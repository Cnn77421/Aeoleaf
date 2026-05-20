const router = require('express').Router();
const { db } = require('../../config/db');
const { rateLimit } = require('../../middleware/rateLimit');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: '留言太频繁，请稍后再试',
  keyPrefix: 'guestbook:'
});

// GET /api/guestbook — list all messages
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM guestbook ORDER BY created_at DESC').all();
  res.json(rows);
});

// POST /api/guestbook — submit a message
router.post('/', postLimiter, (req, res) => {
  const { name, message, avatar } = req.body || {};

  if (!name || !message) {
    return res.status(400).json({ error: '昵称和留言内容不能为空' });
  }

  const cleanName = DOMPurify.sanitize(String(name).trim()).slice(0, 50);
  const cleanMessage = DOMPurify.sanitize(String(message).trim()).slice(0, 500);
  const cleanAvatar = avatar ? DOMPurify.sanitize(String(avatar).trim()).slice(0, 200) : '';

  if (!cleanName || !cleanMessage) {
    return res.status(400).json({ error: '昵称和留言内容不能为空' });
  }

  const result = db.prepare(
    'INSERT INTO guestbook (name, message, avatar) VALUES (?, ?, ?)'
  ).run(cleanName, cleanMessage, cleanAvatar);

  const row = db.prepare('SELECT * FROM guestbook WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

module.exports = router;
