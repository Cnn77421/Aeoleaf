const express = require('express');
const router = express.Router();
const { db } = require('../../config/db');
const { rateLimit } = require('../../middleware/rateLimit');

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many search requests',
  keyPrefix: 'search:'
});

// Escape LIKE wildcards so user-supplied _ and % don't match everything.
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

router.get('/', searchLimiter, async (req, res) => {
  try {
    const raw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!raw) return res.json({ posts: [], works: [] });
    if (raw.length < 1 || raw.length > 100) {
      return res.json({ posts: [], works: [] });
    }

    const query = `%${escapeLike(raw)}%`;

    const posts = db.prepare(`
      SELECT id, title, slug, excerpt, created_at
      FROM posts
      WHERE status = 'published'
      AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC
      LIMIT 20
    `).all(query, query);

    const works = db.prepare(`
      SELECT id, title, slug, description, cover_image, year
      FROM works
      WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      ORDER BY sort_order ASC
      LIMIT 20
    `).all(query, query);

    res.json({ posts, works });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
