// Lightfence landing page: lazy video, sector rail, reveals.
// Videos load only near the viewport and play only while on screen. With
// Reduce Motion or Save-Data they stay as posters until the viewer presses Play.
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var hasIO = 'IntersectionObserver' in window;

  function attach(video) {
    if (video.dataset.loaded) return;
    video.dataset.loaded = '1';
    video.querySelectorAll('source[data-src]').forEach(function (s) { s.src = s.dataset.src; });
    video.load();
  }

  function setButton(btn, playing) {
    btn.textContent = playing ? 'Pause' : 'Play';
    btn.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + ' video');
  }

  function play(video) {
    attach(video);
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay refused; the button still works */ });
  }

  var clips = Array.prototype.slice.call(document.querySelectorAll('.clip'));
  clips.forEach(function (clip) {
    var video = clip.querySelector('video');
    var btn = clip.querySelector('.vbtn');
    if (!video || !btn) return;
    btn.hidden = false;
    setButton(btn, false);
    video.addEventListener('play', function () { setButton(btn, true); });
    video.addEventListener('pause', function () { setButton(btn, false); });
    btn.addEventListener('click', function () {
      if (video.paused) { clip.dataset.user = 'play'; play(video); }
      else { clip.dataset.user = 'pause'; video.pause(); }
    });
  });

  function autoplayAllowed(clip) {
    if (clip.dataset.user === 'pause') return false;
    if (clip.dataset.user === 'play') return true;
    return !reduce.matches && !saveData;
  }

  if (hasIO) {
    var near = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var v = e.target.querySelector('video');
        if (v && autoplayAllowed(e.target)) attach(v);
        near.unobserve(e.target);
      });
    }, { rootMargin: '400px 0px' });

    var vis = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target.querySelector('video');
        if (!v) return;
        if (e.isIntersecting && autoplayAllowed(e.target)) play(v);
        else if (!e.isIntersecting && !v.paused) v.pause();
      });
    }, { threshold: 0.45 });

    clips.forEach(function (c) { near.observe(c); vis.observe(c); });
  }

  // Sector backdrops: load each painting only as its panel approaches.
  var sectors = Array.prototype.slice.call(document.querySelectorAll('.sector'));
  var railLinks = {};
  document.querySelectorAll('.rail a').forEach(function (a) { railLinks[a.getAttribute('href').slice(1)] = a; });

  if (hasIO) {
    var bg = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('near'); bg.unobserve(e.target); }
      });
    }, { rootMargin: '600px 0px' });

    var current = null;
    var rail = document.querySelector('.rail');
    var showing = {};
    var active = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        showing[e.target.id] = e.isIntersecting;
        if (rail) rail.classList.toggle('on', Object.keys(showing).some(function (k) { return showing[k]; }));
        if (!e.isIntersecting) return;
        if (current) current.removeAttribute('aria-current');
        current = railLinks[e.target.id] || null;
        if (current) current.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -45% 0px' });

    var reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
      });
    }, { threshold: 0.2 });

    sectors.forEach(function (s) { bg.observe(s); active.observe(s); });
    document.querySelectorAll('.reveal').forEach(function (el) { reveal.observe(el); });
  } else {
    sectors.forEach(function (s) { s.classList.add('near'); });
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  // The SVG board demo uses SMIL; hold it still under Reduce Motion.
  var board = document.querySelector('.board-svg');
  function syncBoard() {
    if (!board || !board.pauseAnimations) return;
    if (reduce.matches) board.pauseAnimations(); else board.unpauseAnimations();
  }
  syncBoard();
  if (reduce.addEventListener) reduce.addEventListener('change', syncBoard);

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
