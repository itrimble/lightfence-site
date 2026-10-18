// Lightfence mini board: the game's core rules on a small grid, playable on
// the page. Run the border, cut into open ground, close the cut to claim the
// side without the Snarl. No reversing, no touching your own line, and a line
// left standing lights a fuse. Tracers patrol the border. Claimed ground shows
// the sector's world. Before Play it plays itself.
//
// Free play is three stages (see FREE_STAGES). After the third win the page
// offers the App Store, once, at the high point; losses never count. The
// method is written up in site-templates/docs/PLAYABLE-DEMO.md.
(function () {
  'use strict';
  var root = document.getElementById('mini');
  if (!root) return;
  var canvas = root.querySelector('canvas');
  // With WebGL2 the frame is drawn off screen and finished on the GPU (play-gl.js).
  var gpu = window.LightfenceGL ? window.LightfenceGL.create(canvas) : null;
  var scene = gpu ? document.createElement('canvas') : canvas;
  var ctx = scene.getContext('2d');
  root.dataset.renderer = gpu ? 'webgl2' : 'canvas2d';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var GW = 40, GH = 50;                       // cells; the phone's portrait board
  var OPEN = 0, FILL = 1, TRAIL = 2;
  var STAGES = [
    { world: 'aqua-reef', name: 'Aqua Reef', accent: '#33f2ff', target: 0.55, snarl: 6.5, tracers: 1, tracer: 5.5 },
    { world: 'crystal-caverns', name: 'Crystal Caverns', accent: '#59ff80', target: 0.6, snarl: 7.5, tracers: 2, tracer: 6 },
    { world: 'magma-core', name: 'Magma Core', accent: '#ff8026', target: 0.65, snarl: 9, tracers: 2, tracer: 7 }
  ];
  var FREE_STAGES = STAGES.length;
  var NEXT = { world: 'ice-spires', name: 'Ice Spires' };
  var RUN = 12, DRAW = 9;                     // player speed on the border / drawing, cells per second
  var TURN_EARLY = 0.25;                      // a turn asked for a cell or two early is taken when it opens
  var COMBO_WINDOW = 6;

  var grid = new Uint8Array(GW * GH), flash = new Float32Array(GW * GH);
  var images = {}, state = 'demo', stage = 0, lives = 3, score = 0, best = 0, combo = 1, lastClaim = -99;
  var player, trail, snarl, tracers, fuse, still, grace, acc = 0, now = 0, pct = 0;
  // Steering latches, as in the game: the marker keeps the last heading until
  // it is blocked, a claim closes or it dies. `turn` is a heading asked for
  // but not yet open.
  var heading = null, turn = null, turnUntil = 0, stalled = true;
  var plan = [], deaths = 0, sparks = [], ring = { x: 0.5, y: 0.5, t: -9 };
  var layer = document.createElement('canvas'), lctx = layer.getContext('2d');
  var mask = document.createElement('canvas'); mask.width = GW; mask.height = GH;
  var cell = 8, dirty = true, running = false, visible = true;

  try { best = +localStorage.getItem('lf-mini-best') || 0; } catch (e) { /* storage off */ }

  function track(name, props) { if (window.posthog && window.posthog.capture) window.posthog.capture(name, props || {}); }
  function img(world) {
    if (!images[world]) { var i = new Image(); i.onload = function () { dirty = true; }; i.src = 'img/world-' + world + '.webp'; images[world] = i; }
    return images[world];
  }
  function idx(x, y) { return y * GW + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; }
  function at(x, y) { return inside(x, y) ? grid[idx(x, y)] : FILL; }
  function edge(x, y) {
    if (at(x, y) !== FILL || !inside(x, y)) return false;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++)
      if (inside(x + dx, y + dy) && grid[idx(x + dx, y + dy)] !== FILL) return true;
    return false;
  }

  // ---- a stage -------------------------------------------------------------
  function setup(n) {
    var s = STAGES[n % STAGES.length];
    stage = n % STAGES.length; grid.fill(OPEN); flash.fill(0);
    for (var x = 0; x < GW; x++) { grid[idx(x, 0)] = FILL; grid[idx(x, GH - 1)] = FILL; }
    for (var y = 0; y < GH; y++) { grid[idx(0, y)] = FILL; grid[idx(GW - 1, y)] = FILL; }
    player = { x: GW >> 1, y: GH - 1, drawing: false, from: null, dir: null };
    trail = []; fuse = 0; still = 0; grace = 1; acc = 0; pct = 0; combo = 1; plan = []; sparks = [];
    heading = turn = null; stalled = true;
    var a = Math.random() * Math.PI * 2;
    snarl = { x: GW / 2, y: GH * 0.4, vx: Math.cos(a) * s.snarl, vy: Math.sin(a) * s.snarl, spin: 0, lurch: 1, burst: 0 };
    tracers = [];
    for (var i = 0; i < s.tracers; i++)
      tracers.push({ x: i ? GW - 1 : 0, y: 0, dir: i ? [0, 1] : [1, 0], left: !!i, acc: 0, speed: s.tracer * (1 + i * 0.08) });
    img(s.world); img(STAGES[(n + 1) % STAGES.length].world);
    root.style.setProperty('--mini-accent', s.accent);
    dirty = true; hud();
  }

  // ---- the player and the line -------------------------------------------------
  function step(d) {
    var nx = player.x + d[0], ny = player.y + d[1];
    if (!inside(nx, ny)) return false;
    var c = grid[idx(nx, ny)];
    if (!player.drawing) {
      if (c === FILL) { if (!edge(nx, ny)) return false; player.x = nx; player.y = ny; return true; }
      player.drawing = true; player.from = { x: player.x, y: player.y }; player.dir = d; trail = [];
    } else if (d[0] === -player.dir[0] && d[1] === -player.dir[1]) return false;   // no reversing
    if (c === TRAIL) return false;
    if (c === OPEN) {
      var here = trail.length ? trail[trail.length - 1] : -1, k = idx(nx, ny), n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var j = 0; j < 4; j++) {                                                     // no running alongside it
        var mx = nx + n4[j][0], my = ny + n4[j][1];
        if (inside(mx, my) && grid[idx(mx, my)] === TRAIL && idx(mx, my) !== here) return false;
      }
      grid[k] = TRAIL; trail.push(k); player.x = nx; player.y = ny; player.dir = d; return true;
    }
    player.x = nx; player.y = ny; close(); return true;
  }

  function close() {
    var claimed = 0, seen = new Uint8Array(GW * GH), stack = [];
    trail.forEach(function (k) { grid[k] = FILL; flash[k] = now; });
    var sx = Math.floor(snarl.x), sy = Math.floor(snarl.y);
    if (at(sx, sy) === OPEN) stack.push(idx(sx, sy));
    while (stack.length) {
      var k = stack.pop();
      if (seen[k] || grid[k] !== OPEN) continue;
      seen[k] = 1;
      var x = k % GW, y = (k / GW) | 0;
      if (x > 0) stack.push(k - 1); if (x < GW - 1) stack.push(k + 1);
      if (y > 0) stack.push(k - GW); if (y < GH - 1) stack.push(k + GW);
    }
    var cx = 0, cy = 0;
    for (var i = 0; i < grid.length; i++) if (grid[i] === OPEN && !seen[i]) { grid[i] = FILL; flash[i] = now; claimed++; cx += i % GW; cy += (i / GW) | 0; }
    if (claimed) ring = { x: (cx / claimed + 0.5) / GW, y: 1 - (cy / claimed + 0.5) / GH, t: now };
    claimed += trail.length;
    player.drawing = false; trail = []; fuse = 0;
    combo = now - lastClaim < COMBO_WINDOW ? Math.min(combo + 0.5, 3) : 1; lastClaim = now;
    var gained = claimed / ((GW - 2) * (GH - 2));
    if (state === 'play') score += Math.round(gained * 10000 * combo);
    burst(player.x, player.y, Math.min(40, 8 + claimed / 8));
    tracers.forEach(reseat);
    measure(); dirty = true; hud();
    if (state === 'play' && pct >= STAGES[stage].target) win();
    if (state === 'demo' && pct >= 0.6) setTimeout(function () { if (state === 'demo') setup(stage + 1); }, 900);
  }

  function measure() {
    var n = 0;
    for (var y = 1; y < GH - 1; y++) for (var x = 1; x < GW - 1; x++) if (grid[idx(x, y)] === FILL) n++;
    pct = n / ((GW - 2) * (GH - 2));
  }

  function die() {
    if (grace > 0) return;
    trail.forEach(function (k) { grid[k] = OPEN; });
    if (player.drawing) { player.x = player.from.x; player.y = player.from.y; }
    player.drawing = false; trail = []; fuse = 0; grace = 1.25; plan = [];
    heading = turn = null; stalled = true;
    burst(player.x, player.y, 24, '#ff3dd8');
    if (state !== 'play') return;
    lives--; deaths++; combo = 1; hud();
    if (lives <= 0) over();
  }

  // ---- the Snarl and the Tracers ------------------------------------------------
  function moveSnarl(dt) {
    var s = STAGES[stage], speed = s.snarl * (snarl.burst > 0 ? 1.7 : 1);
    snarl.spin += dt * 2.4; snarl.lurch -= dt; snarl.burst -= dt;
    if (snarl.lurch <= 0) {                                             // lurches without warning
      var a = Math.atan2(snarl.vy, snarl.vx) + (Math.random() - 0.5) * 2.2;
      if (player.drawing && Math.random() < 0.5) a = Math.atan2(player.y - snarl.y, player.x - snarl.x);
      snarl.vx = Math.cos(a) * s.snarl; snarl.vy = Math.sin(a) * s.snarl;
      snarl.lurch = 0.8 + Math.random() * 1.2; snarl.burst = 0.3;
    }
    var m = Math.hypot(snarl.vx, snarl.vy) || 1, steps = Math.ceil(speed * dt / 0.4);
    for (var i = 0; i < steps; i++) {
      var nx = snarl.x + snarl.vx / m * speed * dt / steps, ny = snarl.y + snarl.vy / m * speed * dt / steps;
      if (at(Math.floor(nx), Math.floor(snarl.y)) === FILL) snarl.vx = -snarl.vx; else snarl.x = nx;
      if (at(Math.floor(snarl.x), Math.floor(ny)) === FILL) snarl.vy = -snarl.vy; else snarl.y = ny;
    }
    for (var arm = 0; arm < 3; arm++) {                                  // its arms cut lines too
      var t = snarl.spin + arm * 2.094;
      for (var r = 0; r <= 2.2; r += 0.55)
        if (at(Math.floor(snarl.x + Math.cos(t) * r), Math.floor(snarl.y + Math.sin(t) * r)) === TRAIL) { die(); return; }
    }
  }

  function reseat(t) {
    if (edge(t.x, t.y)) return;
    var bestD = 1e9;
    for (var y = 0; y < GH; y++) for (var x = 0; x < GW; x++)
      if (edge(x, y)) { var d = Math.abs(x - t.x) + Math.abs(y - t.y); if (d < bestD) { bestD = d; t.nx = x; t.ny = y; } }
    t.x = t.nx; t.y = t.ny;
  }

  function moveTracer(t, dt) {
    t.acc += t.speed * dt;
    while (t.acc >= 1) {
      t.acc -= 1;
      var d = t.dir, l = [d[1], -d[0]], r = [-d[1], d[0]], back = [-d[0], -d[1]];
      var order = t.left ? [l, d, r, back] : [r, d, l, back];
      for (var i = 0; i < 4; i++)
        if (edge(t.x + order[i][0], t.y + order[i][1])) { t.x += order[i][0]; t.y += order[i][1]; t.dir = order[i]; break; }
    }
    if (!player.drawing && Math.abs(t.x - player.x) + Math.abs(t.y - player.y) <= 1) die();
  }

  // ---- input -----------------------------------------------------------------
  var KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  var held = [];
  function same(a, b) { return !!a && !!b && a[0] === b[0] && a[1] === b[1]; }
  function steer(d) {
    if (state !== 'play') return;
    if (same(d, heading) && !stalled) { turn = null; return; }            // already going that way
    turn = d; turnUntil = now + TURN_EARLY;
    if (stalled) acc = Math.max(acc, 1);                                 // a standing marker moves on this frame
  }
  // Keys work wherever focus is while a stage is on; the board pauses when
  // it scrolls away, and then the arrows scroll the page again.
  document.addEventListener('keydown', function (e) {
    if (state !== 'play' || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key, d = KEYS[key];
    if (key === 'Escape' || key === 'p') { e.preventDefault(); pause(true); return; }
    if (!d) return;
    e.preventDefault();
    if (!held.some(function (h) { return same(h, d); })) held.push(d);
    if (!e.repeat) steer(d);
  });
  document.addEventListener('keyup', function (e) {
    var d = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    held = held.filter(function (h) { return !same(h, d); });
  });
  window.addEventListener('blur', function () { held = []; });
  var origin = null, dragged = false;                                     // finger-relative steering, as in the game
  canvas.addEventListener('pointerdown', function (e) {
    if (state !== 'play') return;
    origin = { x: e.clientX, y: e.clientY }; dragged = false;
    canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!origin) return;
    var dx = e.clientX - origin.x, dy = e.clientY - origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? KEYS.ArrowRight : KEYS.ArrowLeft) : (dy > 0 ? KEYS.ArrowDown : KEYS.ArrowUp));
    origin = { x: e.clientX, y: e.clientY }; dragged = true;
  });
  canvas.addEventListener('pointerup', function (e) {                     // a tap steers toward it
    if (origin && !dragged) {
      var r = canvas.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width * GW - (player.x + 0.5), dy = (e.clientY - r.top) / r.height * GH - (player.y + 0.5);
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 1)
        steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? KEYS.ArrowRight : KEYS.ArrowLeft) : (dy > 0 ? KEYS.ArrowDown : KEYS.ArrowUp));
    }
    origin = null;
  });
  canvas.addEventListener('pointercancel', function () { origin = null; });

  // The demo's hands: run the border a while, then cut a box and come home.
  function autopilot() {
    if (grace > 0) return null;
    if (!plan.length) {
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], inward = null;
      for (var i = 0; i < 4; i++) if (at(player.x + dirs[i][0], player.y + dirs[i][1]) === OPEN) inward = dirs[i];
      if (!inward || Math.random() < 0.4) {
        var along = dirs.filter(function (d) { return edge(player.x + d[0], player.y + d[1]); });
        plan.push({ d: along[(Math.random() * along.length) | 0], n: 3 + ((Math.random() * 8) | 0) });
      } else {
        var side = Math.random() < 0.5 ? [inward[1], -inward[0]] : [-inward[1], inward[0]];
        plan.push({ d: inward, n: 4 + ((Math.random() * 8) | 0) }, { d: side, n: 4 + ((Math.random() * 10) | 0) },
                  { d: [-inward[0], -inward[1]], n: 1e9, home: true });
      }
    }
    return plan[0].d;
  }

  // ---- the loop ----------------------------------------------------------------
  function drive(dt) {                                                     // the autopilot's moves
    var d = autopilot(), moved = false;
    if (!d) { acc = 0; return false; }
    acc += (player.drawing ? DRAW : RUN) * dt;
    while (acc >= 1) {
      acc -= 1;
      if (!step(d)) { acc = 0; plan.shift(); break; }
      moved = true;
      if (plan.length && --plan[0].n <= 0) plan.shift();
      if (!player.drawing && plan.length && plan[0].home) plan = [];
    }
    return moved;
  }

  function move(dt) {                                                      // the player's moves
    if (turn && held.some(function (h) { return same(h, turn); })) turnUntil = now + TURN_EARLY;
    if (turn && now > turnUntil) turn = null;
    if (!turn && !heading) { acc = 0; return false; }
    var moved = false;
    acc += (player.drawing ? DRAW : RUN) * dt;
    while (acc >= 1 && state === 'play') {
      acc -= 1;
      var was = player.drawing, took = null;
      if (turn && step(turn)) took = turn;
      else if (heading && step(heading)) took = heading;
      if (!took) { acc = 0; stalled = true; break; }
      moved = true; stalled = false; heading = took;
      if (took === turn) turn = null;
      if (was && !player.drawing) {                                        // a claim stops the marker on the border
        heading = null; stalled = true; acc = 0;
        if (held.length) { turn = held[held.length - 1]; turnUntil = now + TURN_EARLY; }
        break;
      }
    }
    return moved;
  }

  function update(dt) {
    now += dt; grace = Math.max(0, grace - dt);
    var moved = state === 'demo' ? drive(dt) : move(dt);
    still = moved || !player.drawing ? 0 : still + dt;
    if (player.drawing && still > 0.35) {                                  // the fuse burns up a standing line
      fuse += 10 * dt;
      if (fuse >= trail.length) die();
    } else if (moved) fuse = 0;
    moveSnarl(dt);
    tracers.forEach(function (t) { moveTracer(t, dt); });
    sparks = sparks.filter(function (p) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.t > 0; });
  }

  function burst(x, y, n, color) {
    if (reduce.matches) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, v = 4 + Math.random() * 12;
      sparks.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.4 + Math.random() * 0.5, c: color || STAGES[stage].accent });
    }
  }

  // ---- drawing -------------------------------------------------------------------
  function resize() {
    var w = canvas.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
    scene.width = canvas.width = Math.round(w * dpr); scene.height = canvas.height = Math.round(w * GH / GW * dpr);
    layer.width = canvas.width; layer.height = canvas.height;
    cell = canvas.width / GW; dirty = true;
  }

  function rebuild() {                                                     // claimed ground shows the world
    var s = STAGES[stage], im = img(s.world), W = layer.width, H = layer.height;
    var data = new ImageData(GW, GH);
    for (var i = 0; i < grid.length; i++) data.data[i * 4 + 3] = grid[i] === FILL ? 255 : 0;
    mask.getContext('2d').putImageData(data, 0, 0);
    lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, W, H);
    if (im.complete && im.naturalWidth) {
      var sc = Math.max(W / im.naturalWidth, H / im.naturalHeight);
      lctx.drawImage(im, (W - im.naturalWidth * sc) / 2, (H - im.naturalHeight * sc) / 2, im.naturalWidth * sc, im.naturalHeight * sc);
    } else { lctx.fillStyle = s.accent; lctx.globalAlpha = 0.3; lctx.fillRect(0, 0, W, H); lctx.globalAlpha = 1; }
    lctx.globalCompositeOperation = 'destination-in'; lctx.imageSmoothingEnabled = false;
    lctx.drawImage(mask, 0, 0, W, H);
    lctx.globalCompositeOperation = 'source-over';
    lctx.strokeStyle = s.accent; lctx.lineWidth = Math.max(1.5, cell * 0.22); lctx.shadowColor = s.accent; lctx.shadowBlur = cell;
    lctx.beginPath();
    for (var y = 0; y < GH; y++) for (var x = 0; x < GW; x++) {
      if (grid[idx(x, y)] !== FILL) continue;
      if (at(x, y - 1) !== FILL && y > 0) { lctx.moveTo(x * cell, y * cell); lctx.lineTo((x + 1) * cell, y * cell); }
      if (at(x, y + 1) !== FILL && y < GH - 1) { lctx.moveTo(x * cell, (y + 1) * cell); lctx.lineTo((x + 1) * cell, (y + 1) * cell); }
      if (at(x - 1, y) !== FILL && x > 0) { lctx.moveTo(x * cell, y * cell); lctx.lineTo(x * cell, (y + 1) * cell); }
      if (at(x + 1, y) !== FILL && x < GW - 1) { lctx.moveTo((x + 1) * cell, y * cell); lctx.lineTo((x + 1) * cell, (y + 1) * cell); }
    }
    lctx.stroke(); lctx.shadowBlur = 0;
    dirty = false;
  }

  function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = gpu || reduce.matches ? 0 : blur; }   // the GPU blooms instead

  function draw() {
    if (dirty) rebuild();
    var W = canvas.width, H = canvas.height, c = cell;
    ctx.fillStyle = '#070414'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,140,255,.10)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var gx = 0; gx <= GW; gx += 2) { ctx.moveTo(gx * c, 0); ctx.lineTo(gx * c, H); }
    for (var gy = 0; gy <= GH; gy += 2) { ctx.moveTo(0, gy * c); ctx.lineTo(W, gy * c); }
    ctx.stroke();
    ctx.drawImage(layer, 0, 0);
    if (!reduce.matches) {                                                 // the claim lights up, then settles
      ctx.fillStyle = '#fff';
      for (var i = 0; i < flash.length; i++) {
        var age = now - flash[i];
        if (flash[i] && age < 0.5) { ctx.globalAlpha = (0.5 - age) * 1.2; ctx.fillRect((i % GW) * c, ((i / GW) | 0) * c, c, c); }
      }
      ctx.globalAlpha = 1;
    }
    if (trail.length) {
      glow('#fff36a', c * 1.5); ctx.strokeStyle = '#fff36a'; ctx.lineWidth = c * 0.35; ctx.lineJoin = 'round'; ctx.beginPath();
      ctx.moveTo((player.from.x + 0.5) * c, (player.from.y + 0.5) * c);
      trail.forEach(function (k) { ctx.lineTo((k % GW + 0.5) * c, (((k / GW) | 0) + 0.5) * c); });
      ctx.stroke();
      if (fuse > 0) {
        var f = trail[Math.min(trail.length - 1, Math.floor(fuse))];
        glow('#fff', c * 2); ctx.fillStyle = '#fff'; ctx.beginPath();
        ctx.arc((f % GW + 0.5) * c, (((f / GW) | 0) + 0.5) * c, c * 0.5, 0, 7); ctx.fill();
      }
    }
    glow('#ff3dd8', c * 2); ctx.strokeStyle = '#ff3dd8'; ctx.lineWidth = c * 0.28; ctx.beginPath();
    for (var a = 0; a < 3; a++) {
      var t = snarl.spin + a * 2.094, r = 2.2 * c, x = snarl.x * c, y = snarl.y * c;
      ctx.moveTo(x - Math.cos(t) * r, y - Math.sin(t) * r); ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
    }
    ctx.stroke();
    glow('#ffb02e', c * 1.5); ctx.fillStyle = '#ffb02e';
    tracers.forEach(function (tr) { ctx.beginPath(); ctx.arc((tr.x + 0.5) * c, (tr.y + 0.5) * c, c * 0.5, 0, 7); ctx.fill(); });
    if (!(grace > 0 && Math.floor(now * 10) % 2)) {
      glow('#fff', c * 2); ctx.fillStyle = '#fff'; ctx.beginPath();
      ctx.arc((player.x + 0.5) * c, (player.y + 0.5) * c, c * 0.62, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
    sparks.forEach(function (p) { ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillStyle = p.c; ctx.fillRect(p.x * c, p.y * c, c * 0.3, c * 0.3); });
    ctx.globalAlpha = 1;
    if (gpu) gpu.render(scene, { claim: [ring.x, ring.y, Math.min(1, (now - ring.t) / 0.8)],
                                 snarl: [snarl.x / GW, 1 - snarl.y / GH], time: now, motion: reduce.matches ? 0 : 1 });
  }

  var last = 0;
  function frame(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (state === 'play' || state === 'demo') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible) { running = true; last = 0; requestAnimationFrame(frame); } }
  function stop() { running = false; }

  // ---- the page around the board -----------------------------------------------------
  var ui = {
    hud: root.querySelector('.mini-hud'), sector: root.querySelector('[data-mini="sector"]'),
    bar: root.querySelector('[data-mini="bar"]'), pct: root.querySelector('[data-mini="pct"]'),
    lives: root.querySelector('[data-mini="lives"]'), score: root.querySelector('[data-mini="score"]'),
    live: root.querySelector('[data-mini="live"]'), card: root.querySelector('.mini-card')
  };
  function hud() {
    var s = STAGES[stage];
    ui.sector.textContent = state === 'demo' ? 'Demo · ' + s.name : 'Stage ' + (stage + 1) + ' of ' + FREE_STAGES + ' · ' + s.name;
    ui.pct.textContent = Math.round(pct * 100) + '% of ' + Math.round(s.target * 100) + '%';
    ui.bar.style.width = Math.min(100, pct / s.target * 100) + '%';
    ui.lives.textContent = state === 'demo' ? '' : '◆'.repeat(Math.max(0, lives));
    ui.lives.setAttribute('aria-label', lives + ' lives');
    ui.score.textContent = state === 'demo' ? '' : score.toLocaleString();
  }
  function say(text) { ui.live.textContent = text; }

  function storeUrl(ct) {
    var a = document.querySelector('a[href*="apps.apple.com"]');
    if (!a) return null;
    var u = new URL(a.href); u.searchParams.set('ct', ct); return u.toString();
  }

  function card(html, focus) {
    ui.card.innerHTML = html; ui.card.hidden = false; root.classList.add('carded');
    var first = ui.card.querySelector(focus || 'h3');
    if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
    ui.card.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', act); });
    ui.card.querySelectorAll('a[data-ct]').forEach(function (a) {
      a.addEventListener('click', function () { track('mini_store_click', { ct: a.dataset.ct, stage: stage + 1, score: score }); });
    });
  }
  function hideCard() { ui.card.hidden = true; root.classList.remove('carded'); }
  function buy(ct, label) {
    var url = storeUrl(ct);
    return url ? '<a class="btn" data-ct="' + ct + '" href="' + url + '">' + label + '</a>'
               : '<span class="btn btn-static">Coming soon to the App Store</span>';
  }

  function play(fromStage) {
    hideCard(); state = 'play'; lives = 3; score = fromStage ? score : 0; deaths = 0;
    setup(fromStage || 0); canvas.focus({ preventScroll: true }); root.classList.add('playing');
    say('Stage ' + (stage + 1) + ': claim ' + Math.round(STAGES[stage].target * 100) + ' percent.');
    track('mini_play_start', { stage: stage + 1 }); start();
  }

  function win() {
    state = 'won'; burst(player.x, player.y, 60);
    track('mini_stage_clear', { stage: stage + 1, score: score });
    say('Stage ' + (stage + 1) + ' cleared.');
    if (stage + 1 < FREE_STAGES) {
      setTimeout(function () { state = 'play'; var keep = score; setup(stage + 1); score = keep; hud(); say('Stage ' + (stage + 1) + ': ' + STAGES[stage].name + '.'); }, reduce.matches ? 300 : 1400);
      return;
    }
    if (score > best) { best = score; try { localStorage.setItem('lf-mini-best', best); } catch (e) { /* storage off */ } }
    try { localStorage.setItem('lf-mini-done', '1'); } catch (e) { /* storage off */ }
    setTimeout(ask, reduce.matches ? 200 : 1600);
  }

  function ask() {                                                          // the high point, once
    state = 'done'; root.classList.remove('playing'); track('mini_ask_shown', { score: score });
    card('<p class="eyebrow">' + FREE_STAGES + ' stages cleared · ' + score.toLocaleString() + ' points</p>' +
      '<h3>That was ' + FREE_STAGES + ' of 100.</h3>' +
      '<div class="mini-next" style="--next:url(img/world-' + NEXT.world + '.webp)"><span>Next · Sector 4</span><b>' + NEXT.name + '</b></div>' +
      '<p>The full game has ten sectors of ten stages, a guardian fight at the end of each, the Light Core upgrades and Endless mode. One purchase covers iPhone, iPad and Apple TV.</p>' +
      '<div class="mini-actions">' + buy('web_demo_end', 'Get Lightfence') +
      '<button class="btn btn-ghost" type="button" data-act="replay">Play again</button></div>');
  }

  function over() {
    state = 'over'; track('mini_game_over', { stage: stage + 1, score: score });
    card('<p class="eyebrow">Stage ' + (stage + 1) + ' · ' + score.toLocaleString() + ' points</p>' +
      '<h3>The Snarl got you.</h3><p>Losses don’t count. Pick up where you fell.</p>' +
      '<div class="mini-actions"><button class="btn" type="button" data-act="retry">Try stage ' + (stage + 1) + ' again</button>' +
      (deaths >= 3 && storeUrl('x') ? buy('web_demo_skip', 'Or get the full game') : '') + '</div>', 'button');
  }

  function pause(on) {
    if (on && state === 'play') {
      state = 'paused';
      card('<h3>Paused</h3><div class="mini-actions"><button class="btn" type="button" data-act="resume">Resume</button></div>', 'button');
    }
  }

  function act(e) {
    var a = e.currentTarget.dataset.act;
    if (a === 'start' || a === 'replay') play(0);
    if (a === 'retry') { var keep = score; play(stage); score = keep; hud(); }
    if (a === 'resume') { hideCard(); state = 'play'; canvas.focus({ preventScroll: true }); }
  }
  root.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', act); });
  ui.card.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (state === 'done' || state === 'over')) { hideCard(); state = 'demo'; setup(0); root.classList.remove('playing'); hud(); }
  });

  // Returning players who finished the free stages see where they left off.
  var done = false;
  try { done = localStorage.getItem('lf-mini-done') === '1'; } catch (e) { /* storage off */ }

  setup(0); resize();
  window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (!visible) { if (state === 'play') pause(true); stop(); } else start();
    }, { threshold: 0.15 }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { if (state === 'play') pause(true); stop(); } else start(); });
  if (reduce.matches) { state = 'still'; draw(); }                          // a still board until Play
  if (done && best) root.querySelector('[data-mini="best"]').textContent = 'Your best: ' + best.toLocaleString();
  start();
  if (/[?&]minitest\b/.test(location.search))                          // for scripted tests only
    window.__mini = { get: function () { return { state: state, stage: stage, pct: pct, lives: lives, score: score,
                                                  x: player.x, y: player.y, drawing: player.drawing }; },
                      win: function () { pct = 1; win(); },
                      calm: function () { snarl.x = GW - 6; snarl.y = 6; snarl.vx = snarl.vy = 0.001; STAGES[stage].snarl = 0.001; tracers = []; } };
})();
