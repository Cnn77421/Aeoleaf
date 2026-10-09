const router = require('express').Router();
const { db } = require('../../config/db');
const { rateLimit } = require('../../middleware/rateLimit');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const { parseSensitiveWords, detectGuestbookRisk } = require('../../lib/guestbookModeration');
const { logAudit } = require('../../lib/auditLog');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Guestbook entries are free text. Strip interactive/form elements so a
// submission cannot be repurposed for phishing (e.g. an external
// <form action>) or UI spoofing if the raw value is ever rendered elsewhere.
const SANITIZE_OPTIONS = {
  FORBID_TAGS: [
    'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'fieldset', 'legend',
    'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'style', 'template'
  ],
  FORBID_ATTR: ['action', 'formaction', 'style', 'srcset', 'ping']
};

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: '留言太频繁，请稍后再试',
  keyPrefix: 'guestbook:'
});

// GET /api/guestbook — list public messages
router.get('/', (req, res) => {
  const rows = db.prepare("SELECT * FROM guestbook WHERE status = 'approved' AND deleted_at = '' ORDER BY created_at DESC").all();
  res.json(rows);
});

// POST /api/guestbook — submit a message
router.post('/', postLimiter, (req, res) => {
  const { name, message, avatar } = req.body || {};

  if (!name || !message) {
    return res.status(400).json({ error: '昵称和留言内容不能为空' });
  }

  const cleanName = DOMPurify.sanitize(String(name).trim(), SANITIZE_OPTIONS).slice(0, 50);
  const cleanMessage = DOMPurify.sanitize(String(message).trim(), SANITIZE_OPTIONS).slice(0, 500);
  const cleanAvatar = avatar ? DOMPurify.sanitize(String(avatar).trim(), SANITIZE_OPTIONS).slice(0, 200) : '';

  if (!cleanName || !cleanMessage) {
    return res.status(400).json({ error: '昵称和留言内容不能为空' });
  }

  const sensitiveSetting = db.prepare("SELECT value FROM settings WHERE key = 'guestbook_sensitive_words'").get();
  const duplicate = db.prepare(`
    SELECT COUNT(*) AS cnt FROM guestbook
    WHERE name = ? AND message = ? AND deleted_at = '' AND created_at >= datetime('now', '-24 hours', 'localtime')
  `).get(cleanName, cleanMessage).cnt > 0;
  const riskFlags = detectGuestbookRisk({
    name: cleanName,
    message: cleanMessage,
    sensitiveWords: parseSensitiveWords(sensitiveSetting?.value),
    duplicate
  });
  const requestIp = String(req.ip || req.socket?.remoteAddress || '').slice(0, 100);

  const result = db.prepare(
    "INSERT INTO guestbook (name, message, avatar, status, risk_flags, ip) VALUES (?, ?, ?, 'pending', ?, ?)"
  ).run(cleanName, cleanMessage, cleanAvatar, JSON.stringify(riskFlags), requestIp);

  const row = db.prepare('SELECT * FROM guestbook WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, req, { action: 'guestbook.create', entityType: 'guestbook', entityId: row.id, summary: { name: row.name, status: row.status, riskFlags } });
  res.status(201).json(row);
});

module.exports = router;
