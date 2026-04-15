/* Writes views/index.ejs as UTF-8. Source uses \\uXXXX only (ASCII-safe). */
const fs = require('fs');
const path = require('path');

const C = {
  metaDescSuffix: '\u8bbe\u8ba1\u3001\u5199\u4f5c\u4e0e\u4f5c\u54c1\u7684\u4e2a\u4eba\u4e3b\u9875',
  keywords: '\u535a\u5ba2,\u4f5c\u54c1\u96c6,\u8bbe\u8ba1,\u5199\u4f5c',
  siteDesc:
    'Aeoleaf \u98ce\u53f6\uff1a\u4e2a\u4eba\u535a\u5ba2\u4e0e\u4f5c\u54c1\u96c6\uff0c\u8bb0\u5f55\u8bbe\u8ba1\u4e0e\u6280\u672f\u7b14\u8bb0\u3002',
  tagline: '\u8bbe\u8ba1 \u00b7 \u5199\u4f5c \u00b7 \u52a8\u624b\u5b9e\u73b0',
  btnWorks: '\u67e5\u770b\u4f5c\u54c1',
  btnBlog: '\u9605\u8bfb\u535a\u5ba2',
  aboutH2: '\u5173\u4e8e\u6211',
  aboutFallback:
    '\u8fd9\u91cc\u4f1a\u663e\u793a\u4e2a\u4eba\u7b80\u4ecb\u6458\u8981\uff1b\u53ef\u5728\u540e\u53f0\u6216\u5173\u4e8e\u9875\u7f16\u8f91\u5185\u5bb9\u3002',
  learnMore: '\u4e86\u89e3\u66f4\u591a',
  featured: '\u7cbe\u9009\u6587\u7ae0',
  readFull: '\u9605\u8bfb\u5168\u6587',
  statsTitle: '\u7ad9\u70b9\u6570\u636e',
  labelPosts: '\u6587\u7ae0',
  labelWorks: '\u4f5c\u54c1',
  labelPV: '\u603b\u8bbf\u95ee\u91cf',
  featWorks: '\u7cbe\u9009\u4f5c\u54c1',
  recentPosts: '\u6700\u8fd1\u6587\u7ae0',
  viewAllPosts: '\u67e5\u770b\u5168\u90e8\u6587\u7ae0',
  contactH2: '\u8054\u7cfb\u6211',
  contactP:
    '\u6709\u5408\u4f5c\u3001\u53cd\u9988\u6216\u60f3\u804a\u804a\u9879\u76ee\uff0c\u6b22\u8fce\u53d1\u90ae\u4ef6\u3002',
  sendMail: '\u53d1\u9001\u90ae\u4ef6',
  footerBrand: 'aeoleaf \u98ce\u53f6',
  footerTag: '\u4e2a\u4eba\u535a\u5ba2\u4e0e\u4f5c\u54c1\u96c6',
  nav: '\u5bfc\u822a',
  home: '\u9996\u9875',
  blog: '\u535a\u5ba2',
  works: '\u4f5c\u54c1',
  about: '\u5173\u4e8e',
  contact: '\u8054\u7cfb',
  email: '\u90ae\u7bb1',
  backTop: '\u56de\u5230\u9876\u90e8',
};

const body = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="view-transition" content="same-origin">
  <title><%= title %></title>
  <meta name="description" content="<%= subtitle %> - ${C.metaDescSuffix}">
  <meta name="keywords" content="${C.keywords},<%= subtitle %>">
  <meta name="author" content="<%= title %>">
  <meta name="theme-color" content="#7B2638">
  <link rel="canonical" href="<%= typeof baseUrl !== 'undefined' ? baseUrl : 'http://localhost:3000' %>/">

  <!-- Open Graph -->
  <meta property="og:title" content="<%= title %> - <%= subtitle %>">
  <meta property="og:description" content="${C.siteDesc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="<%= typeof baseUrl !== 'undefined' ? baseUrl : 'http://localhost:3000' %>/">
  <meta property="og:image" content="<%= typeof baseUrl !== 'undefined' ? baseUrl : 'http://localhost:3000' %>/images/logo.png">
  <meta property="og:site_name" content="<%= title %>">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<%= title %> - <%= subtitle %>">
  <meta name="twitter:description" content="${C.siteDesc}">
  <meta name="twitter:image" content="<%= typeof baseUrl !== 'undefined' ? baseUrl : 'http://localhost:3000' %>/images/logo.png">

  <!-- RSS Feed -->
  <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/rss.xml">

  <link rel="icon" type="image/png" href="/images/logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Lora:ital,wght@0,400;1,400&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/main.css?v=10">
  <link rel="stylesheet" href="/css/blog.css?v=10">
  <link rel="stylesheet" href="/css/works.css?v=10">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "<%= title %>",
    "url": "<%= typeof baseUrl !== 'undefined' ? baseUrl : 'http://localhost:3000' %>/",
    "description": "${C.siteDesc}",
    "author": {
      "@type": "Person",
      "name": "aeoleaf"
    }
  }
  </script>
</head>
<body>
  <%- include('partials/public-header') %>
  <main id="main" class="site-main site-main--no-pad">

    <section class="hero hero--enhanced">
      <div class="hero__content">
        <h1 class="hero-title"><%= title %></h1>
        <p class="hero-subtitle"><%= subtitle %></p>
        <p class="hero__tagline">${C.tagline}</p>
        <div class="hero__cta">
          <a href="/works" class="btn-primary">${C.btnWorks}</a>
          <a href="/blog" class="btn-outline">${C.btnBlog}</a>
        </div>
      </div>
      <div class="hero__visual">
        <div class="hero__orb hero__orb--1"></div>
        <div class="hero__orb hero__orb--2"></div>
        <div class="hero__orb hero__orb--3"></div>
        <svg class="hero__leaf" width="200" height="200" aria-hidden="true"><use href="#icon-hero-leaf"/></svg>
      </div>
    </section>

    <section class="hp-about reveal-section">
      <div class="hp-about__inner">
        <% if (aboutImage) { %>
        <div class="hp-about__avatar slide-from-left">
          <img data-src="<%= aboutImage %>" alt="About me" class="lazy">
        </div>
        <% } else { %>
        <div class="hp-about__avatar hp-about__avatar--placeholder slide-from-left">
          <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="40" cy="30" r="14"/>
            <path d="M12 72c0-15.5 12.5-28 28-28s28 12.5 28 28"/>
          </svg>
        </div>
        <% } %>
        <div class="hp-about__text slide-from-right">
          <h2>${C.aboutH2}</h2>
          <% if (aboutText) { %>
            <p><%= aboutText.replace(/[#*_\[\]()]/g, '').substring(0, 200) %><% if (aboutText.length > 200) { %>\u2026<% } %></p>
          <% } else { %>
            <p>${C.aboutFallback}</p>
          <% } %>
          <a href="/about" class="hp-about__link">${C.learnMore} <span aria-hidden="true">\u2192</span></a>
        </div>
      </div>
    </section>

    <% if (featuredPost) { %>
    <section class="hp-featured-post reveal-section">
      <h2 class="hp-section-title">${C.featured}</h2>
      <a href="/blog/<%= featuredPost.slug %>" class="hp-featured-post__card stagger-child">
        <div class="hp-featured-post__img">
          <img src="<%= featuredPost.cover_image %>" alt="<%= featuredPost.title %>" loading="lazy">
        </div>
        <div class="hp-featured-post__body">
          <div class="hp-featured-post__date"><%= new Date(featuredPost.created_at).toLocaleDateString('zh-CN') %></div>
          <h3 class="hp-featured-post__title"><%= featuredPost.title %></h3>
          <p class="hp-featured-post__excerpt"><%= (featuredPost.excerpt || featuredPost.title).substring(0, 160) %><% if ((featuredPost.excerpt || featuredPost.title).length > 160) { %>\u2026<% } %></p>
          <span class="hp-featured-post__cta">${C.readFull} <span aria-hidden="true">\u2192</span></span>
        </div>
      </a>
    </section>
    <% } %>

    <section class="hp-stats reveal-section">
      <h2 class="hp-section-title">${C.statsTitle}</h2>
      <div class="hp-stats__grid">
        <div class="hp-stats__item stagger-child">
          <span class="hp-stats__number" data-target="<%= statsData.postsCount %>">0</span>
          <span class="hp-stats__label">${C.labelPosts}</span>
        </div>
        <div class="hp-stats__item stagger-child">
          <span class="hp-stats__number" data-target="<%= statsData.worksCount %>">0</span>
          <span class="hp-stats__label">${C.labelWorks}</span>
        </div>
        <div class="hp-stats__item stagger-child">
          <span class="hp-stats__number" data-target="<%= statsData.totalPV %>">0</span>
          <span class="hp-stats__label">${C.labelPV}</span>
        </div>
      </div>
    </section>

    <% if (featuredWorks.length > 0) { %>
    <section class="featured-works reveal-section">
      <h2 class="hp-section-title">${C.featWorks}</h2>
      <div class="works-grid">
        <% featuredWorks.forEach(work => { %>
        <a href="/works/<%= work.slug %>" class="work-card stagger-child">
          <% if (work.cover_image) { %>
          <div class="work-card__media">
            <img data-src="<%= work.cover_image %>" alt="<%= work.title %>" class="work-image lazy">
          </div>
          <% } %>
          <h3 class="work-title"><%= work.title %></h3>
          <% if (work.year) { %><span class="work-year"><%= work.year %></span><% } %>
        </a>
        <% }); %>
      </div>
    </section>
    <% } %>

    <% if (recentPosts.length > 0) { %>
    <section class="recent-posts reveal-section">
      <h2 class="hp-section-title">${C.recentPosts}</h2>
      <div class="posts-list">
        <% recentPosts.forEach(post => { %>
        <article class="post-item stagger-child">
          <time class="post-date"><%= new Date(post.created_at).toLocaleDateString('zh-CN') %></time>
          <a href="/blog/<%= post.slug %>" class="post-title"><%= post.title %></a>
        </article>
        <% }); %>
      </div>
      <p style="text-align:center;margin-top:var(--space-6);"><a href="/blog" class="hp-about__link">${C.viewAllPosts} <span aria-hidden="true">\u2192</span></a></p>
    </section>
    <% } %>

    <section class="hp-contact reveal-section">
      <div class="hp-contact__inner">
        <h2>${C.contactH2}</h2>
        <p>${C.contactP}</p>
        <a href="mailto:xiner521@aliyun.com" class="hp-contact__btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          ${C.sendMail}
        </a>
      </div>
    </section>

  </main>
  <%- include('partials/brand-wave') %>
  <footer class="site-footer">
    <div class="footer-content">
      <div class="footer-section">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>
          </svg>
          ${C.footerBrand}
        </h3>
        <p>${C.footerTag}</p>
      </div>
      <div class="footer-section">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
          ${C.nav}
        </h3>
        <ul>
          <li><a href="/">${C.home}</a></li>
          <li><a href="/blog">${C.blog}</a></li>
          <li><a href="/works">${C.works}</a></li>
          <li><a href="/about">${C.about}</a></li>
        </ul>
      </div>
      <div class="footer-section">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          ${C.contact}
        </h3>
        <ul>
          <li>
            <a href="mailto:xiner521@aliyun.com">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path>
              </svg>
              ${C.email}
            </a>
          </li>
          <li>
            <a href="https://github.com/Cnn77421" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
              GitHub
            </a>
          </li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <p>&copy; <%= new Date().getFullYear() %> aeoleaf. All rights reserved.</p>
      <p><a href="/admin/login" style="opacity:0;font-size:0;user-select:none;">.</a></p>
    </div>
  </footer>
  <button id="back-to-top" aria-label="${C.backTop}">\u2191</button>
  <script src="/js/main.js" defer></script>
  <script src="/js/tracker.js" async defer></script>
</body>
</html>
`;

const out = path.join(__dirname, '..', 'views/index.ejs');
fs.writeFileSync(out, body, 'utf8');
console.log('written', out);
