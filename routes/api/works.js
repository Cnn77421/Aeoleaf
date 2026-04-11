const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadWork } = require('../../middleware/upload');
const fs = require('fs');
const path = require('path');

function makeSlug(title) {
  return slugify(title, { lower: true, strict: true, locale: 'en' }) ||
    'work-' + Date.now();
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

// GET /api/works
router.get('/', (req, res) => {
  const { featured, tag } = req.query;
  let query = 'SELECT * FROM works WHERE 1=1';
  const params = [];

  if (featured !== undefined) { query += ' AND featured = ?'; params.push(parseInt(featured)); }
  if (tag) { query += ' AND tags LIKE ?'; params.push(`%"${tag}"%`); }
  query += ' ORDER BY sort_order ASC, created_at DESC';

  const works = db.prepare(query).all(...params).map(w => ({
    ...w,
    tags: JSON.parse(w.tags || '[]'),
    images: JSON.parse(w.images || '[]')
  }));
  res.json({ works });
});

// GET /api/works/:slug
router.get('/:slug', (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE slug = ?').get(req.params.slug);
  if (!work) return res.status(404).json({ error: 'Not found' });
  res.json({ ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') });
});

// POST /api/works
router.post('/', requireAdmin, (req, res) => {
  const { title, slug, description, content, tags, url, year, date, featured, sort_order } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const finalSlug = slug || makeSlug(title);
  const existing = db.prepare('SELECT id FROM works WHERE slug = ?').get(finalSlug);
  if (existing) return res.status(409).json({ error: 'Slug already exists' });

  const result = db.prepare(
    `INSERT INTO works (title, slug, description, content, tags, url, year, date, featured, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title, finalSlug, description || '', content || '', parseTags(tags),
    url || '', year ? parseInt(year) : null, date || '',
    featured ? 1 : 0, sort_order ? parseInt(sort_order) : 0
  );

  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') });
});

// PUT /api/works/:id
router.put('/:id', requireAdmin, (req, res) => {
  const { title, slug, description, content, tags, url, year, date, featured, sort_order } = req.body;
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  const newSlug = slug || work.slug;
  if (newSlug !== work.slug) {
    const existing = db.prepare('SELECT id FROM works WHERE slug = ? AND id != ?').get(newSlug, work.id);
    if (existing) return res.status(409).json({ error: 'Slug already exists' });
  }

  db.prepare(
    `UPDATE works SET title=?, slug=?, description=?, content=?, tags=?, url=?, year=?, date=?, featured=?, sort_order=?
     WHERE id=?`
  ).run(
    title ?? work.title, newSlug,
    description ?? work.description, content ?? work.content,
    parseTags(tags ?? work.tags),
    url ?? work.url,
    year !== undefined ? parseInt(year) : work.year,
    date ?? work.date,
    featured !== undefined ? (featured ? 1 : 0) : work.featured,
    sort_order !== undefined ? parseInt(sort_order) : work.sort_order,
    work.id
  );

  const updated = db.prepare('SELECT * FROM works WHERE id = ?').get(work.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), images: JSON.parse(updated.images || '[]') });
});

// DELETE /api/works/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  const images = JSON.parse(work.images || '[]');
  [work.cover_image, ...images].filter(Boolean).forEach(img => {
    const filePath = path.join(__dirname, '../../public', img);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  db.prepare('DELETE FROM works WHERE id = ?').run(work.id);
  res.json({ ok: true });
});

// POST /api/works/:id/cover
router.post('/:id/cover', requireAdmin, uploadWork.single('cover'), (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  if (work.cover_image) {
    const old = path.join(__dirname, '../../public', work.cover_image);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  const url = '/uploads/works/' + req.file.filename;
  db.prepare('UPDATE works SET cover_image = ? WHERE id = ?').run(url, work.id);
  res.json({ url });
});

// POST /api/works/:id/images — add additional images
router.post('/:id/images', requireAdmin, uploadWork.array('images', 10), (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });

  const existing = JSON.parse(work.images || '[]');
  const newUrls = req.files.map(f => '/uploads/works/' + f.filename);
  db.prepare('UPDATE works SET images = ? WHERE id = ?').run(
    JSON.stringify([...existing, ...newUrls]), work.id
  );
  res.json({ urls: newUrls });
});

// DELETE /api/works/:id/images/:filename
router.delete('/:id/images/:filename', requireAdmin, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  const filename = req.params.filename;
  const imgUrl = '/uploads/works/' + filename;
  const images = JSON.parse(work.images || '[]').filter(i => i !== imgUrl);
  db.prepare('UPDATE works SET images = ? WHERE id = ?').run(JSON.stringify(images), work.id);

  const filePath = path.join(__dirname, '../../public', imgUrl);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// PUT /api/works/reorder
router.put('/reorder', requireAdmin, (req, res) => {
  const { order } = req.body; // [{ id, sort_order }, ...]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const stmt = db.prepare('UPDATE works SET sort_order = ? WHERE id = ?');
  const update = db.transaction(() => order.forEach(({ id, sort_order }) => stmt.run(sort_order, id)));
  update();
  res.json({ ok: true });
});

module.exports = router;
