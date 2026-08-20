// Admin backend routes — the authenticated dashboard, content CRUD entry
// pages, settings, and the visitor-analytics console. Split out of pages.js so
// the public SSR routes and the admin surface live in separate files. Every
// route here except the login GET/POST requires an authenticated admin session.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
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
const { requireAdmin, isRecentlyAuthenticated } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { getCsrfToken } = require('../middleware/sameOrigin');
const { uploadGeneral, validateUploadedFiles } = require('../middleware/upload');
const { restoreQuarantinedUpload, destroyQuarantinedUpload } = require('../lib/safeFs');
const { logAudit } = require('../lib/auditLog');
const { trashMedia } = require('../lib/trash');
const {
  createBackup, listBackups, getBackup, deleteBackup, restoreBackup, recentEvents
} = require('../lib/backupService');
const { getLoginState, recordFailure, clearFailures, initializeSession } = require('../lib/loginSecurity');
const passkeyService = require('../lib/passkeys');
const { runHealthChecks } = require('../lib/healthCheck');
const { getAdvancedAnalytics } = require('../lib/advancedAnalytics');

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

function passwordMatches(value) {
  const crypto = require('crypto');
  const supplied = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(String(process.env.ADMIN_PASSWORD || ''), 'utf8');
  if (!expected.length || supplied.length !== expected.length) {
    const filler = Buffer.alloc(expected.length);
    if (expected.length) crypto.timingSafeEqual(filler, expected);
    return false;
  }
  return crypto.timingSafeEqual(supplied, expected);
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
    csrfToken: getCsrfToken(req),
    passkeyCount: db.prepare('SELECT COUNT(*) AS count FROM admin_passkeys').get().count
  });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const adminPass = process.env.ADMIN_PASSWORD || '';
  const loginState = getLoginState(db, req);

  const renderFail = (reason, status = 401, extra = {}) => {
    logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'failure', summary: { reason, ...extra } });
    return res.status(status).render('admin/login', {
      title: '后台登录 — aeoleaf',
      error: status === 429 ? '登录尝试过多，请稍后再试' : 'Incorrect password',
      csrfToken: getCsrfToken(req),
      passkeyCount: db.prepare('SELECT COUNT(*) AS count FROM admin_passkeys').get().count
    });
  };

  if (loginState.locked) return renderFail('temporarily_locked', 429, { lockedUntil: loginState.lockedUntil });

  if (!password || !adminPass) return renderFail(!adminPass ? 'disabled' : 'missing_password');

  if (!passwordMatches(password)) {
    const failed = recordFailure(db, req);
    return renderFail(failed.locked ? 'temporarily_locked' : 'incorrect_password', failed.locked ? 429 : 401, { failures: failed.failures });
  }

  req.session.regenerate((err) => {
    if (err) return next(err);
    initializeSession(req);
    req.session.save((err2) => {
      if (err2) return next(err2);
      clearFailures(db, req);
      logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'success' });
      res.redirect('/admin/dashboard');
    });
  });
});

router.post('/logout', requireAdmin, (req, res) => {
  logAudit(db, req, { action: 'auth.logout', entityType: 'admin', entityId: req.sessionID || '' });
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Every authenticated admin page exposes a form token. Browsers or privacy
// extensions may omit Origin/Referer on same-origin form POSTs, so the token is
// the reliable fallback used by requireSameOrigin.
router.use(requireAdmin, (req, res, next) => {
  res.locals.csrfToken = getCsrfToken(req);
  res.locals.guestbookPending = db.prepare("SELECT COUNT(*) AS cnt FROM guestbook WHERE status = 'pending' AND deleted_at = ''").get().cnt;
    res.locals.trashCount = db.prepare(`
    SELECT (SELECT COUNT(*) FROM posts WHERE deleted_at != '')
      + (SELECT COUNT(*) FROM works WHERE deleted_at != '')
      + (SELECT COUNT(*) FROM guestbook WHERE deleted_at != '')
      + (SELECT COUNT(*) FROM media_trash) AS cnt
    `).get().cnt;
    res.locals.notificationUnread = db.prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE read_at = ''").get().cnt;
    next();
  });

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireAdmin, (req, res) => {
  const stats = {
    postsPublished: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published' AND deleted_at = ''").get().cnt,
    postsDraft: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='draft' AND deleted_at = ''").get().cnt,
    worksTotal: db.prepare("SELECT COUNT(*) as cnt FROM works WHERE deleted_at = ''").get().cnt,
    guestbookTotal: db.prepare("SELECT COUNT(*) as cnt FROM guestbook WHERE deleted_at = ''").get().cnt,
    guestbookPending: db.prepare("SELECT COUNT(*) as cnt FROM guestbook WHERE status = 'pending' AND deleted_at = ''").get().cnt
  };
  const recentPosts = db.prepare("SELECT * FROM posts WHERE deleted_at = '' ORDER BY created_at DESC LIMIT 5").all();
  const recentWorks = db.prepare("SELECT * FROM works WHERE deleted_at = '' ORDER BY created_at DESC LIMIT 5").all();

  res.render('admin/dashboard', { title: '后台概览 — aeoleaf', stats, recentPosts, recentWorks });
});

// ─── Notifications ──────────────────────────────────────────────────────────

router.get('/notifications', requireAdmin, (req, res) => {
  const filter = ['all', 'unread', 'error', 'warning'].includes(req.query.filter) ? req.query.filter : 'all';
  let where = '';
  const params = [];
  if (filter === 'unread') where = "WHERE read_at = ''";
  else if (filter === 'error' || filter === 'warning') { where = 'WHERE severity = ?'; params.push(filter); }
  const notifications = db.prepare(`SELECT * FROM notifications ${where} ORDER BY id DESC LIMIT 300`).all(...params);
  const counts = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN read_at='' THEN 1 ELSE 0 END) AS unread, SUM(CASE WHEN severity='error' THEN 1 ELSE 0 END) AS errors FROM notifications`).get();
  res.render('admin/notifications', { title: '通知中心 — aeoleaf', notifications, counts, filter });
});

router.post('/notifications/read-all', requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE notifications SET read_at=datetime('now', 'localtime') WHERE read_at='' ").run();
  logAudit(db, req, { action: 'notification.read_all', entityType: 'notification', summary: { count: result.changes } });
  return wantsJson(req) ? res.json({ ok: true, count: result.changes }) : res.redirect('/admin/notifications');
});

router.post('/notifications/:id/read', requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE notifications SET read_at=CASE WHEN read_at='' THEN datetime('now', 'localtime') ELSE read_at END WHERE id=?").run(req.params.id);
  if (!result.changes) return res.status(404).send('Notification not found');
  return wantsJson(req) ? res.json({ ok: true }) : res.redirect('/admin/notifications');
});

router.post('/notifications/:id/delete', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM notifications WHERE id=?').run(req.params.id);
  if (!result.changes) return res.status(404).send('Notification not found');
  logAudit(db, req, { action: 'notification.delete', entityType: 'notification', entityId: req.params.id });
  return wantsJson(req) ? res.json({ ok: true }) : res.redirect('/admin/notifications');
});

// ─── System health ──────────────────────────────────────────────────────────
router.get('/health', requireAdmin, (req, res) => {
  const health = runHealthChecks(db);
  if (wantsJson(req)) return res.json(health);
  const history = db.prepare('SELECT * FROM health_snapshots ORDER BY id DESC LIMIT 20').all();
  return res.render('admin/health', { title: '系统健康 — aeoleaf', health, history });
});

router.get('/audit', requireAdmin, (req, res) => {
  const action = String(req.query.action || '').trim();
  const outcome = String(req.query.outcome || '').trim();
  const entityType = String(req.query.entity_type || '').trim();
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from || '') ? req.query.date_from : '';
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') ? req.query.date_to : '';
  let where = ' WHERE 1=1';
  const params = [];
  if (action) { where += ' AND action LIKE ?'; params.push(`%${action}%`); }
  if (outcome === 'success' || outcome === 'failure') { where += ' AND outcome = ?'; params.push(outcome); }
  if (entityType) { where += ' AND entity_type = ?'; params.push(entityType); }
  if (dateFrom) { where += ' AND created_at >= ?'; params.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { where += ' AND created_at <= ?'; params.push(`${dateTo} 23:59:59`); }
  const entries = db.prepare(`SELECT * FROM audit_log${where} ORDER BY id DESC LIMIT 200`).all(...params)
    .map((entry) => {
      try { return { ...entry, summary: JSON.parse(entry.summary_json || '{}') }; }
      catch { return { ...entry, summary: {} }; }
    });
  const entityTypes = db.prepare("SELECT DISTINCT entity_type FROM audit_log WHERE entity_type != '' ORDER BY entity_type").all().map((row) => row.entity_type);
  res.render('admin/audit', { title: '操作审计 — aeoleaf', entries, entityTypes, filters: { action, outcome, entityType, dateFrom, dateTo } });
});

router.get('/security', requireAdmin, (req, res) => {
  const now = Date.now();
  const sessions = db.prepare(`SELECT sid, expires_at, created_at, last_seen_at, ip, user_agent
    FROM admin_sessions WHERE expires_at > ? ORDER BY last_seen_at DESC`).all(now).map((session) => ({
      ...session,
      current: session.sid === req.sessionID,
      device: /mobile|android|iphone|ipad/i.test(session.user_agent || '') ? '移动设备' : '桌面设备'
    }));
  const recentAuth = Number(req.session.security?.authenticatedAt || 0);
  const failedLogins = db.prepare("SELECT * FROM audit_log WHERE action IN ('auth.login','auth.passkey_login') AND outcome = 'failure' ORDER BY id DESC LIMIT 10").all();
  const lockedIps = db.prepare('SELECT * FROM admin_login_attempts WHERE locked_until > ? ORDER BY locked_until DESC').all(now);
  const adminAccesses = db.prepare(`SELECT id, tracked_at, path, ip, device_type, os_name, browser_name, stay_duration_ms, fingerprint_id
    FROM visitors WHERE path LIKE '/admin/%' ORDER BY tracked_at DESC, id DESC LIMIT 30`).all();
  res.render('admin/security', { title: '登录安全 — aeoleaf', sessions, recentAuth, passkeys: passkeyService.passkeys(db), failedLogins, lockedIps, adminAccesses });
});

router.post('/security/passkeys/register/options', requireAdmin, async (req, res, next) => {
  if (!isRecentlyAuthenticated(req)) return res.status(403).json({ error: '注册通行密钥前需要重新验证密码', code: 'REAUTH_REQUIRED' });
  try { res.json(await passkeyService.registrationOptions(db, req)); } catch (error) { next(error); }
});

router.post('/security/passkeys/register/verify', requireAdmin, async (req, res) => {
  if (!isRecentlyAuthenticated(req)) return res.status(403).json({ error: '注册通行密钥前需要重新验证密码', code: 'REAUTH_REQUIRED' });
  try {
    const verified = await passkeyService.verifyRegistration(db, req, req.body.response, req.body.name);
    logAudit(db, req, { action: 'auth.passkey_register', entityType: 'passkey', outcome: verified ? 'success' : 'failure' });
    return res.status(verified ? 200 : 400).json({ ok: verified });
  } catch (error) {
    logAudit(db, req, { action: 'auth.passkey_register', entityType: 'passkey', outcome: 'failure', summary: { reason: error.message } });
    return res.status(400).json({ error: error.message });
  }
});

router.post('/security/passkeys/:id/delete', requireAdmin, (req, res) => {
  if (!isRecentlyAuthenticated(req)) return res.status(403).json({ error: '删除通行密钥前需要重新验证密码', code: 'REAUTH_REQUIRED' });
  const removed = db.prepare('DELETE FROM admin_passkeys WHERE id = ?').run(req.params.id).changes;
  logAudit(db, req, { action: 'auth.passkey_delete', entityType: 'passkey', entityId: req.params.id, summary: { removed } });
  return wantsJson(req) ? res.json({ ok: true, removed }) : res.redirect('/admin/security?ok=passkey_deleted');
});

router.post('/security/reauth', requireAdmin, (req, res) => {
  if (!passwordMatches(req.body.password)) {
    logAudit(db, req, { action: 'auth.reauthenticate', entityType: 'admin', outcome: 'failure' });
    return wantsJson(req) ? res.status(403).json({ error: '管理员密码错误' }) : res.redirect('/admin/security?err=password');
  }
  req.session.security = req.session.security || {};
  req.session.security.authenticatedAt = Date.now();
  logAudit(db, req, { action: 'auth.reauthenticate', entityType: 'admin' });
  return wantsJson(req) ? res.json({ ok: true }) : res.redirect('/admin/security?ok=reauth');
});

router.post('/security/sessions/revoke-others', requireAdmin, (req, res) => {
  const removed = db.prepare('DELETE FROM admin_sessions WHERE sid != ?').run(req.sessionID).changes;
  logAudit(db, req, { action: 'auth.sessions_revoke_others', entityType: 'session', entityId: req.sessionID, summary: { removed } });
  return wantsJson(req) ? res.json({ ok: true, removed }) : res.redirect('/admin/security?ok=revoked');
});

router.post('/security/sessions/:sid/revoke', requireAdmin, (req, res) => {
  const sid = String(req.params.sid || '');
  const removed = db.prepare('DELETE FROM admin_sessions WHERE sid = ?').run(sid).changes;
  logAudit(db, req, { action: 'auth.session_revoke', entityType: 'session', entityId: sid, summary: { current: sid === req.sessionID, removed } });
  if (sid === req.sessionID) return req.session.destroy(() => res.redirect('/admin/login'));
  return wantsJson(req) ? res.json({ ok: true, removed }) : res.redirect('/admin/security?ok=revoked');
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
    WHERE p.deleted_at = ''
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
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
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
  const works = db.prepare("SELECT * FROM works WHERE deleted_at = '' ORDER BY sort_order ASC, created_at DESC").all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));
  res.render('admin/works-list', { title: '作品管理 — aeoleaf', works });
});

router.get('/works/new', requireAdmin, (req, res) => {
  res.render('admin/work-edit', { title: '新建作品 — aeoleaf', work: null });
});

router.get('/works/:id/edit', requireAdmin, (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
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
    FROM guestbook WHERE deleted_at = ''
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
    ? db.prepare("SELECT * FROM guestbook WHERE deleted_at = '' ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC").all()
    : db.prepare("SELECT * FROM guestbook WHERE status = ? AND deleted_at = '' ORDER BY created_at DESC").all(status);
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
  const message = db.prepare("SELECT * FROM guestbook WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!message) return res.status(404).send('Message not found');
  db.prepare('UPDATE guestbook SET status = ? WHERE id = ?').run(status, req.params.id);
  recordGuestbookAudit(message, status === 'approved' ? 'approve' : status === 'hidden' ? 'reject' : 'reset', status);
  logAudit(db, req, { action: `guestbook.${status === 'approved' ? 'approve' : status === 'hidden' ? 'reject' : 'reset'}`, entityType: 'guestbook', entityId: message.id, summary: { previousStatus: message.status, status } });
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
  const messages = db.prepare(`SELECT * FROM guestbook WHERE deleted_at = '' AND id IN (${placeholders})`).all(...ids);
  const applyBulk = db.transaction(() => {
    messages.forEach((message) => {
      if (action === 'delete') {
        recordGuestbookAudit(message, 'delete', '', '批量删除');
        db.prepare("UPDATE guestbook SET deleted_at = datetime('now', 'localtime') WHERE id = ?").run(message.id);
        logAudit(db, req, { action: 'guestbook.delete', entityType: 'guestbook', entityId: message.id, summary: { name: message.name, bulk: true } });
        return;
      }
      const nextStatus = action === 'approve' ? 'approved' : 'hidden';
      recordGuestbookAudit(message, action, nextStatus, '批量操作');
      db.prepare('UPDATE guestbook SET status = ? WHERE id = ?').run(nextStatus, message.id);
      logAudit(db, req, { action: `guestbook.${action}`, entityType: 'guestbook', entityId: message.id, summary: { previousStatus: message.status, status: nextStatus, bulk: true } });
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
  const message = db.prepare("SELECT * FROM guestbook WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!message) return res.status(404).send('Message not found');
  db.prepare("UPDATE guestbook SET admin_reply = ?, replied_at = CASE WHEN ? = '' THEN '' ELSE datetime('now') END WHERE id = ?")
    .run(reply, reply, req.params.id);
  recordGuestbookAudit(message, reply ? 'reply' : 'clear_reply', message.status, reply ? '保存站长回复' : '清除站长回复');
  logAudit(db, req, { action: `guestbook.${reply ? 'reply' : 'clear_reply'}`, entityType: 'guestbook', entityId: message.id, summary: { replyLength: reply.length } });
  saveDBSync();
  return respondGuestbookAction(req, res, {
    notice: reply ? '回复已保存' : '回复已清除',
    affectedIds: [message.id],
    status: message.status
  });
});

router.post('/guestbook/:id/delete', requireAdmin, (req, res) => {
  const message = db.prepare("SELECT * FROM guestbook WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!message) return res.status(404).send('Message not found');
  recordGuestbookAudit(message, 'delete');
  db.prepare("UPDATE guestbook SET deleted_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
  logAudit(db, req, { action: 'guestbook.delete', entityType: 'guestbook', entityId: message.id, summary: { name: message.name } });
  saveDBSync();
  return respondGuestbookAction(req, res, {
    notice: '留言已删除',
    affectedIds: [message.id],
    status: 'deleted'
  });
});

// ─── Unified trash ───────────────────────────────────────────────────────────

const TRASH_TYPES = new Set(['post', 'work', 'guestbook', 'media']);

function trashItems(filters = {}) {
  const type = TRASH_TYPES.has(filters.type) ? filters.type : '';
  const keyword = String(filters.keyword || '').trim();
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom || '') ? filters.dateFrom : '';
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo || '') ? filters.dateTo : '';
  let where = ' WHERE 1=1';
  const params = [];
  if (type) { where += ' AND type = ?'; params.push(type); }
  if (keyword) { where += ' AND (title LIKE ? OR detail LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (dateFrom) { where += ' AND deleted_at >= ?'; params.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { where += ' AND deleted_at <= ?'; params.push(`${dateTo} 23:59:59`); }
  return db.prepare(`
    SELECT * FROM (
      SELECT 'post' AS type, id, title, deleted_slug AS detail, deleted_at FROM posts WHERE deleted_at != ''
      UNION ALL
      SELECT 'work' AS type, id, title, deleted_slug AS detail, deleted_at FROM works WHERE deleted_at != ''
      UNION ALL
      SELECT 'guestbook' AS type, id, name AS title, substr(message, 1, 160) AS detail, deleted_at FROM guestbook WHERE deleted_at != ''
      UNION ALL
      SELECT 'media' AS type, id, original_url AS title, printf('%d bytes', original_size) AS detail, deleted_at FROM media_trash
    )${where}
    ORDER BY deleted_at DESC, type, id DESC
    LIMIT 500
  `).all(...params).map((item) => ({ ...item, key: `${item.type}:${item.id}` }));
}

function parseTrashKey(value) {
  const match = String(value || '').match(/^(post|work|guestbook|media):(\d+)$/);
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) && id > 0 ? { type: match[1], id } : null;
}

function restoreTrashItem(req, key) {
  if (key.type === 'post' || key.type === 'work') {
    const table = key.type === 'post' ? 'posts' : 'works';
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at != ''`).get(key.id);
    if (!row) throw Object.assign(new Error('项目不存在或已恢复'), { status: 404 });
    if (!row.deleted_slug) throw Object.assign(new Error('缺少原始 URL 别名，无法安全恢复'), { status: 409 });
    const conflict = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).get(row.deleted_slug, row.id);
    if (conflict) throw Object.assign(new Error(`URL 别名 ${row.deleted_slug} 已被占用`), { status: 409 });
    db.prepare(`UPDATE ${table} SET slug = deleted_slug, deleted_slug = '', deleted_at = '', updated_at = datetime('now') WHERE id = ?`).run(row.id);
    logAudit(db, req, { action: `${key.type}.trash_restore`, entityType: key.type, entityId: row.id, summary: { title: row.title, slug: row.deleted_slug } });
    return { key: `${key.type}:${row.id}`, restoredUrl: key.type === 'post' ? `/blog/${row.deleted_slug}` : `/works/${row.deleted_slug}` };
  }
  if (key.type === 'guestbook') {
    const row = db.prepare("SELECT * FROM guestbook WHERE id = ? AND deleted_at != ''").get(key.id);
    if (!row) throw Object.assign(new Error('留言不存在或已恢复'), { status: 404 });
    db.prepare("UPDATE guestbook SET deleted_at = '' WHERE id = ?").run(row.id);
    recordGuestbookAudit(row, 'restore', row.status, '从回收站恢复');
    logAudit(db, req, { action: 'guestbook.restore', entityType: 'guestbook', entityId: row.id, summary: { name: row.name } });
    return { key: `guestbook:${row.id}` };
  }
  const row = db.prepare('SELECT * FROM media_trash WHERE id = ?').get(key.id);
  if (!row) throw Object.assign(new Error('媒体不存在或已恢复'), { status: 404 });
  const restored = restoreQuarantinedUpload(row.quarantine_name, row.original_url);
  if (!restored) throw Object.assign(new Error('隔离文件缺失，无法恢复'), { status: 409 });
  db.prepare('DELETE FROM media_trash WHERE id = ?').run(row.id);
  logAudit(db, req, { action: 'media.restore', entityType: 'media', entityId: row.id, summary: { originalUrl: row.original_url, restoredUrl: restored.url, renamed: restored.renamed } });
  return { key: `media:${row.id}`, restoredUrl: restored.url, renamed: restored.renamed };
}

function destroyTrashItem(req, key) {
  if (key.type === 'post' || key.type === 'work') {
    const table = key.type === 'post' ? 'posts' : 'works';
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at != ''`).get(key.id);
    if (!row) throw Object.assign(new Error('项目不存在'), { status: 404 });
    const destroy = db.transaction(() => {
      db.prepare('DELETE FROM content_versions WHERE entity_type = ? AND entity_id = ?').run(key.type, row.id);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
    });
    destroy();
    logAudit(db, req, { action: `${key.type}.destroy`, entityType: key.type, entityId: row.id, summary: { title: row.title, slug: row.deleted_slug } });
    return { key: `${key.type}:${row.id}` };
  }
  if (key.type === 'guestbook') {
    const row = db.prepare("SELECT * FROM guestbook WHERE id = ? AND deleted_at != ''").get(key.id);
    if (!row) throw Object.assign(new Error('留言不存在'), { status: 404 });
    db.prepare('DELETE FROM guestbook WHERE id = ?').run(row.id);
    recordGuestbookAudit(row, 'destroy', '', '从回收站彻底删除');
    logAudit(db, req, { action: 'guestbook.destroy', entityType: 'guestbook', entityId: row.id, summary: { name: row.name } });
    return { key: `guestbook:${row.id}` };
  }
  const row = db.prepare('SELECT * FROM media_trash WHERE id = ?').get(key.id);
  if (!row) throw Object.assign(new Error('媒体不存在'), { status: 404 });
  if (!destroyQuarantinedUpload(row.quarantine_name)) throw Object.assign(new Error('隔离文件删除失败'), { status: 500 });
  db.prepare('DELETE FROM media_trash WHERE id = ?').run(row.id);
  logAudit(db, req, { action: 'media.destroy', entityType: 'media', entityId: row.id, summary: { url: row.original_url } });
  return { key: `media:${row.id}` };
}

router.get('/trash', requireAdmin, (req, res) => {
  const filters = {
    type: String(req.query.type || ''), keyword: String(req.query.keyword || ''),
    dateFrom: String(req.query.date_from || ''), dateTo: String(req.query.date_to || '')
  };
  res.render('admin/trash', {
    title: '回收站 — aeoleaf', items: trashItems(filters), filters,
    notice: req.query.ok ? `已处理 ${Number(req.query.ok) || 0} 项` : null,
    trashError: req.query.err === 'conflict' ? '部分项目存在 URL 或文件冲突，未能恢复。' : null
  });
});

router.post('/trash/bulk', requireAdmin, (req, res) => {
  const action = String(req.body.action || '');
  if (!['restore', 'destroy'].includes(action)) return res.status(400).send('Invalid action');
  if (action === 'destroy' && !isRecentlyAuthenticated(req)) {
    logAudit(db, req, { action: 'trash.destroy', entityType: 'trash', outcome: 'failure', summary: { reason: 'reauth_required' } });
    return wantsJson(req) ? res.status(403).json({ error: '彻底删除前需要重新验证管理员身份', code: 'REAUTH_REQUIRED' }) : res.redirect('/admin/security?err=reauth');
  }
  const rawKeys = Array.isArray(req.body.item_keys) ? req.body.item_keys : [req.body.item_keys];
  const keys = rawKeys.map(parseTrashKey).filter(Boolean).slice(0, 200);
  if (!keys.length) return wantsJson(req) ? res.status(400).json({ error: '请选择项目' }) : res.redirect('/admin/trash');
  const completed = [];
  const errors = [];
  keys.forEach((key) => {
    try { completed.push(action === 'restore' ? restoreTrashItem(req, key) : destroyTrashItem(req, key)); }
    catch (error) { errors.push({ key: `${key.type}:${key.id}`, error: error.message, status: error.status || 500 }); }
  });
  if (wantsJson(req)) return res.status(errors.length ? 409 : 200).json({ ok: !errors.length, completed, errors });
  return res.redirect(`/admin/trash?ok=${completed.length}${errors.length ? '&err=conflict' : ''}`);
});

// ─── Backups ─────────────────────────────────────────────────────────────────

function backupSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('backup_schedule_enabled', 'backup_interval_hours', 'backup_retention_count')").all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

router.get('/backups', requireAdmin, (req, res) => {
  res.render('admin/backups', {
    title: '备份与恢复 — aeoleaf', backups: listBackups(), events: recentEvents(), settings: backupSettings(),
    notice: req.query.ok === 'created' ? '完整备份已创建' : req.query.ok === 'deleted' ? '备份已删除' : req.query.ok === 'settings' ? '定时备份设置已保存' : null,
    backupError: req.query.err ? '备份操作失败，请查看失败记录。' : null
  });
});

router.post('/backups/create', requireAdmin, async (req, res) => {
  try {
    const backup = await createBackup({ trigger: 'manual' });
    logAudit(db, req, { action: 'backup.create', entityType: 'backup', entityId: backup.id, summary: { size: backup.size, sha256: backup.sha256, fileCount: backup.fileCount } });
    if (wantsJson(req)) return res.status(201).json({ ok: true, backup });
    return res.redirect('/admin/backups?ok=created');
  } catch (error) {
    logAudit(db, req, { action: 'backup.create', entityType: 'backup', outcome: 'failure', summary: { reason: error.message } });
    if (wantsJson(req)) return res.status(500).json({ error: error.message });
    return res.redirect('/admin/backups?err=create');
  }
});

router.get('/backups/:id/download', requireAdmin, (req, res) => {
  const backup = getBackup(req.params.id);
  if (!backup) return res.status(404).send('Backup not found');
  logAudit(db, req, { action: 'backup.download', entityType: 'backup', entityId: backup.metadata.id, summary: { sha256: backup.metadata.sha256 } });
  return res.download(backup.archive, `${backup.metadata.id}.aebak`);
});

router.post('/backups/:id/delete', requireAdmin, (req, res) => {
  const backup = getBackup(req.params.id);
  if (!backup) return res.status(404).send('Backup not found');
  const summary = { size: backup.metadata.size, sha256: backup.metadata.sha256 };
  if (!deleteBackup(req.params.id)) return res.status(500).send('Backup deletion failed');
  logAudit(db, req, { action: 'backup.delete', entityType: 'backup', entityId: req.params.id, summary });
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect('/admin/backups?ok=deleted');
});

router.post('/backups/:id/restore', requireAdmin, async (req, res) => {
  if (!passwordMatches(req.body.password)) {
    logAudit(db, req, { action: 'backup.restore', entityType: 'backup', entityId: req.params.id, outcome: 'failure', summary: { reason: 'password_mismatch' } });
    return wantsJson(req) ? res.status(403).json({ error: '管理员密码错误' }) : res.redirect('/admin/backups?err=password');
  }
  try {
    const result = await restoreBackup(req.params.id);
    logAudit(db, req, { action: 'backup.restore', entityType: 'backup', entityId: req.params.id, summary: { safetyBackupId: result.safety.id } });
    if (wantsJson(req)) return res.json({ ok: true, safetyBackupId: result.safety.id });
    return res.redirect('/admin/login?restored=1');
  } catch (error) {
    logAudit(db, req, { action: 'backup.restore', entityType: 'backup', entityId: req.params.id, outcome: 'failure', summary: { reason: error.message } });
    if (wantsJson(req)) return res.status(500).json({ error: error.message });
    return res.redirect('/admin/backups?err=restore');
  }
});

router.post('/backups/settings', requireAdmin, (req, res) => {
  const intervalHours = Math.min(720, Math.max(1, Number.parseInt(req.body.interval_hours, 10) || 24));
  const retentionCount = Math.min(100, Math.max(1, Number.parseInt(req.body.retention_count, 10) || 10));
  const save = db.transaction(() => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('backup_schedule_enabled', req.body.schedule_enabled === '1' ? '1' : '0');
    stmt.run('backup_interval_hours', String(intervalHours));
    stmt.run('backup_retention_count', String(retentionCount));
  });
  save();
  logAudit(db, req, { action: 'backup.settings_update', entityType: 'backup', summary: { enabled: req.body.schedule_enabled === '1', intervalHours, retentionCount } });
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect('/admin/backups?ok=settings');
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

async function loadMediaFiles() {
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
      const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      media.push({ url, folder, name: entry.name, size: stat.size, updatedAt: stat.mtime, usedBy, hash, abs });
    });
  });
  const hashCounts = media.reduce((counts, item) => { counts[item.hash] = (counts[item.hash] || 0) + 1; return counts; }, {});
  await Promise.all(media.map(async (item) => {
    try {
      const metadata = await sharp(item.abs).metadata();
      item.width = metadata.width || 0;
      item.height = metadata.height || 0;
      item.format = metadata.format || path.extname(item.name).slice(1);
    } catch {
      item.width = 0; item.height = 0; item.format = path.extname(item.name).slice(1);
    }
    item.duplicate = hashCounts[item.hash] > 1;
    item.needsOptimization = item.size > 500 * 1024 || item.width > 1920;
    delete item.abs;
  }));
  return media.sort((a, b) => b.updatedAt - a.updatedAt);
}

router.get('/media', requireAdmin, async (req, res, next) => {
  const errorMap = {
    upload: '上传失败，仅支持 8MB 以内且内容真实的图片。',
    empty: '请选择要上传的图片。',
    used: '图片仍被文章、作品或站点设置引用，无法删除。',
    invalid: '图片路径无效。'
  };
  try {
    const media = await loadMediaFiles();
    res.render('admin/media', {
      title: '媒体库 — aeoleaf', media,
      notice: req.query.ok === 'uploaded' ? '图片已上传' : req.query.ok === 'deleted' ? '图片已删除' : req.query.ok === 'optimized' ? '已生成 WebP 优化副本' : null,
      mediaError: errorMap[req.query.err] || null
    });
  } catch (error) { next(error); }
});

router.post('/media/upload', requireAdmin, parseMediaUpload, (req, res) => {
  const url = `/uploads/general/${req.file.filename}`;
  logAudit(db, req, { action: 'media.create', entityType: 'media', entityId: url, summary: { url, size: req.file.size } });
  if (wantsJson(req)) return res.json({ ok: true, notice: '图片已上传' });
  res.redirect('/admin/media?ok=uploaded');
});

router.post('/media/delete', requireAdmin, async (req, res) => {
  const url = String(req.body.url || '').trim();
  const item = (await loadMediaFiles()).find((file) => file.url === url);
  if (!item) return wantsJson(req) ? res.status(400).json({ error: '图片路径无效' }) : res.redirect('/admin/media?err=invalid');
  if (item.usedBy.length) return wantsJson(req) ? res.status(409).json({ error: '图片仍被内容引用，无法删除' }) : res.redirect('/admin/media?err=used');
  if (!trashMedia(db, req, url, { reason: 'media_library' })) return wantsJson(req) ? res.status(400).json({ error: '图片删除失败' }) : res.redirect('/admin/media?err=invalid');
  if (wantsJson(req)) return res.json({ ok: true, notice: '图片已移入回收站' });
  res.redirect('/admin/media?ok=deleted');
});

router.post('/media/optimize', requireAdmin, async (req, res) => {
  const url = String(req.body.url || '').trim();
  const item = (await loadMediaFiles()).find((file) => file.url === url);
  if (!item) return wantsJson(req) ? res.status(400).json({ error: '图片路径无效' }) : res.redirect('/admin/media?err=invalid');
  const source = path.resolve(__dirname, '../public', item.url.replace(/^\//, ''));
  const sourceRoot = path.resolve(__dirname, '../public/uploads');
  if (!source.startsWith(sourceRoot + path.sep)) return res.status(400).json({ error: '图片路径无效' });
  const parsed = path.parse(source);
  const output = path.join(parsed.dir, `${parsed.name}-optimized-${Date.now()}.webp`);
  try {
    await sharp(source).rotate().resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toFile(output);
    const optimizedUrl = `/uploads/${item.folder}/${path.basename(output)}`;
    const optimizedSize = fs.statSync(output).size;
    logAudit(db, req, { action: 'media.optimize', entityType: 'media', entityId: optimizedUrl, summary: { source: item.url, originalSize: item.size, optimizedSize } });
    if (wantsJson(req)) return res.json({ ok: true, url: optimizedUrl, originalSize: item.size, optimizedSize });
    return res.redirect('/admin/media?ok=optimized');
  } catch (error) {
    try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {}
    return wantsJson(req) ? res.status(400).json({ error: '图片优化失败' }) : res.redirect('/admin/media?err=upload');
  }
});

// ─── SEO control center ─────────────────────────────────────────────────────

function inspectPostSeo(post) {
  const title = String(post.seo_title || post.title || '').trim();
  const description = String(post.seo_description || post.excerpt || '').trim();
  const image = String(post.og_image || post.cover_image || '').trim();
  const issues = [];
  if (!description) issues.push('缺少描述');
  else if (description.length < 50) issues.push('描述偏短');
  else if (description.length > 160) issues.push('描述超过 160 字');
  if (title.length < 10) issues.push('标题偏短');
  else if (title.length > 60) issues.push('标题超过 60 字');
  if (!image) issues.push('缺少分享图');
  if (post.canonical_url && !/^(https?:\/\/|\/)/i.test(post.canonical_url)) issues.push('Canonical 格式无效');
  return { ...post, seoTitle: title, seoDescription: description, seoImage: image, issues };
}

router.get('/seo', requireAdmin, (req, res) => {
  const posts = db.prepare("SELECT * FROM posts WHERE deleted_at = '' ORDER BY status DESC, updated_at DESC").all().map(inspectPostSeo);
  const published = posts.filter((post) => post.status === 'published');
  res.render('admin/seo', {
    title: 'SEO 控制中心 — aeoleaf',
    settings: loadSettingsMap(),
    posts,
    metrics: {
      published: published.length,
      healthy: published.filter((post) => !post.issues.length && !post.noindex).length,
      issues: published.reduce((sum, post) => sum + post.issues.length, 0),
      excluded: published.filter((post) => post.noindex).length
    },
    notice: req.query.ok === '1' ? 'SEO 默认设置已保存' : null
  });
});

router.post('/seo/settings', requireAdmin, (req, res) => {
  const description = String(req.body.seo_default_description || '').trim().slice(0, 300);
  const image = String(req.body.seo_default_og_image || '').trim().slice(0, 2000);
  const save = db.transaction(() => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('seo_default_description', description);
    stmt.run('seo_default_og_image', image);
  });
  save();
  logAudit(db, req, { action: 'seo.settings_update', entityType: 'settings', summary: { descriptionLength: description.length, hasDefaultImage: !!image } });
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect('/admin/seo?ok=1');
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
      'trash_retention_days',
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
      if (Object.prototype.hasOwnProperty.call(b, 'trash_retention_days')) {
        const retentionDays = Math.min(3650, Math.max(1, Number.parseInt(b.trash_retention_days, 10) || 30));
        stmt.run('trash_retention_days', String(retentionDays));
        stmt.run('trash_retention_enabled', b.trash_retention_enabled === '1' ? '1' : '0');
      }
      if (Object.prototype.hasOwnProperty.call(b, 'social_links')) stmt.run('social_links', socialVal);
    });
    update();
    logAudit(db, req, { action: 'settings.update', entityType: 'settings', summary: { keys: keys.filter((key) => Object.prototype.hasOwnProperty.call(b, key)) } });
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
    const view = req.query.view === 'detail' ? 'detail' : 'sessions';

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

router.get('/visitors/advanced', requireAdmin, (req, res, next) => {
  try {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const analytics = getAdvancedAnalytics(db, days);
    res.render('admin/visitors-advanced', { title: '高级访客分析 — aeoleaf', analytics });
  } catch (error) { next(error); }
});

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
    const adminVisit = String(visitor.path || '').startsWith('/admin/');
    const scopedPathRows = pathRows.filter((row) => String(row.path || '').startsWith('/admin/') === adminVisit);

    res.render('admin/visitor-detail', {
      title: `访客 #${visitor.id} — aeoleaf`,
      visitor,
      session,
      pathRows: scopedPathRows
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
