const express = require('express');
const router = express.Router();
const { db } = require('../../config/db');

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.json({ posts: [], works: [] });
    }

    const query = `%${q.trim()}%`;

    const posts = db.prepare(`
      SELECT id, title, slug, excerpt, created_at
      FROM posts
      WHERE status = 'published'
      AND (title LIKE ? OR content LIKE ?)
      ORDER BY created_at DESC
      LIMIT 20
    `).all(query, query);

    const works = db.prepare(`
      SELECT id, title, slug, description, cover_image, year
      FROM works
      WHERE title LIKE ? OR description LIKE ?
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
