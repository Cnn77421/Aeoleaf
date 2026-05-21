/* ═══════════════════════════════════════════════════════════════════════════
 *  Birthday Theme — 5.21
 *  canvas-confetti + cake interaction + balloon/sparkle decorations
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Load canvas-confetti from CDN ─────────────────────────────────────── */
  function loadConfetti() {
    return new Promise(function (resolve, reject) {
      if (window.confetti) return resolve();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ── Confetti bursts ───────────────────────────────────────────────────── */
  var BIRTHDAY_COLORS = ['#FF6B9D', '#FFB84D', '#7C5CFF', '#49E3D0', '#FFD700', '#FF8DB5', '#B8F26C'];

  function burstCenter() {
    if (!window.confetti) return;
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: BIRTHDAY_COLORS,
      disableForReducedMotion: true
    });
  }

  function burstSides() {
    if (!window.confetti) return;
    var duration = 2000;
    var end = Date.now() + duration;
    (function frame() {
      confetti({ particleCount: 3, angle: 60,  spread: 55, origin: { x: 0, y: 0.7 }, colors: BIRTHDAY_COLORS, disableForReducedMotion: true });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: BIRTHDAY_COLORS, disableForReducedMotion: true });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  function bigBurst() {
    if (!window.confetti) return;
    // Multi-wave celebration
    burstCenter();
    setTimeout(burstSides, 300);
    setTimeout(function () {
      confetti({ particleCount: 50, spread: 100, origin: { y: 0.5 }, colors: BIRTHDAY_COLORS, disableForReducedMotion: true, scalar: 1.2 });
    }, 800);
  }

  /* ── Balloons ──────────────────────────────────────────────────────────── */
  var BALLOON_COLORS = ['#FF6B9D', '#FFB84D', '#7C5CFF', '#49E3D0', '#FFD700', '#FF8DB5', '#4DA8FF', '#B8F26C'];

  function createBalloons(container) {
    var count = window.innerWidth < 640 ? 3 : 5;
    for (var i = 0; i < count; i++) {
      var b = document.createElement('div');
      b.className = 'birthday-balloon';
      b.style.left = (Math.random() * 100) + '%';
      b.style.background = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)];
      b.style.animationDuration = (10 + Math.random() * 12) + 's';
      b.style.animationDelay = (Math.random() * 15) + 's';
      b.style.width = (28 + Math.random() * 16) + 'px';
      b.style.height = (36 + Math.random() * 16) + 'px';
      container.appendChild(b);
    }
  }

  /* ── Sparkles ──────────────────────────────────────────────────────────── */
  function createSparkles(container) {
    var count = window.innerWidth < 640 ? 8 : 15;
    for (var i = 0; i < count; i++) {
      var s = document.createElement('div');
      s.className = 'birthday-sparkle';
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = (Math.random() * 100) + '%';
      s.style.animationDuration = (2 + Math.random() * 3) + 's';
      s.style.animationDelay = (Math.random() * 4) + 's';
      var size = 4 + Math.random() * 6;
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      container.appendChild(s);
    }
  }

  /* ── Cake interaction ──────────────────────────────────────────────────── */
  function initCake() {
    var cake = document.querySelector('.birthday-cake');
    if (!cake) return;

    var flames = cake.querySelectorAll('.birthday-flame');
    var wished = false;

    cake.addEventListener('click', function () {
      if (wished) return;
      wished = true;
      cake.classList.add('wished');

      // Blow out candles with stagger
      flames.forEach(function (f, i) {
        setTimeout(function () {
          f.classList.add('blown-out');
        }, i * 150);
      });

      // Confetti after last candle
      setTimeout(bigBurst, flames.length * 150 + 200);
    });
  }

  /* ── Banner dismiss ────────────────────────────────────────────────────── */
  function initBanner() {
    var banner = document.querySelector('.birthday-banner');
    if (!banner) return;

    var closeBtn = banner.querySelector('.birthday-banner__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        banner.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        banner.style.transform = 'translateY(-100%)';
        banner.style.opacity = '0';
        document.body.classList.remove('has-birthday-banner');
        setTimeout(function () { banner.remove(); }, 300);
      });
    }
  }

  /* ── Danmaku ──────────────────────────────────────────────────────────── */
  var danmakuTimer = null;
  var danmakuPool = [];

  function initDanmaku() {
    var container = document.getElementById('birthday-danmaku');
    if (!container) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // Clear any previous loop
    if (danmakuTimer) { clearTimeout(danmakuTimer); danmakuTimer = null; }

    var ROWS = 10;
    var GAP = 48;                        // min horizontal gap between items on a row (px)
    var rowFreeAt = [];                  // timestamp each row becomes free again
    for (var r = 0; r < ROWS; r++) rowFreeAt.push(0);

    // Place one comment on a free row. Returns false when every row is busy.
    function spawn(text) {
      var now = Date.now();
      var free = [];
      for (var i = 0; i < ROWS; i++) {
        if (now >= rowFreeAt[i]) free.push(i);
      }
      if (!free.length) return false;
      var row = free[Math.floor(Math.random() * free.length)];

      var el = document.createElement('div');
      el.className = 'birthday-danmaku__item';
      el.textContent = text;
      el.style.top = (5 + row * 9.5) + '%';
      // Suppress the stylesheet animation so width can be measured flash-free.
      el.style.animation = 'none';
      container.appendChild(el);

      var width = el.offsetWidth;
      // Uniform speed (px/s) keeps items from ever catching up to one another.
      var speed = window.innerWidth / 7;
      var dur = (window.innerWidth + width * 1.2) / speed;
      el.style.animation = 'danmakuFloat ' + dur.toFixed(2) + 's linear forwards';

      // Row reopens once this item's tail has cleared the entry edge + gap.
      rowFreeAt[row] = now + ((width + GAP) / speed) * 1000;

      setTimeout(function () { el.remove(); }, dur * 1000);
      return true;
    }

    var idx = 0;
    function loop() {
      if (!danmakuPool.length) return;
      // Stop if container was removed from DOM (PJAX navigated away)
      if (!document.getElementById('birthday-danmaku')) return;
      if (spawn(danmakuPool[idx % danmakuPool.length])) {
        idx++;
      }
      var gap = 700 + Math.random() * 900;
      danmakuTimer = setTimeout(loop, gap);
    }

    if (danmakuPool.length) {
      // Already have data from previous fetch, just restart loop
      loop();
    } else {
      fetch('/api/guestbook')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!Array.isArray(data) || !data.length) return;
          danmakuPool = data.map(function (m) {
            return m.name + ': ' + m.message;
          });
          // Shuffle
          for (var i = danmakuPool.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = danmakuPool[i]; danmakuPool[i] = danmakuPool[j]; danmakuPool[j] = tmp;
          }
          loop();
        })
        .catch(function () {});
    }
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  function init() {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Decorations container
    var decorations = document.querySelector('.birthday-decorations');
    if (decorations) {
      createBalloons(decorations);
      if (!reduced) createSparkles(decorations);
    }

    // Cake
    initCake();

    // Banner
    initBanner();

    // Danmaku on homepage
    initDanmaku();

    // Confetti on load
    loadConfetti().then(function () {
      if (reduced) return;
      setTimeout(burstCenter, 600);
      setTimeout(burstSides, 1500);
    }).catch(function () {
      // CDN blocked — no confetti, no crash
    });
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init after PJAX navigation (decorations are in body, not main, so
  // they survive; but the cake tooltip state may need a reset on soft nav)
  document.addEventListener('pjax:ready', function () {
    // Re-init danmaku when navigating back to homepage
    initDanmaku();

    // Cake lives outside main — no re-init needed.
    // But fire a small confetti burst on each page nav for fun.
    if (window.confetti) {
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) {
        confetti({ particleCount: 20, spread: 50, origin: { y: 0.3 }, colors: BIRTHDAY_COLORS, disableForReducedMotion: true });
      }
    }
  });
})();
