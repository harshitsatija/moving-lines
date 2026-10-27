"""Decompose a pen-and-watercolor painting into strokes p5.brush can replay.

    python tools/decompose.py data/reference.png data/reference.json [--preview out.png]

Two layers, mirroring how the painting was made:
  * pen lines  — ridges darker than their surroundings, at two scales (fine lines and
    hatching; heavy lid/iris/mouth marks). Thinned to a skeleton, traced into
    smoothed polylines, coloured by un-blending the paper from the source.
  * washes     — the painting with the fine lines inpainted away, painted coarse to
    fine: broad regions, then detail regions only where the broad layer misses.
"""
import argparse
import json

import cv2
import numpy as np
from skimage.morphology import skeletonize

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--preview")
ap.add_argument("--bg-kernel", type=int, default=15)
ap.add_argument("--colors", type=int, default=36)
ap.add_argument("--min-stroke", type=int, default=8)
ap.add_argument("--coverage", type=float, default=0.85, help="lightness coverage of a line's core pixel")
ap.add_argument("--chroma-coverage", type=float, default=0.3,
                help="chroma coverage: JPEG 4:2:0 stores colour at half resolution, so thin lines lose most of their hue")
ap.add_argument("--smooth", type=float, default=1.5, help="gaussian sigma (in skeleton steps) along each stroke")
ap.add_argument("--hp-sigma", type=float, default=1.5)
ap.add_argument("--hp-strong", type=float, default=6)
ap.add_argument("--hp-weak", type=float, default=3)
ap.add_argument("--heavy-sigma", type=float, default=3.5)
ap.add_argument("--heavy-strong", type=float, default=22, help="0 disables the heavy-mark pass")
ap.add_argument("--heavy-weak", type=float, default=12)
ap.add_argument("--heavy-min-width", type=float, default=2.5)
ap.add_argument("--wash-smooth", type=int, default=1, help="bilateral passes before quantising")
ap.add_argument("--min-area", type=int, default=25)
ap.add_argument("--poly-eps", type=float, default=1.5)
ap.add_argument("--chaikin", type=int, default=1)
ap.add_argument("--grow", type=int, default=2)
ap.add_argument("--base-colors", type=int, default=16)
ap.add_argument("--base-min-area", type=int, default=150)
ap.add_argument("--base-sp", type=int, default=12, help="mean-shift spatial radius for the broad layer")
ap.add_argument("--base-sr", type=int, default=24, help="mean-shift colour radius for the broad layer")
ap.add_argument("--detail-err", type=float, default=8, help="add detail washes where the broad layer is off by more (Lab)")
ap.add_argument("--fine-err", type=float, default=14)
ap.add_argument("--fine-colors", type=int, default=48)
ap.add_argument("--dark-l", type=float, default=95, help="Lab L (0-255) below which an area is dark paint")
ap.add_argument("--wiggle-len", type=float, default=40)
ap.add_argument("--wiggle-ratio", type=float, default=1.8)
ap.add_argument("--keep-dark-l", type=float, default=85, help="Lab L (0-255) below which pixels stay in the washes")
ap.add_argument("--thick", type=float, default=2.5, help="marks wider than this (px) stay in the wash layer")
args = ap.parse_args()

img = cv2.imread(args.src)
H, W = img.shape[:2]
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)

# Props in the reference photo (brush handle bottom-left, pen bottom-right) are not
# part of the painting; mask them out so they produce neither strokes nor washes.
props = np.zeros((H, W), np.uint8)
if (W, H) == (480, 638):
    cv2.fillPoly(props, [np.array([[22, 405], [56, 392], [168, 638], [108, 638]])], 255)
    cv2.fillPoly(props, [np.array([[422, 385], [470, 400], [376, 638], [318, 638]])], 255)

# ---------------------------------------------------------------- pen lines
bg = cv2.medianBlur(img, args.bg_kernel)
blab = cv2.cvtColor(bg, cv2.COLOR_BGR2LAB).astype(np.float32)
dL = np.clip(blab[..., 0] - lab[..., 0], 0, None)
dC = np.sqrt(((lab[..., 1:] - blab[..., 1:]) ** 2).sum(-1))
score = dL + 0.6 * dC
Lf = lab[..., 0]
N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def ridges(sigma):
    """How much darker each pixel is than its `sigma` neighbourhood: thin ridges."""
    return np.clip(cv2.GaussianBlur(Lf, (0, 0), sigma) - Lf, 0, None)


def trace_lines(line_score, strong_t, weak_t, min_len):
    """Hysteresis mask → skeleton → polylines. Returns (polylines, mask, width map)."""
    weak = ((line_score > weak_t) & (props == 0)).astype(np.uint8)
    _, cc = cv2.connectedComponents(weak, connectivity=8)
    strong_ids = np.unique(cc[(line_score > strong_t) & (weak > 0)])
    mask = np.isin(cc, strong_ids[strong_ids > 0]).astype(np.uint8)
    skel = skeletonize(mask > 0).astype(np.uint8)
    # width from the ink core (strong pixels), not the halo the hysteresis lets in
    core = ((line_score > strong_t) & (mask > 0)).astype(np.uint8)
    dist = cv2.distanceTransform(core, cv2.DIST_L2, 3)

    # Walk the skeleton graph. At junctions a walk continues along the neighbour that
    # bends least, so crossing pen strokes stay whole.
    ys, xs = np.nonzero(skel)
    pix = set(zip(ys.tolist(), xs.tolist()))
    nbrs = {p: [(p[0] + dy, p[1] + dx) for dy, dx in N8 if (p[0] + dy, p[1] + dx) in pix] for p in pix}
    used = set()
    edge = lambda a, b: (a, b) if a < b else (b, a)

    def walk(start, nxt):
        path = [start, nxt]
        used.add(edge(start, nxt))
        while True:
            cur, prev = path[-1], path[-2]
            d = (cur[0] - prev[0], cur[1] - prev[1])
            cands = [n for n in nbrs[cur] if edge(cur, n) not in used and n != prev]
            if not cands:
                return path
            n = max(cands, key=lambda n: (n[0] - cur[0]) * d[0] + (n[1] - cur[1]) * d[1])
            if (n[0] - cur[0]) * d[0] + (n[1] - cur[1]) * d[1] < 0:
                return path
            used.add(edge(cur, n))
            path.append(n)

    polylines = []
    for p in sorted(pix, key=lambda p: len(nbrs[p])):  # endpoints first
        for n in nbrs[p]:
            if edge(p, n) not in used:
                path = walk(p, n)
                if len(path) >= min_len:
                    polylines.append(path)
    return link(polylines), mask, dist


def heading(path, at_end):
    a, b = (path[-1], path[-4 if len(path) > 4 else 0]) if at_end else (path[0], path[3 if len(path) > 4 else -1])
    v = np.array([a[0] - b[0], a[1] - b[1]], float)
    return v / (np.linalg.norm(v) + 1e-6)


def link(polylines):
    """Join polylines whose ends nearly touch and keep heading the same way."""
    merged = True
    while merged:
        merged = False
        for i, pl in enumerate(polylines):
            if pl is None:
                continue
            ey, ex = pl[-1]
            hi = heading(pl, True)
            best, bd = None, 6.0
            for j, q in enumerate(polylines):
                if j == i or q is None:
                    continue
                for rev in (False, True):
                    qq = q[::-1] if rev else q
                    d = np.hypot(qq[0][0] - ey, qq[0][1] - ex)
                    if d < bd and np.dot(hi, -heading(qq, False)) > 0.6:
                        best, bd = (j, rev), d
            if best:
                j, rev = best
                polylines[i] = pl + (polylines[j][::-1] if rev else polylines[j])
                polylines[j] = None
                merged = True
        polylines = [p for p in polylines if p is not None]
    return polylines


def smooth_path(path, sigma):
    """Gaussian-smooth a pixel path along its length; skeletons zig-zag by a pixel."""
    a = np.array(path, np.float32)
    if sigma <= 0 or len(a) < 5:
        return a
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((r, r), (0, 0)), mode="edge")
    out = np.stack([np.convolve(pad[:, i], k, mode="valid") for i in range(2)], 1)
    out[0], out[-1] = a[0], a[-1]
    return out


dropped = {"dark": 0, "wiggle": 0}


def to_strokes(polylines, dist, heavy):
    """Polylines → stroke records with smoothed points, un-blended colour and width.

    Pen colours: a 1-2px line in a small JPEG keeps its darkness but loses most of
    its hue (chroma is stored at half resolution and averaged with the paper), so
    un-blend in Lab — gently for lightness, strongly for chroma.
    """
    out = []
    for path in polylines:
        sm = smooth_path(path, args.smooth)[:, ::-1]  # → (x, y)
        ys_, xs_ = np.array(path).T
        if not heavy:
            # Inside dark painted masses (iris, nostrils) fine ridges are paint
            # texture, not pen; the heavy pass and the washes carry those areas.
            if (blab[ys_, xs_, 0] < args.dark_l).mean() > 0.6:
                dropped["dark"] += 1
                continue
            # Short real strokes are nearly straight hatching; short paths that
            # wander are texture traced as a squiggle.
            seg = np.linalg.norm(np.diff(sm, axis=0), axis=1).sum()
            if seg < args.wiggle_len and seg > args.wiggle_ratio * max(np.linalg.norm(sm[-1] - sm[0]), 1):
                dropped["wiggle"] += 1
                continue
        approx = cv2.approxPolyDP(sm.reshape(-1, 1, 2).astype(np.float32), 0.5, False).reshape(-1, 2)
        inks, widths = [], []
        for y, x in path[:: max(1, len(path) // 16)]:
            y0, y1, x0, x1 = max(0, y - 1), min(H, y + 2), max(0, x - 1), min(W, x + 2)
            win = score[y0:y1, x0:x1]
            iy, ix = np.unravel_index(np.argmax(win), win.shape)
            p, b = lab[y0 + iy, x0 + ix], blab[y0 + iy, x0 + ix]
            ink = b.copy()
            ink[0] = b[0] + (p[0] - b[0]) / args.coverage
            ink[1:] = b[1:] + (p[1:] - b[1:]) / args.chroma_coverage
            inks.append(np.clip(ink, 0, 255))
            widths.append(dist[y, x] * 2)
        ink = cv2.cvtColor(np.median(np.array(inks), axis=0).astype(np.uint8).reshape(1, 1, 3), cv2.COLOR_LAB2RGB)[0, 0]
        out.append({
            "color": "#%02x%02x%02x" % tuple(int(c) for c in ink),
            "width": round(float(np.clip(np.median(widths), 0.8, 5 if heavy else 3)), 2),
            "pts": np.round(approx, 1).tolist(),
        })
    return out


# Two scales of pen: fine ridges (most lines, hatching kept separate) and heavy
# marks (lid lines, iris rings, the mouth line) that a fine high-pass only sees
# at their edges.
fine_lines, mask, dist = trace_lines(ridges(args.hp_sigma), args.hp_strong, args.hp_weak, args.min_stroke)
strokes = to_strokes(fine_lines, dist, heavy=False)
if args.heavy_strong > 0:
    heavy_lines, heavy_mask, heavy_dist = trace_lines(ridges(args.heavy_sigma), args.heavy_strong,
                                                      args.heavy_weak, args.min_stroke)
    # only genuinely wide marks; narrower ones are already traced by the fine pass
    strokes += [h for h in to_strokes(heavy_lines, heavy_dist, heavy=True) if h["width"] >= args.heavy_min_width]

# ---------------------------------------------------------------- washes
# Very dark pixels (iris rings, nostrils, the lid line) are inked masses, not thin
# lines over a wash: keep them in the wash layer instead of inpainting them away.
thick = cv2.dilate((dist * 2 > args.thick).astype(np.uint8), np.ones((5, 5), np.uint8))
inky = (cv2.erode((Lf < args.keep_dark_l).astype(np.uint8), np.ones((2, 2), np.uint8)) > 0).astype(np.uint8)
hole = (cv2.dilate(mask, np.ones((3, 3), np.uint8)) & (1 - thick) & (1 - inky)) | (props > 0)
wash_img = cv2.inpaint(img, hole * 255, 5, cv2.INPAINT_TELEA)
smooth = wash_img
for _ in range(args.wash_smooth):
    smooth = cv2.bilateralFilter(smooth, 9, 40, 9)
near_props = cv2.dilate(props, np.ones((9, 9), np.uint8)) > 0
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)


def is_paper(bgr):
    """Bright, near-neutral areas are paper under the photo's lighting, not paint."""
    lab_ = cv2.cvtColor(np.uint8([[bgr]]), cv2.COLOR_BGR2LAB)[0, 0].astype(float)
    return lab_[0] > 175 and np.hypot(lab_[1] - 128, lab_[2] - 128) < 7


def regions(src, n_colors, min_area, keep=lambda comp: True, grow=None):
    """Quantise `src` into colour regions; one polygon per connected component."""
    grow = args.grow if grow is None else grow
    slab = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.float32)
    _, labels, _ = cv2.kmeans(slab.reshape(-1, 3), n_colors, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    labels = cv2.medianBlur(labels.reshape(H, W).astype(np.uint8), 5)
    out = []
    for k in range(n_colors):
        region = ((labels == k) & (props == 0)).astype(np.uint8)
        n, cc, stats, _ = cv2.connectedComponentsWithStats(region, 8)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < min_area:
                continue
            comp = (cc == i).astype(np.uint8)
            if (comp & near_props).sum() > 0.3 * comp.sum() or not keep(comp):
                continue
            mean = cv2.mean(wash_img, comp)[:3]
            if is_paper(mean):
                continue
            # overlap neighbours slightly, as overlapping washes do, so no paper seams show
            grown = cv2.dilate(comp, np.ones((3, 3), np.uint8), iterations=grow) if grow else comp
            contours, _ = cv2.findContours(grown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            c = max(contours, key=cv2.contourArea)
            approx = cv2.approxPolyDP(c, args.poly_eps, True).reshape(-1, 2).astype(np.float32)
            if len(approx) < 3:
                continue
            for _ in range(args.chaikin):  # corner-cutting softens the polygon's facets
                q = np.roll(approx, -1, 0)
                approx = np.stack([0.75 * approx + 0.25 * q, 0.25 * approx + 0.75 * q], 1).reshape(-1, 2)
            out.append({
                "color": "#%02x%02x%02x" % (int(mean[2]), int(mean[1]), int(mean[0])),
                "area": int(stats[i, cv2.CC_STAT_AREA]),
                "pts": np.round(approx, 1).tolist(),
            })
    return sorted(out, key=lambda w: -w["area"])


def raster(ws, base):
    out = base.copy()
    for w in ws:
        c = tuple(int(w["color"][i:i + 2], 16) for i in (5, 3, 1))
        cv2.fillPoly(out, [np.array(w["pts"]).astype(np.int32)], c)
    return out


# Coarse-to-fine, as a watercolourist works (and as in Hertzmann's layered
# painterly rendering): broad flat washes from a strongly smoothed image, then
# smaller washes only where the broad layer still misses the painting.
wl = cv2.cvtColor(wash_img, cv2.COLOR_BGR2LAB).astype(np.float32)
paperish = (wl[..., 0] > 200) & (np.hypot(wl[..., 1] - 128, wl[..., 2] - 128) < 6) & (props == 0)
paper_bgr = np.percentile(wash_img[paperish], 70, axis=0).astype(np.uint8)  # unshadowed paper
base_src = cv2.pyrMeanShiftFiltering(wash_img, args.base_sp, args.base_sr)
washes = regions(base_src, args.base_colors, args.base_min_area)
for w in washes:
    w["layer"] = 0
if args.detail_err > 0:
    base_img = raster(washes, np.full_like(img, paper_bgr))
    err = np.sqrt(((cv2.cvtColor(base_img, cv2.COLOR_BGR2LAB).astype(np.float32)
                    - cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB).astype(np.float32)) ** 2).sum(-1))
    detail = regions(smooth, args.colors, args.min_area,
                     keep=lambda comp: cv2.mean(err, comp)[0] > args.detail_err)
    for w in detail:
        w["layer"] = 1
    washes += detail
if args.fine_err > 0:
    # small exact patches where the painting is most detailed (eyes, nostrils, mouth)
    sofar = raster(washes, np.full_like(img, paper_bgr))
    err = np.sqrt(((cv2.cvtColor(sofar, cv2.COLOR_BGR2LAB).astype(np.float32)
                    - cv2.cvtColor(wash_img, cv2.COLOR_BGR2LAB).astype(np.float32)) ** 2).sum(-1))
    fine = regions(wash_img, args.fine_colors, 6, grow=0, keep=lambda comp: cv2.mean(err, comp)[0] > args.fine_err)
    for w in fine:
        w["layer"] = 2
    washes += fine
paper_rgb = paper_bgr[::-1]

json.dump({
    "width": W, "height": H,
    "paper": "#%02x%02x%02x" % tuple(int(c) for c in paper_rgb),
    "washes": washes, "strokes": strokes,
}, open(args.out, "w"))
print(f"{len(strokes)} strokes (dropped {dropped}), {len(washes)} washes, paper {paper_rgb}")

if args.preview:
    pv = np.full_like(img, paper_rgb[::-1])
    for w in washes:
        c = tuple(int(w["color"][i:i + 2], 16) for i in (5, 3, 1))
        cv2.fillPoly(pv, [np.array(w["pts"]).astype(np.int32)], c)
    for s in strokes:
        c = tuple(int(s["color"][i:i + 2], 16) for i in (5, 3, 1))
        ov = pv.copy()
        cv2.polylines(ov, [np.array(s["pts"]).astype(np.int32)], False, c, max(1, int(round(s["width"] * 0.6))), cv2.LINE_AA)
        a = 0.9
        m = (ov != pv).any(-1)
        pv[m] = (a * ov[m] + (1 - a) * pv[m]).astype(np.uint8)
    cv2.imwrite(args.preview, np.hstack([img, pv]))
