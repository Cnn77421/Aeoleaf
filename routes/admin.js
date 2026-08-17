// Admin backend routes — the authenticated dashboard, content CRUD entry
// pages, settings, and the visitor-analytics console. Split out of pages.js so
// the public SSR routes and the admin surface live in separate files. Every
// route here except the login GET/POST requires an authenticated admin session.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const {
  db,
  saveDBSync,
  getVisitorOverview,
  getVisitorTrend,
  getRegionDistribution,
  getTopPages,
  getVisitorsPage,
  getVisitorsByFilter,
  getVisitorDetail,
  getVisitorSessionById,
  getVisitorPathBySession,
  getVisitorsByFingerprint,
  getSessionsPage,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklistIps
} = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { getCsrfToken } = require('../middleware/sameOrigin');
const { uploadGeneral, validateUploadedFiles } = require('../middleware/upload');
const { unlinkPublicUpload } = require('../lib/safeFs');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many login attempts, try again later',
  keyPrefix: 'login:'
});

const settingsUpload = uploadGeneral.fields([
  { name: 'home_hero_desktop_file', maxCount: 1 },
  { name: 'home_hero_mobile_file', maxCount: 1 }
]);
const mediaUpload = uploadGeneral.single('image');

function wantsJson(req) {
  return String(req.get('accept') || '').includes('application/json');
}

function parseSettingsUpload(req, res, next) {
  settingsUpload(req, res, async (err) => {
    if (err) return wantsJson(req) ? res.status(400).json({ error: '背景图片上传失败' }) : res.redirect('/admin/settings?err=upload');
    try {
      await validateUploadedFiles(req);
      return next();
    } catch {
      return wantsJson(req) ? res.status(400).json({ error: '背景图片上传失败' }) : res.redirect('/admin/settings?err=upload');
    }
  });
}

function parseMediaUpload(req, res, next) {
  mediaUpload(req, res, async (err) => {
    if (err) return wantsJson(req) ? res.status(400).json({ error: '图片上传失败' }) : res.redirect('/admin/media?err=upload');
    try {
      await validateUploadedFiles(req);
      if (!req.file) return wantsJson(req) ? res.status(400).json({ error: '请选择图片' }) : res.redirect('/admin/media?err=empty');
      return next();
    } catch {
      return wantsJson(req) ? res.status(400).json({ error: '图片内容或格式无效' }) : res.redirect('/admin/media?err=upload');
    }
  });
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

function renderPublic404(res) {
  return res.status(404).render('404', {
    title: 'Not Found',
    errorCode: 404,
    errorTitle: '风把你带到了没有文字的地方',
    errorMessage: '这页可能从未生长，也可能已随时节凋落。你可以从首页重新出发，或去搜索一下。'
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.redirect('/admin/dashboard'));

router.get('/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', {
    title: '后台登录 — aeoleaf',
    error: null,
    csrfToken: getCsrfToken(req)
  });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const crypto = require('crypto');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const adminPass = process.env.ADMIN_PASSWORD || '';

  const renderFail = () =>
    res.status(401).render('admin/login', {
      title: '后台登录 — aeoleaf',
      error: 'Incorrect password',
      csrfToken: getCsrfToken(req)
    });

  if (!password || !adminPass) return renderFail();

  let match = false;
  try {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(adminPass, 'utf8');
    if (a.length !== b.length) {
      const filler = Buffer.alloc(b.length);
      crypto.timingSafeEqual(filler, b);
      match = false;
    } else {
      match = crypto.timingSafeEqual(a, b);
    }
  } catch { match = false; }

  if (!match) return renderFail();

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.admin = true;
    req.session.save((err2) => {
      if (err2) return next(err2);
      res.redirect('/admin/dashboard');
    });
  });
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Every authenticated admin page exposes a form token. Browsers or privacy
// extensions may omit Origin/Referer on same-origin form POSTs, so the token is
// the reliable fallback used by requireSameOrigin.
router.use(requireAdmin, (req, res, next) => {
  res.locals.csrfToken = getCsrfToken(req);
  res.locals.guestbookPending = db.prepare("SELECT COUNT(*) AS cnt FROM guestbook WHERE status = 'pending'").get().cnt;
  next();
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireAdmin, (req, res) => {
  const stats = {
    postsPublished: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get().cnt,
    postsDraft: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='draft'").get().cnt,
    worksTotal: db.prepare('SELECT COUNT(*) as cnt FROM works').get().cnt,
    guestbookTotal: db.prepare('SELECT COUNT(*) as cnt FROM guestbook').get().cnt,
    guestbookPending: db.prepare("SELECT COUNT(*) as cnt FROM guestbook WHERE status = 'pending'").get().cnt
  };
  const recentPosts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 5').all();
  const recentWorks = db.prepare('SELECT * FROM works ORDER BY created_at DESC LIMIT 5').all();

  res.render('admin/dashboard', { title: '后台概览 — aeoleaf', stats, recentPosts, recentWorks });
});

// ─── Posts (edit pages; JSON CRUD lives in routes/api/posts.js) ────────────────

router.get('/posts', requireAdmin, (req, res) => {
  const posts = db.prepare(`
    SELECT p.*,
      COUNT(v.id) AS analytics_pv,
      COUNT(DISTINCT NULLIF(v.fingerprint_id, '')) AS analytics_uv,
      COALESCE(ROUND(AVG(CASE WHEN v.stay_duration_ms > 0 THEN v.stay_duration_ms END) / 1000.0, 1), 0) AS analytics_avg_stay,
      COALESCE(ROUND(AVG(CASE WHEN v.max_scroll_depth > 0 THEN v.max_scroll_depth END), 0), 0) AS analytics_avg_scroll
    FROM posts p
    LEFT JOIN visitors v ON v.path = '/blog/' || p.slug AND COALESCE(v.is_bot, 0) = 0
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all()
    .map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));
  res.render('admin/posts-list', { title: '文章管理 — aeoleaf', posts });
});

router.get('/posts/new', requireAdmin, (req, res) => {
  res.render('admin/post-edit', { title: '新建文章 — aeoleaf', post: null, performance: null });
});

router.get('/posts/:id/edit', requireAdmin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return renderPublic404(res);
  const performance = db.prepare(`
    SELECT COUNT(*) AS pv,
      COUNT(DISTINCT NULLIF(fingerprint_id, '')) AS uv,
      COALESCE(ROUND(AVG(CASE WHEN stay_duration_ms > 0 THEN stay_duration_ms END) / 1000.0, 1), 0) AS avgStay,
      COALESCE(ROUND(AVG(CASE WHEN max_scroll_depth > 0 THEN max_scroll_depth END), 0), 0) AS avgScroll
    FROM visitors
    WHERE path = ? AND COALESCE(is_bot, 0) = 0
  `).get(`/blog/${post.slug}`);
  res.render('admin/post-edit', {
    title: '编辑文章 — aeoleaf',
    post: { ...post, tags: JSON.parse(post.tags || '[]') },
    performance
  });
});

// ─── Works (edit pages; JSON CRUD lives in routes/api/works.js) ────────────────

router.get('/works', requireAdmin, (req, res) => {
  const works = db.prepare('SELECT * FROM works ORDER BY sort_order ASC, created_at DESC').all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));
  res.render('admin/works-list', { title: '作品管理 — aeoleaf', works });
});

router.get('/works/new', requireAdmin, (req, res) => {
  res.render('admin/work-edit', { title: '新建作品 — aeoleaf', work: null });
});

router.get('/works/:id/edit', requireAdmin, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return renderPublic404(res);
  res.render('admin/work-edit', {
    title: '编辑作品 — aeoleaf',
    work: { ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') }
  });
});

// ─── Guestbook moderation ────────────────────────────────────────────────────

function getGuestbookCounts() {
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'hidden' THEN 1 ELSE 0 END) AS hidden
    FROM guestbook
  `).get();
  return {
    total: counts.total || 0,
    pending: counts.pending || 0,
    approved: counts.approved || 0,
    hidden: counts.hidden || 0
  };
}

function parseGuestbookRow(message) {
  let riskFlags = [];
  try {
    const parsed = JSON.parse(message.risk_flags || '[]');
    if (Array.isArray(parsed)) riskFlags = parsed.map(String);
  } catch {}
  return { ...message, riskFlags };
}

function recordGuestbookAudit(message, action, newStatus = '', details = '') {
  db.prepare(`
    INSERT INTO guestbook_audit_log
      (guestbook_id, action, previous_status, new_status, message_name, message_excerpt, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    action,
    message.status || '',
    newStatus,
    message.name || '',
    String(message.message || '').slice(0, 160),
    details
  );
}

function guestbookReturnTo(value) {
  const target = String(value || '');
  return /^\/admin\/guestbook(?:\?status=(?:pending|approved|hidden|all))?$/.test(target)
    ? target
    : '/admin/guestbook';
}

function respondGuestbookAction(req, res, payload) {
  if (String(req.get('accept') || '').includes('application/json')) {
    return res.json({ ok: true, counts: getGuestbookCounts(), ...payload });
  }
  const target = new URL(guestbookReturnTo(req.body.return_to), 'http://localhost');
  target.searchParams.set('ok', '1');
  return res.redirect(`${target.pathname}${target.search}`);
}

router.get('/guestbook', requireAdmin, (req, res) => {
  const requestedStatus = String(req.query.status || 'pending');
  const status = ['all', 'pending', 'approved', 'hidden'].includes(requestedStatus) ? requestedStatus : 'pending';
  const messageRows = status === 'all'
    ? db.prepare("SELECT * FROM guestbook ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC").all()
    : db.prepare('SELECT * FROM guestbook WHERE status = ? ORDER BY created_at DESC').all(status);
  res.render('admin/guestbook', {
    title: '留言管理 — aeoleaf',
    messages: messageRows.map(parseGuestbookRow),
    counts: getGuestbookCounts(),
    status,
    returnTo: status === 'pending' ? '/admin/guestbook' : `/admin/guestbook?status=${status}`,
    view: 'moderation',
    auditLogs: [],
    notice: req.query.ok === '1' ? '留言已更新' : null
  });
});

router.get('/guestbook/audit', requireAdmin, (req, res) => {
  const auditLogs = db.prepare('SELECT * FROM guestbook_audit_log ORDER BY created_at DESC, id DESC LIMIT 200').all();
  res.render('admin/guestbook', {
    title: '留言审核日志 — aeoleaf',
    messages: [],
    counts: getGuestbookCounts(),
    status: '',
    returnTo: '/admin/guestbook/audit',
    view: 'audit',
    auditLogs,
    notice: null
  });
});

router.post('/guestbook/:id/status', requireAdmin, (req, res) => {
  const status = String(req.body.status || '');
  if (!['pending', 'approved', 'hidden'].includes(status)) return res.status(400).send('Invalid status');
  const message = db.prepare('SELECT * FROM guestbook WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).send('Message not found');
  db.prepare('UPDATE guestbook SET status = ? WHERE id = ?').run(status, req.params.id);
  recordGuestbookAudit(message, status === 'approved' ? 'approve' : status === 'hidden' ? 'reject' : 'reset', status);
  saveDBSync();
  return respondGuestbookAction(req, res, {
    notice: status === 'approved' ? '留言已通过并公开' : status === 'hidden' ? '留言已拒绝' : '留言已退回待审',
    affectedIds: [message.id],
    status
  });
});

router.post('/guestbook/bulk', requireAdmin, (req, res) => {
  const rawIds = Array.isArray(req.body.message_ids) ? req.body.message_ids : [req.body.message_ids];
  const ids = [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 200);
  const action = String(req.body.action || '');
  if (!ids.length) return res.redirect(guestbookReturnTo(req.body.return_to));
  if (!['approve', 'reject', 'delete'].includes(action)) return res.status(400).send('Invalid bulk action');

  const placeholders = ids.map(() => '?').join(',');
  const messages = db.prepare(`SELECT * FROM guestbook WHERE id IN (${placeholders})`).all(...ids);
  const applyBulk = db.transaction(() => {
    messages.forEach((message) => {
      if (action === 'delete') {
        recordGuestbookAudit(message, 'delete', '', '批量删除');
        db.prepare('DELETE FROM guestbook WHERE id = ?').run(message.id);
        return;
      }
      const nextStatus = action === 'approve' ? 'approved' : 'hidden';
      recordGuestbookAudit(message, action, nextStatus, '批量操作');
      db.prepare('UPDATE guestbook SET status = ? WHERE id = ?').run(nextStatus, message.id);
    });
  });
  applyBulk();
  saveDBSync();
  return respondGuestbookAction(req, res, {
    notice: `已${action === 'approve' ? '通过' : action === 'reject' ? '拒绝' : '删除'} ${messages.length} 条留言`,
    affectedIds: messages.map((message) => message.id),
    status: action === 'approve' ? 'approved' : action === 'reject' ? 'hidden' : 'deleted'
  });
});

router.post('/guestbook/:id/reply', requireAdmin, (req, res) => {
  const reply = String(req.body.admin_reply || '').trim().slice(0, 1000);
  const message = db.prepare('SELECT * FROM guestbook WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).send('Message not found');
  db.prepare("UPDATE guestbook SET admin_reply = ?, replied_at = CASE WHEN ? = '' THEN '' ELSE datetime('now') END WHERE id = ?")
    .run(reply, reply, req.params.id);
  recordGuestbookAudit(message, reply ? 'reply' : 'clear_reply', message.status, reply ? '保存站长回复' : '清除站长回复');
  saveDBSync();
  return respondGuestbookAction(req, res, {
    notice: reply ? '回复已保存' : '回复已清除',
    affectedIds: [message.id],
    status: message.status
  });
});

router.post('/guestbook/:id/delete', requireAdmin, (req, res) => {
  const message = db.prepare('SELECT * FROM guestbook WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).send('Message not found');
  recordGuestbookAudit(message, 'delete');
  db.prepare('DELETE FROM guestbook WHERE id = ?').run(req.params.id);
  saveDBSync();
  return respondGuestbookAction(req, res, {
    notice: '留言已删除',
    affectedIds: [message.id],
    status: 'deleted'
  });
});

// ─── Media library ───────────────────────────────────────────────────────────

const MEDIA_FOLDERS = ['posts', 'works', 'general'];
const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.heif', '.bmp']);

function loadMediaReferences() {
  const sources = [];
  db.prepare('SELECT id, title, cover_image, content FROM posts').all().forEach((row) => {
    sources.push({ label: `文章：${row.title}`, text: `${row.cover_image || ''}\n${row.content || ''}` });
  });
  db.prepare('SELECT id, title, cover_image, images, content FROM works').all().forEach((row) => {
    sources.push({ label: `作品：${row.title}`, text: `${row.cover_image || ''}\n${row.images || ''}\n${row.content || ''}` });
  });
  db.prepare('SELECT key, value FROM settings').all().forEach((row) => {
    sources.push({ label: `设置：${row.key}`, text: String(row.value || '') });
  });
  return sources;
}

function loadMediaFiles() {
  const uploadsRoot = path.resolve(__dirname, '../public/uploads');
  const references = loadMediaReferences();
  const media = [];
  MEDIA_FOLDERS.forEach((folder) => {
    const dir = path.join(uploadsRoot, folder);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isFile() || !MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return;
      const abs = path.join(dir, entry.name);
      const stat = fs.statSync(abs);
      const url = `/uploads/${folder}/${entry.name}`;
      const usedBy = references.filter((item) => item.text.includes(url)).map((item) => item.label);
      media.push({ url, folder, name: entry.name, size: stat.size, updatedAt: stat.mtime, usedBy });
    });
  });
  return media.sort((a, b) => b.updatedAt - a.updatedAt);
}

router.get('/media', requireAdmin, (req, res) => {
  const errorMap = {
    upload: '上传失败，仅支持 8MB 以内且内容真实的图片。',
    empty: '请选择要上传的图片。',
    used: '图片仍被文章、作品或站点设置引用，无法删除。',
    invalid: '图片路径无效。'
  };
  res.render('admin/media', {
    title: '媒体库 — aeoleaf',
    media: loadMediaFiles(),
    notice: req.query.ok === 'uploaded' ? '图片已上传' : req.query.ok === 'deleted' ? '图片已删除' : null,
    mediaError: errorMap[req.query.err] || null
  });
});

router.post('/media/upload', requireAdmin, parseMediaUpload, (req, res) => {
  if (wantsJson(req)) return res.json({ ok: true, notice: '图片已上传' });
  res.redirect('/admin/media?ok=uploaded');
});

router.post('/media/delete', requireAdmin, (req, res) => {
  const url = String(req.body.url || '').trim();
  const item = loadMediaFiles().find((file) => file.url === url);
  if (!item) return wantsJson(req) ? res.status(400).json({ error: '图片路径无效' }) : res.redirect('/admin/media?err=invalid');
  if (item.usedBy.length) return wantsJson(req) ? res.status(409).json({ error: '图片仍被内容引用，无法删除' }) : res.redirect('/admin/media?err=used');
  if (!unlinkPublicUpload(url)) return wantsJson(req) ? res.status(400).json({ error: '图片删除失败' }) : res.redirect('/admin/media?err=invalid');
  if (wantsJson(req)) return res.json({ ok: true, notice: '图片已删除' });
  res.redirect('/admin/media?ok=deleted');
});

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettingsMap() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = r.value; });
  return settings;
}

router.get('/settings', requireAdmin, (req, res) => {
  const settings = loadSettingsMap();
  const notice = req.query.ok === '1' ? '已保存' : null;
  const saveError = req.query.err === 'social_json'
    ? '社交链接 JSON 格式无效，请检查括号与引号后重试。'
    : req.query.err === 'upload'
      ? '背景图片上传失败，仅支持 8MB 以内的常见图片格式。'
    : req.query.err === 'body'
      ? '未收到表单数据（可能被代理截断或请求过大）。'
      : null;
  res.render('admin/settings', { title: '站点设置 — aeoleaf', settings, notice, saveError });
});

router.post('/settings', requireAdmin, parseSettingsUpload, (req, res, next) => {
  try {
    const b = req.body;
    if (!b || typeof b !== 'object') {
      return wantsJson(req) ? res.status(400).json({ error: '未收到设置数据' }) : res.redirect('/admin/settings?err=body');
    }

    const keys = [
      'site_title',
      'site_subtitle',
      'about_text',
      'about_image',
      'about_tagline',
      'about_meta',
      'home_hero_image',
      'home_hero_image_mobile',
      'home_hero_position',
      'home_hero_position_mobile',
      'contact_email',
      'contact_qq',
      'guestbook_sensitive_words',
      'social_links'
    ];
    const hasAnyField = keys.some((k) => Object.prototype.hasOwnProperty.call(b, k));
    if (!hasAnyField) {
      return wantsJson(req) ? res.status(400).json({ error: '未收到设置数据' }) : res.redirect('/admin/settings?err=body');
    }

    let socialVal = b.social_links;
    if (Object.prototype.hasOwnProperty.call(b, 'social_links')) {
      const raw = socialVal == null ? '' : String(socialVal);
      if (raw.trim() === '') {
        socialVal = '[]';
      } else {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            return wantsJson(req) ? res.status(400).json({ error: '社交链接 JSON 格式无效' }) : res.redirect('/admin/settings?err=social_json');
          }
          socialVal = JSON.stringify(parsed);
        } catch {
          return wantsJson(req) ? res.status(400).json({ error: '社交链接 JSON 格式无效' }) : res.redirect('/admin/settings?err=social_json');
        }
      }
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const update = db.transaction(() => {
      const desktopUpload = req.files?.home_hero_desktop_file?.[0];
      const mobileUpload = req.files?.home_hero_mobile_file?.[0];
      if (Object.prototype.hasOwnProperty.call(b, 'site_title')) stmt.run('site_title', b.site_title ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'site_subtitle')) stmt.run('site_subtitle', b.site_subtitle ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_text')) stmt.run('about_text', b.about_text ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_image')) stmt.run('about_image', b.about_image ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_tagline')) stmt.run('about_tagline', b.about_tagline ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_meta')) stmt.run('about_meta', b.about_meta ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_image') || desktopUpload) {
        stmt.run('home_hero_image', desktopUpload ? `/uploads/general/${desktopUpload.filename}` : (b.home_hero_image ?? ''));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_image_mobile') || mobileUpload) {
        stmt.run('home_hero_image_mobile', mobileUpload ? `/uploads/general/${mobileUpload.filename}` : (b.home_hero_image_mobile ?? ''));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_position')) {
        stmt.run('home_hero_position', normalizeHeroPosition(b.home_hero_position));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_position_mobile')) {
        stmt.run('home_hero_position_mobile', normalizeHeroPosition(b.home_hero_position_mobile));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'contact_email')) stmt.run('contact_email', b.contact_email ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'contact_qq')) stmt.run('contact_qq', b.contact_qq ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'guestbook_sensitive_words')) {
        stmt.run('guestbook_sensitive_words', String(b.guestbook_sensitive_words ?? '').slice(0, 5000));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'social_links')) stmt.run('social_links', socialVal);
    });
    update();
    saveDBSync();
    if (wantsJson(req)) return res.json({ ok: true, notice: '设置已保存' });
    return res.redirect('/admin/settings?ok=1');
  } catch (e) {
    return next(e);
  }
});

// ─── Visitor analytics console ─────────────────────────────────────────────────

function parseDatetimeParam(val) {
  if (!val) return null;
  var n = Number(val);
  if (Number.isFinite(n) && n > 1e12) return n;
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function visitorFiltersFromQuery(req) {
  return {
    startTime: parseDatetimeParam(req.query.startTime),
    endTime: parseDatetimeParam(req.query.endTime),
    ip: (req.query.ip || '').trim(),
    city: (req.query.city || '').trim(),
    deviceType: (req.query.deviceType || '').trim(),
    fingerprint: (req.query.fingerprint || '').trim()
  };
}

function renderAdminVisitorsList(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const filters = visitorFiltersFromQuery(req);
    const view = req.query.view === 'sessions' ? 'sessions' : 'detail';

    const allowedSortCols = ['tracked_at', 'ip', 'stay_duration_ms'];
    const sortBy = allowedSortCols.includes(req.query.sortBy) ? req.query.sortBy : 'tracked_at';
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const overview = getVisitorOverview();
    const trendRows = getVisitorTrend(7);
    const regionRows = getRegionDistribution(20);
    const topPages = getTopPages(10);

    let visitorsPage = null;
    let sessionsPage = null;

    if (view === 'sessions') {
      sessionsPage = getSessionsPage(filters, page, limit);
    } else {
      visitorsPage = getVisitorsPage(filters, page, limit, sortBy, sortDir);
    }

    res.render('admin/visitors', {
      title: '访客分析 — aeoleaf',
      overview,
      trendRows,
      regionRows,
      topPages,
      visitorsPage,
      sessionsPage,
      filters,
      view,
      sortBy,
      sortDir
    });
  } catch (err) {
    next(err);
  }
}

router.get('/visitors', requireAdmin, renderAdminVisitorsList);

function renderVisitorFingerprint(req, res, next) {
  try {
    const fp = String(req.query.fp || '').trim();
    if (!fp) return res.redirect('/admin/visitors');
    const rows = getVisitorsByFingerprint(fp, 500);
    res.render('admin/visitor-fingerprint', {
      title: '访客路径 — aeoleaf',
      fingerprint: fp,
      rows
    });
  } catch (err) {
    next(err);
  }
}

router.get('/visitors/fingerprint', requireAdmin, renderVisitorFingerprint);

function renderVisitorsExportCsv(req, res, next) {
  try {
    const startTime = req.query.startTime ? Number(req.query.startTime) : null;
    const endTime = req.query.endTime ? Number(req.query.endTime) : null;
    const filters = {
      startTime: Number.isFinite(startTime) ? startTime : null,
      endTime: Number.isFinite(endTime) ? endTime : null,
      ip: (req.query.ip || '').trim(),
      city: (req.query.city || '').trim(),
      deviceType: (req.query.deviceType || '').trim(),
      fingerprint: (req.query.fingerprint || '').trim()
    };

    const rows = getVisitorsByFilter(filters, 10000);
    const headers = [
      'id', 'tracked_at', 'ip', 'full_url', 'path', 'referer', 'device_type', 'os_name', 'browser_name',
      'country', 'province', 'city', 'isp', 'network_type', 'stay_duration_ms', 'max_scroll_depth',
      'fingerprint_id', 'request_id', 'utm_source', 'utm_medium', 'utm_campaign', 'search_keyword', 'is_bot'
    ];

    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(',')]
      .concat(rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visitors-${Date.now()}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}

router.get('/visitors/export.csv', requireAdmin, renderVisitorsExportCsv);

function renderVisitorDetail(req, res, next) {
  try {
    const visitor = getVisitorDetail(req.params.id);
    if (!visitor) return renderPublic404(res);
    const session = visitor.visitor_session_id ? getVisitorSessionById(visitor.visitor_session_id) : null;
    const pathRows = visitor.visitor_session_id ? getVisitorPathBySession(visitor.visitor_session_id) : [visitor];

    res.render('admin/visitor-detail', {
      title: `访客 #${visitor.id} — aeoleaf`,
      visitor,
      session,
      pathRows
    });
  } catch (err) {
    next(err);
  }
}

router.get('/visitor/:id', requireAdmin, renderVisitorDetail);

router.post('/visitors/blacklist', requireAdmin, (req, res) => {
  try {
    const ip = (req.body.ip || '').trim();
    const reason = (req.body.reason || '').trim();
    if (!ip) return res.status(400).json({ error: 'IP is required' });
    addToBlacklist(ip, reason);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/visitors/blacklist/remove', requireAdmin, (req, res) => {
  try {
    const ip = (req.body.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'IP is required' });
    removeFromBlacklist(ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/visitors/blacklist', requireAdmin, (req, res) => {
  try {
    const list = getBlacklistIps();
    res.render('admin/visitors-blacklist', {
      title: 'IP 黑名单 — aeoleaf',
      list
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
