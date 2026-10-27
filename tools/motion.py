"""Measure how the pen lines move: how they run against the form, how they wiggle,
and how they repeat.

    python tools/motion.py data/reference.json [--viz out.png]

The form comes from the wash layer alone (the painting without its lines). Its
structure tensor gives, at each point, the direction of the contour (isophote) and
how strongly the form defines one (coherence). Each line is then split into:
  * a spine   — the line smoothed at a scale well above its wiggle (what it draws),
  * a residual — the sideways offset from that spine along its length (how it was drawn).
"""
import argparse
import json

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--viz")
ap.add_argument("--out", help="per-line motion data for animate.js")
ap.add_argument("--form-sigma", type=float, default=6)
ap.add_argument("--spine-sigma", type=float, default=6, help="px of arclength")
ap.add_argument("--link-gap", type=float, default=7)
ap.add_argument("--link-angle", type=float, default=50)
ap.add_argument("--link-color", type=float, default=30)
args = ap.parse_args()

d = json.load(open(args.src))
W, H = d["width"], d["height"]
hex2rgb = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def to_lab(rgb):
    px = np.uint8([[rgb[::-1]]])
    return cv2.cvtColor(px, cv2.COLOR_BGR2LAB)[0, 0].astype(float)


# ---- form field from the washes -------------------------------------------------
form = np.full((H, W, 3), hex2rgb(d["paper"])[::-1], np.uint8)
for w in d["washes"]:
    cv2.fillPoly(form, [np.int32(np.round(w["pts"]))], hex2rgb(w["color"])[::-1])
L = cv2.cvtColor(form, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
L = cv2.GaussianBlur(L, (0, 0), 1.5)
gx, gy = cv2.Sobel(L, cv2.CV_32F, 1, 0), cv2.Sobel(L, cv2.CV_32F, 0, 1)
s = args.form_sigma
Jxx, Jyy, Jxy = (cv2.GaussianBlur(a, (0, 0), s) for a in (gx * gx, gy * gy, gx * gy))
grad_theta = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)  # dominant gradient direction
iso_theta = grad_theta + np.pi / 2  # contour direction
tr = Jxx + Jyy
coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / (tr + 1e-6)
strength = np.sqrt(tr)


# ---- strokes resampled at 1px ---------------------------------------------------
def resample(p, step=1.0):
    p = np.asarray(p, float)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
    if seg[-1] < step:
        return p
    t = np.arange(0, seg[-1], step)
    return np.c_[np.interp(t, seg, p[:, 0]), np.interp(t, seg, p[:, 1])]


strokes = [dict(pts=resample(st["pts"]), lab=to_lab(hex2rgb(st["color"])), color=st["color"], width=st["width"])
           for st in d["strokes"] if len(st["pts"]) > 1]
strokes = [st for st in strokes if len(st["pts"]) > 3]


# ---- link fragments into gestures -----------------------------------------------
# The tracer breaks a continuous pen line wherever it crosses another; re-join
# fragments whose ends meet with a continuing heading and a similar colour.
def end_dir(p, at_end, k=6):
    q = p[-min(k, len(p)):] if at_end else p[:min(k, len(p))][::-1]
    v = q[-1] - q[0]
    return v / (np.linalg.norm(v) + 1e-9)


ends = []  # (stroke idx, at_end)
for i, st in enumerate(strokes):
    ends += [(i, False), (i, True)]
pos = np.array([strokes[i]["pts"][-1 if e else 0] for i, e in ends])
cands = []
for a in range(len(ends)):
    i, ea = ends[a]
    da = end_dir(strokes[i]["pts"], ea)
    near = np.where(np.hypot(*(pos - pos[a]).T) < args.link_gap)[0]
    for b in near:
        j, eb = ends[b]
        if j <= i:
            continue
        db = end_dir(strokes[j]["pts"], eb)
        # leaving a and entering b: heading out of a should match heading into b
        cos = -float(da @ db)
        if cos < np.cos(np.radians(args.link_angle)):
            continue
        if np.linalg.norm(strokes[i]["lab"] - strokes[j]["lab"]) > args.link_color:
            continue
        gap = np.linalg.norm(pos[a] - pos[b])
        cands.append((gap + 8 * (1 - cos), a, b))
cands.sort()
partner = {}
for _, a, b in cands:
    if a in partner or b in partner:
        continue
    partner[a], partner[b] = b, a

gestures, seen = [], set()
for i in range(len(strokes)):
    if i in seen:
        continue
    # walk to one free end of the chain, then collect forwards
    cur, at_end = i, False
    guard = 0
    while (2 * cur + at_end) in partner and guard < len(strokes):
        nb = partner[2 * cur + at_end]
        cur, at_end = ends[nb][0], not ends[nb][1]
        guard += 1
        if cur == i:
            break
    chain, cur, entered_end = [], cur, at_end
    while cur not in seen:
        seen.add(cur)
        p = strokes[cur]["pts"]
        chain.append((cur, p[::-1] if entered_end else p))
        out = 2 * cur + (not entered_end)
        if out not in partner:
            break
        nb = partner[out]
        cur, entered_end = ends[nb][0], ends[nb][1]
    # fragments keep their own colour and width: parts are (stroke, first point, end)
    parts, at = [], 0
    for k, p in chain:
        parts.append((k, at, at + len(p)))
        at += len(p)
    gestures.append(dict(pts=np.vstack([p for _, p in chain]), n=len(chain), parts=parts))


# ---- per-gesture measurements -----------------------------------------------------
def gauss1d(p, sigma):
    k = int(3 * sigma)
    if len(p) < 3 or k < 1:
        return p.copy()
    pad = np.pad(p, ((k, k), (0, 0)), mode="reflect")
    ker = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    ker /= ker.sum()
    return np.c_[np.convolve(pad[:, 0], ker, "valid"), np.convolve(pad[:, 1], ker, "valid")]


def sample(img, p):
    x = np.clip(np.round(p[:, 0]).astype(int), 0, W - 1)
    y = np.clip(np.round(p[:, 1]).astype(int), 0, H - 1)
    return img[y, x]


rows = []
for g in gestures:
    p = g["pts"]
    n = len(p)
    spine = gauss1d(p, args.spine_sigma)
    t = np.gradient(spine, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    nrm = np.c_[-t[:, 1], t[:, 0]]
    resid = np.einsum("ij,ij->i", p - spine, nrm)
    # wiggle: RMS sideways offset, wavelength from zero crossings of the residual
    zc = np.where(np.diff(np.sign(resid)) != 0)[0]
    wl = 2 * np.mean(np.diff(zc)) if len(zc) > 2 else np.nan
    # turning of the raw path per 100px, and of the spine (large-scale bend)
    def turning(q):
        v = np.diff(q, axis=0)
        a = np.unwrap(np.arctan2(v[:, 1], v[:, 0]))
        return np.abs(np.diff(a)).sum(), a[-1] - a[0] if len(a) else 0
    tot_raw, _ = turning(p[::2])
    tot_sp, net_sp = turning(spine[::2])
    # alignment with the form: |cos| between spine tangent and contour direction,
    # weighted by how coherent and strong the form is there
    th = sample(iso_theta, spine)
    w = sample(coh, spine) * np.minimum(sample(strength, spine) / 20, 1)
    align = np.abs(np.cos(np.arctan2(t[:, 1], t[:, 0]) - th))
    rows.append(dict(
        len=n, frags=g["n"], amp=float(np.sqrt(np.mean(resid ** 2))), wl=wl,
        turn_raw=tot_raw / n * 100, turn_spine=tot_sp / n * 100, net_spine=abs(net_sp),
        align=float((align * w).sum() / (w.sum() + 1e-9)), align_w=float(w.mean()),
        mid=p[n // 2],
    ))

lens = np.array([r["len"] for r in rows])
print(f"fragments {len(strokes)} -> gestures {len(gestures)}  "
      f"(chained {sum(r['frags'] > 1 for r in rows)}; max {max(r['frags'] for r in rows)} fragments)")
print("gesture length px: median %.0f  p75 %.0f  p90 %.0f  max %.0f" % tuple(np.percentile(lens, [50, 75, 90, 100])))
tot = lens.sum()
for lo, hi in ((0, 20), (20, 60), (60, 150), (150, 1e9)):
    m = (lens >= lo) & (lens < hi)
    print(f"  {lo:>3}-{hi if hi < 1e9 else '∞':<4}px  n={m.sum():4d}  share of ink {lens[m].sum() / tot:5.1%}")


def wmean(key, m):
    v = np.array([r[key] for r in rows])[m]
    ok = ~np.isnan(v)
    return np.average(v[ok], weights=lens[m][ok])


print("\n(length-weighted)                 short<20   mid 20-60   long>60")
groups = [lens < 20, (lens >= 20) & (lens < 60), lens >= 60]
for key, label in (("amp", "wiggle amplitude px (RMS)"), ("wl", "wiggle wavelength px"),
                   ("turn_raw", "turning rad/100px, raw path"), ("turn_spine", "turning rad/100px, spine"),
                   ("align", "|cos| to form contour")):
    print(f"  {label:<32}" + "".join(f"{wmean(key, m):10.2f}" for m in groups))
print("  (random directions would give |cos| = 0.64; 1 = runs along the contour, 0 = across it)")

# how strongly the form constrains direction where lines are: compare to a shuffled baseline
al = np.array([r["align"] for r in rows])
rng = np.random.default_rng(0)
print(f"\nalignment vs form: lines {np.average(al, weights=lens):.3f}", end="")
base = []
for _ in range(20):
    rot = rng.uniform(0, np.pi, len(rows))
    vals = []
    for r, g, a in zip(rows, gestures, rot):
        sp = gauss1d(g["pts"], args.spine_sigma)
        t = np.gradient(sp, axis=0)
        ang = np.arctan2(t[:, 1], t[:, 0]) + a
        w = sample(coh, sp) * np.minimum(sample(strength, sp) / 20, 1)
        vals.append((np.abs(np.cos(ang - sample(iso_theta, sp))) * w).sum() / (w.sum() + 1e-9))
    base.append(np.average(vals, weights=lens))
print(f"   randomly rotated {np.mean(base):.3f} ± {np.std(base):.3f}")

# echoes: for each gesture, how much of it has a near-parallel neighbour within 6px
mask = np.zeros((H, W), np.int32)
for gi, g in enumerate(gestures):
    for x, y in np.round(g["pts"]).astype(int):
        if 0 <= x < W and 0 <= y < H:
            mask[y, x] = gi + 1
echo = []
for gi, g in enumerate(gestures):
    if len(g["pts"]) < 30:
        continue
    sp = gauss1d(g["pts"], args.spine_sigma)
    t = np.gradient(sp, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    hit = 0
    for k in range(0, len(sp), 3):
        nrm = np.array([-t[k, 1], t[k, 0]])
        for dd in (-6, -4, -3, 3, 4, 6):
            x, y = np.round(sp[k] + nrm * dd).astype(int)
            if 0 <= x < W and 0 <= y < H and mask[y, x] not in (0, gi + 1):
                hit += 1
                break
    echo.append(hit / len(range(0, len(sp), 3)))
print(f"echo: share of long-gesture length with another line 3-6px beside it: {np.mean(echo):.0%}")

if args.viz:
    S = 2
    vis = cv2.resize(form, (W * S, H * S), interpolation=cv2.INTER_LINEAR)
    vis = cv2.addWeighted(vis, 0.35, np.full_like(vis, 255), 0.65, 0)
    # form contour field
    for y in range(8, H, 14):
        for x in range(8, W, 14):
            if coh[y, x] * min(strength[y, x] / 20, 1) < 0.15:
                continue
            c, s_ = np.cos(iso_theta[y, x]), np.sin(iso_theta[y, x])
            a, b = (np.array([x - 5 * c, y - 5 * s_]) * S).astype(int), (np.array([x + 5 * c, y + 5 * s_]) * S).astype(int)
            cv2.line(vis, tuple(a), tuple(b), (170, 170, 170), 1, cv2.LINE_AA)
    # gestures coloured by alignment (blue = along the form, red = across)
    for r, g in zip(rows, gestures):
        col = (int(255 * r["align"]), 60, int(255 * (1 - r["align"])))
        cv2.polylines(vis, [np.int32(g["pts"] * S)], False, col, 1 if r["len"] < 60 else 2, cv2.LINE_AA)
    cv2.imwrite(args.viz, vis)

if args.out:
    # How free each line is to move. Heavy marks in the dark features (lids, irises,
    # nostrils, mouth) carry the likeness and stay nearly put; lines out on bare paper
    # (the loose loops above the head) are the freest.
    form_lab = cv2.cvtColor(form, cv2.COLOR_BGR2LAB).astype(float)
    paper_lab = to_lab(hex2rgb(d["paper"]))
    on_paper = np.linalg.norm(form_lab - paper_lab, axis=2) < 10
    out = []
    for g, r in zip(gestures, rows):
        p = g["pts"]
        sp = gauss1d(p, args.spine_sigma)
        t = np.gradient(sp, axis=0)
        t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
        width = np.average([strokes[k]["width"] for k, a, b in g["parts"]], weights=[b - a for k, a, b in g["parts"]])
        dark = np.median(sample(form_lab[..., 0], p)) < 110
        free = 0.3 if (width >= 2.5 or dark) else 1 + 0.6 * sample(on_paper, p).mean()
        wl = r["wl"] if np.isfinite(r["wl"]) else 30
        out.append(dict(
            pts=np.round(p, 1).tolist(), tan=np.round(t, 2).tolist(),
            wl=round(float(np.clip(wl, 12, 60)), 1), align=round(r["align"], 2), free=round(float(free), 2),
            parts=[dict(c=strokes[k]["color"], w=strokes[k]["width"], a=a, b=b) for k, a, b in g["parts"]],
        ))
    json.dump(dict(width=W, height=H, paper=d["paper"], gestures=out), open(args.out, "w"), separators=(",", ":"))
    fr = np.array([o["free"] for o in out])
    print(f"wrote {args.out}: {len(out)} lines; anchored {np.sum(fr < 0.5)}, loose {np.sum(fr > 1.2)}")
