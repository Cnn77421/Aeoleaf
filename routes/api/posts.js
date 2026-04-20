const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadPost, uploadGeneral, wrapUpload } = require('../../middleware/upload');
const { unlinkPublicUpload } = require('../../lib/safeFs');

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

// GET /api/posts — list posts
router.get('/', (req, res) => {
  const admin = isAdmin(req);
  const { status, tag } = req.query;
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  let query = 'SELECT * FROM posts WHERE 1=1';
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

// GET /api/posts/:slug
router.get('/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
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
  res.status(201).json({ ...post, tags: JSON.parse(post.tags || '[]') });
});

// PUT /api/posts/:id — update (JSON or multipart with optional `cover`)
router.put('/:id', requireAdmin, optionalPostCover, (req, res) => {
  const { title, slug, excerpt, content, tags, status } = req.body;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  const newSlug = slug || post.slug;
  if (newSlug !== post.slug) {
    const existing = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(newSlug, post.id);
    if (existing) return res.status(409).json({ error: 'Slug already exists' });
  }

  db.prepare(
    `UPDATE posts SET title=?, slug=?, excerpt=?, content=?, tags=?, status=?
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
    unlinkPublicUpload(post.cover_image);
    const coverUrl = '/uploads/posts/' + req.file.filename;
    db.prepare('UPDATE posts SET cover_image = ? WHERE id = ?').run(coverUrl, post.id);
  }

  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]') });
});

// DELETE /api/posts/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  unlinkPublicUpload(post.cover_image);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// POST /api/posts/:id/cover — upload cover image
router.post('/:id/cover', requireAdmin, wrapUpload(uploadPost.single('cover')), (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  unlinkPublicUpload(post.cover_image);
  const url = '/uploads/posts/' + req.file.filename;
  db.prepare('UPDATE posts SET cover_image = ? WHERE id = ?').run(url, post.id);
  res.json({ url });
});

// POST /api/posts/upload-image — inline image for EasyMDE
router.post('/upload-image', requireAdmin, wrapUpload(uploadGeneral.single('image')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/general/' + req.file.filename });
});

module.exports = router;
