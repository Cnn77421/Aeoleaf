// ── Public PJAX navigation ───────────────────────────────────────────────────
(function () {
  var MAIN_SEL = 'main.site-main';
  var DURATION = 180;
  var _busy = false;
  var _loadedScripts = {};

  // Page-specific stylesheets that should be swapped on each PJAX navigation.
  var PAGE_SPECIFIC_CSS = [
    '/css/home.css', '/css/blog-v2.css', '/css/blog.css',
    '/css/works-v2.css', '/css/works.css', '/css/about-v2.css'
  ];

  // Unified cascade anchor — tokens.css / bento.css MUST remain last in the
  // cascade. Page-specific CSS is inserted before these.
  var CASCADE_ANCHOR_SEL =
    'link[rel="stylesheet"][href*="/css/tokens.css"], ' +
    'link[rel="stylesheet"][href*="/css/bento.css"]';

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function pjaxProgressStart() {
    document.body.classList.add('pjax-loading');
    var el = document.getElementById('pjax-progress');
    if (!el) return;
    el.style.opacity = '1';
    el.style.width = prefersReducedMotion() ? '100%' : '12%';
  }

  function pjaxProgressMid() {
    var el = document.getElementById('pjax-progress');
    if (el && !prefersReducedMotion()) el.style.width = '62%';
  }

  function pjaxProgressEnd() {
    var el = document.getElementById('pjax-progress');
    var done = function () {
      document.body.classList.remove('pjax-loading');
      if (el) {
        el.style.width = '0';
        el.style.opacity = '';
      }
    };
    if (!el) {
      done();
      return;
    }
    el.style.width = '100%';
    setTimeout(done, prefersReducedMotion() ? 50 : 280);
  }

  function shouldIntercept(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.download) return false;
    if (a.origin !== location.origin) return false;
    if (a.pathname === location.pathname && a.search === location.search && a.hash) return false;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return false;
    if (href.indexOf('/admin') === 0) return false;
    return true;
  }

  function collectCurrentScripts() {
    document.querySelectorAll('script[src]').forEach(function (s) {
      _loadedScripts[s.src] = 'loaded';
    });
  }

  // Normalize href for comparison (strip query strings / version hashes).
  function normalizeHref(href) {
    return (href || '').split('?')[0];
  }

  // Snapshot optional attributes from a <script> tag so loadScript can
  // replay them on the new element.
  function scriptAttrs(el) {
    return {
      type: el.getAttribute('type') || '',
      async: el.hasAttribute('async'),
      defer: el.hasAttribute('defer'),
      crossorigin: el.getAttribute('crossorigin') || '',
      nonce: el.getAttribute('nonce') || ''
    };
  }

  function loadScript(src, attrs) {
    if (_loadedScripts[src] === 'loaded') return Promise.resolve();
    if (_loadedScripts[src] && _loadedScripts[src].then) return _loadedScripts[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      // Replay original attributes (type, async, defer, crossorigin, nonce).
      if (attrs) {
        if (attrs.type) s.type = attrs.type;
        if (attrs.async) s.async = true;
        if (attrs.defer) s.defer = true;
        if (attrs.crossorigin) s.crossOrigin = attrs.crossorigin;
        if (attrs.nonce) s.nonce = attrs.nonce;
      }
      s.src = src;
      s.onload = function () { _loadedScripts[src] = 'loaded'; resolve(); };
      s.onerror = function (e) { delete _loadedScripts[src]; reject(e); };
      document.head.appendChild(s);
    });
    _loadedScripts[src] = p;
    return p;
  }

  // Append a <link rel="stylesheet"> to <head> and resolve when it finishes
  // loading (or errors). Used during PJAX navigations to inject page-specific
  // stylesheets synchronously w.r.t. their actual parse/apply.
  function loadStylesheet(href) {
    if (!href) return Promise.resolve();

    // Dedupe: already present in DOM (ignoring query strings)?
    var nodes = document.querySelectorAll('head link[rel="stylesheet"]');
    var target = normalizeHref(href);
    for (var i = 0; i < nodes.length; i++) {
      if (normalizeHref(nodes[i].getAttribute('href')) === target) {
        return Promise.resolve();
      }
    }

    return new Promise(function (resolve) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      // Always resolve — we don't want to block navigation on a missing CSS file.
      link.onload = function () { resolve(); };
      link.onerror = function () { resolve(); };

      // CRITICAL — cascade anchor.
      // tokens.css and bento.css are the "override layer" and MUST remain
      // last in the cascade. Insert page-specific CSS before them.
      var anchor = document.querySelector(CASCADE_ANCHOR_SEL);
      if (anchor) {
        document.head.insertBefore(link, anchor);
      } else {
        document.head.appendChild(link);
      }
    });
  }

  async function execInlineScripts(container) {
    var scripts = Array.from(container.querySelectorAll('script'));
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      if (old.src) {
        try {
          await loadScript(old.src, scriptAttrs(old));
        } catch (e) {
          // Ignore load failures but continue execution.
        }
        old.remove();
      } else {
        // Inline script: replace to execute in document context.
        // Preserve type and nonce so module scripts / CSP continue to work.
        var s = document.createElement('script');
        var t = old.getAttribute('type');
        if (t) s.type = t;
        var nonce = old.getAttribute('nonce');
        if (nonce) s.nonce = nonce;
        s.textContent = old.textContent;
        old.replaceWith(s);
      }
    }
  }

  function updateNav(url) {
    var path = url.replace(location.origin, '').split('?')[0].split('#')[0];
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      // Exact match OR boundary-safe prefix match so `/blog` doesn't
      // light up when the user is on `/blogger`.
      var isActive =
        path === href ||
        (href !== '/' && path.indexOf(href + '/') === 0);
      if (isActive) {
        a.parentElement.classList.add('active');
      } else {
        a.parentElement.classList.remove('active');
      }
    });
  }

  function reinitPageFeatures() {
    var lazyImages = document.querySelectorAll('img[data-src]');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var img = entry.target;
            img.classList.add('loading');
            img.src = img.dataset.src;
            img.onload = function () { img.classList.remove('loading'); img.classList.add('loaded'); };
            img.onerror = function () { img.classList.remove('loading'); img.classList.add('error'); };
            img.removeAttribute('data-src');
            io.unobserve(img);
          }
        });
      }, { rootMargin: '50px' });
      lazyImages.forEach(function (img) { io.observe(img); });
    } else {
      lazyImages.forEach(function (img) { img.src = img.dataset.src; img.removeAttribute('data-src'); });
    }

    var elements = document.querySelectorAll('.post-item, .work-card, .blog-item');
    if (prefersReducedMotion()) {
      elements.forEach(function (el) {
        el.classList.add('animate-on-scroll', 'visible');
      });
    } else if ('IntersectionObserver' in window) {
      var anim = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-on-scroll', 'visible');
            anim.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
      elements.forEach(function (el) { el.classList.add('animate-on-scroll'); anim.observe(el); });
    }

    var tagBtns = document.querySelectorAll('.tag-btn');
    var workCards = document.querySelectorAll('.work-card');
    tagBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tag = btn.dataset.tag;
        tagBtns.forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        workCards.forEach(function (card) {
          // Restore to CSS default ('' clears the inline style) so cards that
          // use flex / grid layout (e.g. .card-v2 in works-v2) keep their
          // layout contract. Only hiding needs an inline value.
          if (tag === 'all') { card.style.display = ''; }
          else {
            var tags = (card.dataset.tags || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
            card.style.display = tags.indexOf(tag) !== -1 ? '' : 'none';
          }
        });
      });
    });

    initRevealSections();
    initStatsCounters();
  }

  function initRevealSections() {
    var sections = document.querySelectorAll('.reveal-section');
    if (prefersReducedMotion()) {
      sections.forEach(function (s) { s.classList.add('visible'); });
      return;
    }
    if (!sections.length || !('IntersectionObserver' in window)) {
      sections.forEach(function (s) { s.classList.add('visible'); });
      return;
    }
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    sections.forEach(function (s) { revealObs.observe(s); });
  }

  function initStatsCounters() {
    var counters = document.querySelectorAll('.hp-stats__number[data-target], .about-stats__num[data-target]');
    if (!counters.length) return;
    if (prefersReducedMotion()) {
      counters.forEach(function (el) {
        var t = parseInt(el.getAttribute('data-target'), 10) || 0;
        el.textContent = t.toLocaleString();
      });
      return;
    }
    var animated = new WeakSet();

    function animateCounter(el) {
      if (animated.has(el)) return;
      animated.add(el);
      var target = parseInt(el.getAttribute('data-target'), 10) || 0;
      if (target === 0) { el.textContent = '0'; return; }
      var duration = 1200;
      var start = performance.now();
      function tick(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / duration, 1);
        var ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * ease).toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });
      counters.forEach(function (c) { obs.observe(c); });
    } else {
      counters.forEach(animateCounter);
    }
  }

  async function pjaxNavigate(url, pushState) {
    if (_busy) return;
    _busy = true;

    var mainEl = document.querySelector(MAIN_SEL);
    if (!mainEl) {
      // No container to swap — fall back to a full navigation. Release the
      // lock first so an in-flight state doesn't linger if the navigation
      // is somehow cancelled.
      _busy = false;
      location.href = url;
      return;
    }

    mainEl.classList.add('pjax-out');
    pjaxProgressStart();

    try {
      var resp = await fetch(url);
      pjaxProgressMid();
      if (!resp.ok) throw new Error(resp.status);
      var html = await resp.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var newMain = doc.querySelector(MAIN_SEL);
      if (!newMain) throw new Error('no main');

      // CRITICAL: Sync all stylesheets from the target page.
      // Remove page-specific CSS that the new page won't need,
      // then add page-specific CSS that the new page requires.
      // This ensures clean cascade without conflicts.

      // Remove old page-specific stylesheets.
      var currentLinks = Array.from(document.querySelectorAll('head link[rel="stylesheet"]'));
      currentLinks.forEach(function (link) {
        var href = link.getAttribute('href') || '';
        var isPageSpecific = PAGE_SPECIFIC_CSS.some(function (pattern) {
          return href.indexOf(pattern) !== -1;
        });
        if (isPageSpecific) {
          link.remove();
        }
      });

      // Extract stylesheet hrefs from the target page's head.
      var newLinks = Array.from(doc.querySelectorAll('head link[rel="stylesheet"]'));
      var newHrefs = newLinks.map(function (l) { return l.getAttribute('href'); }).filter(Boolean);

      // Wait for all new stylesheets to finish loading before swapping
      // content in — this replaces the old hard-coded setTimeout and gives
      // a deterministic signal that styles are actually applied.
      await Promise.all(newHrefs.map(loadStylesheet));

      // Load any new head scripts. Preserve original attributes.
      var headScripts = doc.querySelectorAll('head script[src]');
      for (var i = 0; i < headScripts.length; i++) {
        try {
          await loadScript(headScripts[i].src, scriptAttrs(headScripts[i]));
        } catch (_e) {
          // Continue — a missing non-critical head script shouldn't abort navigation.
        }
      }

      // Swap in the new content. Align classes at the same time so any
      // layout-affecting classes on <main> stay in sync with the new page.
      // Also sync body attributes/classes from the new document so CSS
      // selectors that depend on `body` (e.g. body.page-works) apply.
      // Preserve transient runtime state like the pjax-loading class.
      var wasLoading = document.body.classList.contains('pjax-loading');
      var newBody = doc.body;
      if (newBody) {
        // Replace body class list with the new page's classes.
        document.body.className = newBody.className || '';
        // Copy other attributes (data-*, aria-*, etc.) from new body.
        // We don't remove attributes that aren't present in the new body
        // to avoid wiping runtime flags; just set/overwrite from the new page.
        for (var i = 0; i < newBody.attributes.length; i++) {
          var a = newBody.attributes[i];
          if (a.name === 'class') continue;
          document.body.setAttribute(a.name, a.value);
        }
      }
      if (wasLoading) document.body.classList.add('pjax-loading');

      mainEl.innerHTML = newMain.innerHTML;
      mainEl.className = newMain.className;

      // Execute the new inline / injected scripts BEFORE reinitializing
      // page features, so any globals or event wiring they register are
      // available when reinitPageFeatures runs.
      await execInlineScripts(mainEl);

      // CRITICAL: yield two animation frames so the browser can complete
      // style recalculation and layout for the just-swapped DOM before we
      // start registering IntersectionObservers.
      //
      // Without this, observers created right after an innerHTML swap can
      // queue their initial intersection check against a not-yet-laid-out
      // tree. The check fires on the next frame and sees elements with
      // zero/stale bounds, so reveal-animated content (.reveal-section,
      // .post-item, .work-card, .blog-item) never gets `.visible` added
      // and stays at opacity 0 — appearing as "half loaded" on list pages
      // and "blank" on pages where everything is a reveal-section (about).
      // A hard refresh doesn't hit this because reinitPageFeatures runs at
      // `window.load`, by which time layout is long done.
      await new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(resolve);
        });
      });

      reinitPageFeatures();

      // Execute any scripts that were present in <body> but outside of
      // the main container in the fetched document. Some pages (like
      // the about page) include inline scripts at the end of <body>
      // that initialize page-specific observers; those must run after
      // the DOM is swapped and after layout is ready.
      try {
        var bodyScripts = Array.from(doc.querySelectorAll('body script'))
          .filter(function (s) { return !s.closest(MAIN_SEL); });
        for (var bi = 0; bi < bodyScripts.length; bi++) {
          var bs = bodyScripts[bi];
          if (bs.src) {
            try { await loadScript(bs.src, scriptAttrs(bs)); } catch (_) { /* ignore */ }
          } else {
            var nb = document.createElement('script');
            var t = bs.getAttribute('type'); if (t) nb.type = t;
            var nonce = bs.getAttribute('nonce'); if (nonce) nb.nonce = nonce;
            nb.textContent = bs.textContent;
            document.body.appendChild(nb);
            // keep the inserted node — harmless and may be inspected by page scripts
          }
        }
      } catch (ex) {
        // Non-fatal: continue even if executing body scripts fails.
      }

      // Notify any page-specific scripts that PJAX has swapped content
      // and features are re-initialized. Listen with:
      //   document.addEventListener('pjax:ready', fn)
      document.dispatchEvent(new CustomEvent('pjax:ready', {
        detail: { url: url }
      }));

      var newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      if (pushState !== false) {
        history.pushState({ pjax: true }, '', url);
      }

      updateNav(url);

      mainEl.classList.remove('pjax-out');
      mainEl.classList.add('pjax-in');

      // Clean up the pjax-in class on animation end, with a safety-net
      // timeout in case no animation is defined (otherwise the class
      // would linger forever).
      var settled = false;
      var cleanupPjaxIn = function () {
        if (settled) return;
        settled = true;
        mainEl.classList.remove('pjax-in');
        mainEl.removeEventListener('animationend', cleanupPjaxIn);
      };
      mainEl.addEventListener('animationend', cleanupPjaxIn);
      setTimeout(cleanupPjaxIn, 500);

      var focusHeading = mainEl.querySelector('h1');
      if (focusHeading) {
        focusHeading.setAttribute('tabindex', '-1');
        focusHeading.focus({ preventScroll: true });
        focusHeading.addEventListener('blur', function onHeadingBlur() {
          focusHeading.removeAttribute('tabindex');
          focusHeading.removeEventListener('blur', onHeadingBlur);
        });
      }

      window.scrollTo({ top: 0, behavior: 'instant' });
      pjaxProgressEnd();
    } catch (e) {
      document.body.classList.remove('pjax-loading');
      var pel = document.getElementById('pjax-progress');
      if (pel) {
        pel.style.width = '0';
        pel.style.opacity = '';
      }
      location.href = url;
      return;
    } finally {
      _busy = false;
    }
  }

  collectCurrentScripts();

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var a = e.target.closest('a');
    if (!shouldIntercept(a)) return;
    e.preventDefault();
    pjaxNavigate(a.href);
  });

  window.addEventListener('popstate', function () {
    pjaxNavigate(location.href, false);
  });

  // For first page load: wait until window.load AND yield two animation frames
  // so layout is guaranteed complete, just like PJAX navigation does.
  // This ensures IntersectionObserver sees correct element bounds.
  window.addEventListener('load', function initOnLoad() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        reinitPageFeatures();
      });
    });
  }, { once: true });
})();

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
const html = document.documentElement;

const savedTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', savedTheme);

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}

// Scroll header effect — kick in after the hero area so the style change is deliberate.
// Uses rAF to coalesce scroll reads into a single paint frame.
const header = document.querySelector('.site-header');
if (header) {
  const SCROLL_THRESHOLD = 120;
  let scrolledState = false;
  let headerTicking = false;
  const updateHeaderScroll = () => {
    headerTicking = false;
    const shouldBeScrolled = window.pageYOffset > SCROLL_THRESHOLD;
    if (shouldBeScrolled === scrolledState) return;
    scrolledState = shouldBeScrolled;
    header.classList.toggle('scrolled', shouldBeScrolled);
  };
  const onHeaderScroll = () => {
    if (headerTicking) return;
    headerTicking = true;
    requestAnimationFrame(updateHeaderScroll);
  };
  updateHeaderScroll();
  window.addEventListener('scroll', onHeaderScroll, { passive: true });
}

// Homepage hero parallax — nudges the hero leaf downward at ~0.25x of the
// page scroll so it feels anchored to the page, not pinned. Only runs on
// pages that actually have a .hero__leaf, and respects reduced-motion.
(function () {
  const leaf = document.querySelector('.hero__leaf-shift');
  if (!leaf) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  const MAX_OFFSET = 60;
  let ticking = false;
  function apply() {
    ticking = false;
    const y = Math.min(window.pageYOffset * 0.25, MAX_OFFSET);
    leaf.style.transform = 'translate3d(0,' + y.toFixed(1) + 'px,0)';
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }
  apply();
  window.addEventListener('scroll', onScroll, { passive: true });
})();

(function initHeroCarousel() {
  var root = document.getElementById('hero-carousel');
  if (!root) return;
  var slides = Array.prototype.slice.call(root.querySelectorAll('.hero-carousel__slide'));
  if (slides.length <= 1) return;
  var dots = Array.prototype.slice.call(root.querySelectorAll('.hero-carousel__dot'));
  var prevBtn = root.querySelector('.hero-carousel__btn--prev');
  var nextBtn = root.querySelector('.hero-carousel__btn--next');
  var idx = 0;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function go(n) {
    idx = (n + slides.length) % slides.length;
    slides.forEach(function (s, i) {
      s.classList.toggle('is-active', i === idx);
    });
    dots.forEach(function (d, i) {
      var on = i === idx;
      d.classList.toggle('is-active', on);
      d.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  if (prevBtn) prevBtn.addEventListener('click', function () { go(idx - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(idx + 1); });
  dots.forEach(function (d) {
    d.addEventListener('click', function () {
      var t = parseInt(d.getAttribute('data-hero-slide-to'), 10);
      if (!isNaN(t)) go(t);
    });
  });

  var timer = null;
  if (!reduced) {
    timer = window.setInterval(function () { go(idx + 1); }, 5500);
  }
  root.addEventListener('mouseenter', function () { if (timer) window.clearInterval(timer); timer = null; });
  root.addEventListener('mouseleave', function () {
    if (reduced) return;
    if (!timer) timer = window.setInterval(function () { go(idx + 1); }, 5500);
  });
})();

// Navigation toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const navOverlay = document.createElement('div');
navOverlay.className = 'nav-overlay';

if (navToggle && navLinks) {
  document.body.appendChild(navOverlay);

  function setNavOpen(open) {
    navLinks.classList.toggle('active', open);
    navOverlay.classList.toggle('active', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  navToggle.addEventListener('click', () => {
    setNavOpen(!navLinks.classList.contains('active'));
  });

  navOverlay.addEventListener('click', () => {
    setNavOpen(false);
  });

  navLinks.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      setNavOpen(false);
    });
  });
}

// Auto-generate slug from title.
// Delegated on the document so this keeps working after PJAX swaps `main`.
// Preserves CJK characters so Chinese titles don't collapse to an empty slug.
document.addEventListener('input', function (e) {
  var target = e.target;
  if (!target || !target.matches) return;

  if (target.matches('input[name="title"]')) {
    var slugInput = document.querySelector('input[name="slug"]');
    if (slugInput && !slugInput.dataset.manual) {
      slugInput.value = target.value
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return;
  }

  if (target.matches('input[name="slug"]')) {
    target.dataset.manual = 'true';
  }
});

// Lazy image loading is handled inside `reinitPageFeatures()` (invoked on
// initial load and after every PJAX navigation), so no duplicate observer
// is needed here.

// Smooth scroll for anchor links.
// Delegated on the document so this keeps working after PJAX swaps `main`.
document.addEventListener('click', function (e) {
  if (e.defaultPrevented) return;
  var anchor = e.target.closest('a[href^="#"]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (href === '#' || !document.querySelector(href)) return;
  e.preventDefault();
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelector(href).scrollIntoView({
    behavior: reduced ? 'instant' : 'smooth'
  });
});

// Search modal
const searchToggle = document.getElementById('search-toggle');
const searchModal = document.getElementById('search-modal');
const searchClose = document.getElementById('search-close');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

// Shared across open/close/perform so we can cancel in-flight work cleanly.
let searchTimeout;
let searchController = null;

function closeSearchModal() {
  if (!searchModal) return;
  // Cancel any debounced / in-flight request so stale results don't land
  // in an empty modal after it's been closed.
  clearTimeout(searchTimeout);
  if (searchController) {
    searchController.abort();
    searchController = null;
  }
  searchModal.classList.remove('active');
  searchModal.setAttribute('aria-hidden', 'true');
  if (searchToggle) searchToggle.setAttribute('aria-expanded', 'false');
  if (searchInput) {
    searchInput.value = '';
  }
  if (searchResults) searchResults.innerHTML = '';
  if (searchToggle) searchToggle.focus();
}

function openSearchModal() {
  if (!searchModal || !searchInput) return;
  searchModal.classList.add('active');
  searchModal.setAttribute('aria-hidden', 'false');
  if (searchToggle) searchToggle.setAttribute('aria-expanded', 'true');
  searchInput.focus();
}

if (searchToggle && searchModal && searchClose && searchInput && searchResults) {
  searchToggle.addEventListener('click', () => {
    if (searchModal.classList.contains('active')) {
      closeSearchModal();
    } else {
      openSearchModal();
    }
  });

  searchClose.addEventListener('click', () => {
    closeSearchModal();
  });

  searchModal.addEventListener('click', (e) => {
    if (!e.target.closest('.search-modal-content')) {
      closeSearchModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchModal.classList.contains('active')) {
      closeSearchModal();
    }
  });

  searchModal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !searchModal.classList.contains('active')) return;
    const focusables = searchModal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.prototype.filter.call(focusables, (el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
  });
}

function clearNode(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function buildSearchItem(href, title, subtitle) {
  const a = document.createElement('a');
  a.className = 'search-item';
  a.href = href;
  const t = document.createElement('div');
  t.className = 'search-item-title';
  t.textContent = title || '';
  a.appendChild(t);
  if (subtitle) {
    const s = document.createElement('div');
    s.className = 'search-item-date';
    s.textContent = subtitle;
    a.appendChild(s);
  }
  return a;
}

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    clearNode(searchResults);
    return;
  }
  if (query.length > 100) return;

  // Abort any previous in-flight search so late responses can't clobber
  // a newer result set.
  if (searchController) searchController.abort();
  searchController = new AbortController();
  const signal = searchController.signal;

  clearNode(searchResults);
  const loading = document.createElement('div');
  loading.className = 'search-results-loading';
  loading.setAttribute('role', 'status');
  const spinner = document.createElement('span');
  spinner.className = 'ui-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const lt = document.createElement('span');
  lt.textContent = '搜索中…';
  loading.appendChild(spinner);
  loading.appendChild(lt);
  searchResults.appendChild(loading);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      credentials: 'same-origin',
      signal
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const works = Array.isArray(data.works) ? data.works : [];

    clearNode(searchResults);

    if (posts.length === 0 && works.length === 0) {
      const p = document.createElement('p');
      p.style.cssText = 'color: var(--text-muted); padding: 1rem;';
      p.textContent = '没有找到相关结果';
      searchResults.appendChild(p);
      return;
    }

    if (posts.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'search-section';
      const h = document.createElement('h3');
      h.textContent = `文章 (${posts.length})`;
      sec.appendChild(h);
      posts.forEach((post) => {
        const date = post.created_at ? new Date(post.created_at).toLocaleDateString() : '';
        sec.appendChild(buildSearchItem('/blog/' + encodeURIComponent(post.slug || ''), post.title, date));
      });
      searchResults.appendChild(sec);
    }

    if (works.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'search-section';
      const h = document.createElement('h3');
      h.textContent = `作品 (${works.length})`;
      sec.appendChild(h);
      works.forEach((work) => {
        sec.appendChild(buildSearchItem(
          '/works/' + encodeURIComponent(work.slug || ''),
          work.title,
          work.year ? String(work.year) : ''
        ));
      });
      searchResults.appendChild(sec);
    }
  } catch (error) {
    // Don't render an error UI for our own aborts — a newer search is on the way.
    if (error && error.name === 'AbortError') return;
    clearNode(searchResults);
    const p = document.createElement('p');
    p.style.cssText = 'color: var(--text-muted); padding: 1rem;';
    p.textContent = '搜索失败，请重试';
    searchResults.appendChild(p);
  }
}

(function initSearchFromHomeQuery() {
  if (!searchModal || !searchInput) return;
  var params = new URLSearchParams(window.location.search);
  if (params.get('openSearch') !== '1') return;
  var q = params.get('q') || '';
  openSearchModal();
  if (q) {
    searchInput.value = q;
    performSearch();
  }
  try {
    history.replaceState({}, '', window.location.pathname || '/');
  } catch (_e) { /* ignore */ }
})();

// Back to top button.
// Uses rAF to coalesce scroll reads into a single paint frame.
const backToTop = document.getElementById('back-to-top');

if (backToTop) {
  let backToTopTicking = false;
  const updateBackToTop = () => {
    backToTopTicking = false;
    if (window.pageYOffset > 300) {
      backToTop.classList.add('visible');
    } else {
      backToTop.classList.remove('visible');
    }
  };
  const onBackToTopScroll = () => {
    if (backToTopTicking) return;
    backToTopTicking = true;
    requestAnimationFrame(updateBackToTop);
  };
  window.addEventListener('scroll', onBackToTopScroll, { passive: true });

  backToTop.addEventListener('click', () => {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: reduced ? 'instant' : 'smooth'
    });
  });
}