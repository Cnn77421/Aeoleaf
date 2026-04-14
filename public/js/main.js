// Page transition (fallback for browsers without View Transitions API)
(function () {
  var hasNativeVT = Boolean(document.startViewTransition) ||
    CSS.supports && CSS.supports('view-transition-name', 'root');
  if (hasNativeVT) return;

  function shouldIntercept(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.download) return false;
    if (a.origin !== location.origin) return false;
    if (a.pathname === location.pathname && a.hash) return false;
    var href = a.getAttribute('href') || '';
    if (href.startsWith('#') || href.startsWith('javascript:')) return false;
    return true;
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var a = e.target.closest('a');
    if (!shouldIntercept(a)) return;
    e.preventDefault();
    document.body.classList.add('page-leaving');
    setTimeout(function () { location.href = a.href; }, 180);
  });
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
let lastScroll = 0;
const header = document.querySelector('.site-header');

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;
  if (currentScroll > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
  lastScroll = currentScroll;
}, { passive: true });

// Navigation toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const navOverlay = document.createElement('div');
navOverlay.className = 'nav-overlay';

if (navToggle) {
  document.body.appendChild(navOverlay);

  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    navOverlay.classList.toggle('active');
  });

  navOverlay.addEventListener('click', () => {
    navLinks.classList.remove('active');
    navOverlay.classList.remove('active');
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
      document.querySelector(href).scrollIntoView({
        behavior: 'smooth'
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

if (searchToggle && searchModal) {
  searchToggle.addEventListener('click', () => {
    searchModal.classList.add('active');
    searchInput.focus();
  });

  searchClose.addEventListener('click', () => {
    searchModal.classList.remove('active');
    searchInput.value = '';
    searchResults.innerHTML = '';
  });

  searchModal.addEventListener('click', (e) => {
    if (e.target === searchModal) {
      searchModal.classList.remove('active');
      searchInput.value = '';
      searchResults.innerHTML = '';
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

  searchResults.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">搜索中...</p>';

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

// Scroll animations
const animateOnScroll = () => {
  const elements = document.querySelectorAll('.post-item, .work-card, .blog-item');

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
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}
