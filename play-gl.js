// GPU finish for the mini board (play.js, play-draw.js), used when the browser
// has WebGL2. play-draw.js draws the frame on a 2D canvas without glow, and
// its neon again on a half-size glow canvas; this uploads both and adds what a
// GPU does well: a two-level bloom of the neon (the painting never blooms), a
// shockwave from each claim, heat shimmer round the Snarl, and a vignette.
// Without WebGL2 (or after a lost context) play-draw.js uses Canvas 2D shadows.
window.LightfenceGL = (function () {
  'use strict';
  var VS = '#version 300 es\nin vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }';
  var BLUR = '#version 300 es\nprecision mediump float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 d;\n' +
    'void main(){ vec3 c = texture(t, uv).rgb * .227;\n' +
    ' c += (texture(t, uv + d * 1.385).rgb + texture(t, uv - d * 1.385).rgb) * .316;\n' +
    ' c += (texture(t, uv + d * 3.231).rgb + texture(t, uv - d * 3.231).rgb) * .070; o = vec4(c, 1.); }';
  var FINAL = '#version 300 es\nprecision mediump float; in vec2 uv; out vec4 o;\n' +
    'uniform sampler2D scene, b1, b2; uniform vec3 claim; uniform vec2 snarl; uniform float time, motion, aspect;\n' +
    'void main(){ vec2 q = uv;\n' +
    ' if (motion > 0.) {\n' +
    '  vec2 dc = (q - claim.xy) * vec2(1., aspect); float r = claim.z * .9, ring = exp(-pow((length(dc) - r) * 28., 2.)) * (1. - claim.z);\n' +
    '  if (claim.z < 1.) q += normalize(dc + 1e-5) * ring * .012 / vec2(1., aspect);\n' +
    '  vec2 ds = (q - snarl) * vec2(1., aspect); float h = exp(-dot(ds, ds) * 90.);\n' +
    '  q += vec2(sin(q.y * 90. + time * 7.), cos(q.x * 80. + time * 6.)) * .0025 * h;\n' +
    ' }\n' +
    ' vec3 b = texture(b1, q).rgb * 1.0 + texture(b2, q).rgb * 0.9;\n' +
    ' vec3 c = 1. - (1. - texture(scene, q).rgb) * (1. - min(b, 1.));\n' +
    ' if (motion > 0. && claim.z < 1.) c += vec3(.6, .9, 1.) * exp(-pow((length((uv - claim.xy) * vec2(1., aspect)) - claim.z * .9) * 40., 2.)) * (1. - claim.z) * .35;\n' +
    ' vec2 v = uv - .5; c *= 1. - dot(v, v) * .35;\n' +
    ' o = vec4(min(c, 1.), 1.); }';

  function create(canvas) {
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    var progs = {}, tex = {}, fbo = {}, size = { w: 0, h: 0 }, lost = false;

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function program(fs) {
      var p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    function texture(w, h) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    }
    function target(name, w, h) {
      tex[name] = texture(w, h); fbo[name] = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[name]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[name], 0);
      fbo[name].w = w; fbo[name].h = h;
    }
    function init() {
      progs.blur = program(BLUR); progs.final = program(FINAL);
      var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      tex.scene = texture(0, 0); tex.glow = texture(0, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      size.w = 0;
    }
    function resize(w, h) {
      if (size.w === w && size.h === h) return;
      size.w = w; size.h = h;
      var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
      ['a1', 'b1', 'a2', 'b2'].forEach(function (n) { if (tex[n]) { gl.deleteTexture(tex[n]); gl.deleteFramebuffer(fbo[n]); } });
      target('a1', hw, hh); target('b1', hw, hh); target('a2', qw, qh); target('b2', qw, qh);
    }
    function pass(prog, out, inputs, uniforms) {
      gl.useProgram(prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? fbo[out] : null);
      gl.viewport(0, 0, out ? fbo[out].w : size.w, out ? fbo[out].h : size.h);
      Object.keys(inputs).forEach(function (name, i) {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, inputs[name]);
        gl.uniform1i(gl.getUniformLocation(prog, name), i);
      });
      Object.keys(uniforms || {}).forEach(function (name) {
        var v = uniforms[name], loc = gl.getUniformLocation(prog, name);
        if (typeof v === 'number') gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2fv(loc, v); else gl.uniform3fv(loc, v);
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function blur(a, b) {
      var w = fbo[a].w, h = fbo[a].h;
      pass(progs.blur, b, { t: tex[a] }, { d: [1 / w, 0] });
      pass(progs.blur, a, { t: tex[b] }, { d: [0, 1 / h] });
    }

    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', function () { tex = {}; fbo = {}; init(); lost = false; });
    try { init(); } catch (e) { return null; }

    return {
      // scene: the 2D canvas; glow: its neon at half size; fx: { claim: [x, y, 0..1 progress],
      // snarl: [x, y], time, motion } in 0..1 canvas space, y up
      render: function (scene, glow, fx) {
        if (lost) return false;
        resize(scene.width, scene.height);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.scene);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
        gl.bindTexture(gl.TEXTURE_2D, tex.glow);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glow);
        pass(progs.blur, 'a1', { t: tex.glow }, { d: [0, 0] }); blur('a1', 'b1');
        pass(progs.blur, 'a2', { t: tex.a1 }, { d: [0, 0] }); blur('a2', 'b2'); blur('a2', 'b2');
        pass(progs.final, null, { scene: tex.scene, b1: tex.a1, b2: tex.a2 },
             { claim: fx.claim, snarl: fx.snarl, time: fx.time, motion: fx.motion, aspect: scene.height / scene.width });
        return true;
      },
      get ok() { return !lost; }
    };
  }
  return { create: create };
})();
