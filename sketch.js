// Scribble portrait — watercolor planes under multicolor fineliner, after the
// mixed-media style of loose watercolor + pen portraits.
//
// How the style works (and how this sketch is organised):
//  1. Washes are facets of the head's planes: cool grey-violet on the shadow
//     side, warm orange on the lit side, dark accents in the sockets, beside
//     the nose and under it; highlights are bare paper.
//  2. Every line describes form. Each contour (lids, orbital rims, nose sides,
//     lips, chin, jaw) is restated several times in different colours, offset
//     and overshooting — the searching line.
//  3. Hatching is value: dense back-and-forth strokes confined to shadow planes.
//  4. Dark ink is reserved for the features: eyes, nostrils, mouth line.
//  5. Only the hair escapes into free loops.
// Rendering is queued as jobs and painted progressively across frames.

const W = 750, H = 1000;
const PAPER = "#f4f0e9";

// The face is measured on a 480x638 reference sheet; R() maps it onto the canvas.
const REF_W = 480, REF_CX = 240, REF_CY = 319;
const S = W / REF_W;
let OX = 0, OY = 0; // per-portrait drift of the whole face, in ref units
let warp = null;     // optional ref→ref deformation fitted to a photo's face
const R = (x, y) => {
  const [u, v] = warp ? warp(x + OX, y + OY) : [x + OX, y + OY];
  return [(u - REF_CX) * S, (v - REF_CY) * S];
};

const WASH = {
  peach: "#eba37a", orange: "#e0672e", burnt: "#c04a1d", rose: "#d98572",
  ochre: "#d9993f", teal: "#2f8f90", deepTeal: "#1d5f5e", blue: "#6b93bb",
  slate: "#566a86", lilac: "#8572ad", red: "#b3221c", grey: "#8c949c",
  umber: "#6b544a", night: "#36405a",
};
const INK = {
  purple: "#5d2a8c", violet: "#7d52c7", orange: "#e8582a", red: "#d22f2c",
  teal: "#178a8a", navy: "#1e2a58", brown: "#6a3426", magenta: "#b0307a",
  green: "#3c8c5a", black: "#1b1a22", amber: "#d08a22", blue: "#2f5fb5",
};
const DARK = ["navy", "black", "purple", "brown"];

// ---------------------------------------------------------------- form model
// Measured from the reference (ref units). "L"/"R" are the viewer's left/right;
// the light comes from the viewer's right, so the left side is the shadow side.
const FACE = {
  outlineL: [[52, 205], [44, 260], [46, 320], [52, 380], [62, 430], [80, 480], [104, 530], [140, 570], [185, 600]],
  outlineR: [[436, 195], [446, 250], [440, 310], [425, 370], [405, 430], [385, 485], [360, 530], [330, 570], [295, 600]],
  socketTopL: [[48, 238], [56, 196], [82, 168], [122, 156], [162, 160], [190, 178], [202, 202]],
  socketTopR: [[256, 198], [276, 172], [318, 158], [362, 162], [392, 180], [404, 215], [400, 246]],
  socketLowL: [[58, 270], [82, 292], [122, 302], [162, 296], [194, 276]],
  socketLowR: [[268, 274], [298, 295], [340, 301], [380, 290], [404, 262]],
  cheekL: [[48, 318], [86, 334], [130, 338], [174, 326]],
  cheekR: [[432, 298], [398, 332], [350, 350], [300, 357]],
  noseL: [[176, 196], [196, 236], [206, 292], [210, 340], [203, 366], [189, 378], [183, 395], [196, 406]],
  noseR: [[262, 198], [254, 250], [256, 300], [263, 345], [274, 372], [285, 398], [280, 416]],
  noseBall: [[198, 406], [212, 426], [240, 431], [268, 426], [282, 410]],
  noseTip: [[222, 400], [240, 393], [260, 400]],
  nostrilL: [212, 418, 13, 8, 0.4],
  nostrilR: [267, 417, 13, 7, -0.4],
  nasoL: [[186, 408], [172, 442], [162, 480]],
  nasoR: [[290, 414], [312, 450], [318, 488]],
  philtrumL: [[230, 436], [228, 465]],
  philtrumR: [[250, 436], [251, 465]],
  lipTop: [[166, 490], [193, 471], [225, 464], [238, 468], [251, 464], [280, 472], [307, 490]],
  mouth: [[162, 491], [200, 489], [238, 487], [275, 488], [310, 492]],
  lipBottom: [[172, 495], [195, 516], [238, 524], [281, 513], [304, 494]],
  chin: [[198, 556], [205, 590], [238, 611], [272, 600], [287, 560]],
  chinCrease: [[202, 551], [238, 545], [272, 551]],
  eyeL: { cx: 126, cy: 249, outer: [68, 256], inner: [186, 246], top: 232, bottom: 267, iris: 27 },
  eyeR: { cx: 329, cy: 245, outer: [392, 248], inner: [276, 250], top: 224, bottom: 265, iris: 26 },
  browL: [[90, 184], [112, 173], [142, 168], [174, 177]],
  browR: [[250, 192], [280, 179], [320, 170], [356, 171], [384, 183]],
};

let jobs = [];
let grain = null; // cold-press paper texture, multiplied over the finished painting
let mode = "procedural";
let photoWarp = null; // TPS fitted to the uploaded photo's landmarks
let seed = 1;

// ---------------------------------------------------------------- setup / loop

function setup() {
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  createCanvas(W, H, WEBGL);
  brush.scaleBrushes(2.2);

  // Fineliner nibs in canvas units (added after scaleBrushes, so unscaled).
  brush.add("fineliner", {
    type: "default", weight: 2.3, scatter: 0.12, sharpness: 0.85, grain: 1,
    opacity: 225, spacing: 0.15, pressure: [1.1, 1, 0.75], rotate: "none", noise: 0.25,
  });
  brush.add("felt", {
    type: "default", weight: 3.0, scatter: 0.25, sharpness: 0.7, grain: 1,
    opacity: 225, spacing: 0.15, pressure: [0.8, 1.15, 0.7], rotate: "none", noise: 0.3,
  });
  brush.add("hairline", {
    type: "default", weight: 1.9, scatter: 0.1, sharpness: 0.9, grain: 1,
    opacity: 215, spacing: 0.2, pressure: [1, 0.6], rotate: "none", noise: 0.35,
  });

  grain = paperGrain();
  wireUI();
  const q = new URLSearchParams(location.search).get("seed");
  start(q ? Number(q) : Math.floor(Math.random() * 1e6));
}

function draw() {
  const budget = 40, t0 = performance.now();
  while (jobs.length && performance.now() - t0 < budget) jobs.shift()();
  status(jobs.length ? `painting… ${jobs.length} marks left` : `seed ${seed} · R new · S save`);
  if (!jobs.length) noLoop();
}

function start(s) {
  seed = s;
  randomSeed(seed);
  noiseSeed(seed);
  jobs = [];
  background(PAPER);
  warp = mode === "photo" ? photoWarp : null;
  buildFace();
  jobs.push(() => {
    push();
    blendMode(MULTIPLY);
    image(grain, -W / 2, -H / 2, W, H);
    pop();
  });
  loop();
}

// Speckled tooth plus soft low-frequency mottling, near-white so MULTIPLY only darkens a touch.
function paperGrain() {
  const g = createGraphics(W, H);
  g.pixelDensity(1);
  g.loadPixels();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = noise(x * 0.012, y * 0.012) * 10 + noise(x * 0.15, y * 0.15) * 8;
    const v = 255 - m - (Math.random() < 0.06 ? Math.random() * 14 : Math.random() * 4);
    const i = (y * W + x) * 4;
    g.pixels[i] = v; g.pixels[i + 1] = v - 1; g.pixels[i + 2] = v - 3; g.pixels[i + 3] = 255;
  }
  g.updatePixels();
  return g;
}

function keyPressed() {
  if (key === "r" || key === "R") start(Math.floor(Math.random() * 1e6));
  if (key === "s" || key === "S") saveCanvas(`scribble-portrait-${seed}`, "png");
  if (key === "p" || key === "P") { mode = "procedural"; start(seed); }
}

function wireUI() {
  document.getElementById("regen").onclick = () => start(Math.floor(Math.random() * 1e6));
  document.getElementById("save").onclick = () => saveCanvas(`scribble-portrait-${seed}`, "png");
  document.getElementById("procedural").onclick = () => { mode = "procedural"; start(seed); };
  document.getElementById("file").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = async () => {
      status("looking for a face…");
      const fit = await faceWarp(img).catch((err) => { console.warn(err); return null; });
      if (!fit) { status("no face found in that photo"); return; }
      photoWarp = fit;
      mode = "photo";
      start(seed);
    };
    img.src = URL.createObjectURL(f);
  };
}

function status(msg) { document.getElementById("status").textContent = msg; }

// ---------------------------------------------------------------- primitives

// Queue a watercolor wash over a polygon (canvas units).
function wash(color, pts, opacity = 110, bleed = 0.25, texture = 0.5, border = 0.7) {
  jobs.push(() => {
    brush.noStroke();
    brush.noHatch();
    brush.fill(color, opacity);
    brush.fillBleed(bleed);
    brush.fillTexture(texture, border);
    brush.polygon(pts);
    brush.noFill();
  });
}

// Queue a flat, opaque ink fill (canvas units) — for pupils, lids and nostrils,
// where the watercolor fill's pooled rim would leave a hollow centre.
function solid(color, pts, opacity = 240) {
  jobs.push(() => {
    brush.noStroke();
    brush.noFill();
    brush.noHatch();
    brush.wash(color, opacity);
    brush.polygon(pts);
    brush.noWash();
  });
}

// Queue an ink line through points (canvas units).
function ink(color, pts, nib = "fineliner", weight = 1, curvature = 0.5) {
  if (pts.length < 2) return;
  jobs.push(() => {
    brush.noFill();
    brush.set(nib, INK[color] || color, weight);
    brush.spline(pts, curvature);
  });
}

// A hard-edged facet: a ref-space polygon with hand-laid wobble on its corners.
function facet(c, refPts, op = 140, bleed = 0.18, edge) {
  op = Math.min(255, op * 1.2);
  const corners = refPts.map(([x, y]) => [x + random(-7, 7), y + random(-7, 7)]);
  const pts = [];
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % corners.length];
    const len = dist(x1, y1, x2, y2), nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
    const k = Math.max(1, Math.round(len / 12));
    for (let j = 0; j < k; j++) {
      const t = j / k + (j ? random(-0.2, 0.2) / k : 0), push = j ? random(-0.22, 0.22) * Math.min(len, 45) : 0;
      pts.push([x1 + (x2 - x1) * t + nx * push, y1 + (y2 - y1) * t + ny * push]);
    }
  }
  wash(WASH[c] || c, pts.map(([x, y]) => R(x, y)), op, bleed, 0.5, 0.8);
  // the pen often runs along a wash edge, restating the plane boundary
  if (edge) {
    const s0 = floor(random(pts.length)), n = floor(pts.length * random(0.35, 0.65));
    const run = Array.from({ length: n }, (_, k) => pts[(s0 + k) % pts.length]);
    trace(run, edge, { passes: random() < 0.5 ? 1 : 2, amp: 2.5, nib: "hairline", partial: 0 });
  }
}

// A soft wet-in-wet pool (ref centre and radii).
function pool(c, x, y, rx, ry, op = 110, bleed = 0.45) {
  wash(WASH[c] || c, blob(x, y, rx, ry, random(-0.3, 0.3), 0.3).map(([px, py]) => R(px, py)), op, bleed, 0.35, 0.5);
}

// Smooth round-ish blob (any units).
function blob(cx, cy, rx, ry, rot = 0, wobble = 0.22, n = 22) {
  const out = [], off = random(1000);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TWO_PI;
    const k = 1 + wobble * (noise(off + cos(a) * 1.3, off + sin(a) * 1.3) - 0.5) * 2;
    const x = cos(a) * rx * k, y = sin(a) * ry * k;
    out.push([cx + x * cos(rot) - y * sin(rot), cy + x * sin(rot) + y * cos(rot)]);
  }
  return out;
}

// Catmull-Rom resample of a polyline.
function resample(pts, n) {
  const out = [];
  const P = (i) => pts[constrain(i, 0, pts.length - 1)];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (pts.length - 1);
    const i = Math.floor(Math.min(t, pts.length - 1.0001));
    const u = t - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c = (a, b, c2, d) =>
      0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

// Noise-displaced copy of a path: slow drift + faster tremor + a whole-stroke shift.
function jitter(pts, amp) {
  const off = random(1000);
  const sx = random(-amp, amp) * 0.6, sy = random(-amp, amp) * 0.6;
  return pts.map(([x, y], i) => [
    x + sx + (noise(off + i * 0.09, 0) - 0.5) * 3 * amp + (noise(off + i * 0.5, 9) - 0.5) * amp * 0.8,
    y + sy + (noise(off + i * 0.09, 50) - 0.5) * 3 * amp + (noise(off + i * 0.5, 59) - 0.5) * amp * 0.8,
  ]);
}

// Restate a contour several times: each pass offset, recoloured, overshooting
// its ends, sometimes only a stretch of it — the searching line.
function trace(refPts, colors, { passes = 4, amp = 4, nib = "fineliner", weight = 1, overshoot = 0.15, partial = 0.3, spread = 0 } = {}) {
  const base = resample(refPts, Math.max(24, refPts.length * 8));
  for (let p = 0; p < passes; p++) {
    let path = base;
    if (spread) {
      // echo: shift the whole contour along its normal, tapering at the ends
      const off = random(-spread, spread);
      path = base.map(([x, y], i) => {
        const [ax, ay] = base[Math.max(0, i - 1)], [bx, by] = base[Math.min(base.length - 1, i + 1)];
        const l = dist(ax, ay, bx, by) || 1, taper = sin((i / (base.length - 1)) * PI) * 0.7 + 0.3;
        return [x - ((by - ay) / l) * off * taper, y + ((bx - ax) / l) * off * taper];
      });
    }
    path = jitter(path, amp * random(0.5, 1.4));
    const a = path[0], b = path[3], y = path[path.length - 1], z = path[path.length - 4];
    const os = overshoot * random(0, 2);
    path.unshift([a[0] + (a[0] - b[0]) * os * 3, a[1] + (a[1] - b[1]) * os * 3]);
    path.push([y[0] + (y[0] - z[0]) * os * 3, y[1] + (y[1] - z[1]) * os * 3]);
    if (random() < partial) {
      const s = floor(random(path.length * 0.4)), e = floor(random(path.length * 0.6, path.length));
      path = path.slice(s, e);
    }
    ink(random(colors), path.map(([x, yy]) => R(x, yy)), nib, weight * random(0.8, 1.2), 0.5);
  }
}

// Shading confined to a ref-space polygon: parallel rows at `ang` degrees,
// chained back and forth so the pen rarely lifts, rows not quite reaching the edge.
function hatch(poly, ang, colors, { gap = 4, nib = "hairline", weight = 1, run = [5, 12], reach = 0.7 } = {}) {
  const a = radians(ang + random(-8, 8)), dx = cos(a), dy = sin(a), nx = -dy, ny = dx;
  const proj = poly.map(([x, y]) => x * nx + y * ny);
  const lo = Math.min(...proj), hi = Math.max(...proj);
  const rows = [];
  for (let d = lo + gap * random(0.3, 1); d < hi; d += gap * random(0.7, 1.3)) {
    const ts = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const pn = p[0] * nx + p[1] * ny - d, qn = q[0] * nx + q[1] * ny - d;
      if (pn * qn < 0) {
        const t = pn / (pn - qn);
        ts.push((p[0] + (q[0] - p[0]) * t) * dx + (p[1] + (q[1] - p[1]) * t) * dy);
      }
    }
    if (ts.length < 2) continue;
    ts.sort((u, v) => u - v);
    let t0 = ts[0], t1 = ts[ts.length - 1];
    const len = t1 - t0;
    t0 += len * random(0, 1 - reach);
    t1 -= len * random(0, 1 - reach);
    // rows lean a little differently each time, like a wrist pivoting
    const tilt = random(-0.12, 0.12) * (t1 - t0);
    rows.push([[d * nx + t0 * dx - tilt * nx, d * ny + t0 * dy - tilt * ny], [d * nx + t1 * dx + tilt * nx, d * ny + t1 * dy + tilt * ny]]);
  }
  for (let i = 0; i < rows.length;) {
    const n = floor(random(run[0], run[1])), pts = [];
    for (let k = 0; k < n && i < rows.length; k++, i++) {
      const [p, q] = rows[i];
      // a slight bow mid-row so strokes aren't ruler-straight
      const m = [(p[0] + q[0]) / 2 + nx * random(-1.5, 1.5), (p[1] + q[1]) / 2 + ny * random(-1.5, 1.5)];
      if (k % 2) pts.push(q, m, p); else pts.push(p, m, q);
    }
    ink(random(colors), pts.map(([x, y]) => R(x + random(-1, 1), y + random(-1, 1))), nib, weight * random(0.8, 1.2), 0.3);
  }
}

// Angular scribble whose centre line follows a form line: the pen zig-zags
// across the contour while moving along it — fast, searching, still on the form.
function zigTrace(refPts, colors, { width = 8, step = 7, nib = "hairline", weight = 1 } = {}) {
  const base = resample(refPts, 60);
  const lens = [0];
  for (let i = 1; i < base.length; i++) lens.push(lens[i - 1] + dist(...base[i - 1], ...base[i]));
  const total = lens[lens.length - 1], pts = [];
  let side = 1, k = 0;
  const off = random(1000);
  for (let d = 0; d < total; d += step * random(0.4, 1.8)) {
    while (k < lens.length - 2 && lens[k + 1] < d) k++;
    const [x1, y1] = base[k], [x2, y2] = base[k + 1], l = dist(x1, y1, x2, y2) || 1;
    const t = (d - lens[k]) / l, nx = -(y2 - y1) / l, ny = (x2 - x1) / l;
    const w = width * (0.2 + noise(off + d * 0.03) * 1.2) * random(0.6, 1) * side;
    pts.push([x1 + (x2 - x1) * t + nx * w, y1 + (y2 - y1) * t + ny * w]);
    side = -side;
  }
  ink(random(colors), pts.map(([x, y]) => R(x, y)), nib, weight, 0.3);
}

// Coiled scribble travelling along a ref path (brow mass, pupils, nostrils).
function coil(refPts, colors, { r = 8, loops = 10, ecc = 0.7, nib = "fineliner", weight = 1, strokes = 1 } = {}) {
  for (let s = 0; s < strokes; s++) {
    const n = Math.max(40, loops * 13);
    const g = resample(jitter(resample(refPts, 40), 2), n);
    const out = [];
    let ph = random(TWO_PI);
    const off = random(1000);
    for (let i = 0; i < n; i++) {
      const rr = r * (0.4 + noise(off + i * 0.08));
      ph += (TWO_PI * loops) / n * random(0.7, 1.3);
      out.push(R(g[i][0] + cos(ph) * rr, g[i][1] + sin(ph) * rr * ecc));
    }
    ink(random(colors), out, nib, weight, 0.6);
  }
}

// Free line with irregular loops — only for the hair, where form dissolves.
function wander(x, y, len, colors, { step = 6, loops = 0.035, dir, pull } = {}) {
  let px = x, py = y;
  let ang = dir !== undefined ? radians(dir) : random(TWO_PI);
  const pts = [R(px, py)];
  const off = random(1000);
  let loopLeft = 0, turn = 0;
  for (let i = 0; i < len; i++) {
    if (!loopLeft && random() < loops) { loopLeft = floor(random(12, 24)); turn = random([-1, 1]) * TWO_PI / random(14, 26); }
    if (loopLeft) { ang += turn * random(0.7, 1.3); loopLeft--; }
    else if (random() < 0.04) ang += random([-1, 1]) * random(2, 2.8);
    else ang += (noise(off + i * 0.06) - 0.5) * 0.7;
    // optional pull keeps a hair line hugging the skull instead of drifting off
    if (pull) {
      const [cx, cy, rad] = pull, d = dist(px, py, cx, cy);
      if (d > rad) ang += constrain(((atan2(cy - py, cx - px) - ang + PI * 3) % TWO_PI) - PI, -0.25, 0.25);
    }
    px += cos(ang) * step;
    py += sin(ang) * step;
    pts.push(R(px, py));
  }
  ink(random(colors), pts, "hairline", 1, 0.6);
}

// ---------------------------------------------------------------- the portrait

function buildFace() {
  OX = random(-5, 5);
  OY = random(-5, 5);
  washes();
  hatching();
  contours();
  brow(FACE.browL, 1);
  brow(FACE.browR, -1);
  eye(FACE.eyeL, 1);
  eye(FACE.eyeR, -1);
  nose();
  mouth();
  hair();
}

function washes() {
  // broken skin tone under everything; the gaps become the highlights
  facet("peach", [[70, 180], [200, 190], [205, 300], [180, 420], [100, 450], [60, 330]], 100, 0.35);
  facet("peach", [[280, 190], [420, 180], [430, 330], [380, 450], [290, 420], [272, 300]], 110, 0.35);
  facet("rose", [[150, 440], [330, 440], [320, 560], [240, 600], [160, 560]], 90, 0.35);
  facet("ochre", [[205, 170], [275, 170], [268, 240], [212, 240]], 80, 0.35);
  facet("rose", [[90, 470], [190, 470], [200, 590], [130, 560]], 70, 0.35);
  facet("ochre", [[300, 470], [380, 470], [340, 570], [290, 590]], 70, 0.35);
  // forehead: soft, wet, mostly warm, cooling toward the shadow side
  pool("peach", 235, 105, 150, 62, 120);
  pool("rose", 305, 88, 80, 40, 100);
  pool("ochre", 165, 112, 60, 34, 90);
  pool("orange", 370, 140, 45, 40, 110);
  pool("blue", 82, 175, 42, 42, 110);
  pool("teal", 60, 225, 20, 40, 120, 0.3);

  // shadow side (viewer-left): cool facets
  facet("lilac", [[38, 280], [78, 268], [94, 330], [86, 420], [58, 432], [40, 360]], 190, 0.18, ["purple", "teal"]);
  facet("slate", [[58, 300], [98, 298], [96, 352], [64, 348]], 160);
  facet("blue", [[62, 200], [122, 192], [190, 212], [186, 240], [70, 242]], 100);
  facet("lilac", [[72, 274], [178, 268], [172, 302], [92, 304]], 160, 0.18, ["purple", "violet"]);
  facet("orange", [[94, 332], [174, 322], [190, 380], [176, 440], [122, 452], [88, 420]], 150, 0.18, ["red", "orange"]);
  facet("burnt", [[120, 346], [165, 340], [160, 380], [125, 382]], 110);
  facet("lilac", [[100, 470], [180, 480], [188, 550], [140, 560], [110, 522]], 80, 0.3);

  // nose: dark teal wedge on the shadow side, bridge left as paper
  facet("deepTeal", [[180, 262], [214, 278], [216, 356], [198, 378], [182, 340]], 235, 0.1, ["navy", "teal"]);
  facet("slate", [[186, 372], [206, 368], [204, 398], [186, 396]], 140);
  facet("ochre", [[249, 300], [268, 300], [281, 380], [263, 392], [248, 350]], 120);
  facet("umber", [[250, 346], [268, 348], [266, 368], [251, 366]], 170);
  facet("burnt", [[214, 401], [268, 399], [273, 422], [240, 429], [211, 423]], 150);
  facet("grey", [[182, 428], [292, 428], [286, 463], [190, 463]], 110);
  facet("night", [[216, 430], [264, 430], [260, 461], [224, 461]], 240, 0.08);

  // lit side (viewer-right): warm facets, a cool jaw edge
  facet("umber", [[260, 258], [300, 264], [304, 298], [266, 296]], 220);
  facet("blue", [[290, 272], [372, 268], [366, 301], [300, 303]], 120);
  facet("ochre", [[276, 204], [390, 198], [396, 234], [282, 236]], 110);
  facet("orange", [[282, 320], [360, 312], [372, 380], [342, 432], [290, 428]], 150, 0.18, ["red", "orange"]);
  facet("burnt", [[300, 350], [346, 350], [340, 396], [305, 396]], 110);
  facet("orange", [[392, 218], [442, 212], [440, 332], [400, 346]], 150, 0.18, ["orange", "amber"]);
  facet("blue", [[352, 360], [384, 360], [378, 470], [352, 500]], 120, 0.18, ["blue", "purple"]);

  // mouth surround and lips
  facet("grey", [[140, 470], [172, 465], [170, 515], [145, 512]], 100);
  facet("grey", [[306, 470], [332, 470], [330, 515], [306, 510]], 90);
  wash("#9a2a22", resample([...FACE.lipTop, [238, 490]], 30).map(([x, y]) => R(x, y)), 220, 0.15, 0.55, 0.85);
  wash(WASH.red, resample([...FACE.lipBottom, [238, 494]], 30).map(([x, y]) => R(x, y)), 150, 0.2, 0.55, 0.85);
  facet("#7e1a18", [[182, 497], [240, 499], [298, 492], [278, 506], [240, 512], [200, 507]], 150, 0.12);

  // chin
  facet("peach", [[200, 555], [286, 555], [280, 606], [240, 616], [205, 601]], 110);
  facet("blue", [[188, 560], [212, 560], [210, 600], [192, 596]], 110);
}

function hatching() {
  // cheek shadows, under the cheekbones
  hatch([[82, 336], [150, 328], [186, 346], [181, 420], [136, 448], [90, 430]], -60, ["red", "orange", "red"], { gap: 3.6 });
  hatch([[96, 350], [170, 345], [176, 410], [120, 430]], -40, ["orange", "amber", "magenta"], { gap: 5 });
  hatch([[86, 380], [140, 372], [150, 440], [100, 430]], -75, ["red", "magenta"], { gap: 5 });
  hatch([[276, 356], [334, 349], [346, 400], [322, 431], [280, 425]], 60, ["red", "orange"], { gap: 3.4 });
  hatch([[286, 362], [330, 360], [334, 410], [292, 412]], 35, ["orange", "magenta"], { gap: 5 });
  hatch([[300, 380], [344, 384], [336, 428], [300, 424]], 80, ["red", "orange"], { gap: 4.5 });
  // lit temple
  hatch([[396, 248], [440, 246], [436, 362], [398, 360]], 80, ["orange", "amber", "red"], { gap: 4 });
  // shadow-side temple and socket corner
  hatch([[50, 212], [82, 204], [86, 266], [56, 272]], 78, ["purple", "teal", "violet"], { gap: 5 });
  hatch([[150, 292], [198, 288], [205, 348], [160, 346]], -50, ["red", "orange"], { gap: 4 });
  // above the lit eye
  hatch([[288, 190], [384, 184], [390, 206], [292, 212]], 20, ["orange", "amber"], { gap: 5, run: [4, 8] });
  // chin ball and the shadow under the lower lip
  trace([[204, 566], [214, 596], [240, 607], [268, 597], [280, 566]], ["orange", "red", "amber", "magenta"], { passes: 6, amp: 2.5, nib: "hairline", spread: 12, partial: 0.5 });
  for (let i = 0; i < 5; i++) {
    const x = random(222, 256), y = random(526, 532);
    ink(random(["navy", "purple", "brown", "red"]), [R(x, y), R(x + random(-2, 2), y + random(8, 18))], "hairline", 1, 0);
  }
  // shadow-side jaw, sparse
  hatch([[96, 440], [150, 450], [160, 520], [112, 500]], -70, ["magenta", "purple"], { gap: 6 });
}

// Every form line in the face — the contours plus the boundaries between the
// head's planes — with its local palette, restatement count and echo spread.
// Lines are dense where planes meet (brow ridge, inner sockets, beside the nose,
// cheek fronts) and sparse on the broad planes.
function formLines() {
  const cool = ["purple", "teal", "navy", "violet", "green"], warm = ["red", "orange", "amber", "magenta"];
  const mid = ["red", "purple", "orange", "navy"];
  return [
    [FACE.outlineL, [...cool, "magenta"], 3, 9],
    [FACE.outlineR, [...warm, "purple", "blue"], 3, 9],
    [FACE.socketTopL, [...cool, "black"], 8, 14],
    [FACE.socketTopR, ["teal", "navy", "orange", "red", "purple"], 5, 10],
    [FACE.socketLowL.slice(0, 3), [...cool, "red"], 1, 4],
    [FACE.socketLowR.slice(2), [...warm, "purple"], 1, 4],
    [FACE.cheekL, ["red", "orange", "purple"], 3, 8],
    [FACE.cheekR, warm, 3, 8],
    [FACE.nasoL, ["teal", "purple", "navy"], 3, 5],
    [FACE.nasoR, ["teal", "green", "orange"], 4, 6],
    [FACE.chin, ["red", "orange", "purple", "teal"], 2, 6],
    // brow ridge and glabella
    [[[95, 170], [150, 150], [205, 160], [228, 172]], mid, 3, 10],
    [[[252, 170], [276, 158], [340, 150], [392, 168]], mid, 3, 10],
    [[[198, 202], [214, 180], [236, 164]], mid, 4, 6],
    [[[266, 202], [250, 182], [232, 168]], warm, 4, 6],
    // forehead side planes
    [[[70, 192], [80, 132], [112, 92]], cool, 2, 8],
    [[[420, 190], [404, 130], [370, 92]], warm, 2, 8],
    // inner sockets, brow down to the inner eye corner
    [[[200, 205], [194, 230], [190, 250], [196, 268]], [...cool, "red"], 5, 6],
    [[[262, 205], [266, 230], [272, 250], [268, 270]], [...warm, "purple"], 5, 6],
    // front plane of the cheek: inner eye corner down beside the nose
    [[[190, 272], [176, 322], [178, 370], [186, 398]], [...cool, "red"], 4, 8],
    [[[280, 274], [292, 322], [294, 370], [290, 404]], warm, 4, 8],
    // zygomatic: outer eye corner down across the cheekbone
    [[[66, 264], [86, 302], [112, 342], [142, 382]], [...cool, "orange"], 4, 9],
    [[[394, 256], [380, 302], [350, 342], [320, 382]], warm, 4, 9],
    // side planes: temple to jaw
    [[[52, 250], [72, 332], [92, 420], [112, 470]], cool, 3, 9],
    [[[430, 242], [412, 332], [388, 420], [362, 470]], [...warm, "purple"], 3, 9],
    // the mouth barrel, jaw and chin planes
    [[[182, 440], [162, 490], [176, 540]], ["teal", "purple", "red"], 3, 6],
    [[[298, 440], [320, 490], [306, 540]], ["teal", "green", "orange"], 3, 6],
    [[[150, 520], [196, 560]], ["purple", "magenta"], 2, 6],
    [[[332, 520], [288, 560]], ["teal", "orange"], 2, 6],
    [[[110, 520], [160, 560], [205, 590]], ["teal", "purple", "magenta"], 2, 6],
    [[[330, 500], [350, 530], [330, 570]], ["teal", "green", "purple"], 2, 6],
  ];
}

function contours() {
  const lines = formLines();
  // restate each form line where it sits
  for (const [pts, colors, passes, spread] of lines) trace(pts, colors, { passes, amp: 3, nib: "hairline", partial: 0.45, spread });
  // then let the pen run on from one form into the next
  for (let i = 0; i < 48; i++) gesture(lines);
  // and zig-zag along some of them, hardest where planes turn
  const interior = lines.filter(([pts]) => pts !== FACE.outlineL && pts !== FACE.outlineR);
  for (let i = 0; i < 24; i++) {
    const [pts, colors] = random(interior);
    const a = floor(random(pts.length - 1)), b = Math.min(pts.length, a + floor(random(2, 5)));
    if (b - a >= 2) zigTrace(pts.slice(a, b), colors, { width: random(5, 12), step: random(5, 9) });
  }
  trace(FACE.chinCrease, ["brown", "red", "purple"], { passes: 2, amp: 2.5, nib: "hairline", partial: 0.6 });
}

// One continuous stroke that follows a form line and, at its end, carries on
// into whichever form line starts nearby — so a jaw line turns up the cheek,
// runs under the eye and on round the socket.
function gesture(lines) {
  const [first, colors] = random(lines);
  let path = random() < 0.5 ? first.slice() : first.slice().reverse();
  const used = new Set([first]);
  for (let k = floor(random(1, 4)); k > 0; k--) {
    const [ex, ey] = path[path.length - 1];
    let best = null, bestLine = null, bd = 60;
    for (const [q] of lines) {
      if (used.has(q)) continue;
      for (const rev of [false, true]) {
        const [qx, qy] = rev ? q[q.length - 1] : q[0];
        const d = dist(ex, ey, qx, qy) * random(0.8, 1.2);
        if (d < bd) { bd = d; bestLine = q; best = rev ? q.slice().reverse() : q.slice(); }
      }
    }
    if (!best) break;
    used.add(bestLine);
    path = path.concat(best);
  }
  trace(path, colors, { passes: 1, amp: 3.5, nib: "hairline", partial: 0.15, overshoot: 0.1 });
}

// Brow: dense hair strokes along the arch over a dark coiled mass.
function brow(refPts, side) {
  const path = resample(refPts, 60);
  for (let i = 0; i < 200; i++) {
    const t = random(0.02, 0.98), k = floor(t * (path.length - 1));
    const [x, y] = path[k];
    // hairs stand up at the inner end and lie flat, pointing outward, toward the tail
    const inn = side > 0 ? t : 1 - t, out = side > 0 ? -1 : 1;
    const a = atan2(-lerp(0.3, 1, inn), out * lerp(1, 0.3, inn)) + random(-0.25, 0.25);
    const len = random(7, 16);
    const ox = random(-7, 7), oy = random(-6, 6);
    ink(random([...DARK, "navy", "purple", "teal"]),
      [R(x + ox, y + oy), R(x + ox + cos(a) * len * 0.5, y + oy + sin(a) * len * 0.5), R(x + ox + cos(a) * len, y + oy + sin(a) * len)],
      random() < 0.5 ? "fineliner" : "hairline", 1, 0.5);
  }
  wash(WASH.night, resample(refPts, 12).map(([x, y]) => [x, y - 4]).concat(resample(refPts, 12).reverse().map(([x, y]) => [x, y + 6])).map(([x, y]) => R(x, y)), 150, 0.2, 0.4, 0.6);
  coil(refPts, ["navy", "black", "purple", "teal"], { r: 6, loops: 22, ecc: 0.55, strokes: 3 });
  trace(refPts, ["navy", "purple", "teal"], { passes: 3, amp: 3, partial: 0.5 });
}

function eye(e, side) {
  const { cx, cy, outer, inner, top, bottom, iris: r } = e;
  const at = (t) => lerp(outer[0], inner[0], t);
  const upper = [outer, [at(0.2), top + 8], [at(0.48), top], [at(0.78), top + 4], inner];
  const lower = [outer, [at(0.25), bottom - 4], [at(0.5), bottom], [at(0.78), bottom - 5], inner];
  const crease = [[at(-0.04), outer[1] - 12], [at(0.25), top - 7], [at(0.55), top - 12], [at(0.85), top - 7], [at(1.05), inner[1] - 10]];

  // lid heights at ref x, so the iris is cropped top and bottom like a real eye
  const yOn = (pts) => {
    const p = resample(pts, 40);
    return (x) => {
      for (let k = 1; k < p.length; k++) {
        const [x1, y1] = p[k - 1], [x2, y2] = p[k];
        if ((x - x1) * (x - x2) <= 0) return y1 + (y2 - y1) * (x - x1) / (x2 - x1 || 1);
      }
      return (top + bottom) / 2;
    };
  };
  const lidTop = yOn(upper), lidBot = yOn(lower);
  const clip = ([x, y]) => [x, constrain(y, lidTop(x) + 1, lidBot(x) - 1)];

  // the eye sits in loops that circle the whole socket
  const ex = (inner[0] - outer[0]) / 2, ey = (top + bottom) / 2;
  const orbit = Array.from({ length: 9 }, (_, k) => {
    const a = (side > 0 ? PI * 0.95 : PI * 1.45) + (k / 8) * PI * 0.6;
    return [outer[0] + ex + cos(a) * (Math.abs(ex) + 10), ey + sin(a) * 30];
  });
  trace(orbit, ["teal", "green", "red", "purple", "navy"], { passes: 3, amp: 3, nib: "hairline", partial: 0.6, spread: 6 });

  // eyeball: never paper-white — cool grey, darker into the corners
  wash(WASH.grey, resample([...upper, ...lower.slice().reverse()], 36).map(([x, y]) => R(x, y)), 130, 0.06, 0.3, 0.5);
  wash(WASH.blue, resample([...upper, ...lower.slice().reverse()], 36).map(([x, y]) => R(x, y)), 70, 0.06, 0.3, 0.5);
  wash(WASH.slate, blob(...R(at(0.1), outer[1]), 10 * S, 6 * S, 0, 0.3, 12), 130, 0.08);
  wash(WASH.lilac, blob(...R(at(0.9), inner[1]), 9 * S, 6 * S, 0, 0.3, 12), 120, 0.08);
  wash(WASH.red, blob(...R(inner[0] - side * 5, inner[1] + 2), 5 * S, 4 * S, 0, 0.2, 12), 160, 0.05);

  iris(cx, cy, r, clip);

  // the lid: a thick black band that flicks past the outer corner
  const wing = [[outer[0] - (inner[0] - outer[0]) * 0.1, outer[1] - 6], ...upper.slice(1)];
  for (let k = 0; k < 7; k++) {
    const lift = k * random(0.9, 1.5), keep = random(0.6, 0.95);
    const pts = resample(wing, 24).slice(0, floor(24 * keep)).map(([x, y], i) => [x, y - lift * sin(PI * Math.min(1, (i / 23) * 1.2))]);
    trace(pts, ["black", "navy", "black", "brown"], { passes: 1, amp: 1.2, nib: "felt", weight: random(0.7, 1), overshoot: 0.05, partial: 0 });
  }
  wash(WASH.grey, resample(upper, 20).map(([x, y]) => [x, y + 1]).concat(resample(upper, 20).reverse().map(([x, y]) => [x, y + 8])).map(([x, y]) => R(x, y)), 140, 0.08, 0.3, 0.5);
  trace(lower, ["red", "#c8615a", "teal", "brown"], { passes: 3, amp: 1.8, partial: 0.6, nib: "hairline" });
  trace(crease, ["orange", "brown", "red", "purple"], { passes: 3, amp: 2.5 });
  for (let i = 0; i < 18; i++) {
    const t = random(0, 0.55), x = at(t), y = lidTop(x) - 4;
    const len = random(4, 10) * (1 - t);
    const a = side > 0 ? radians(random(195, 240)) : radians(random(-60, -15));
    ink(random(["black", "navy"]), [R(x, y), R(x + cos(a) * len, y + sin(a) * len)], "hairline", 1.2, 0);
  }
}

// Iris: a rough dark mass of circular scribble, flecked amber, with one glint.
function iris(cx, cy, r, clip) {
  const M = (pts) => pts.map((p) => R(...clip(p)));
  solid("#3b2416", M(blob(cx, cy, r, r, 0, 0.18, 28)), 230);
  // amber flecks radiating from the pupil, strongest on the lit side
  for (let i = 0; i < 26; i++) {
    const a = random(-PI * 0.6, PI * 0.9), r1 = r * random(0.38, 0.5), r2 = r * random(0.6, 0.85);
    ink(random(["amber", "#c9c25a", "orange", "amber"]), M([[cx + cos(a) * r1, cy + sin(a) * r1], [cx + cos(a) * r2, cy + sin(a) * r2]]), "hairline", 1.1, 0);
  }
  // loose loops of dark ink, not quite concentric
  for (let k = 0; k < 12; k++) {
    const pts = [];
    let ph = random(TWO_PI);
    const rr0 = r * random(0.5, 1.05), ox = random(-3, 3), oy = random(-3, 3), squash = random(0.8, 1.1);
    for (let i = 0; i < 22 * random(0.6, 1.4); i++) {
      ph += (TWO_PI / 22) * random(0.7, 1.3);
      const rr = rr0 * random(0.85, 1.12);
      pts.push([cx + ox + cos(ph) * rr, cy + oy + sin(ph) * rr * squash]);
    }
    ink(random(["black", "navy", "brown", "black", "brown"]), M(resample(pts, pts.length * 3)), k < 4 ? "felt" : "fineliner", k < 4 ? 0.55 : 1, 0.5);
  }
  solid("#0f0e13", M(blob(cx, cy, r * 0.38, r * 0.38, 0, 0.2, 14)), 250);
  const hx = cx + r * 0.25, hy = cy - r * 0.18;
  solid("#fffdf8", [R(hx - 2.5, hy - 2.5), R(hx + 3, hy - 3), R(hx + 3, hy + 2.5), R(hx - 2, hy + 2.5)], 250);
}

function nose() {
  // the two long sides: brow → bridge → wing, the line never really lifts
  trace(FACE.noseL.slice(0, 4), ["teal", "purple", "navy"], { passes: 2, amp: 3, nib: "hairline", partial: 0.6 });
  trace(FACE.noseL.slice(2), ["navy", "black", "teal", "purple"], { passes: 4, amp: 2.2, partial: 0.3 });
  trace(FACE.noseL.slice(4), ["black", "navy"], { passes: 2, amp: 1.5, nib: "felt", weight: 0.7, partial: 0 });
  trace(FACE.noseR.slice(3), ["red", "brown", "orange"], { passes: 3, amp: 2.5, partial: 0.4, nib: "hairline" });
  trace(FACE.noseR.slice(1, 4), ["orange", "red"], { passes: 1, amp: 3, partial: 0.6, nib: "hairline" });
  trace(FACE.noseBall.slice(1, 4), ["red", "brown"], { passes: 1, amp: 2, partial: 0.5, nib: "hairline" });
  trace(FACE.noseTip, ["orange", "red"], { passes: 2, amp: 2, nib: "hairline" });
  trace(FACE.philtrumL, ["red", "navy", "brown"], { passes: 2, amp: 1.5, nib: "hairline" });
  trace(FACE.philtrumR, ["red", "navy", "brown"], { passes: 2, amp: 1.5, nib: "hairline" });
  // nostrils: inky pools ringed with scribble
  // the ball of the nose: a round red-orange form, its top and sides restated in arcs
  wash(WASH.burnt, blob(...R(240, 404), 30 * S, 19 * S, 0, 0.2), 150, 0.15, 0.5, 0.8);
  wash(WASH.red, blob(...R(240, 412), 18 * S, 9 * S, 0, 0.3), 120, 0.1, 0.5, 0.8);
  trace([[206, 404], [214, 390], [240, 383], [266, 390], [276, 404]], ["red", "orange", "brown", "magenta"], { passes: 2, amp: 2.5, nib: "hairline", spread: 4, partial: 0.7 });
  for (const [nx, ny, rx, ry, tilt] of [FACE.nostrilL, FACE.nostrilR]) {
    solid("#1d1418", blob(...R(nx + random(-1, 1), ny), rx * S, ry * S, tilt, 0.55, 12), 235);
    wash(WASH.night, blob(...R(nx, ny + 4), rx * 1.3 * S, ry * 1.4 * S, tilt, 0.5, 12), 170, 0.1, 0.4, 0.6);
    coil([[nx - rx * 0.6, ny], [nx + rx * 0.6, ny]], ["black", "navy", "brown"], { r: ry * 0.8, loops: 7, ecc: 0.7, strokes: 3 });
  }
  // the dark wedge under the nose, inked over its wash
  for (let i = 0; i < 6; i++) {
    const x = random(224, 256), y = random(432, 440);
    ink(random(["navy", "black", "purple"]), [R(x, y), R(x + random(-2, 2), y + random(12, 22))], "fineliner", random(0.8, 1.2), 0);
  }
}

function mouth() {
  trace(FACE.mouth, ["black", "brown", "navy", "red"], { passes: 5, amp: 1.8, nib: "felt", weight: 0.75, partial: 0.3 });
  trace(FACE.lipTop, ["red", "brown", "magenta"], { passes: 2, amp: 2.5, partial: 0.7, nib: "hairline" });
  trace(FACE.lipBottom, ["red", "orange", "brown"], { passes: 1, amp: 3, partial: 0.8, nib: "hairline" });
  // vertical lip texture, from each lip's edge toward the mouth line
  const yAt = (pts, x) => {
    for (let k = 1; k < pts.length; k++) {
      const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
      if ((x - x1) * (x - x2) <= 0) return y1 + (y2 - y1) * (x - x1) / (x2 - x1 || 1);
    }
    return null;
  };
  for (let i = 0; i < 110; i++) {
    const top = random() < 0.5, x = random(175, 302);
    const yEdge = yAt(top ? FACE.lipTop : FACE.lipBottom, x), yMid = yAt(FACE.mouth, x);
    if (yEdge === null || yMid === null) continue;
    const span = yMid - yEdge, a = random(0, 0.35), b = random(0.5, 1);
    const lean = (x - 238) * 0.08 + random(-2, 2);
    ink(random(["red", "brown", "magenta", "red", "#8f1d1a"]), [R(x, yEdge + span * a), R(x + lean, yEdge + span * b)], "hairline", random(0.8, 1.3), 0);
  }
}

function hair() {
  // loops that climb off the crown and spill down the lit side
  const crown = [250, 150, 190];
  const hairInk = ["purple", "violet", "red", "navy", "orange", "amber", "magenta", "#d8b13a"];
  for (let i = 0; i < 9; i++) wander(random(120, 380), random(50, 130), floor(random(50, 110)), hairInk, { dir: random(-170, -10), pull: crown });
  for (let i = 0; i < 6; i++) wander(random(370, 445), random(80, 260), floor(random(40, 90)), ["orange", "amber", "purple", "red", "magenta", "#d8b13a"], { dir: random(50, 120), loops: 0.06, pull: [405, 250, 80] });
  for (let i = 0; i < 3; i++) wander(random(45, 100), random(140, 210), floor(random(30, 60)), ["teal", "purple", "navy"], { dir: random(90, 150), pull: [70, 250, 60] });
  for (let i = 0; i < 2; i++) wander(random(140, 340), random(70, 120), floor(random(40, 70)), ["purple", "navy", "red", "violet"], { dir: random(60, 120), pull: [240, 160, 70] });
}

// ---------------------------------------------------------------- photo → face warp

// MediaPipe face-mesh indices paired with the matching point on the reference face.
// Only points whose meaning is unambiguous are used; the spline extrapolates the
// rest (brows, outline, hair) from these.
const LANDMARKS = [
  [468, 126, 249], [33, 68, 256], [133, 186, 246],       // viewer-left eye: iris, outer, inner
  [473, 329, 245], [362, 276, 250], [263, 392, 248],     // viewer-right eye
  [1, 240, 400], [2, 240, 430],                          // nose tip, base
  [61, 164, 491], [291, 308, 492], [0, 238, 466], [17, 238, 524],  // mouth
  [152, 242, 608],                                        // chin
];

let landmarker = null;
async function loadLandmarker() {
  if (landmarker) return landmarker;
  const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
  const vision = await import(`${base}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
  landmarker = await vision.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
    runningMode: "IMAGE",
    numFaces: 1,
  });
  return landmarker;
}

// Detect the face, align it to the reference by similarity (Procrustes), and fit
// a thin-plate spline so the form model bends to this person's features.
async function faceWarp(img) {
  const lm = await loadLandmarker();
  const face = lm.detect(img).faceLandmarks[0];
  if (!face) return null;
  const src = LANDMARKS.map(([k]) => [face[k].x * img.width, face[k].y * img.height]);
  const dst = LANDMARKS.map(([, x, y]) => [x, y]);
  const mean = (pts) => pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
  const ms = mean(src), md = mean(dst);
  let a = 0, b = 0, nrm = 0;
  src.forEach(([x, y], i) => {
    const px = x - ms[0], py = y - ms[1], qx = dst[i][0] - md[0], qy = dst[i][1] - md[1];
    a += px * qx + py * qy; b += px * qy - py * qx; nrm += px * px + py * py;
  });
  const c = a / nrm, d = b / nrm;
  const aligned = src.map(([x, y]) => [c * (x - ms[0]) - d * (y - ms[1]) + md[0], d * (x - ms[0]) + c * (y - ms[1]) + md[1]]);
  return tps(dst, aligned);
}

// Thin-plate spline through control points: returns (x, y) => [x', y'].
function tps(src, dst) {
  const n = src.length, m = n + 3;
  const U = (r2) => (r2 < 1e-9 ? 0 : 0.5 * r2 * Math.log(r2));
  const A = Array.from({ length: m }, () => new Float64Array(m));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U((src[i][0] - src[j][0]) ** 2 + (src[i][1] - src[j][1]) ** 2);
    A[i][n] = A[n][i] = 1;
    A[i][n + 1] = A[n + 1][i] = src[i][0];
    A[i][n + 2] = A[n + 2][i] = src[i][1];
  }
  const solve = (rhs) => {
    const M = A.map((row, i) => [...row, rhs[i]]);
    for (let col = 0; col < m; col++) {
      let piv = col;
      for (let r = col + 1; r < m; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = 0; r < m; r++) {
        if (r === col || !M[col][col]) continue;
        const f = M[r][col] / M[col][col];
        for (let k = col; k <= m; k++) M[r][k] -= f * M[col][k];
      }
    }
    return M.map((row, i) => row[m] / row[i]);
  };
  const wx = solve([...dst.map((p) => p[0]), 0, 0, 0]);
  const wy = solve([...dst.map((p) => p[1]), 0, 0, 0]);
  return (x, y) => {
    let fx = wx[n] + wx[n + 1] * x + wx[n + 2] * y, fy = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
    for (let i = 0; i < n; i++) {
      const u = U((x - src[i][0]) ** 2 + (y - src[i][1]) ** 2);
      fx += wx[i] * u; fy += wy[i] * u;
    }
    return [fx, fy];
  };
}
