// The painted washes, boiling with the lines: a WebGL pass that warps the finished
// wash layer with fractal noise, pools pigment along the warped wash edges and lets
// its density drift, re-seeded on the same ticks the pen lines are redrawn.
//  * everywhere: a faint fractal ripple of the wash edges and pigment, stronger close
//    to the pen lines (`near`, a blurred map of where the lines are);
//  * around the cursor: a second, domain-warped layer (noise warped by noise), so the
//    wash swirls and blooms the way the lines coil, re-seeded every tick.

const WASH_VS = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p; gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.); }`;

const WASH_FS = `
precision highp float;
varying vec2 uv;
uniform sampler2D wash, near;
uniform vec2 size;          // painting px
uniform vec3 paper;
uniform vec2 cursor;
uniform float radius, on, base, boost, vBase, vHot;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0., a = .5;
  for (int k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; }
  return s / .97 - .5; // about [-.5, .5]
}
vec2 fbm2(vec2 p) { return vec2(fbm(p), fbm(p + vec2(31.7, 11.3))); }
vec3 W(vec2 px) { return texture2D(wash, px / size).rgb; }
vec2 seed(float v) { return vec2(fract(v * .618034), fract(v * .381966)) * 97.; }

void main() {
  vec2 px = uv * size;
  float u = clamp(1. - length(px - cursor) / radius, 0., 1.);
  float heat = on * u * u * (3. - 2. * u);
  float nr = texture2D(near, uv).r;

  vec2 sb = seed(vBase), sh = seed(vHot + 500.);
  vec2 w = base * (.3 + .7 * nr) * 2. * fbm2(px / 11. + sb);
  vec2 q = fbm2(px / 16. + sh);
  w += boost * heat * 2. * fbm2(px / 16. + 3. * q + sh.yx);

  vec3 c = W(px + w);
  // pigment pools where a wash meets another and dries darker there; the pooled edge
  // moves with the ripple, which is what makes it read as wet paint
  float r = 2.5;
  vec3 avg = (W(px + w + vec2(r, 0)) + W(px + w - vec2(r, 0)) + W(px + w + vec2(0, r)) + W(px + w - vec2(0, r))) / 4.;
  c *= 1. - clamp((.6 + 2. * heat) * length(c - avg), 0., .3);
  // pigment settles differently in every redraw: density drifts, more under the cursor
  float g = fbm(px / 7. + sb * 1.7 + w * .4);
  c = mix(paper, c, 1. + (.15 * min(base, 2.) + .6 * heat) * g);
  gl_FragColor = vec4(c, 1.);
}`;

function makeWashLayer(washCanvas, nearCanvas, paperRgb, refW, refH) {
  const cv = document.createElement("canvas");
  cv.id = "wash";
  cv.width = washCanvas.width;
  cv.height = washCanvas.height;
  const gl = cv.getContext("webgl", { preserveDrawingBuffer: true }); // readable for frameAt
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, WASH_VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, WASH_FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit, src) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  tex(0, washCanvas);
  tex(1, nearCanvas);
  const U = (n) => gl.getUniformLocation(prog, n);
  gl.uniform1i(U("wash"), 0);
  gl.uniform1i(U("near"), 1);
  gl.uniform2f(U("size"), refW, refH);
  gl.uniform3f(U("paper"), ...paperRgb.map((v) => v / 255));
  gl.viewport(0, 0, cv.width, cv.height);
  return {
    canvas: cv,
    // vBase / vHot: the variant numbers of the slow (held) and hot (every tick) boil
    draw({ vBase, vHot, cursor, radius, base, boost }) {
      gl.uniform2f(U("cursor"), cursor.x, cursor.y);
      gl.uniform1f(U("on"), cursor.on);
      gl.uniform1f(U("radius"), radius);
      gl.uniform1f(U("base"), base);
      gl.uniform1f(U("boost"), boost);
      gl.uniform1f(U("vBase"), vBase);
      gl.uniform1f(U("vHot"), vHot);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
