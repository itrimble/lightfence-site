// Lightfence mini board: the game's core rules on a small grid, playable on
// the page. Run the border, cut into open ground, close the cut to claim the
// side without the Snarl. No reversing, no touching your own line, and a line
// left standing lights a fuse. Tracers patrol the border; walls block lines
// and the Snarl. Claimed ground shows the sector's world. Before Play it plays
// itself. Drawing is in play-draw.js (and play-gl.js with a GPU).
//
// The three free stages are the game's first three, Aqua Reef 1-3 (qix-swift
// LevelCatalog + Resources/WaveRecipes/campaign-layouts.json). After the
// third win the page offers the App Store, once, at the high point; losses
// never count. The method is in site-templates/docs/PLAYABLE-DEMO.md.
(function () {
  'use strict';
  var root = document.getElementById('mini');
  if (!root || !window.LightfenceDraw || !window.LightfenceHud) return;
  var canvas = root.querySelector('canvas');
  // With WebGL2 the frame is drawn off screen and finished on the GPU (play-gl.js).
  var gpu = window.LightfenceGL ? window.LightfenceGL.create(canvas) : null;
  root.dataset.renderer = gpu ? 'webgl2' : 'canvas2d';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var GW = 40, GH = 46;                       // cells; the phone's board, about 28 x 32 game units
  var OPEN = 0, FILL = 1, TRAIL = 2, WALL = 3;
  // Speeds in cells a second (1 game unit = 1.4 cells). The game: player 9 u/s on
  // the border and 0.75 of that drawing; Snarl 3 u/s, erratic 0.5, aggression
  // 0.15; Tracers 5 u/s (6.5 on Perimeter Patrol); win at 66 %. Stages 1-2 are
  // softened for a first-time player (see the README).
  var STAGES = [
    { title: 'Reef Twin Gates', target: 0.6, snarl: 4.3, art: 'blue', tracers: 1, tracer: 7, spawn: [0.66, 0.62],
      walls: [[0.197, 0.255, 0.064, 0.068], [0.707, 0.63, 0.08, 0.098]] },
    { title: 'Reef Broken Causeway', target: 0.63, snarl: 4.35, art: 'green', tracers: 2, tracer: 7, spawn: [0.34, 0.635],
      walls: [[0.095, 0.405, 0.064, 0.068], [0.299, 0.63, 0.08, 0.098], [0.605, 0.255, 0.08, 0.11]] },
    { title: 'Reef Staggered Columns', target: 0.66, snarl: 4.4, art: 'red', tracers: 3, tracer: 8.5, spawn: [0.534, 0.68],
      walls: [[0.197, 0.255, 0.064, 0.068], [0.197, 0.555, 0.08, 0.098], [0.707, 0.405, 0.08, 0.11]] }
  ];
  var FREE_STAGES = STAGES.length;
  var RUN = 12, DRAW = 9, TURN_EARLY = 0.25, COMBO_WINDOW = 6, HIT = 2.0;

  var grid = new Uint8Array(GW * GH);
  var state = 'demo', stage = 0, lives = 3, score = 0, best = 0, combo = 1, lastClaim = -99;
  var player, trail = [], snarl, tracers = [], walls = [], fuse = 0, still = 0, grace = 0, acc = 0, now = 0, pct = 0;
  // Steering latches, as in the game: the marker keeps the last heading until
  // it is blocked, a claim closes or it dies. `turn` is a heading asked for but not yet open.
  var heading = null, turn = null, turnUntil = 0, stalled = true;
  var plan = [], deaths = 0, sparks = [], ring = { x: 0.5, y: 0.5, t: -9 }, running = false, visible = true, light = 0, lean = [0, 0];

  try { best = +localStorage.getItem('lf-mini-best') || 0; } catch (e) { /* storage off */ }

  // ---- art, loaded when the board comes near ----------------------------------------
  var img = {}, loaded = false;
  function load() {
    if (loaded) return; loaded = true;
    var files = { far: 'reef-far', near: 'reef-near', wall: 'reef-wall', tracer: 'tracer', marker: 'marker',
                  blue: 'snarl-blue', green: 'snarl-green', red: 'snarl-red' };
    Object.keys(files).forEach(function (k) {
      var i = new Image(); i.decoding = 'async'; i.onload = function () { if (!running) render(); };
      i.src = 'img/play/' + files[k] + '.webp'; img[k] = i;
    });
  }
  var G = { GW: GW, GH: GH, OPEN: OPEN, FILL: FILL, TRAIL: TRAIL, WALL: WALL, grid: grid, img: img,
            scene: gpu ? document.createElement('canvas') : canvas, glow: gpu ? document.createElement('canvas') : null };
  var draw = window.LightfenceDraw.create(G);

  function track(name, props) { if (window.posthog && window.posthog.capture) window.posthog.capture(name, props || {}); }
  function idx(x, y) { return y * GW + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; }
  function at(x, y) { return inside(x, y) ? grid[idx(x, y)] : FILL; }
  function edge(x, y) {                         // border: claimed ground next to open ground or the line
    if (at(x, y) !== FILL || !inside(x, y)) return false;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var c = at(x + dx, y + dy);
      if (inside(x + dx, y + dy) && (c === OPEN || c === TRAIL)) return true;
    }
    return false;
  }

  // ---- a stage -------------------------------------------------------------------
  function setup(n) {
    var s = STAGES[n % STAGES.length];
    stage = n % STAGES.length; grid.fill(OPEN);
    for (var x = 0; x < GW; x++) { grid[idx(x, 0)] = FILL; grid[idx(x, GH - 1)] = FILL; }
    for (var y = 0; y < GH; y++) { grid[idx(0, y)] = FILL; grid[idx(GW - 1, y)] = FILL; }
    walls = s.walls.map(function (r) {         // layout rects are fractions of the board, y from the near edge
      var x0 = Math.max(2, Math.ceil(r[0] * (GW - 1))), x1 = Math.max(x0, Math.floor((r[0] + r[2]) * (GW - 1)));
      var y0 = Math.max(2, Math.ceil((1 - r[1] - r[3]) * (GH - 1))), y1 = Math.max(y0, Math.floor((1 - r[1]) * (GH - 1)));
      for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) grid[idx(xx, yy)] = WALL;
      return [x0, y0, x1, y1];
    });
    player = { x: GW >> 1, y: GH - 1, drawing: false, from: null, dir: null };
    trail = []; fuse = 0; still = 0; grace = 1; acc = 0; pct = 0; combo = 1; plan = []; sparks = [];
    heading = turn = null; stalled = true;
    var sp = clear(s.spawn[0] * (GW - 1), (1 - s.spawn[1]) * (GH - 1));
    snarl = { x: sp[0] + 0.5, y: sp[1] + 0.5, h: Math.random() * 6.283, turnT: 1, frozen: false };
    tracers = [];
    for (var i = 0; i < s.tracers; i++)
      tracers.push({ x: Math.round(GW * (i + 1) / (s.tracers + 1)), y: 0, dir: i % 2 ? [-1, 0] : [1, 0], left: !!(i % 2), acc: 0, speed: s.tracer });
    G.snarlArt = s.art; G.walls = walls; G.stageNo = stage + 1;
    draw.rebuild(false); hud();
  }
  function clear(fx, fy) {                     // the nearest open cell with room round it (obstacleField.spawn)
    for (var r = 0; r < 20; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      var x = Math.round(fx) + dx, y = Math.round(fy) + dy, ok = true;
      for (var j = -3; j <= 3 && ok; j++) for (var i = -3; i <= 3 && ok; i++) if (at(x + i, y + j) !== OPEN) ok = false;
      if (ok) return [x, y];
    }
    return [GW >> 1, GH >> 1];
  }

  // ---- the player and the line -------------------------------------------------------
  function step(d) {
    var nx = player.x + d[0], ny = player.y + d[1];
    if (!inside(nx, ny)) return false;
    var c = grid[idx(nx, ny)];
    if (c === WALL) return false;
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
    trail.forEach(function (k) { grid[k] = FILL; });
    var sx = Math.floor(snarl.x), sy = Math.floor(snarl.y);
    if (at(sx, sy) !== OPEN) { var c = clear(sx, sy); sx = c[0]; sy = c[1]; }
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
    for (var i = 0; i < grid.length; i++) if (grid[i] === OPEN && !seen[i]) { grid[i] = FILL; claimed++; cx += i % GW; cy += (i / GW) | 0; }
    if (claimed) { var c2 = draw.project(cx / claimed, cy / claimed); ring = { x: c2[0], y: 1 - c2[1], t: now }; }
    claimed += trail.length;
    player.drawing = false; trail = []; fuse = 0;
    combo = now - lastClaim < COMBO_WINDOW ? Math.min(combo + 1, 4) : 1; lastClaim = now;
    var gained = claimed / playable();
    if (state === 'play') { score += Math.round(gained * 10000 * combo); sound('claim'); if (combo > 1) sound('combo', 0.7); }
    burst(player.x, player.y, Math.min(40, 8 + claimed / 8));
    tracers.forEach(reseat);
    measure(); draw.rebuild(true); hud();
    if (state === 'play' && pct >= STAGES[stage].target) win();
    if (state === 'demo' && pct >= 0.6) setTimeout(function () { if (state === 'demo') setup(stage + 1); }, 900);
  }

  function playable() { return (GW - 2) * (GH - 2) - walls.reduce(function (n, w) { return n + (w[2] - w[0] + 1) * (w[3] - w[1] + 1); }, 0); }
  function measure() {
    var n = 0;
    for (var y = 1; y < GH - 1; y++) for (var x = 1; x < GW - 1; x++) if (grid[idx(x, y)] === FILL) n++;
    pct = n / playable();
  }

  function die() {
    if (grace > 0) return;
    trail.forEach(function (k) { grid[k] = OPEN; });
    if (player.drawing) { player.x = player.from.x; player.y = player.from.y; }
    player.drawing = false; trail = []; fuse = 0; grace = 1.25; plan = [];
    heading = turn = null; stalled = true;
    burst(player.x, player.y, 24, '#ff4033');
    if (state !== 'play') return;
    lives--; deaths++; combo = 1; sound('die'); hud();
    if (lives <= 0) over();
  }
  // ---- the Snarl and the Tracers ------------------------------------------------------
  function blocked(x, y) { var c = at(Math.floor(x), Math.floor(y)); return c === FILL || c === WALL; }
  function moveSnarl(dt) {                     // QixGame.moveQix: erratic lurches, bending toward an open line
    if (snarl.frozen) return;
    var s = STAGES[stage];
    snarl.turnT -= dt;
    if (snarl.turnT <= 0) {
      snarl.turnT = 0.7 + Math.random() * 1.1;
      var m = (0.5 + Math.random() * 1.4) * 0.5; snarl.h += Math.random() < 0.5 ? m : -m;
    }
    if (trail.length >= 2) {
      var bestD = 1e9, tx = 0, ty = 0;
      trail.forEach(function (k) { var dx = k % GW + 0.5 - snarl.x, dy = ((k / GW) | 0) + 0.5 - snarl.y, d = dx * dx + dy * dy; if (d < bestD) { bestD = d; tx = dx; ty = dy; } });
      var turnBy = Math.atan2(ty, tx) - snarl.h; turnBy = Math.atan2(Math.sin(turnBy), Math.cos(turnBy));
      var lim = 0.15 * 2.4 * dt; snarl.h += Math.max(-lim, Math.min(lim, turnBy));
    }
    var steps = Math.ceil(s.snarl * dt / 0.3), r = 2.2;              // ~ the game's body radius, 1.68 u
    for (var i = 0; i < steps; i++) {
      var dx = Math.cos(snarl.h) * s.snarl * dt / steps, dy = Math.sin(snarl.h) * s.snarl * dt / steps;
      if (blocked(snarl.x + dx + (dx > 0 ? r : -r), snarl.y)) snarl.h = Math.PI - snarl.h; else snarl.x += dx;
      if (blocked(snarl.x, snarl.y + dy + (dy > 0 ? r : -r))) snarl.h = -snarl.h; else snarl.y += dy;
    }
    for (var j = 0; j < trail.length; j++) {    // its body cuts the line
      var ex = trail[j] % GW + 0.5 - snarl.x, ey = ((trail[j] / GW) | 0) + 0.5 - snarl.y;
      if (ex * ex + ey * ey < HIT * HIT) { die(); return; }
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
  // ---- input -------------------------------------------------------------------------
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
    if (key === 'm') { e.preventDefault(); toggleSound(); return; }
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
  function toward(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? KEYS.ArrowRight : KEYS.ArrowLeft) : (dy > 0 ? KEYS.ArrowDown : KEYS.ArrowUp); }
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
    steer(toward(dx, dy)); origin = { x: e.clientX, y: e.clientY }; dragged = true;
  });
  canvas.addEventListener('pointerup', function (e) {                     // a tap steers toward it, on the tilted board
    if (origin && !dragged) {
      var r = canvas.getBoundingClientRect(), k = G.scene.width / r.width;
      var g = draw.unproject((e.clientX - r.left) * k, (e.clientY - r.top) * k), dx = g[0] - player.x, dy = g[1] - player.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 1) steer(toward(dx, dy));
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
        if (!along.length) return null;
        plan.push({ d: along[(Math.random() * along.length) | 0], n: 3 + ((Math.random() * 8) | 0) });
      } else {
        var side = Math.random() < 0.5 ? [inward[1], -inward[0]] : [-inward[1], inward[0]];
        plan.push({ d: inward, n: 4 + ((Math.random() * 8) | 0) }, { d: side, n: 4 + ((Math.random() * 10) | 0) },
                  { d: [-inward[0], -inward[1]], n: 1e9, home: true });
      }
    }
    return plan[0].d;
  }

  // ---- the loop -------------------------------------------------------------------------
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
      sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.4 + Math.random() * 0.5, c: color || '#33f2ff' });
    }
  }

  // ---- drawing (play-draw.js) ---------------------------------------------------------------
  var cssW = 0;                                 // phones fire resize as their toolbars slide; only a new width redraws
  function resize() {
    var w = canvas.clientWidth || 360;
    if (w === cssW) return;
    cssW = w; draw.resize(w);
    if (gpu) { canvas.width = G.scene.width; canvas.height = G.scene.height; }
    if (!running) render(0);
  }
  function render(dt) {
    var moving = !reduce.matches;
    // The world brightens as ground is won back, and fully when the stage is cleared (WorldStory).
    var goal = state === 'won' || state === 'done' ? 1 : Math.min(1, pct / STAGES[stage].target) * 0.75;
    light += (goal - light) * Math.min(1, (dt || 1) * 1.5);
    var lx = player.x / (GW - 1) - 0.5, ly = player.y / (GH - 1) - 0.5;
    lean[0] += (lx - lean[0]) * Math.min(1, (dt || 1) * 1.2); lean[1] += (ly - lean[1]) * Math.min(1, (dt || 1) * 1.2);
    G.player = player; G.trail = trail; G.snarl = snarl; G.tracers = tracers; G.sparks = sparks;
    G.fuse = fuse; G.grace = grace; G.dt = dt || 0; G.now = now; G.light = light; G.lean = moving ? lean : [0, 0]; G.reduce = !moving;
    draw.draw(performance.now() / 1000, moving);
    if (gpu) {
      var s = draw.project(snarl.x - 0.5, snarl.y - 0.5);
      gpu.render(G.scene, G.glow, { claim: [ring.x, ring.y, Math.min(1, (now - ring.t) / 0.8)], snarl: [s[0], 1 - s[1]], time: now, motion: moving ? 1 : 0 });
    }
  }

  var last = 0;
  function frame(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (state === 'play' || state === 'demo') update(dt);
    render(dt);
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible) { running = true; last = 0; requestAnimationFrame(frame); } }
  function stop() { running = false; }

  // ---- the page around the board -------------------------------------------------------------
  var H = window.LightfenceHud.create(root), ui = H.ui;
  function hud() { var s = STAGES[stage]; H.update({ stage: stage, stages: FREE_STAGES, title: s.title, target: s.target, pct: pct, lives: lives, score: score, best: best }); }
  function say(text) { H.say(text); } function sound(n, vol) { H.play(n, vol); }
  function toggleSound() { H.toggle(state !== 'demo' && state !== 'still'); }

  function storeUrl(ct) {
    var a = document.querySelector('a[href*="apps.apple.com"]');
    if (!a) return null;
    var u = new URL(a.href); u.searchParams.set('ct', ct); return u.toString();
  }

  function card(html, focus) {
    ui.card.innerHTML = html; ui.card.hidden = false; root.classList.add('carded'); ui.pause.hidden = true;
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
    hideCard(); load(); H.start(); state = 'play'; lives = 3; score = fromStage ? score : 0; deaths = 0;
    setup(fromStage || 0); canvas.focus({ preventScroll: true }); root.classList.add('playing'); ui.pause.hidden = false;
    sound('confirm', 0.8);
    say('Stage ' + (stage + 1) + ', ' + STAGES[stage].title + ': claim ' + Math.round(STAGES[stage].target * 100) + ' percent.');
    track('mini_play_start', { stage: stage + 1 }); start();
  }

  function win() {
    state = 'won'; burst(player.x, player.y, 60); sound('win');
    track('mini_stage_clear', { stage: stage + 1, score: score });
    say('Stage ' + (stage + 1) + ' cleared.');
    if (stage + 1 < FREE_STAGES) {
      setTimeout(function () {
        state = 'play'; var keep = score; setup(stage + 1); score = keep; hud();
        say('Stage ' + (stage + 1) + ', ' + STAGES[stage].title + ': claim ' + Math.round(STAGES[stage].target * 100) + ' percent.');
      }, reduce.matches ? 300 : 1600);
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
      '<div class="mini-next" style="--next:url(img/world-crystal-caverns.webp)"><span>Next world · Sector 2</span><b>Crystal Caverns</b></div>' +
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
      state = 'paused'; sound('select', 0.6);
      card('<h3>Paused</h3><div class="mini-actions"><button class="btn" type="button" data-act="resume">Resume</button></div>', 'button');
    }
  }

  function act(e) {
    var a = e.currentTarget.dataset.act;
    if (a === 'sound') { toggleSound(); return; }
    if (a === 'pause') { pause(true); return; }
    if (a === 'start' || a === 'replay') play(0);
    if (a === 'retry') { var keep = score; play(stage); score = keep; hud(); }
    if (a === 'resume') { hideCard(); state = 'play'; ui.pause.hidden = false; sound('select', 0.6); canvas.focus({ preventScroll: true }); }
  }
  root.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', act); });
  ui.card.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (state === 'done' || state === 'over')) { hideCard(); state = 'demo'; setup(0); root.classList.remove('playing'); hud(); }
  });

  var done = false;                            // returning players who finished see their best
  try { done = localStorage.getItem('lf-mini-done') === '1'; } catch (e) { /* storage off */ }

  setup(0); resize();
  window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { if (entries[0].isIntersecting) load(); }, { rootMargin: '800px 0px' }).observe(root);
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (!visible) { if (state === 'play') pause(true); stop(); } else start();
    }, { threshold: 0.15 }).observe(canvas);
  } else load();
  document.addEventListener('visibilitychange', function () { if (document.hidden) { if (state === 'play') pause(true); stop(); } else start(); });
  if (reduce.matches) state = 'still';                                     // a still board until Play
  if (done && best) root.querySelector('[data-mini="best"]').textContent = 'Your best: ' + best.toLocaleString();
  render(0); start();
  if (/[?&]minitest\b/.test(location.search))                          // for scripted tests only
    window.__mini = { get: function () { return { state: state, stage: stage, pct: pct, lives: lives, score: score,
                                                  x: player.x, y: player.y, drawing: player.drawing }; },
                      win: function () { pct = 1; win(); },
                      calm: function () { snarl.x = GW - 6; snarl.y = 6; snarl.frozen = true; tracers = []; } };
})();
