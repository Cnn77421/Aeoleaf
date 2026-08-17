const router = require('express').Router();
const { db } = require('../../config/db');
const slugify = require('slugify');
const { requireAdmin } = require('../../middleware/auth');
const { uploadWork, wrapUpload } = require('../../middleware/upload');
const { trashMedia } = require('../../lib/trash');
const path = require('path');
const { logAudit } = require('../../lib/auditLog');
const { snapshotFor, saveVersion, listVersions, getVersion } = require('../../lib/contentVersions');

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

function workDraft(work, body) {
  return {
    ...snapshotFor('work', work),
    title: body.title ?? work.title,
    slug: body.slug ?? work.slug,
    description: body.description ?? work.description,
    content: body.content ?? work.content,
    tags: body.tags === undefined ? work.tags : parseTags(body.tags),
    url: body.url ?? work.url,
    year: body.year === undefined ? work.year : parseYearField(body.year),
    date: body.date ?? work.date,
    featured: body.featured === undefined ? work.featured : parseFeatured(body.featured),
    sort_order: body.sort_order ?? work.sort_order
  };
}

// GET /api/works
router.get('/', (req, res) => {
  const { featured, tag } = req.query;
  let query = "SELECT * FROM works WHERE deleted_at = ''";
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

router.get('/:id/revisions', requireAdmin, (req, res) => {
  const work = db.prepare("SELECT id FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  res.json({ revisions: listVersions(db, 'work', work.id) });
});

router.post('/:id/autosave', requireAdmin, (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  const result = saveVersion(db, 'work', work.id, workDraft(work, req.body || {}), 'autosave');
  res.json({ ok: true, saved: result.created });
});

router.post('/:id/revisions/:versionId/restore', requireAdmin, (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  const version = getVersion(db, 'work', work.id, req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  const snap = version.snapshot;
  const conflict = db.prepare('SELECT id FROM works WHERE slug = ? AND id != ?').get(snap.slug, work.id);
  if (conflict) return res.status(409).json({ error: '该历史版本的 URL 别名已被占用' });
  saveVersion(db, 'work', work.id, snapshotFor('work', work), 'before_restore');
  db.prepare(`UPDATE works SET title=?, slug=?, description=?, content=?, cover_image=?, images=?, tags=?, url=?, year=?, date=?, featured=?, sort_order=?, updated_at=datetime('now') WHERE id=?`)
    .run(snap.title, snap.slug, snap.description || '', snap.content || '', snap.cover_image || '', snap.images || '[]', snap.tags || '[]', snap.url || '', snap.year, snap.date || '', snap.featured ? 1 : 0, Number(snap.sort_order) || 0, work.id);
  logAudit(db, req, { action: 'work.restore', entityType: 'work', entityId: work.id, summary: { versionId: version.id } });
  res.json({ ok: true });
});

// GET /api/works/:slug
router.get('/:slug', (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE slug = ? AND deleted_at = ''").get(req.params.slug);
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
  saveVersion(db, 'work', newId, snapshotFor('work', work), 'created');
  logAudit(db, req, { action: 'work.create', entityType: 'work', entityId: newId, summary: { title: work.title, slug: work.slug } });
  res.status(201).json({ ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') });
});

// PUT /api/works/reorder (must be before PUT /:id)
router.put('/reorder', requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const stmt = db.prepare("UPDATE works SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at = ''");
  const update = db.transaction(() => order.forEach(({ id, sort_order }) => stmt.run(sort_order, id)));
  update();
  res.json({ ok: true });
});

// PUT /api/works/:id — JSON or multipart (optional `cover`)
router.put('/:id', requireAdmin, optionalWorkCover, (req, res) => {
  const { title, slug, description, content, tags, url, year, date, featured, sort_order } = req.body;
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  const newSlug = slug || work.slug;
  if (newSlug !== work.slug) {
    const existing = db.prepare('SELECT id FROM works WHERE slug = ? AND id != ?').get(newSlug, work.id);
    if (existing) return res.status(409).json({ error: 'Slug already exists' });
  }

  saveVersion(db, 'work', work.id, snapshotFor('work', work), 'before_save');

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
    `UPDATE works SET title=?, slug=?, description=?, content=?, tags=?, url=?, year=?, date=?, featured=?, sort_order=?, updated_at=datetime('now')
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
    if (work.cover_image) trashMedia(db, req, work.cover_image, { reason: 'cover_replaced', workId: work.id });
    const coverUrl = '/uploads/works/' + req.file.filename;
    db.prepare("UPDATE works SET cover_image = ?, updated_at = datetime('now') WHERE id = ?").run(coverUrl, work.id);
  }

  const updated = db.prepare('SELECT * FROM works WHERE id = ?').get(work.id);
  logAudit(db, req, { action: 'work.update', entityType: 'work', entityId: work.id, summary: { title: updated.title, slug: updated.slug } });
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), images: JSON.parse(updated.images || '[]') });
});

// DELETE /api/works/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });

  saveVersion(db, 'work', work.id, snapshotFor('work', work), 'before_delete');
  const tombstoneSlug = `__trash_work_${work.id}_${Date.now()}`;
  db.prepare("UPDATE works SET deleted_at = datetime('now', 'localtime'), deleted_slug = slug, slug = ?, updated_at = datetime('now') WHERE id = ?")
    .run(tombstoneSlug, work.id);
  logAudit(db, req, { action: 'work.delete', entityType: 'work', entityId: work.id, summary: { title: work.title, slug: work.slug } });
  res.json({ ok: true });
});

// POST /api/works/:id/cover
router.post('/:id/cover', requireAdmin, wrapUpload(uploadWork.single('cover')), (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  saveVersion(db, 'work', work.id, snapshotFor('work', work), 'before_cover');
  if (work.cover_image) trashMedia(db, req, work.cover_image, { reason: 'cover_replaced', workId: work.id });
  const url = '/uploads/works/' + req.file.filename;
  db.prepare("UPDATE works SET cover_image = ?, updated_at = datetime('now') WHERE id = ?").run(url, work.id);
  logAudit(db, req, { action: 'work.cover_update', entityType: 'work', entityId: work.id, summary: { url } });
  res.json({ url });
});

// POST /api/works/:id/images — add additional images
router.post('/:id/images', requireAdmin, wrapUpload(uploadWork.array('images', 10)), (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });

  const existing = JSON.parse(work.images || '[]');
  const newUrls = req.files.map(f => '/uploads/works/' + f.filename);
  db.prepare("UPDATE works SET images = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify([...existing, ...newUrls]), work.id
  );
  logAudit(db, req, { action: 'media.create', entityType: 'media', entityId: work.id, summary: { urls: newUrls, source: 'work_images' } });
  res.json({ urls: newUrls });
});

// DELETE /api/works/:id/images/:filename
router.delete('/:id/images/:filename', requireAdmin, (req, res) => {
  const work = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at = ''").get(req.params.id);
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
  db.prepare("UPDATE works SET images = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(remaining), work.id);
  trashMedia(db, req, imgUrl, { reason: 'work_image_removed', workId: work.id });
  res.json({ ok: true });
});

module.exports = router;
