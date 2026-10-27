// The pointer as a small scribble: a tangled knot of ink that follows the mouse and is
// redrawn 12 times a second, the beat of the hot lines under it (animate.js). The
// system pointer is hidden with CSS (cursor: none); touch input shows no cursor.

(() => {
  const SIZE = 36, DPR = Math.min(2, devicePixelRatio || 1), FPS = 12;
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIZE * DPR;
  Object.assign(cv.style, {
    position: "fixed", left: "0", top: "0", width: SIZE + "px", height: SIZE + "px",
    pointerEvents: "none", zIndex: 10, display: "none", willChange: "transform",
  });
  const x = cv.getContext("2d");
  x.scale(DPR, DPR);
  x.lineCap = x.lineJoin = "round";
  addEventListener("DOMContentLoaded", () => document.body.append(cv));

  addEventListener("pointermove", (e) => {
    // pages keep a normal pointer over their controls (#ui), and touch gets none
    const show = e.pointerType !== "touch" && !e.target.closest?.("#ui");
    cv.style.display = show ? "block" : "none";
    cv.style.transform = `translate(${e.clientX - SIZE / 2}px, ${e.clientY - SIZE / 2}px)`;
  });
  document.addEventListener("pointerleave", () => (cv.style.display = "none"));

  // a knot like a scribbled ball: a slow orbit with quick small loops riding on it,
  // both wobbling, so every redraw is a different tangle of about the same size
  function scribble() {
    const r = Math.random, c = SIZE / 2;
    x.clearRect(0, 0, SIZE, SIZE);
    x.strokeStyle = "rgba(42, 39, 37, 0.92)";
    x.lineWidth = 1.4;
    x.beginPath();
    const turns = 1.6 + 0.8 * r(), tilt = r() * Math.PI, sq = 0.6 + 0.3 * r();
    let a = r() * 2 * Math.PI, b = r() * 2 * Math.PI, big = 5 + 2 * r(), loop = 3 + 1.5 * r();
    const steps = Math.round(turns * 40);
    for (let i = 0; i <= steps; i++) {
      a += (turns * 2 * Math.PI) / steps;
      b += 0.3 + 0.7 * r(); // about five uneven small loops per orbit
      big = Math.max(4.5, Math.min(9, big + (r() - 0.5) * 1.6));
      loop = Math.max(1.5, Math.min(5.5, loop + (r() - 0.5) * 0.8));
      const ex = big * Math.cos(a) + loop * Math.cos(b), ey = (big * Math.sin(a) + loop * Math.sin(b)) * sq;
      const px = c + ex * Math.cos(tilt) - ey * Math.sin(tilt), py = c + ex * Math.sin(tilt) + ey * Math.cos(tilt);
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.stroke();
  }

  let shown = -1;
  (function tick(now) {
    const n = Math.floor((now / 1000) * FPS);
    if (n !== shown && cv.style.display !== "none") {
      shown = n;
      scribble();
    }
    requestAnimationFrame(tick);
  })(0);
})();
