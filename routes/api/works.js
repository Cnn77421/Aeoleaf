const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadWork, wrapUpload } = require('../../middleware/upload');
const { unlinkPublicUpload } = require('../../lib/safeFs');
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

function optionalWorkCover(req, res, next) {
  const ct = req.headers['content-type'] || '';
  if (ct.indexOf('multipart/form-data') === 0) {
    return wrapUpload(uploadWork.single('cover'))(req, res, next);
  }
  next();
}

function parseFeatured(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  return 0;
}

function parseYearField(y) {
  if (y === undefined || y === null || y === '') return null;
  const n = parseInt(String(y), 10);
  return Number.isFinite(n) ? n : null;
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

// POST /api/works — JSON or multipart/form-data (optional field `cover`)
router.post('/', requireAdmin, optionalWorkCover, (req, res) => {
  const { title, slug, description, content, tags, url, year, date, featured, sort_order } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const finalSlug = slug || makeSlug(title);
  const existing = db.prepare('SELECT id FROM works WHERE slug = ?').get(finalSlug);
  if (existing) return res.status(409).json({ error: 'Slug already exists' });

  const feat = featured !== undefined ? parseFeatured(featured) : 0;
  const yr = year !== undefined && year !== '' ? parseYearField(year) : null;
  const so = sort_order !== undefined && sort_order !== '' ? parseInt(String(sort_order), 10) : 0;

  const result = db.prepare(
    `INSERT INTO works (title, slug, description, content, tags, url, year, date, featured, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title, finalSlug, description || '', content || '', parseTags(tags),
    url || '', yr, date || '',
    feat,
    Number.isFinite(so) ? so : 0
  );

  const newId = result.lastInsertRowid;
  if (req.file) {
    const coverUrl = '/uploads/works/' + req.file.filename;
    db.prepare('UPDATE works SET cover_image = ? WHERE id = ?').run(coverUrl, newId);
  }

  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(newId);
  res.status(201).json({ ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') });
});

// PUT /api/works/reorder (must be before PUT /:id)
router.put('/reorder', requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const stmt = db.prepare('UPDATE works SET sort_order = ? WHERE id = ?');
  const update = db.transaction(() => order.forEach(({ id, sort_order }) => stmt.run(sort_order, id)));
  update();
  res.json({ ok: true });
});

// PUT /api/works/:id — JSON or multipart (optional `cover`)
router.put('/:id', requireAdmin, optionalWorkCover, (req, res) => {
  const { title, slug, description, content, tags, url, year, date, featured, sort_order } = req.body;
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  const newSlug = slug || work.slug;
  if (newSlug !== work.slug) {
    const existing = db.prepare('SELECT id FROM works WHERE slug = ? AND id != ?').get(newSlug, work.id);
    if (existing) return res.status(409).json({ error: 'Slug already exists' });
  }

  let yearVal = work.year;
  if (year !== undefined) {
    if (year === null || year === '') yearVal = null;
    else yearVal = parseYearField(year);
  }
  const featVal = featured !== undefined ? parseFeatured(featured) : work.featured;
  const soVal = sort_order !== undefined && sort_order !== ''
    ? parseInt(String(sort_order), 10)
    : work.sort_order;

  db.prepare(
    `UPDATE works SET title=?, slug=?, description=?, content=?, tags=?, url=?, year=?, date=?, featured=?, sort_order=?
     WHERE id=?`
  ).run(
    title ?? work.title, newSlug,
    description ?? work.description, content ?? work.content,
    parseTags(tags ?? work.tags),
    url ?? work.url,
    yearVal,
    date ?? work.date,
    featVal,
    Number.isFinite(soVal) ? soVal : work.sort_order,
    work.id
  );

  if (req.file) {
    unlinkPublicUpload(work.cover_image);
    const coverUrl = '/uploads/works/' + req.file.filename;
    db.prepare('UPDATE works SET cover_image = ? WHERE id = ?').run(coverUrl, work.id);
  }

  const updated = db.prepare('SELECT * FROM works WHERE id = ?').get(work.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), images: JSON.parse(updated.images || '[]') });
});

// DELETE /api/works/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  const images = JSON.parse(work.images || '[]');
  [work.cover_image, ...images].filter(Boolean).forEach(unlinkPublicUpload);

  db.prepare('DELETE FROM works WHERE id = ?').run(work.id);
  res.json({ ok: true });
});

// POST /api/works/:id/cover
router.post('/:id/cover', requireAdmin, wrapUpload(uploadWork.single('cover')), (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  unlinkPublicUpload(work.cover_image);
  const url = '/uploads/works/' + req.file.filename;
  db.prepare('UPDATE works SET cover_image = ? WHERE id = ?').run(url, work.id);
  res.json({ url });
});

// POST /api/works/:id/images — add additional images
router.post('/:id/images', requireAdmin, wrapUpload(uploadWork.array('images', 10)), (req, res) => {
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

  // The filename must be a basename only — reject any attempt to escape the
  // uploads/works directory via `..`, leading slashes, or null bytes.
  const rawName = String(req.params.filename || '');
  if (!rawName || rawName !== path.basename(rawName) || rawName.indexOf('\0') !== -1) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const imgUrl = '/uploads/works/' + rawName;
  const images = JSON.parse(work.images || '[]');
  if (!images.includes(imgUrl)) {
    return res.status(404).json({ error: 'Image not attached to this work' });
  }

  const remaining = images.filter((i) => i !== imgUrl);
  db.prepare('UPDATE works SET images = ? WHERE id = ?').run(JSON.stringify(remaining), work.id);
  unlinkPublicUpload(imgUrl);
  res.json({ ok: true });
});

module.exports = router;
