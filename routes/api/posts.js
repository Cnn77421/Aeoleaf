const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadPost, uploadGeneral } = require('../../middleware/upload');
const fs = require('fs');
const path = require('path');

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

// GET /api/posts — list posts
router.get('/', (req, res) => {
  const { status, tag, page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = 'SELECT * FROM posts WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (tag) { query += ' AND tags LIKE ?'; params.push(`%"${tag}"%`); }

  const total = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as cnt')).get(...params).cnt;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const posts = db.prepare(query).all(...params).map(p => ({
    ...p,
    tags: JSON.parse(p.tags || '[]')
  }));

  res.json({ posts, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/posts/:slug
router.get('/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
  if (!post) return res.status(404).json({ error: 'Not found' });
  res.json({ ...post, tags: JSON.parse(post.tags || '[]') });
});

// POST /api/posts — create
router.post('/', requireAdmin, (req, res) => {
  const { title, slug, excerpt, content, tags, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const finalSlug = slug || makeSlug(title);
  const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(finalSlug);
  if (existing) return res.status(409).json({ error: 'Slug already exists' });

  const result = db.prepare(
    `INSERT INTO posts (title, slug, excerpt, content, tags, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(title, finalSlug, excerpt || '', content || '', parseTags(tags), status || 'draft');

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...post, tags: JSON.parse(post.tags || '[]') });
});

// PUT /api/posts/:id — update
router.put('/:id', requireAdmin, (req, res) => {
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

  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]') });
});

// DELETE /api/posts/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  if (post.cover_image) {
    const filePath = path.join(__dirname, '../../public', post.cover_image);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// POST /api/posts/:id/cover — upload cover image
router.post('/:id/cover', requireAdmin, uploadPost.single('cover'), (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  if (post.cover_image) {
    const old = path.join(__dirname, '../../public', post.cover_image);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  const url = '/uploads/posts/' + req.file.filename;
  db.prepare('UPDATE posts SET cover_image = ? WHERE id = ?').run(url, post.id);
  res.json({ url });
});

// POST /api/posts/upload-image — inline image for EasyMDE
router.post('/upload-image', requireAdmin, uploadGeneral.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/general/' + req.file.filename });
});

module.exports = router;
