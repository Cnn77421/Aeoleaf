// Public, server-rendered pages (home, blog, works, about, guestbook, search).
// The authenticated admin backend lives in routes/admin.js.
const router = require('express').Router();
const { db } = require('../config/db');
const { marked } = require('marked');

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

marked.use({ gfm: true, breaks: false });

function render(md) {
  if (!md) return '';
  return DOMPurify.sanitize(marked.parse(md));
}

// ── Heading-id + TOC extraction for post detail pages ────────────────────────
// Walks the sanitized HTML, assigns unique id= to each h2/h3, returns
// { html, toc } where toc is a flat array of { level, text, id }.
function slugifyHeading(text, fallbackIdx) {
  const raw = String(text || '').trim();
  const ascii = raw
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^-$/, '');
  return ascii || ('section-' + fallbackIdx);
}

// Reading time estimate — mixed CN/EN content: CN at ~400 chars/min, EN at ~250 words/min.
function estimateReadMinutes(rawContent) {
  if (!rawContent) return 1;
  const plain = String(rawContent)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\(([^)]*)\)/g, '$1')
    .replace(/[#*_>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cjk = (plain.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const en = plain.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(cjk / 400 + en / 250));
}

function extractHeadings(html) {
  if (!html) return { html: '', toc: [] };
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>');
  const doc = dom.window.document;
  const headings = Array.from(doc.querySelectorAll('h2, h3'));
  const toc = [];
  const seen = new Map();
  headings.forEach((el, idx) => {
    const text = (el.textContent || '').trim();
    let base = slugifyHeading(text, idx + 1);
    let id = base;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    if (count > 1) id = base + '-' + count;
    el.setAttribute('id', id);
    toc.push({
      level: el.tagName === 'H2' ? 2 : 3,
      text,
      id
    });
  });
  return { html: doc.body.innerHTML, toc };
}

function removeDuplicateLeadHeading(html, title) {
  if (!html) return '';
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>');
  const first = dom.window.document.body.firstElementChild;
  const normalizedTitle = String(title || '').replace(/\s+/g, '').toLowerCase();
  if (first && /^H[12]$/.test(first.tagName)) {
    const normalizedHeading = String(first.textContent || '').replace(/\s+/g, '').toLowerCase();
    if (normalizedHeading === normalizedTitle) first.remove();
  }
  return dom.window.document.body.innerHTML;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

function normalizeHeroPosition(value) {
  const allowed = new Set([
    'left top', 'center top', 'right top',
    'left center', 'center center', 'right center',
    'left bottom', 'center bottom', 'right bottom'
  ]);
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'center center';
}

function getPublicProfileData() {
  return {
    siteTitle: getSetting('site_title') || 'Aeoleaf',
    siteSubtitle: getSetting('site_subtitle') || '风叶',
    aboutSummary: plainTextFromMarkdown(getSetting('about_text') || '', 180),
    aboutImage: getSetting('about_image') || '',
    statsData: {
      postsCount: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get()?.cnt || 0,
      worksCount: db.prepare('SELECT COUNT(*) as cnt FROM works').get()?.cnt || 0,
      totalPV: db.prepare('SELECT COUNT(*) as cnt FROM visitors').get()?.cnt || 0
    }
  };
}

function safeSocialUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  const lower = s.toLowerCase();
  if (lower.startsWith('mailto:') && s.length > 7) return s;
  try {
    const p = new URL(s);
    if (p.protocol === 'http:' || p.protocol === 'https:') return p.href;
  } catch {
    /* ignore */
  }
  return null;
}

function parseSocialLinks(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a
      .map((x) => {
        if (!x || typeof x !== 'object') return null;
        const label = typeof x.label === 'string' ? x.label.trim() : '';
        const url = safeSocialUrl(x.url);
        if (!label || !url) return null;
        return { label, url };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Split site_title so the hero never repeats a trailing 「风叶」 in both lines. */
function parseHeroTitle(siteTitle) {
  const raw = String(siteTitle || 'Aeoleaf').trim();
  const accent = '风叶';
  const trailing = /\s*风叶\s*$/u;
  if (trailing.test(raw)) {
    const main = raw.replace(trailing, '').trim();
    return { heroTitleMain: main || 'Aeoleaf', heroTitleAccent: accent };
  }
  if (raw.includes(accent)) {
    return { heroTitleMain: raw, heroTitleAccent: null };
  }
  return { heroTitleMain: raw, heroTitleAccent: accent };
}

function renderPublic404(res) {
  return res.status(404).render('404', {
    title: 'Not Found',
    errorCode: 404,
    errorTitle: '风把你带到了没有文字的地方',
    errorMessage: '这页可能从未生长，也可能已随时节凋落。你可以从首页重新出发，或去搜索一下。'
  });
}

/**
 * Blog list pagination: ordered parts are either a page number or the string
 * 'gap' for an ellipsis (when there is a hole in the sequence).
 */
function buildBlogPagination(page, totalPages, neighborRadius = 2) {
  if (totalPages <= 1) return null;
  const nums = new Set([1, totalPages]);
  for (let i = page - neighborRadius; i <= page + neighborRadius; i += 1) {
    if (i >= 1 && i <= totalPages) nums.add(i);
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) parts.push('gap');
    parts.push(sorted[i]);
  }
  return {
    prev: page > 1 ? page - 1 : null,
    next: page < totalPages ? page + 1 : null,
    parts
  };
}

function plainTextFromMarkdown(md, maxLen) {
  if (!md) return '';
  const t = String(md)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/\*\*?|__|\[|\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

// ─── Public Pages ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const featuredWorks = db.prepare(
    'SELECT * FROM works WHERE featured = 1 ORDER BY sort_order ASC, created_at DESC LIMIT 3'
  ).all().map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const recentPosts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 5"
  ).all().map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));

  const featuredPostRow = db.prepare(
    "SELECT * FROM posts WHERE status='published' AND cover_image != '' ORDER BY created_at DESC LIMIT 1"
  ).get();
  const featuredPost = featuredPostRow
    ? { ...featuredPostRow, tags: JSON.parse(featuredPostRow.tags || '[]') }
    : null;

  const configuredHeroImage = (getSetting('home_hero_image') || '').trim();
  const heroImage = configuredHeroImage || featuredPost?.cover_image || '';
  const heroImageMobile = (getSetting('home_hero_image_mobile') || '').trim();

  const statsData = {
    postsCount: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get()?.cnt || 0,
    worksCount: db.prepare("SELECT COUNT(*) as cnt FROM works").get()?.cnt || 0,
    totalPV: db.prepare("SELECT COUNT(*) as cnt FROM visitors").get()?.cnt || 0
  };

  const { heroTitleMain, heroTitleAccent } = parseHeroTitle(getSetting('site_title'));

  const carouselWorks = db.prepare(
    "SELECT * FROM works WHERE cover_image IS NOT NULL AND cover_image != '' ORDER BY sort_order ASC, created_at DESC LIMIT 3"
  ).all().map((w) => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  // Contact details for the home-page Bento card. Mirrors /about so that
  // admin-side settings are the single source of truth; the template falls
  // back to the old hard-coded values when a field is empty.
  const contactEmail = (getSetting('contact_email') || '').trim();
  const contactQq = (getSetting('contact_qq') || '').trim();
  const socialLinks = parseSocialLinks(getSetting('social_links'));

  res.render('index', {
    title: getSetting('site_title'),
    subtitle: getSetting('site_subtitle'),
    heroTitleMain,
    heroTitleAccent,
    featuredWorks,
    carouselWorks,
    recentPosts,
    featuredPost,
    heroImage,
    heroImageMobile,
    heroPosition: normalizeHeroPosition(getSetting('home_hero_position')),
    heroPositionMobile: normalizeHeroPosition(getSetting('home_hero_position_mobile')),
    statsData,
    aboutText: getSetting('about_text') || '',
    aboutSummary: plainTextFromMarkdown(getSetting('about_text') || '', 220),
    aboutImage: getSetting('about_image') || '',
    contactEmail,
    contactQq,
    socialLinks
  });
});

router.get('/blog', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 10;
  const activeTag = (req.query.tag || '').trim();

  // Published posts are small enough that loading + filtering in-memory
  // stays cheap; tags are JSON-encoded so a SQL LIKE would be fragile.
  const allPosts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC"
  ).all().map(p => ({
    ...p,
    tags: JSON.parse(p.tags || '[]'),
    readMinutes: estimateReadMinutes(p.content)
  }));

  const filtered = activeTag
    ? allPosts.filter(p => p.tags.includes(activeTag))
    : allPosts;
  const total = filtered.length;
  const offset = (page - 1) * limit;
  const posts = filtered.slice(offset, offset + limit);

  const blogDesc = activeTag
    ? `按标签「${activeTag}」筛选的博客文章。`
    : '浏览所有博客文章，分享技术见解和创意思考';

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allTags = [...new Set(allPosts.flatMap(p => p.tags))].sort();

  res.render('blog', {
    title: (activeTag ? '#' + activeTag + ' — ' : '') + 'Blog — ' + getSetting('site_title'),
    description: blogDesc,
    posts,
    total,
    page,
    limit,
    totalPages,
    pagination: buildBlogPagination(page, totalPages),
    activeTag,
    allTags,
    ...getPublicProfileData()
  });
});

router.get('/blog/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND status = ?')
    .get(req.params.slug, 'published');
  if (!post) return renderPublic404(res);

  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);

  const readMinutes = estimateReadMinutes(post.content);
  const bodyWithoutDuplicateTitle = removeDuplicateLeadHeading(render(post.content), post.title);
  const { html: postHtml, toc } = extractHeadings(bodyWithoutDuplicateTitle);
  // The reference article layout reserves a right rail for navigation, so a
  // single real heading is already useful enough to expose as a compact TOC.
  // The title is also an outline entry, so short posts keep a stable rail.
  const tocVisible = true;

  res.render('post', {
    title: post.title + ' — ' + getSetting('site_title'),
    post: { ...post, tags: JSON.parse(post.tags || '[]'), html: postHtml },
    readMinutes,
    toc,
    tocVisible,
    ...getPublicProfileData()
  });
});

router.get('/works', (req, res) => {
  const works = db.prepare('SELECT * FROM works ORDER BY sort_order ASC, created_at DESC').all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const firstFeaturedIdx = works.findIndex((w) => Number(w.featured) === 1);
  const spanIdx = firstFeaturedIdx >= 0 ? firstFeaturedIdx : 0;
  const worksLayout = works.map((w, i) => ({
    ...w,
    spanFeature: i === spanIdx
  }));

  const allTags = [...new Set(works.flatMap(w => w.tags))].sort();
  // Tag frequency map for the filter bar count badges. "All" is rendered
  // separately from this map using works.length.
  const tagCounts = {};
  works.forEach(w => w.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));

  res.render('works', {
    title: 'Works — ' + getSetting('site_title'),
    works: worksLayout,
    allTags,
    tagCounts
  });
});

router.get('/works/:slug', (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE slug = ?').get(req.params.slug);
  if (!work) return renderPublic404(res);

  res.render('work-detail', {
    title: work.title + ' — ' + getSetting('site_title'),
    work: {
      ...work,
      tags: JSON.parse(work.tags || '[]'),
      images: JSON.parse(work.images || '[]'),
      html: render(work.content)
    }
  });
});

router.get('/about', (req, res) => {
  const aboutTextRaw = getSetting('about_text');
  const aboutMeta = (getSetting('about_meta') || '').trim();
  const ogDescription = aboutMeta || plainTextFromMarkdown(aboutTextRaw, 160)
    || '关于我 — 个人博客与作品集';

  const featuredWorks = db.prepare(
    'SELECT * FROM works WHERE featured = 1 ORDER BY sort_order ASC, created_at DESC LIMIT 3'
  ).all().map((w) => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const recentPosts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 5"
  ).all().map((p) => ({ ...p, tags: JSON.parse(p.tags || '[]') }));

  const statsData = {
    postsCount: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get()?.cnt || 0,
    worksCount: db.prepare('SELECT COUNT(*) as cnt FROM works').get()?.cnt || 0,
    totalPV: db.prepare('SELECT COUNT(*) as cnt FROM visitors').get()?.cnt || 0
  };

  const aboutTagline = getSetting('about_tagline');
  const siteSubtitle = getSetting('site_subtitle');
  const aboutHeroLine = (aboutTagline && aboutTagline.trim())
    || (siteSubtitle && siteSubtitle.trim())
    || '个人博客与作品集';

  const contactEmail = getSetting('contact_email');
  const contactQq = getSetting('contact_qq');
  const socialLinks = parseSocialLinks(getSetting('social_links'));
  const hasContact = Boolean(
    (contactEmail && String(contactEmail).trim())
      || (contactQq && String(contactQq).trim())
      || (socialLinks && socialLinks.length)
  );

  res.render('about', {
    title: 'About — ' + getSetting('site_title'),
    aboutText: render(aboutTextRaw),
    aboutImage: getSetting('about_image'),
    aboutHeroLine,
    ogDescription,
    contactEmail,
    contactQq,
    socialLinks,
    hasContact,
    statsData,
    featuredWorks,
    recentPosts
  });
});

router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const qs = new URLSearchParams();
  qs.set('openSearch', '1');
  if (q) qs.set('q', q);
  res.redirect(302, '/?' + qs.toString());
});

router.get('/guestbook', (req, res) => {
  const messages = db.prepare('SELECT * FROM guestbook ORDER BY created_at DESC').all();
  res.render('guestbook', {
    title: '留言板 — aeoleaf',
    messages,
    extraCss: ['/css/guestbook.css']
  });
});


module.exports = router;
