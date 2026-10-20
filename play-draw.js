// Drawing for the mini board (play.js), in the game's look (qix-swift
// GameScene): the board is a floor seen at an angle (the far edge at 0.78 of
// the near one, the same homography), over the sector's painting under the
// Snarl's veil; claimed ground shows the painting lit; walls, the trail, the
// Snarl, the Tracers and the marker use the game's art and line weights.
// Each frame is drawn on a 2D canvas. With a GPU (play-gl.js) the neon is
// drawn a second time on a half-size glow canvas, which the GPU blooms;
// without one, Canvas 2D shadows stand in.
window.LightfenceDraw = (function () {
  'use strict';
  var ASPECT = 1.38;                       // canvas height / width
  var BW = 0.92, HB = 0.975, MB = 0.07;     // board near width, projected height, bottom margin (x width)
  var K = 1 / 0.78 - 1;                    // GameScene.farEdgeRatio 0.78
  var ACCENT = '#33f2ff', DANGER = '#ff4033', CLAIM = '#0087ff';

  function create(G) {
    var scene = G.scene, ctx = scene.getContext('2d');
    var gcv = G.glow, gctx = gcv ? gcv.getContext('2d') : null;
    var world = document.createElement('canvas'), wctx = world.getContext('2d');
    var R = { W: 1, H: 1, bw: 1, hb: 1, yB: 1, unit: 1, pt: 1 };
    var claimPath = null, edgePath = null, flash = null, dual = null, walls = [];
    var snow = [], jellies = [], fish = [], hazes = [], smoke = null, jellyArt = [];
    var GW = G.GW, GH = G.GH;

    // ---- projection: dual coordinates (cell centres) <-> device pixels ----------------
    function P(gx, gy) {
      var v = 1 - gy / (GH - 1), w = 1 + K * v;
      return [R.W / 2 + (gx / (GW - 1) - 0.5) * R.bw / w, R.yB - v * R.hb * (1 + K) / w, 1 / w];
    }
    function unproject(x, y) {
      var t = (R.yB - y) / (R.hb * (1 + K)), v = t / (1 - K * t), w = 1 + K * v;
      return [((x - R.W / 2) * w / R.bw + 0.5) * (GW - 1), (1 - v) * (GH - 1)];
    }
    function quad(p, x0, y0, x1, y1) {
      var a = P(x0, y0), b = P(x1, y0), c = P(x1, y1), d = P(x0, y1);
      p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(c[0], c[1]); p.lineTo(d[0], d[1]); p.closePath();
    }
    function seg(p, x0, y0, x1, y1) { var a = P(x0, y0), b = P(x1, y1); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); }

    function resize(cssW) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      R.W = Math.max(2, Math.round(cssW * dpr)); R.H = Math.round(R.W * ASPECT);
      scene.width = world.width = R.W; scene.height = world.height = R.H;
      if (gcv) { gcv.width = R.W >> 1; gcv.height = R.H >> 1; }
      R.bw = BW * R.W; R.hb = HB * R.W; R.yB = R.H - MB * R.W;
      R.unit = R.bw / (GW - 1); R.pt = R.bw / 374;              // the phone board is about 374 pt wide
      R.top = P(0, 0)[1];
      seed(); rebuild(false);
    }

    // ---- what changes only when the ground does --------------------------------------
    function solid(k) { var c = G.grid[k]; return c === G.FILL || c === G.WALL; }
    function rebuild(flashNew) {
      var DW = GW - 1, DH = GH - 1, d = new Uint8Array(DW * DH), x, y, k;
      for (y = 0; y < DH; y++) for (x = 0; x < DW; x++) {
        k = y * GW + x;
        d[y * DW + x] = solid(k) && solid(k + 1) && solid(k + GW) && solid(k + GW + 1) ? 1 : 0;
      }
      claimPath = new Path2D(); var fresh = flashNew && dual ? new Path2D() : null, any = false;
      for (y = 0; y < DH; y++) for (x = 0; x < DW; x++) {
        if (!d[y * DW + x]) continue;
        var x1 = x; while (x1 + 1 < DW && d[y * DW + x1 + 1]) x1++;
        quad(claimPath, x, y, x1 + 1, y + 1);
        if (fresh) for (var j = x; j <= x1; j++) if (!dual[y * DW + j]) { quad(fresh, j, y, j + 1, y + 1); any = true; }
        x = x1;
      }
      if (fresh && any) flash = { path: fresh, t: G.now };
      function D(xx, yy) { return xx >= 0 && yy >= 0 && xx < DW && yy < DH ? d[yy * DW + xx] : 0; }
      function wall(xx, yy) { return G.grid[yy * GW + xx] === G.WALL; }
      edgePath = new Path2D();
      for (y = 1; y < GH - 1; y++) for (x = 0; x < DW; x++) {                       // along rows
        if (D(x, y - 1) === D(x, y) || (wall(x, y) && wall(x + 1, y))) continue;
        var e = x; while (e + 1 < DW && D(e + 1, y - 1) !== D(e + 1, y) && !(wall(e + 1, y) && wall(e + 2, y))) e++;
        seg(edgePath, x, y, e + 1, y); x = e;
      }
      for (x = 1; x < GW - 1; x++) for (y = 0; y < DH; y++) {                       // along columns
        if (D(x - 1, y) === D(x, y) || (wall(x, y) && wall(x, y + 1))) continue;
        var f = y; while (f + 1 < DH && D(x - 1, f + 1) !== D(x, f + 1) && !(wall(x, f + 1) && wall(x, f + 2))) f++;
        seg(edgePath, x, y, x, f + 1); y = f;
      }
      dual = d;
      walls = G.walls.map(function (w, i) { return { r: w, i: i }; });
    }

    // ---- the living world: seeded once per size ---------------------------------------
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function seed() {
      snow = []; for (var i = 0; i < 70; i++) snow.push({ x: Math.random(), y: Math.random(), r: rnd(0.6, 1.5), a: rnd(0.25, 0.55), s: rnd(0.6, 1.4), p: rnd(0, 6.3) });
      jellies = [];
      for (var j = 0; j < 5; j++) jellies.push({ x: Math.random(), y: rnd(0.05, 0.95), vx: rnd(-1, 1), vy: rnd(-1, 1), big: j < 3, p: rnd(0, 6.3) });
      fish = []; for (var f = 0; f < 9; f++) fish.push({ a: f / 9 * 6.283 + rnd(-0.2, 0.2), r: rnd(0.85, 1.1), y: rnd(-1, 1) });
      jellyArt = [jelly(Math.round(R.W * 0.12), [150, 230, 255]), jelly(Math.round(R.W * 0.09), [190, 180, 255])];
      hazes = [haze([26, 140, 153]), haze([13, 115, 128])];
      smoke = smokeTexture();
    }
    function jelly(size, rgb) {                    // a dim bell with trailing tentacles
      var c = document.createElement('canvas'), h = Math.round(size * 1.5); c.width = size; c.height = h;
      var x = c.getContext('2d'), col = 'rgba(' + rgb.join(',') + ',';
      var g = x.createRadialGradient(size / 2, size * 0.3, 1, size / 2, size * 0.3, size * 0.5);
      g.addColorStop(0, col + '0.55)'); g.addColorStop(1, col + '0.12)');
      x.fillStyle = g; x.beginPath(); x.ellipse(size / 2, size * 0.36, size * 0.44, size * 0.32, 0, Math.PI, 0);
      x.quadraticCurveTo(size * 0.5, size * 0.46, size * 0.06, size * 0.36); x.fill();
      x.strokeStyle = col + '0.5)'; x.lineWidth = Math.max(1, size / 40); x.stroke();
      x.strokeStyle = col + '0.28)';
      for (var t = 0; t < 5; t++) {
        var tx = size * (0.2 + t * 0.15); x.beginPath(); x.moveTo(tx, size * 0.4);
        x.bezierCurveTo(tx - size * 0.08, size * 0.75, tx + size * 0.08, size * 1.0, tx - size * 0.03, h - 2); x.stroke();
      }
      return c;
    }
    function haze(rgb) {                           // a band of soft fog, tiled sideways
      var c = document.createElement('canvas'); c.width = 512; c.height = 128; var x = c.getContext('2d');
      for (var i = 0; i < 14; i++) {
        var cx = (i / 14) * 512 + rnd(-20, 20), cy = rnd(40, 88), r = rnd(40, 90);
        for (var w = -512; w <= 512; w += 512) {
          var g = x.createRadialGradient(cx + w, cy, 0, cx + w, cy, r);
          g.addColorStop(0, 'rgba(' + rgb.join(',') + ',0.5)'); g.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
          x.fillStyle = g; x.fillRect(cx + w - r, cy - r, r * 2, r * 2);
        }
      }
      return c;
    }
    function smokeTexture() {                      // the veil's drifting smoke (WorldVeil), as a small noise tile
      var n = 64, c = document.createElement('canvas'); c.width = c.height = n;
      var x = c.getContext('2d'), img = x.createImageData(n, n), v = [];
      for (var i = 0; i < 64; i++) v.push(Math.random());
      function at(a, b) { return v[((a & 7) + (b & 7) * 8)]; }
      for (var y = 0; y < n; y++) for (var xx = 0; xx < n; xx++) {
        var fx = xx / 8, fy = y / 8, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var s = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
        var o = (y * n + xx) * 4; img.data[o] = 5; img.data[o + 1] = 18; img.data[o + 2] = 20; img.data[o + 3] = Math.round(s * 255);
      }
      x.putImageData(img, 0, 0); return c;
    }

    function ready(im) { return im && im.complete && im.naturalWidth; }
    function cover(c, im, scale, dx, dy) {
      var s = Math.max(R.W / im.naturalWidth, R.H / im.naturalHeight) * scale, w = im.naturalWidth * s, h = im.naturalHeight * s;
      c.drawImage(im, (R.W - w) / 2 + dx, (R.H - h) / 2 + dy, w, h);
    }

    // ---- one frame --------------------------------------------------------------------
    function draw(t, moving) {
      var c = ctx, W = R.W, H = R.H, light = G.light, lean = G.lean;
      // The painting in two depths, breathing and leaning toward the marker (PaintingStack).
      var br = moving ? Math.sin(t * 0.45) * 0.006 : 0;
      wctx.fillStyle = '#04141a'; wctx.fillRect(0, 0, W, H);
      if (ready(G.img.far)) cover(wctx, G.img.far, 1.03 + br, -lean[0] * R.W * 0.006, -lean[1] * R.W * 0.004);
      if (ready(G.img.near)) cover(wctx, G.img.near, 1.05 + br * 1.6, -lean[0] * R.W * 0.016, -lean[1] * R.W * 0.01);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.shadowBlur = 0;
      c.drawImage(world, 0, 0);
      backdropLife(c, t, moving);
      // The Snarl's veil: the world's dark, lifting as ground is won back.
      var veil = 0.5 * (1 - 0.7 * light);
      c.fillStyle = 'rgba(5,18,20,' + (veil * 0.55).toFixed(3) + ')'; c.fillRect(0, 0, W, H);
      if (smoke) {
        c.globalAlpha = veil; c.imageSmoothingEnabled = true;
        var sx = moving ? Math.sin(t * 0.03) * W * 0.1 : 0, sy = moving ? (t * 0.012 % 1) * H * 0.2 : 0;
        c.drawImage(smoke, -W * 0.2 + sx, -H * 0.2 - sy, W * 1.4, H * 1.6); c.globalAlpha = 1;
      }
      creatures(c, t, moving);
      var board = new Path2D(); quad(board, 0, 0, GW - 1, GH - 1);
      c.fillStyle = 'rgba(1,10,16,0.26)'; c.fill(board);
      grid(c);
      // Claimed ground: the world won back, lit (RestoredGround: art + 0.55 art, a 0.13 wash of the sector's light).
      c.save(); c.clip(claimPath);
      c.drawImage(world, 0, 0);
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.4; c.drawImage(world, 0, 0);
      c.globalAlpha = 0.1; c.fillStyle = ACCENT; c.fillRect(0, 0, W, H);
      if (moving) sheen(c, t);
      c.restore();
      neon(c, t, moving, false);
      snowfall(c, t, moving);
      if (gctx) {
        gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1;
        gctx.fillStyle = '#000'; gctx.fillRect(0, 0, gcv.width, gcv.height);
        gctx.setTransform(gcv.width / W, 0, 0, gcv.height / H, 0, 0);
        neon(gctx, t, moving, true);
      }
    }

    function grid(c) {                             // the floor grid, a line every two board units
      var p = new Path2D(), step = (GW - 1) / 14;
      for (var x = 0; x <= GW - 1 + 1e-6; x += step) seg(p, x, 0, x, GH - 1);
      for (var y = GH - 1; y >= -1e-6; y -= step) seg(p, 0, y, GW - 1, y);
      c.strokeStyle = 'rgba(51,242,255,0.2)'; c.lineWidth = Math.max(1, R.pt * 0.8); c.stroke(p);
    }

    function sheen(c, t) {                         // a slow band of light across everything claimed
      var ph = (t % 5.4) / 3.6; if (ph > 1) return;
      var x = -0.4 * R.W + ph * 1.8 * R.W, g = c.createLinearGradient(x - R.W * 0.18, 0, x + R.W * 0.18, 0);
      g.addColorStop(0, 'rgba(51,242,255,0)'); g.addColorStop(0.5, 'rgba(160,250,255,0.18)'); g.addColorStop(1, 'rgba(51,242,255,0)');
      c.globalAlpha = 1; c.fillStyle = g; c.fillRect(0, 0, R.W, R.H);
    }

    function backdropLife(c, t, moving) {          // light shafts and haze (WorldScript.aquaReef)
      c.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 3; i++) {
        var x = R.W * (0.25 + i * 0.25) + (moving ? Math.sin(t * 0.2 + i * 2) * R.W * 0.04 : 0), w = R.W * (0.07 + i % 2 * 0.04);
        var g = c.createLinearGradient(0, 0, 0, R.H * 0.9);
        g.addColorStop(0, 'rgba(120,240,255,0.10)'); g.addColorStop(1, 'rgba(120,240,255,0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(x - w * 0.4, 0); c.lineTo(x + w * 0.4, 0); c.lineTo(x + w * 1.6 + R.W * 0.12, R.H * 0.9); c.lineTo(x - w * 0.6 + R.W * 0.12, R.H * 0.9); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      var bands = [[0.14, 0.34, 0.22, 7], [0.9, 0.28, 0.26, -11]];
      bands.forEach(function (b, i) {
        var h = R.H * b[1], y = R.H * b[0] - h / 2, w = R.W * 1.6, off = moving ? ((t * b[3] * R.pt) % w + w) % w : 0;
        c.globalAlpha = b[2] * 1.6;
        c.drawImage(hazes[i], off - w, y, w, h); c.drawImage(hazes[i], off, y, w, h);
      });
      c.globalAlpha = 1;
    }

    function creatures(c, t, moving) {             // jellyfish roam; fish come home from stage 2
      jellies.forEach(function (j, i) {
        if (moving) {
          j.x += j.vx * 0.038 * G.dt; j.y += j.vy * 0.029 * G.dt;
          if (j.x < -0.1 || j.x > 1.1) j.vx = -j.vx; if (j.y < -0.05 || j.y > 1.05) j.vy = -j.vy;
        }
        var art = jellyArt[j.big ? 0 : 1], pulse = moving ? 1 + Math.sin(t * 1.3 + j.p) * 0.05 : 1;
        c.globalAlpha = 0.55; c.drawImage(art, j.x * R.W - art.width / 2, j.y * R.H, art.width * pulse, art.height / pulse);
      });
      c.globalAlpha = 1;
      if (G.stageNo < 2) return;
      var cx = R.W * 0.55, cy = R.top - R.W * 0.035, rx = R.W * 0.36, ry = R.W * 0.02, fl = R.W * 0.022;
      c.fillStyle = 'rgba(150,235,240,0.45)';
      fish.forEach(function (f) {
        var a = f.a + (moving ? t * 0.35 : 0), x = cx + Math.cos(a) * rx * f.r, y = cy + Math.sin(a) * ry + f.y * R.W * 0.012, dir = -Math.sin(a) < 0 ? -1 : 1;
        c.beginPath(); c.moveTo(x + dir * fl * 0.5, y); c.quadraticCurveTo(x, y - fl * 0.28, x - dir * fl * 0.4, y);
        c.lineTo(x - dir * fl * 0.7, y - fl * 0.22); c.lineTo(x - dir * fl * 0.7, y + fl * 0.22); c.lineTo(x - dir * fl * 0.4, y);
        c.quadraticCurveTo(x, y + fl * 0.28, x + dir * fl * 0.5, y); c.fill();
      });
    }

    function snowfall(c, t, moving) {              // marine snow, faint over the board too
      c.fillStyle = '#b3ffff';
      snow.forEach(function (s) {
        if (moving) { s.y += 0.027 * s.s * G.dt; if (s.y > 1.02) { s.y = -0.02; s.x = Math.random(); } }
        var x = (s.x + Math.sin(t * 0.4 * s.s + s.p) * 0.006) * R.W, y = s.y * R.H, over = y > R.top && y < R.yB;
        c.globalAlpha = s.a * (over ? 0.45 : 1);
        c.fillRect(x, y, s.r * R.pt * 1.6, s.r * R.pt * 1.6);
      });
      c.globalAlpha = 1;
    }

    // ---- the neon: everything that glows, drawn on the scene and again on the glow canvas
    function soft(c, color, blur, glowPass) { c.shadowColor = color; c.shadowBlur = gctx || glowPass || G.reduce ? 0 : blur; }
    function diamond(c, x, y, w, h) { c.beginPath(); c.moveTo(x, y - h / 2); c.lineTo(x + w / 2, y); c.lineTo(x, y + h / 2); c.lineTo(x - w / 2, y); c.closePath(); }
    function neon(c, t, moving, glowPass) {
      var pt = R.pt, now = G.now;
      c.lineJoin = 'round'; c.lineCap = 'round';
      soft(c, ACCENT, 8 * pt, glowPass); c.strokeStyle = 'rgba(51,242,255,0.9)'; c.lineWidth = 2.5 * pt; c.stroke(edgePath);
      walls.forEach(function (w) { wallBlock(c, w, glowPass); });
      var border = new Path2D(); quad(border, 0, 0, GW - 1, GH - 1);
      var breathe = moving ? 0.72 + Math.sin(t * 2.86) * 0.28 : 1;
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.22 * breathe + (glowPass ? 0.12 : 0);
      c.strokeStyle = ACCENT; c.lineWidth = 6 * pt; c.stroke(border);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      soft(c, ACCENT, 10 * pt, glowPass); c.lineWidth = 2 * pt; c.stroke(border);
      if (flash && now - flash.t < 0.55 && !G.reduce) {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55 * (1 - (now - flash.t) / 0.55);
        c.fillStyle = '#fff'; c.fill(flash.path); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
      trail(c, pt, glowPass);
      c.shadowBlur = 0;
      G.tracers.forEach(function (tr) { tracer(c, tr, t, moving); });
      snarl(c, t, moving, glowPass);
      marker(c, t, moving, glowPass);
      G.sparks.forEach(function (s) {
        var p = P(s.x, s.y); c.globalAlpha = Math.min(1, s.t * 2); c.fillStyle = s.c;
        var z = R.unit * 0.3 * p[2]; c.fillRect(p[0] - z / 2, p[1] - z / 2, z, z);
      });
      c.globalAlpha = 1; c.shadowBlur = 0;
    }

    function wallBlock(c, w, glowPass) {           // GameScene.drawTerrain: a dark block, a textured face, bevels
      var r = w.r, x0 = r[0] - 0.5, y0 = r[1] - 0.5, x1 = r[2] + 0.5, y1 = r[3] + 0.5, ins = Math.min(0.5, (x1 - x0) * 0.18, (y1 - y0) * 0.18);
      var outer = new Path2D(); quad(outer, x0, y0, x1, y1);
      var inner = new Path2D(); quad(inner, x0 + ins, y0 + ins, x1 - ins, y1 - ins);
      c.fillStyle = glowPass ? '#000' : 'rgba(10,10,12,0.94)'; c.fill(outer);
      if (!glowPass) {
        var a = P(x0 + ins, y0 + ins), b = P(x1 - ins, y1 - ins), tex = G.img.wall;
        if (ready(tex)) {
          c.save(); c.clip(inner);
          var fw = b[0] - a[0], fh = b[1] - a[1], s = Math.max(fw, fh) / tex.naturalWidth, off = (w.i % 5) / 4;
          c.drawImage(tex, a[0] - (tex.naturalWidth * s - fw) * off, a[1] - (tex.naturalHeight * s - fh) * (1 - off), tex.naturalWidth * s, tex.naturalHeight * s);
          c.restore();
        } else { c.fillStyle = 'rgba(51,242,255,0.13)'; c.fill(inner); }
        c.strokeStyle = 'rgba(51,242,255,0.45)'; c.lineWidth = R.pt; c.stroke(inner);
        var bev = new Path2D(); seg(bev, x0, y0, x0 + ins, y0 + ins); seg(bev, x1, y0, x1 - ins, y0 + ins); seg(bev, x1, y1, x1 - ins, y1 - ins); seg(bev, x0, y1, x0 + ins, y1 - ins);
        c.strokeStyle = 'rgba(51,242,255,0.65)'; c.stroke(bev);
      }
      soft(c, ACCENT, 6 * R.pt, glowPass); c.strokeStyle = ACCENT; c.lineWidth = 2 * R.pt; c.stroke(outer); c.shadowBlur = 0;
    }

    function trail(c, pt, glowPass) {              // a white-hot core inside the sector's glow
      var tr = G.trail, pl = G.player;
      if (!tr.length || !pl.from) return;
      var line = new Path2D(), a = P(pl.from.x, pl.from.y); line.moveTo(a[0], a[1]);
      tr.forEach(function (k) { var q = P(k % GW, (k / GW) | 0); line.lineTo(q[0], q[1]); });
      c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(51,242,255,0.42)'; c.lineWidth = 11 * pt; c.stroke(line);
      c.globalCompositeOperation = 'source-over';
      soft(c, '#fff', 6 * pt, glowPass); c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 2.6 * pt; c.stroke(line);
      if (G.fuse > 0) {                            // the fuse burns along the line from where it started
        var n = Math.min(tr.length - 1, Math.floor(G.fuse)), burnt = new Path2D(); burnt.moveTo(a[0], a[1]);
        for (var i = 0; i <= n; i++) { var q = P(tr[i] % GW, (tr[i] / GW) | 0); burnt.lineTo(q[0], q[1]); }
        c.strokeStyle = DANGER; c.lineWidth = 4 * pt; c.stroke(burnt);
        var f = P(tr[n] % GW, (tr[n] / GW) | 0);
        soft(c, DANGER, 8 * pt, glowPass); c.fillStyle = '#fff'; c.strokeStyle = DANGER; c.lineWidth = 3 * pt;
        c.beginPath(); c.arc(f[0], f[1], 4 * pt, 0, 7); c.fill(); c.stroke();
      }
      c.shadowBlur = 0;
    }

    function tracer(c, tr, t, moving) {            // drone_gold, additive, about 22 pt
      var p = P(tr.x, tr.y), s = 24 * R.pt * p[2], im = G.img.tracer;
      c.globalCompositeOperation = 'lighter';
      if (ready(im)) {
        c.save(); c.translate(p[0], p[1]); if (moving) c.rotate(t * 3); c.drawImage(im, -s / 2, -s / 2, s, s); c.restore();
      } else { c.fillStyle = '#ffb02e'; c.beginPath(); c.arc(p[0], p[1], s * 0.25, 0, 7); c.fill(); }
      c.globalCompositeOperation = 'source-over';
    }

    function snarl(c, t, moving, glowPass) {       // the drone, its red halo and a counter-turning reticle
      var sn = G.snarl, p = P(sn.x - 0.5, sn.y - 0.5), size = 72 * R.pt * p[2], im = G.img[G.snarlArt];
      c.save(); c.translate(p[0], p[1]);
      c.fillStyle = 'rgba(3,3,3,0.46)';
      if (!glowPass) { c.beginPath(); c.arc(0, 0, size * 0.5, 0, 7); c.fill(); }
      soft(c, DANGER, 6 * R.pt, glowPass); c.strokeStyle = 'rgba(255,64,51,0.72)'; c.lineWidth = 1.6 * R.pt;
      c.beginPath(); c.arc(0, 0, size * 0.5, 0, 7); c.stroke();
      c.rotate(moving ? -t * 0.9 : 0); c.strokeStyle = 'rgba(255,64,51,0.75)'; c.lineWidth = 1.6 * R.pt; c.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4, r0 = size * 0.53, r1 = size * 0.62;
        c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      }
      c.stroke(); c.shadowBlur = 0;
      if (!glowPass) {
        c.rotate(moving ? t * 0.9 + t * 0.698 : 0);
        if (ready(im)) c.drawImage(im, -size / 2, -size / 2, size, size);
        else { c.fillStyle = DANGER; c.beginPath(); c.arc(0, 0, size * 0.2, 0, 7); c.fill(); }
      } else { c.fillStyle = 'rgba(255,60,40,0.5)'; c.beginPath(); c.arc(0, 0, size * 0.08, 0, 7); c.fill(); }
      c.restore();
    }

    function marker(c, t, moving, glowPass) {      // the player: the shiny diamond (pickup_energy) in a pulsing outline
      if (G.grace > 0 && Math.floor(G.now * 10) % 2) return;
      var pl = G.player, p = P(pl.x, pl.y), s = R.pt * p[2], pulse = moving ? 1.03 + Math.sin(t * 6.28) * 0.05 : 1, im = G.img.marker;
      c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(0,135,255,0.16)';
      diamond(c, p[0], p[1], 47 * s, 61 * s); c.fill(); c.globalCompositeOperation = 'source-over';
      soft(c, ACCENT, 8 * s, glowPass); c.strokeStyle = ACCENT; c.lineWidth = 1.6 * R.pt;
      diamond(c, p[0], p[1], 34 * s * pulse, 46 * s * pulse); c.stroke(); c.shadowBlur = 0;
      if (glowPass) return;
      if (ready(im)) c.drawImage(im, p[0] - 15.5 * s, p[1] - 19.5 * s, 31 * s, 39 * s);
      else { c.fillStyle = CLAIM; diamond(c, p[0], p[1], 24 * s, 32 * s); c.fill(); }
    }

    return {
      resize: resize, rebuild: rebuild, draw: draw, unproject: unproject,
      project: function (gx, gy) { var p = P(gx, gy); return [p[0] / R.W, p[1] / R.H]; },
      get aspect() { return ASPECT; }
    };
  }
  return { create: create, ASPECT: ASPECT };
})();
