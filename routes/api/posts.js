const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadPost, uploadGeneral, wrapUpload } = require('../../middleware/upload');
const { trashMedia } = require('../../lib/trash');
const { logAudit } = require('../../lib/auditLog');
const { snapshotFor, saveVersion, listVersions, getVersion } = require('../../lib/contentVersions');
const { createPreviewToken } = require('../../lib/previewToken');
const { localTimestamp } = require('../../lib/publishScheduler');

function makeSlug(title) {
  return slugify(title, { lower: true, strict: true, locale: 'en' }) ||
    'post-' + Date.now();
}

function parseTags(tags) {
  if (!tags) return '[]';
  if (Array.isArray(tags)) return JSON.stringify(tags);
  if (typeof tags === 'string') {
    try { return JSON.stringify(JSON.parse(tags)); } catch {}
    return JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean));
  }
  return '[]';
}

function normalizeDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const normalized = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6] || '00'}`;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`);
  if (Number.isNaN(parsed.getTime()) || localTimestamp(parsed) !== normalized) return null;
  return normalized;
}

function publishingFields(body, post = null) {
  const requestedStatus = body.status === undefined ? (post?.scheduled_at ? 'scheduled' : post?.status || 'draft') : String(body.status);
  if (!['draft', 'published', 'scheduled'].includes(requestedStatus)) {
    return { error: '无效的发布状态' };
  }
  const scheduledAt = normalizeDateTime(body.scheduled_at === undefined ? post?.scheduled_at : body.scheduled_at);
  const unpublishAt = normalizeDateTime(body.unpublish_at === undefined ? post?.unpublish_at : body.unpublish_at);
  if (scheduledAt === null || unpublishAt === null) return { error: '发布时间格式无效' };
  if (requestedStatus === 'scheduled' && !scheduledAt) return { error: '预约发布需要设置发布时间' };
  if (requestedStatus === 'scheduled' && scheduledAt <= localTimestamp()) return { error: '预约发布时间必须晚于当前时间' };
  if (unpublishAt && requestedStatus === 'scheduled' && unpublishAt <= scheduledAt) return { error: '自动下线时间必须晚于预约发布时间' };
  if (unpublishAt && requestedStatus === 'published' && unpublishAt <= localTimestamp()) return { error: '自动下线时间必须晚于当前时间' };
  const status = requestedStatus === 'scheduled' ? 'draft' : requestedStatus;
  return {
    status,
    scheduledAt: requestedStatus === 'scheduled' ? scheduledAt : '',
    unpublishAt: requestedStatus === 'draft' ? '' : unpublishAt,
    publishedAt: status === 'published' ? (post?.published_at || localTimestamp()) : (post?.published_at || '')
  };
}

function optionalPostCover(req, res, next) {
  const ct = req.headers['content-type'] || '';
  if (ct.indexOf('multipart/form-data') === 0) {
    return wrapUpload(uploadPost.single('cover'))(req, res, next);
  }
  next();
}

function isAdmin(req) {
  return !!(req.session && req.session.admin === true);
}

function postDraft(post, body) {
  return {
    ...snapshotFor('post', post),
    title: body.title ?? post.title,
    slug: body.slug ?? post.slug,
    excerpt: body.excerpt ?? post.excerpt,
    content: body.content ?? post.content,
    tags: body.tags === undefined ? post.tags : parseTags(body.tags),
    status: body.status ?? post.status,
    scheduled_at: body.scheduled_at ?? post.scheduled_at,
    unpublish_at: body.unpublish_at ?? post.unpublish_at,
    published_at: post.published_at
    ,seo_title: body.seo_title ?? post.seo_title
    ,seo_description: body.seo_description ?? post.seo_description
    ,canonical_url: body.canonical_url ?? post.canonical_url
    ,og_image: body.og_image ?? post.og_image
    ,noindex: body.noindex === undefined ? post.noindex : (body.noindex === true || body.noindex === 1 || body.noindex === '1' ? 1 : 0)
  };
}

// GET /api/posts — list posts
router.get('/', (req, res) => {
  const admin = isAdmin(req);
  const { status, tag } = req.query;
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  let query = "SELECT * FROM posts WHERE deleted_at = ''";
  const params = [];

  if (admin) {
    if (status) { query += ' AND status = ?'; params.push(status); }
  } else {
    query += " AND status = 'published'";
  }
  if (tag) { query += ' AND tags LIKE ?'; params.push(`%"${tag}"%`); }

  const total = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as cnt')).get(...params).cnt;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const posts = db.prepare(query).all(...params).map(p => ({
    ...p,
    tags: JSON.parse(p.tags || '[]')
  }));

  res.json({ posts, total, page: pageNum, limit: limitNum });
});

router.get('/:id/revisions', requireAdmin, (req, res) => {
  const post = db.prepare("SELECT id FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  res.json({ revisions: listVersions(db, 'post', post.id) });
});

router.post('/:id/autosave', requireAdmin, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const result = saveVersion(db, 'post', post.id, postDraft(post, req.body || {}), 'autosave', req.sessionID);
  res.json({ ok: true, saved: result.created });
});

router.post('/:id/revisions/:versionId/restore', requireAdmin, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  const version = getVersion(db, 'post', post.id, req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  const snap = version.snapshot;
  const conflict = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(snap.slug, post.id);
  if (conflict) return res.status(409).json({ error: '该历史版本的 URL 别名已被占用' });
  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_restore', req.sessionID);
  db.prepare(`UPDATE posts SET title=?, slug=?, excerpt=?, content=?, cover_image=?, tags=?, status=?, scheduled_at=?, unpublish_at=?, published_at=?, seo_title=?, seo_description=?, canonical_url=?, og_image=?, noindex=?, content_revision=content_revision+1, updated_at=datetime('now') WHERE id=?`)
    .run(snap.title, snap.slug, snap.excerpt || '', snap.content || '', snap.cover_image || '', snap.tags || '[]', snap.status || 'draft', snap.scheduled_at || '', snap.unpublish_at || '', snap.published_at || '', snap.seo_title || '', snap.seo_description || '', snap.canonical_url || '', snap.og_image || '', Number(snap.noindex) ? 1 : 0, post.id);
  logAudit(db, req, { action: 'post.restore', entityType: 'post', entityId: post.id, summary: { versionId: version.id } });
  res.json({ ok: true });
});

router.post('/:id/preview-token', requireAdmin, (req, res) => {
  const post = db.prepare("SELECT id, slug FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const ttlSeconds = 60 * 60;
  const token = createPreviewToken(post.id, ttlSeconds);
  logAudit(db, req, { action: 'post.preview_link', entityType: 'post', entityId: post.id, summary: { expiresIn: ttlSeconds } });
  res.json({ url: `/preview/posts/${post.id}?token=${encodeURIComponent(token)}`, expiresIn: ttlSeconds });
});

// GET /api/posts/:slug
router.get('/:slug', (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE slug = ? AND deleted_at = ''").get(req.params.slug);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (!isAdmin(req) && post.status !== 'published') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ ...post, tags: JSON.parse(post.tags || '[]') });
});

// POST /api/posts — create (JSON or multipart with optional `cover`)
router.post('/', requireAdmin, optionalPostCover, (req, res) => {
  const { title, slug, excerpt, content, tags, seo_title, seo_description, canonical_url, og_image } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const finalSlug = slug || makeSlug(title);
  const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(finalSlug);
  if (existing) return res.status(409).json({ error: 'Slug already exists' });
  const publishing = publishingFields(req.body);
  if (publishing.error) return res.status(400).json({ error: publishing.error });

  const result = db.prepare(
    `INSERT INTO posts (title, slug, excerpt, content, tags, status, scheduled_at, unpublish_at, published_at, seo_title, seo_description, canonical_url, og_image, noindex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(title, finalSlug, excerpt || '', content || '', parseTags(tags), publishing.status, publishing.scheduledAt, publishing.unpublishAt, publishing.publishedAt, seo_title || '', seo_description || '', canonical_url || '', og_image || '', req.body.noindex === '1' || req.body.noindex === true ? 1 : 0);

  const newId = result.lastInsertRowid;
  if (req.file) {
    const coverUrl = '/uploads/posts/' + req.file.filename;
    db.prepare('UPDATE posts SET cover_image = ? WHERE id = ?').run(coverUrl, newId);
  }

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(newId);
  saveVersion(db, 'post', newId, snapshotFor('post', post), 'created', req.sessionID);
  logAudit(db, req, { action: 'post.create', entityType: 'post', entityId: newId, summary: { title: post.title, slug: post.slug, status: post.status } });
  res.status(201).json({ ...post, tags: JSON.parse(post.tags || '[]') });
});

// PUT /api/posts/:id — update (JSON or multipart with optional `cover`)
router.put('/:id', requireAdmin, optionalPostCover, (req, res) => {
  const { title, slug, excerpt, content, tags, seo_title, seo_description, canonical_url, og_image } = req.body;
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (req.body.content_revision && Number(req.body.content_revision) !== Number(post.content_revision)) {
    return res.status(409).json({ error: '文章已在其他页面被修改，请刷新后合并更改', code: 'EDIT_CONFLICT', currentUpdatedAt: post.updated_at });
  }

  const newSlug = slug || post.slug;
  if (newSlug !== post.slug) {
    const existing = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(newSlug, post.id);
    if (existing) return res.status(409).json({ error: 'Slug already exists' });
  }
  const publishing = publishingFields(req.body, post);
  if (publishing.error) return res.status(400).json({ error: publishing.error });

  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_save', req.sessionID);

  db.prepare(
    `UPDATE posts SET title=?, slug=?, excerpt=?, content=?, tags=?, status=?, scheduled_at=?, unpublish_at=?, published_at=?, seo_title=?, seo_description=?, canonical_url=?, og_image=?, noindex=?, content_revision=content_revision+1, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    title ?? post.title,
    newSlug,
    excerpt ?? post.excerpt,
    content ?? post.content,
    parseTags(tags ?? post.tags),
    publishing.status,
    publishing.scheduledAt,
    publishing.unpublishAt,
    publishing.publishedAt,
    seo_title ?? post.seo_title,
    seo_description ?? post.seo_description,
    canonical_url ?? post.canonical_url,
    og_image ?? post.og_image,
    req.body.noindex === true || req.body.noindex === 1 || req.body.noindex === '1' ? 1 : 0,
    post.id
  );

  if (req.file) {
    if (post.cover_image) trashMedia(db, req, post.cover_image, { reason: 'cover_replaced', postId: post.id });
    const coverUrl = '/uploads/posts/' + req.file.filename;
    db.prepare("UPDATE posts SET cover_image = ?, updated_at = datetime('now') WHERE id = ?").run(coverUrl, post.id);
  }

  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  logAudit(db, req, { action: 'post.update', entityType: 'post', entityId: post.id, summary: { title: updated.title, slug: updated.slug, status: updated.status } });
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]') });
});

// DELETE /api/posts/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_delete', req.sessionID);
  const tombstoneSlug = `__trash_post_${post.id}_${Date.now()}`;
  db.prepare("UPDATE posts SET deleted_at = datetime('now', 'localtime'), deleted_slug = slug, slug = ?, updated_at = datetime('now') WHERE id = ?")
    .run(tombstoneSlug, post.id);
  logAudit(db, req, { action: 'post.delete', entityType: 'post', entityId: post.id, summary: { title: post.title, slug: post.slug } });
  res.json({ ok: true });
});

// POST /api/posts/:id/cover — upload cover image
router.post('/:id/cover', requireAdmin, wrapUpload(uploadPost.single('cover')), (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_cover', req.sessionID);
  if (post.cover_image) trashMedia(db, req, post.cover_image, { reason: 'cover_replaced', postId: post.id });
  const url = '/uploads/posts/' + req.file.filename;
  db.prepare("UPDATE posts SET cover_image = ?, updated_at = datetime('now') WHERE id = ?").run(url, post.id);
  logAudit(db, req, { action: 'post.cover_update', entityType: 'post', entityId: post.id, summary: { url } });
  res.json({ url });
});

// POST /api/posts/upload-image — inline image for EasyMDE
router.post('/upload-image', requireAdmin, wrapUpload(uploadGeneral.single('image')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = '/uploads/general/' + req.file.filename;
  logAudit(db, req, { action: 'media.create', entityType: 'media', entityId: url, summary: { url, source: 'post_inline', size: req.file.size } });
  res.json({ url });
});

module.exports = router;
