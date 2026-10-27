// Line boil over the replica's still washes, strongest around the cursor.
//   animate.html?boil=1&hold=3&boost=4&radius=80&coil=1
//
// Hand-drawn boil (as in scribble animation): the drawing is redrawn from scratch a few
// times a second and each redraw is held, so lines snap between variants instead of
// sliding. Here every line gets a fresh variant every `hold` ticks of a 12 fps clock
// (hold 3 = 4 redraws/s, the rate of the reference scribble clip).
//
// A variant stays true to how the painting's lines run (measured by tools/motion.py):
//  * lines follow the form (|cos| to the contours 0.76, random would be 0.64), so a
//    redraw mostly shifts a line along itself and only ~1px across, about half the
//    3-6px gap between a contour's echo passes; lines that cross the form shift less;
//  * heavy marks in the eyes, nostrils and mouth barely move; loose loops on bare
//    paper move the most.
// Around the cursor the boil grows: bigger shifts, a redraw every tick, and lines coil
// into loops like a scribble. The washes boil with the lines (wash.js): a faint fractal
// ripple of edges and pigment on the same ticks, swirling under the cursor.
//
// Two hosts: animate.html paints the washes live with p5.brush (replicate.js);
// embed.html sets window.WASH_IMAGE to a pre-rendered wash layer and needs no p5.

// ghost: when nobody is pointing, a cursor drifts over the face on its own
const M = { boil: 4, hold: 3, boost: 4, radius: 300, coil: 1, wash: 4, washBoost: 6, ghost: 0, t: -1, cx: -1e4, cy: -1e4 };
Object.assign(M, window.DEFAULTS); // a host page's own defaults (embed.html)
const Q = new URLSearchParams(location.search);
for (const k in M) if (Q.has(k)) M[k] = +Q.get(k);
const FPS = 12;

let lines = [], lctx, LS = 1, LH = 0, washes, washLayer, ref;
window.onPainted = () => adoptWashes(document.querySelector(".p5Canvas"), true);

// Take the finished wash layer (p5's canvas or a pre-rendered image) and boil it.
async function adoptWashes(src, hideSrc) {
  washes = document.createElement("canvas");
  washes.width = src.width;
  washes.height = src.height;
  washes.getContext("2d").drawImage(src, 0, 0);
  while (!lctx) await new Promise((r) => setTimeout(r, 50));
  // the boiling copy goes under the lines
  washLayer = makeWashLayer(washes, nearLines(), hexRgb(ref.paper), ref.width, ref.height);
  lctx.canvas.before(washLayer.canvas);
  if (hideSrc) src.style.visibility = "hidden";
  shown = -1;
}

// Where the pen lines are, blurred: the wash ripples most around them.
function nearLines() {
  const s = 2, a = document.createElement("canvas"), b = document.createElement("canvas");
  a.width = b.width = ref.width * s;
  a.height = b.height = ref.height * s;
  const x = a.getContext("2d");
  x.fillStyle = "#000";
  x.fillRect(0, 0, a.width, a.height);
  x.strokeStyle = "#fff";
  x.lineWidth = 3 * s;
  for (const g of lines) {
    x.beginPath();
    g.pts.forEach(([px, py], i) => (i ? x.lineTo(px * s, py * s) : x.moveTo(px * s, py * s)));
    x.stroke();
  }
  const y = b.getContext("2d");
  y.filter = `blur(${6 * s}px)`;
  y.drawImage(a, 0, 0);
  y.filter = "none";
  y.globalCompositeOperation = "lighter"; // lift the blurred mask so line clusters saturate
  y.drawImage(b, 0, 0);
  return b;
}
const DPR = 2;

(async () => {
  const m = await (await fetch("data/motion.json", { cache: "no-store" })).json();
  ref = m;
  LS = 750 / m.width;
  LH = Math.round(m.height * LS);
  const paper = hexRgb(m.paper);
  lines = m.gestures.map((g, i) => ({
    ...g,
    seed: i * 7.31,
    coilWl: 12 + 6 * ((i * 0.618) % 1), // px per loop
    xs: new Float32Array(g.pts.length),
    ys: new Float32Array(g.pts.length),
    parts: g.parts.map((p) => ({ ...p, ink: inkOver(p.c, paper), lw: Math.max(0.8, 0.6 * p.w) * 1.5 / LS })),
  }));
  if (!window.WASH_IMAGE) while (!document.querySelector(".p5Canvas")) await new Promise((r) => setTimeout(r, 50));
  const cv = document.createElement("canvas");
  cv.id = "lines";
  cv.width = 750 * DPR;
  cv.height = LH * DPR;
  document.querySelector("main").append(cv);
  lctx = cv.getContext("2d");
  lctx.lineCap = lctx.lineJoin = "round";
  if (window.WASH_IMAGE) {
    // onload rather than decode(): decode() can stall while the page is in the background
    const img = new Image();
    img.onload = () => adoptWashes(img, false);
    img.src = window.WASH_IMAGE;
  }
  if (M.t >= 0) drawAt(Math.floor(M.t * FPS), { x: M.cx, y: M.cy, on: 1 });
  else requestAnimationFrame(tick);
})();

// Live controls: every slider is a key of M (and can also be set from the URL).
for (const el of document.querySelectorAll("#ui input, #ui select")) {
  const out = el.nextElementSibling;
  el.value = M[el.id];
  if (out?.tagName === "OUTPUT") out.value = el.value;
  el.addEventListener("input", () => {
    M[el.id] = +el.value;
    if (out?.tagName === "OUTPUT") out.value = el.value;
    shown = -1;
  });
}
if (M.t >= 0) document.getElementById("ui")?.classList.add("hidden");
addEventListener("keydown", (e) => e.key === "h" && document.getElementById("ui")?.classList.toggle("hidden"));

// The cursor in painting pixels; `on` fades the boost in and out as it enters and leaves.
const pointer = { x: 0, y: 0, inside: false, moved: -1e9 };
const cursor = { x: 0, y: 0, on: 0 };
addEventListener("pointermove", (e) => {
  if (!lctx || !ref) return;
  const r = lctx.canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * ref.width;
  pointer.y = ((e.clientY - r.top) / r.height) * ref.height;
  pointer.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  pointer.moved = performance.now();
});
document.addEventListener("pointerleave", () => (pointer.inside = false));

let clock = 0, last = 0, shown = -1;
function tick(now) {
  clock += Math.min(now - (last || now), 100) / 1000;
  last = now;
  const n = Math.floor(clock * FPS);
  // Nothing moves between ticks: a boil holds each drawing, and the cursor is only
  // read on ticks so lines near it snap rather than morph.
  if (n !== shown) {
    shown = n;
    let target = pointer;
    if (M.ghost && !pointer.inside && now - pointer.moved > 1500) {
      // a slow Lissajous loop over the face, so the piece plays itself in a feed
      const w = ref.width, h = ref.height;
      target = { x: w * (0.5 + 0.27 * Math.sin(clock * 0.41)), y: h * (0.45 + 0.24 * Math.sin(clock * 0.29 + 1)), inside: true };
    }
    if (!cursor.on) Object.assign(cursor, { x: target.x, y: target.y });
    cursor.x += (target.x - cursor.x) * 0.6;
    cursor.y += (target.y - cursor.y) * 0.6;
    cursor.on += ((target.inside ? 1 : 0) - cursor.on) * 0.35;
    if (cursor.on < 0.01) cursor.on = 0;
    drawAt(n, cursor);
  }
  requestAnimationFrame(tick);
}

// Smooth noise in [-1, 1]: two octaves of 3D Perlin noise, scaled to the spread the
// motion was tuned with (sd ≈ 0.38). Self-contained, so the embed runs without p5.
const perm = new Uint8Array(512);
{
  let s = 1;
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
function perlin(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx; y -= fy; z -= fz;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const gr = (h, x, y, z) => {
    h &= 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  };
  const L = (a, b, t) => a + t * (b - a);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return L(
    L(L(gr(perm[AA], x, y, z), gr(perm[BA], x - 1, y, z), u), L(gr(perm[AB], x, y - 1, z), gr(perm[BB], x - 1, y - 1, z), u), v),
    L(L(gr(perm[AA + 1], x, y, z - 1), gr(perm[BA + 1], x - 1, y, z - 1), u), L(gr(perm[AB + 1], x, y - 1, z - 1), gr(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}
const sn = (x, y, z) =>
  Math.max(-1, Math.min(1, 1.27 * (perlin(x, y, z) + 0.5 * perlin(2 * x + 17, 2 * y + 31, 2 * z + 7))));

const falloff = (u) => (Math.exp(-4 * u * u) - Math.exp(-4)) / (1 - Math.exp(-4));

// One redraw of a line: `n` is the 12 fps tick, `c` the cursor.
function pose(g, n, c) {
  const pts = g.pts, N = pts.length, R = M.radius;
  // how close the cursor is, per point and for the line as a whole: a gaussian, so it
  // peaks at the cursor and thins out gradually, reaching zero at the radius
  const heat = new Float32Array(N);
  let hot = 0;
  if (c.on > 0) {
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(pts[i][0] - c.x, pts[i][1] - c.y);
      heat[i] = d < R ? c.on * falloff(d / R) : 0;
      if (heat[i] > hot) hot = heat[i];
    }
  }
  // hot lines are redrawn every tick, the rest every `hold` ticks; the variant number
  // picks an unrelated slice of noise, so each redraw is new, not an in-between
  const hold = Math.max(1, Math.round(M.hold + (1 - M.hold) * hot));
  const v = Math.floor(n / hold);
  const z = v * 17.31 + g.seed * 0.013;
  const along = 2 * (0.4 + 0.6 * g.align) * sn(g.seed, 0.5, z);
  // coils: an ellipse traced along the line; where its radius passes wl/2π the line
  // loops. Size, pace and squash wander, so loops come out uneven like a hand scribble.
  let phase = 2 * Math.PI * ((v * 0.618 + g.seed) % 1);
  const tilt = Math.PI * sn(g.seed, 7.7, z), ct = Math.cos(tilt), st = Math.sin(tilt);
  const squash = 0.55 + 0.35 * sn(g.seed, 9.1, z);
  const k = (2 * Math.PI) / g.coilWl;
  for (let i = 0; i < N; i++) {
    const [x, y] = pts[i], [tx, ty] = g.tan[i];
    const amp = M.boil * g.free + M.boost * heat[i];
    const slide = amp * along;
    const side = amp * sn(g.seed + i / 25, 3.3, z);
    phase += k * (1 + 0.6 * sn(g.seed + i / 15, 5.5, z));
    const r = M.coil * (0.8 * g.free + 5 * heat[i]) * (1 + 0.45 * sn(g.seed + i / 20, 6.6, z));
    const ex = r * Math.cos(phase), ey = r * squash * Math.sin(phase);
    g.xs[i] = x + tx * slide - ty * side + ex * ct - ey * st;
    g.ys[i] = y + ty * slide + tx * side + ex * st + ey * ct;
  }
}

function drawAt(n, c) {
  if (!lctx) return;
  washLayer?.draw({ vBase: Math.floor(n / M.hold), vHot: n, cursor: c, radius: M.radius, base: M.wash, boost: M.washBoost });
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, lctx.canvas.width, lctx.canvas.height);
  lctx.setTransform(DPR * LS, 0, 0, DPR * LS, 0, 0);
  for (const g of lines) {
    pose(g, n, c);
    for (const p of g.parts) {
      lctx.beginPath();
      const a = Math.max(0, p.a - 1); // overlap one point so chained fragments join
      lctx.moveTo(g.xs[a], g.ys[a]);
      for (let i = a + 1; i < p.b; i++) lctx.lineTo(g.xs[i], g.ys[i]);
      lctx.strokeStyle = p.ink;
      lctx.lineWidth = p.lw;
      lctx.stroke();
    }
  }
}

// The line canvas is multiplied over the washes; pick the ink that lands on its
// measured colour where it crosses bare paper.
function inkOver(hex, paper) {
  const c = hexRgb(hex).map((v, i) => Math.min(255, Math.round((v / paper[i]) * 255)));
  return `rgb(${c.join(",")})`;
}

function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// The composited frame (washes × lines) at time t with the cursor at (cx, cy) in
// painting pixels, for scoring with tools/score.py.
window.frameAt = (t, cx = -1e4, cy = -1e4) => {
  drawAt(Math.floor(t * FPS), { x: cx, y: cy, on: 1 });
  const out = document.createElement("canvas");
  out.width = lctx.canvas.width;
  out.height = lctx.canvas.height;
  const o = out.getContext("2d");
  o.drawImage(washLayer ? washLayer.canvas : washes, 0, 0, out.width, out.height);
  o.globalCompositeOperation = "multiply";
  o.drawImage(lctx.canvas, 0, 0);
  return out.toDataURL("image/png");
};
