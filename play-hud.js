// The HUD and sound round the mini board (play.js). The HUD reads like the
// game's (GameHUD.swift): SCORE and BEST, the CLAIM ring with the target tick,
// LIVES, the sector title, the stage line and stage pills. Sound is the game's
// own designed effects (qix-swift Resources/Effects, made by Tools/Sound/sfx.py),
// fetched and decoded only after the visitor presses Play, never autoplayed,
// with a mute toggle remembered per browser.
window.LightfenceHud = (function () {
  'use strict';
  function create(root) {
    function q(n) { return root.querySelector('[data-mini="' + n + '"]'); }
    var ui = { line: q('line'), pct: q('pct'), arc: q('arc'), tick: q('tick'), lives: q('lives'), score: q('score'),
               best: q('bestline'), pills: q('pills'), live: q('live'), card: root.querySelector('.mini-card'),
               sound: root.querySelector('[data-act="sound"]'), pause: root.querySelector('[data-act="pause"]') };
    var audio = { on: true, ctx: null, out: null, buf: {} };
    try { audio.on = localStorage.getItem('lf-mini-sound') !== 'off'; } catch (e) { /* storage off */ }

    function start() {                          // call from a click: browsers allow sound from there
      if (!audio.on) return;
      if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { audio.ctx = new AC(); } catch (e) { return; }
      audio.out = audio.ctx.createGain(); audio.out.gain.value = 0.55; audio.out.connect(audio.ctx.destination);
      ['claim', 'combo', 'die', 'win', 'confirm', 'select'].forEach(function (n) {
        fetch('media/sfx/' + n + '.m4a').then(function (r) { return r.arrayBuffer(); }).then(function (b) {
          audio.ctx.decodeAudioData(b, function (buf) { audio.buf[n] = buf; }, function () { /* codec missing: stay quiet */ });
        }).catch(function () { /* offline: stay quiet */ });
      });
    }
    function play(n, vol) {
      if (!audio.on || !audio.ctx || !audio.buf[n]) return;
      var s = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
      s.buffer = audio.buf[n]; g.gain.value = vol || 1; s.connect(g); g.connect(audio.out); s.start();
    }
    function soundUi() {
      ui.sound.setAttribute('aria-pressed', audio.on ? 'true' : 'false');
      ui.sound.setAttribute('aria-label', audio.on ? 'Sound on (M to mute)' : 'Sound off (M to turn on)');
    }
    function toggle(playing) {
      audio.on = !audio.on; soundUi();
      try { localStorage.setItem('lf-mini-sound', audio.on ? 'on' : 'off'); } catch (e) { /* storage off */ }
      if (audio.on && playing) { start(); play('select'); }
    }
    // s: { stage (0-based), stages, title, target, pct, lives, score, best }
    function update(s) {
      ui.line.textContent = 'Stage ' + (s.stage + 1) + '/' + s.stages + ' · ' + s.title + ' · ' + Math.round(s.target * 100) + '%';
      ui.pct.textContent = Math.round(s.pct * 100) + '%';
      ui.arc.style.strokeDasharray = Math.min(100, s.pct * 100).toFixed(1) + ' 100';
      ui.tick.setAttribute('transform', 'rotate(' + (s.target * 360).toFixed(1) + ' 42 42)');
      Array.prototype.forEach.call(ui.lives.children, function (p, i) { p.classList.toggle('lost', i >= s.lives); });
      Array.prototype.forEach.call(ui.pills.children, function (p, i) { p.classList.toggle('on', i <= s.stage); });
      ui.score.textContent = s.score.toLocaleString();
      ui.best.textContent = 'Best ' + Math.max(s.best, s.score).toLocaleString();
    }
    soundUi();
    return { ui: ui, update: update, say: function (t) { ui.live.textContent = t; }, start: start, play: play, toggle: toggle };
  }
  return { create: create };
})();
