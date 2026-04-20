// ── Public PJAX navigation ───────────────────────────────────────────────────
(function () {
  var MAIN_SEL = 'main.site-main';
  var DURATION = 180;
  var _busy = false;
  var _loadedScripts = {};
  var _loadedStyles = {};

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

  function loadScript(src) {
    if (_loadedScripts[src] === 'loaded') return Promise.resolve();
    if (_loadedScripts[src] && _loadedScripts[src].then) return _loadedScripts[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { _loadedScripts[src] = 'loaded'; resolve(); };
      s.onerror = function (e) { delete _loadedScripts[src]; reject(e); };
      document.head.appendChild(s);
    });
    _loadedScripts[src] = p;
    return p;
  }

  // Append a <link rel="stylesheet"> to the document head.
  // Used during PJAX navigations to inject page-specific stylesheets.
  function loadStylesheet(href) {
    if (!href) return;
    
    // Check if this stylesheet is already in the DOM
    var nodes = document.querySelectorAll('head link[rel="stylesheet"]');
    for (var x = 0; x < nodes.length; x++) {
      var existingHref = nodes[x].getAttribute('href') || '';
      // Compare paths ignoring query strings (version hashes)
      if (existingHref.split('?')[0] === href.split('?')[0]) {
        return;  // Already loaded
      }
    }
    
    // Not in DOM, so add it
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;

    // CRITICAL — cascade anchor.
    // tokens.css and bento.css are authored as the "override layer" and
    // MUST remain last in the cascade. Insert page-specific CSS before them.
    var anchor = document.querySelector(
      'link[rel="stylesheet"][href*="/css/tokens.css"], ' +
      'link[rel="stylesheet"][href*="/css/bento.css"]'
    );
    if (anchor) {
      document.head.insertBefore(link, anchor);
    } else {
      document.head.appendChild(link);
    }
  }

  function execInlineScripts(container) {
    container.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      if (old.src) {
        if (_loadedScripts[old.src] === 'loaded') return;
        s.src = old.src;
        s.onload = function () { _loadedScripts[old.src] = 'loaded'; };
        s.onerror = function () { delete _loadedScripts[old.src]; };
        _loadedScripts[old.src] = 'loaded';
      } else {
        s.textContent = old.textContent;
      }
      old.replaceWith(s);
    });
  }

  function updateNav(url) {
    var path = url.replace(location.origin, '').split('?')[0].split('#')[0];
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (path === href || (href !== '/' && path.indexOf(href) === 0)) {
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
    if (!mainEl) { location.href = url; return; }

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
      
      var PAGE_SPECIFIC_CSS = [
        '/css/home.css', '/css/blog-v2.css', '/css/blog.css', 
        '/css/works-v2.css', '/css/works.css', '/css/about-v2.css'
      ];
      
      // Remove old page-specific stylesheets
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

      // Extract stylesheet hrefs from the target page's head
      var newLinks = Array.from(doc.querySelectorAll('head link[rel="stylesheet"]'));
      var newHrefs = newLinks.map(function (l) { return l.getAttribute('href'); }).filter(Boolean);
      
      // Add stylesheets that are not already in the document
      newHrefs.forEach(function (href) {
        var already exists = !!document.querySelector('head link[rel="stylesheet"][href="' + href + '"]');
        if (!alreadyExists) {
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          // Insert before tokens.css/bento.css so they stay last in cascade
          var anchor = document.querySelector(
            'link[rel="stylesheet"][href*="/tokens.css"], ' +
            'link[rel="stylesheet"][href*="/bento.css"]'
          );
          if (anchor) {
            document.head.insertBefore(link, anchor);
          } else {
            document.head.appendChild(link);
          }
        }
      });

      var headScripts = doc.querySelectorAll('head script[src]');
      for (var i = 0; i < headScripts.length; i++) {
        await loadScript(headScripts[i].src);
      }

      // Wait for CSS to parse and render
      await new Promise(function (r) { setTimeout(r, DURATION + 150); });

      mainEl.innerHTML = newMain.innerHTML;

      execInlineScripts(mainEl);
      
      // Critical: delay reinit to ensure CSS is applied
      await new Promise(function (r) { setTimeout(r, 50); });
      reinitPageFeatures();

      var newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      if (pushState !== false) {
        history.pushState({ pjax: true }, '', url);
      }

      updateNav(url);
      mainEl.className = newMain.className;
      mainEl.classList.remove('pjax-out');
      mainEl.classList.add('pjax-in');
      mainEl.addEventListener('animationend', function handler() {
        mainEl.classList.remove('pjax-in');
        mainEl.removeEventListener('animationend', handler);
      });

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

  // Always wait for window 'load' event for first page load.
  // This ensures all CSS is parsed and applied before we initialize page features.
  window.addEventListener('load', function initOnLoad() {
    reinitPageFeatures();
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
const header = document.querySelector('.site-header');
if (header) {
  const SCROLL_THRESHOLD = 120;
  let scrolledState = false;
  const updateHeaderScroll = () => {
    const shouldBeScrolled = window.pageYOffset > SCROLL_THRESHOLD;
    if (shouldBeScrolled === scrolledState) return;
    scrolledState = shouldBeScrolled;
    header.classList.toggle('scrolled', shouldBeScrolled);
  };
  updateHeaderScroll();
  window.addEventListener('scroll', updateHeaderScroll, { passive: true });
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

// Auto-generate slug from title
const titleInput = document.querySelector('input[name="title"]');
const slugInput = document.querySelector('input[name="slug"]');

if (titleInput && slugInput) {
  titleInput.addEventListener('input', () => {
    if (!slugInput.dataset.manual) {
      slugInput.value = titleInput.value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });

  slugInput.addEventListener('input', () => {
    slugInput.dataset.manual = 'true';
  });
}

// Lazy image loading is handled inside `reinitPageFeatures()` (invoked on
// initial load and after every PJAX navigation), so no duplicate observer
// is needed here.

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href !== '#' && document.querySelector(href)) {
      e.preventDefault();
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.querySelector(href).scrollIntoView({
        behavior: reduced ? 'instant' : 'smooth'
      });
    }
  });
});

// Search modal
const searchToggle = document.getElementById('search-toggle');
const searchModal = document.getElementById('search-modal');
const searchClose = document.getElementById('search-close');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

function closeSearchModal() {
  if (!searchModal) return;
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

  let searchTimeout;
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
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { credentials: 'same-origin' });
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
    void performSearch();
  }
  try {
    history.replaceState({}, '', window.location.pathname || '/');
  } catch (_e) { /* ignore */ }
})();

// Back to top button
const backToTop = document.getElementById('back-to-top');

if (backToTop) {
  window.addEventListener('scroll', () => {
    if (window.pageYOffset > 300) {
      backToTop.classList.add('visible');
    } else {
      backToTop.classList.remove('visible');
    }
  }, { passive: true });

  backToTop.addEventListener('click', () => {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: reduced ? 'instant' : 'smooth'
    });
  });
}
