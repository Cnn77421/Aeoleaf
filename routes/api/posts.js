const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadPost, uploadGeneral, wrapUpload } = require('../../middleware/upload');
const { trashMedia } = require('../../lib/trash');
const { logAudit } = require('../../lib/auditLog');
const { snapshotFor, saveVersion, listVersions, getVersion } = require('../../lib/contentVersions');

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
    status: body.status ?? post.status
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
  const result = saveVersion(db, 'post', post.id, postDraft(post, req.body || {}), 'autosave');
  res.json({ ok: true, saved: result.created });
});

router.post('/:id/revisions/:versionId/restore', requireAdmin, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const version = getVersion(db, 'post', post.id, req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  const snap = version.snapshot;
  const conflict = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(snap.slug, post.id);
  if (conflict) return res.status(409).json({ error: '该历史版本的 URL 别名已被占用' });
  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_restore');
  db.prepare(`UPDATE posts SET title=?, slug=?, excerpt=?, content=?, cover_image=?, tags=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(snap.title, snap.slug, snap.excerpt || '', snap.content || '', snap.cover_image || '', snap.tags || '[]', snap.status || 'draft', post.id);
  logAudit(db, req, { action: 'post.restore', entityType: 'post', entityId: post.id, summary: { versionId: version.id } });
  res.json({ ok: true });
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
  const { title, slug, excerpt, content, tags, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const finalSlug = slug || makeSlug(title);
  const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(finalSlug);
  if (existing) return res.status(409).json({ error: 'Slug already exists' });

  const result = db.prepare(
    `INSERT INTO posts (title, slug, excerpt, content, tags, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(title, finalSlug, excerpt || '', content || '', parseTags(tags), status || 'draft');

  const newId = result.lastInsertRowid;
  if (req.file) {
    const coverUrl = '/uploads/posts/' + req.file.filename;
    db.prepare('UPDATE posts SET cover_image = ? WHERE id = ?').run(coverUrl, newId);
  }

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(newId);
  saveVersion(db, 'post', newId, snapshotFor('post', post), 'created');
  logAudit(db, req, { action: 'post.create', entityType: 'post', entityId: newId, summary: { title: post.title, slug: post.slug, status: post.status } });
  res.status(201).json({ ...post, tags: JSON.parse(post.tags || '[]') });
});

// PUT /api/posts/:id — update (JSON or multipart with optional `cover`)
router.put('/:id', requireAdmin, optionalPostCover, (req, res) => {
  const { title, slug, excerpt, content, tags, status } = req.body;
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  const newSlug = slug || post.slug;
  if (newSlug !== post.slug) {
    const existing = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(newSlug, post.id);
    if (existing) return res.status(409).json({ error: 'Slug already exists' });
  }

  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_save');

  db.prepare(
    `UPDATE posts SET title=?, slug=?, excerpt=?, content=?, tags=?, status=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    title ?? post.title,
    newSlug,
    excerpt ?? post.excerpt,
    content ?? post.content,
    parseTags(tags ?? post.tags),
    status ?? post.status,
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

  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_delete');
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

  saveVersion(db, 'post', post.id, snapshotFor('post', post), 'before_cover');
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
