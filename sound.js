// The sound of the boil: a pen scratching and scribbling on paper, synthesised from
// noise (no audio files). It keeps the drawing's beat:
//  * underneath: soft scribbling, a few pen strokes for every redraw of the lines;
//  * the cursor: louder, brighter, busier strokes the faster it moves through the
//    cursor zone, every tick, like the lines there.
// A stroke is band-passed noise whose pitch drifts as the "pen" changes direction,
// with its loudness re-rolled every few milliseconds, which is what makes it scratch.
// Browsers only start audio after a click or key press; until then it stays silent, and
// the #sound button says so ("click for sound") instead of claiming it is on.

const Sound = (window.Sound = (() => {
  let ctx, master, noise, on = true, started = false;
  const rnd = Math.random;

  function start() {
    if (started || !on) return;
    ctx = ctx || new AudioContext();
    build();
    ctx.resume().then(() => {
      started = ctx.state === "running";
      label();
    });
  }

  function label() {
    const b = document.getElementById("sound");
    if (!b) return;
    b.textContent = !on ? "🔈 sound off" : started ? "🔊 sound on" : "🔇 click for sound";
    b.classList.toggle("waiting", on && !started);
  }

  function build() {
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -8; // only catches peaks: the cursor should be heard over the bed
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = 0.9;
      // a soft clip after the compressor: scratch transients are too quick for it.
      // Halve, then tanh(2x): unity for quiet sound, peaks up to 2 round off below 1.
      const half = ctx.createGain();
      half.gain.value = 0.5;
      const clip = ctx.createWaveShaper();
      clip.curve = Float32Array.from({ length: 1025 }, (_, i) => Math.tanh((2 * (i - 512)) / 512));
      master.connect(comp).connect(half).connect(clip).connect(ctx.destination);
    }
  }

  // one pen stroke from t0 lasting dur seconds
  function stroke(t0, dur, freq, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.7 + 0.6 * rnd();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8 + 1.6 * rnd();
    bp.frequency.setValueAtTime(freq, t0);
    bp.frequency.linearRampToValueAtTime(freq * (0.75 + 0.5 * rnd()), t0 + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    for (let t = 0; t < dur; t += 0.004 + 0.006 * rnd()) {
      const env = Math.min(1, t / 0.012) * Math.min(1, (dur - t) / 0.03);
      g.gain.setValueAtTime(gain * env * (0.35 + 0.65 * rnd()), t0 + t);
    }
    g.gain.setValueAtTime(0, t0 + dur);
    src.connect(bp).connect(hp).connect(g).connect(master);
    src.start(t0, rnd() * 1.5);
    src.stop(t0 + dur + 0.02);
  }

  return {
    start,
    get on() { return on; },
    set on(v) {
      on = v;
      if (!v && ctx) { ctx.suspend(); started = false; }
      if (v) start();
      label();
    },
    get ready() { return started; },
    get output() { return master; }, // for level meters
    // render into another context (an OfflineAudioContext, to measure levels)
    use(c) {
      ctx = c;
      noise = null;
      build();
      started = true;
    },
    // called on every 12 fps tick: `beat` when the lines are redrawn, `heat` how strongly
    // the cursor is in play (0-1), `speed` how far it moved this tick (painting px)
    tick({ beat, heat, speed, tickSec, beatSec, at }) {
      if (!started || !on) return;
      const now = at ?? ctx.currentTime + 0.02;
      if (beat) {
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const dur = 0.04 + 0.12 * rnd();
          stroke(now + rnd() * (beatSec - dur), dur, 1500 + 1500 * rnd(), 0.15 + 0.15 * rnd());
        }
      }
      const move = Math.min(1.5, speed / 18) * heat;
      if (move > 0.02) {
        const n = Math.round(1 + 4 * move);
        for (let k = 0; k < n; k++) {
          const dur = 0.025 + 0.07 * rnd();
          stroke(now + rnd() * tickSec, dur, 2000 + 1800 * Math.min(1, move) + 700 * rnd(), (0.5 + 1.0 * rnd()) * Math.min(1, move + 0.2));
        }
      }
    },
  };
})());

// start on the first gesture that lets a page make sound
// (pointermove too: inside an embed that may play audio, a hover is enough)
// (the sound button handles its own clicks). Browsers differ in which events count as
// permission to play: iOS only takes a finished tap (touchend / click), not touchstart.
for (const ev of ["pointerdown", "pointerup", "click", "keydown", "touchstart", "touchend", "pointermove"])
  addEventListener(ev, (e) => e.target?.id !== "sound" && Sound.start(), { passive: true });
// iPhones mute web audio on the silent switch unless the page says it is media playback
if (navigator.audioSession) navigator.audioSession.type = "playback";

// The button: the first click lets the page make sound, later clicks toggle it.
addEventListener("DOMContentLoaded", () => {
  const b = document.getElementById("sound");
  if (!b) return;
  b.onclick = () => (Sound.on && !Sound.ready ? Sound.start() : (Sound.on = !Sound.on));
  Sound.on = Sound.on; // draw the initial label
});
