"""Score a render against the reference painting.

    python tools/score.py data/reference.png render.png [--diff out.png]

colour : mean Lab distance between the two images blurred (sigma 2) — washes and value
lines  : precision / recall / F1 of the pen-line maps, 1px tolerance — the drawing
Props (brush, pen) in the reference are excluded from both.
"""
import argparse

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("ref")
ap.add_argument("render")
ap.add_argument("--diff")
args = ap.parse_args()

ref = cv2.imread(args.ref)
H, W = ref.shape[:2]
ren = cv2.resize(cv2.imread(args.render), (W, H), interpolation=cv2.INTER_AREA)

valid = np.full((H, W), 255, np.uint8)
if (W, H) == (480, 638):
    cv2.fillPoly(valid, [np.array([[22, 405], [56, 392], [168, 638], [108, 638]])], 0)
    cv2.fillPoly(valid, [np.array([[422, 385], [470, 400], [376, 638], [318, 638]])], 0)
v = valid > 0


def lab(i):
    return cv2.cvtColor(i, cv2.COLOR_BGR2LAB).astype(np.float32)


def lines(i):
    bg = cv2.medianBlur(i, 15)
    a, b = lab(i), lab(bg)
    s = np.clip(b[..., 0] - a[..., 0], 0, None) + 0.6 * np.sqrt(((a[..., 1:] - b[..., 1:]) ** 2).sum(-1))
    return (s > 22) & v


cdist = np.sqrt(((lab(cv2.GaussianBlur(ref, (0, 0), 2)) - lab(cv2.GaussianBlur(ren, (0, 0), 2))) ** 2).sum(-1))
colour = float(cdist[v].mean())

lr, ln = lines(ref), lines(ren)
k = np.ones((3, 3), np.uint8)
prec = float((ln & cv2.dilate(lr.astype(np.uint8), k).astype(bool)).sum() / max(1, ln.sum()))
rec = float((lr & cv2.dilate(ln.astype(np.uint8), k).astype(bool)).sum() / max(1, lr.sum()))
f1 = 2 * prec * rec / max(1e-6, prec + rec)
# per-layer colour: on the reference's line pixels (does ink have the right hue/value?)
# and on wash pixels away from lines (are the washes the right colour?)
raw = np.sqrt(((lab(ref) - lab(ren)) ** 2).sum(-1))
near = cv2.dilate(lr.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
ink_err = float(raw[lr].mean())
# position-tolerant ink colour: best render match within 2px of each reference line pixel
rl, nl = lab(ref), lab(ren)
best = np.full((H, W), 1e9, np.float32)
for dy in range(-2, 3):
    for dx in range(-2, 3):
        sh = np.roll(np.roll(nl, dy, 0), dx, 1)
        best = np.minimum(best, np.sqrt(((rl - sh) ** 2).sum(-1)))
ink_tol = float(best[lr].mean())
wash_err = float(cdist[v & ~near].mean())
print(f"colour {colour:.2f}  ink {ink_err:.2f} inkTol {ink_tol:.2f}  wash {wash_err:.2f}  lines P {prec:.3f} R {rec:.3f} F1 {f1:.3f}  (ink px ref {lr.sum()} render {ln.sum()})")

if args.diff:
    vis = np.zeros((H, W, 3), np.uint8)
    vis[lr & ~ln] = (0, 0, 255)      # missed lines: red
    vis[ln & ~lr] = (255, 120, 0)    # extra lines: blue
    vis[lr & ln] = (255, 255, 255)   # matched: white
    heat = cv2.applyColorMap(np.clip(cdist * 6, 0, 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    cv2.imwrite(args.diff, np.hstack([ref, ren, vis, heat]))
