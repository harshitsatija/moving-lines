"""Side-by-side zoomed crops of reference vs render, for eyeballing what differs.

    python tools/crops.py data/reference.png render.png out.png x0,y0,x1,y1 [...]
"""
import sys

import cv2
import numpy as np

ref = cv2.imread(sys.argv[1])
H, W = ref.shape[:2]
ren = cv2.resize(cv2.imread(sys.argv[2]), (W, H), interpolation=cv2.INTER_AREA)
rows = []
for box in sys.argv[4:]:
    x0, y0, x1, y1 = map(int, box.split(","))
    z = 400 / (x1 - x0)
    a = cv2.resize(ref[y0:y1, x0:x1], None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC)
    b = cv2.resize(ren[y0:y1, x0:x1], None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC)
    rows.append(np.hstack([a, np.full((a.shape[0], 6, 3), 40, np.uint8), b]))
w = max(r.shape[1] for r in rows)
cv2.imwrite(sys.argv[3], np.vstack([np.pad(r, ((0, 6), (0, w - r.shape[1]), (0, 0))) for r in rows]))
