// Replays a decomposed painting (tools/decompose.py → data/*.json) with p5.brush:
// watercolor washes first, then the pen lines on top.
//   replicate.html?src=data/reference.json

const params = new URLSearchParams(location.search);
const SRC = params.get("src") || "data/reference.json";
let W = 750, H = 997, S = 1;
let data, jobs = [], penLut = [];
// Render settings, measured against the reference with tools/score.py.
// Any of them can be overridden from the URL, e.g. ?penOp=110.
const CFG = { washOp: 200, glazeOp: 120, glazeArea: 300, penW: 1, penOp: 140, lut: 1 };
for (const k in CFG) if (params.has(k)) CFG[k] = +params.get(k);

async function setup() {
  data = await (await fetch(SRC, { cache: "no-store" })).json();
  penLut = (await (await fetch("data/pen_lut.json", { cache: "no-store" })).json())
    .map(([req, got]) => [req, rgbToLab(got)]);
  S = W / data.width;
  H = Math.round(data.height * S);
  pixelDensity(1);
  createCanvas(W, H, WEBGL);
  setAttributes("preserveDrawingBuffer", true); // so the finished painting can be copied
  start();
}

function start() {
  randomSeed(1);
  noiseSeed(1);
  brush.add("pen", {
    type: "default", weight: 1.5, scatter: 0.08, sharpness: 0.9, grain: 1,
    opacity: CFG.penOp, spacing: 0.15, pressure: [1, 1], rotate: "none", noise: 0.15,
  });
  background(data.paper);
  jobs = [];
  queue();
  loop();
}

// For parameter sweeps: re-render with overrides and resolve when finished.
window.renderWith = async (overrides = {}) => {
  Object.assign(CFG, overrides);
  start();
  while (jobs.length) await redraw();
  return document.querySelector(".p5Canvas").toDataURL("image/png");
};

function draw() {
  const t0 = performance.now();
  while (jobs.length && performance.now() - t0 < 40) jobs.shift()();
  document.getElementById("status").textContent = jobs.length ? `${jobs.length} left` : "done";
  if (!jobs.length && data) {
    noLoop();
    setTimeout(() => window.onPainted?.()); // after p5.brush flushes this frame
  }
}

// p5.brush's pen does not lay down the colour it is given: overlapping tip stamps
// mix pigment-style, darkening and shifting hue ((0,0,36) renders as (0,18,87)).
// data/pen_lut.json maps 512 requested colours to what the pen actually rendered
// (measured on paper at penOp 140); invert it with the 4 nearest renders in Lab.
function penColor(hex) {
  if (!CFG.lut || !penLut.length) return hex;
  const t = rgbToLab([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const near = penLut
    .map(([req, lab]) => [req, Math.hypot(lab[0] - t[0], lab[1] - t[1], lab[2] - t[2])])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 4);
  const w = near.map(([, d]) => 1 / (d + 1e-3)), sw = w.reduce((a, b) => a + b, 0);
  const rgb = [0, 1, 2].map((c) => Math.round(near.reduce((acc, [req], i) => acc + req[c] * w[i], 0) / sw));
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgbToLab([r, g, b]) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// ref pixel → p5 WEBGL coordinates (origin at the centre)
const P = ([x, y]) => [x * S - W / 2, y * S - H / 2];

function queue() {
  // Measured p5.brush transfer: a flat wash lands ~85% of its colour at opacity 200,
  // the watercolor fill only ~30% even at full opacity (it is a glaze). So: flat wash
  // for the colour, then a glaze of the same colour on larger regions for the
  // pooled edges and paper texture.
  for (const w of data.washes) {
    jobs.push(() => {
      brush.noStroke();
      brush.noHatch();
      brush.noFill();
      brush.wash(w.color, CFG.washOp);
      brush.polygon(w.pts.map(P));
      brush.noWash();
      if (w.area > CFG.glazeArea) {
        brush.fill(w.color, CFG.glazeOp);
        brush.fillBleed(0.06);
        brush.fillTexture(0.4, 0.5);
        brush.polygon(w.pts.map(P));
        brush.noFill();
      }
    });
  }
  if (window.WASH_ONLY) return; // animate.html draws the lines itself
  for (const s of data.strokes) {
    if (s.pts.length < 2) continue;
    jobs.push(() => {
      brush.set("pen", penColor(s.color), CFG.penW * Math.max(0.8, s.width * 0.6));
      brush.spline(s.pts.map(P), 0.4);
    });
  }
}
