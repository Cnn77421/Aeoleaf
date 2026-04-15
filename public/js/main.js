// ── Public PJAX navigation ───────────────────────────────────────────────────
(function () {
  var MAIN_SEL = 'main.site-main';
  var DURATION = 180;
  var _busy = false;
  var _loadedScripts = {};

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
      _loadedScripts[s.src] = true;
    });
  }

  function loadScript(src) {
    if (_loadedScripts[src]) return Promise.resolve();
    _loadedScripts[src] = true;
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function execInlineScripts(container) {
    container.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      if (old.src) {
        if (!_loadedScripts[old.src]) {
          s.src = old.src;
          _loadedScripts[old.src] = true;
        } else {
          return;
        }
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
        tagBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        workCards.forEach(function (card) {
          if (tag === 'all') { card.style.display = 'block'; }
          else { card.style.display = card.dataset.tags.split(',').includes(tag) ? 'block' : 'none'; }
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
    var counters = document.querySelectorAll('.hp-stats__number[data-target]');
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

      var headScripts = doc.querySelectorAll('head script[src]');
      for (var i = 0; i < headScripts.length; i++) {
        await loadScript(headScripts[i].src);
      }

      await new Promise(function (r) { setTimeout(r, DURATION); });

      mainEl.innerHTML = newMain.innerHTML;

      execInlineScripts(mainEl);
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

  initRevealSections();
  initStatsCounters();
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

// Scroll header effect
const header = document.querySelector('.site-header');

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;
  if (currentScroll > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
}, { passive: true });

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

// Tag filter for works page
const tagBtns = document.querySelectorAll('.tag-btn');
const workCards = document.querySelectorAll('.work-card');

tagBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tag = btn.dataset.tag;

    tagBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    workCards.forEach(card => {
      if (tag === 'all') {
        card.style.display = 'block';
      } else {
        const tags = card.dataset.tags.split(',');
        card.style.display = tags.includes(tag) ? 'block' : 'none';
      }
    });
  });
});

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

// Lazy load images
const lazyImages = document.querySelectorAll('img[data-src]');
if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.classList.add('loading');
        img.src = img.dataset.src;
        img.onload = () => {
          img.classList.remove('loading');
          img.classList.add('loaded');
        };
        img.onerror = () => {
          img.classList.remove('loading');
          img.classList.add('error');
        };
        img.removeAttribute('data-src');
        imageObserver.unobserve(img);
      }
    });
  }, {
    rootMargin: '50px'
  });
  lazyImages.forEach(img => imageObserver.observe(img));
} else {
  lazyImages.forEach(img => {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
}

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

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.innerHTML = '';
    return;
  }

  searchResults.innerHTML =
    '<div class="search-results-loading" role="status">' +
    '<span class="ui-spinner" aria-hidden="true"></span>' +
    '<span>搜索中…</span></div>';

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.posts.length === 0 && data.works.length === 0) {
      searchResults.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">没有找到相关结果</p>';
      return;
    }

    let html = '';

    if (data.posts.length > 0) {
      html += '<div class="search-section"><h3>文章 (' + data.posts.length + ')</h3>';
      data.posts.forEach(post => {
        html += `
          <a href="/blog/${post.slug}" class="search-item">
            <div class="search-item-title">${post.title}</div>
            <div class="search-item-date">${new Date(post.created_at).toLocaleDateString()}</div>
          </a>
        `;
      });
      html += '</div>';
    }

    if (data.works.length > 0) {
      html += '<div class="search-section"><h3>作品 (' + data.works.length + ')</h3>';
      data.works.forEach(work => {
        html += `
          <a href="/works/${work.slug}" class="search-item">
            <div class="search-item-title">${work.title}</div>
            ${work.year ? '<div class="search-item-date">' + work.year + '</div>' : ''}
          </a>
        `;
      });
      html += '</div>';
    }

    searchResults.innerHTML = html;
  } catch (error) {
    searchResults.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">搜索失败，请重试</p>';
  }
}

// Scroll animations (initial page load; PJAX uses reinitPageFeatures)
const animateOnScroll = () => {
  const elements = document.querySelectorAll('.post-item, .work-card, .blog-item');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced) {
    elements.forEach(el => {
      el.classList.add('animate-on-scroll', 'visible');
    });
    return;
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-on-scroll', 'visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(el => {
      el.classList.add('animate-on-scroll');
      observer.observe(el);
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', animateOnScroll);
} else {
  animateOnScroll();
}

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
