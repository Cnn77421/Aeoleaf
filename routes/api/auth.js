const router = require('express').Router();
const crypto = require('crypto');
const { rateLimit } = require('../../middleware/rateLimit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many login attempts, try again later',
  keyPrefix: 'login:'
});

router.post('/login', loginLimiter, (req, res, next) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const adminPass = process.env.ADMIN_PASSWORD || '';

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!adminPass) {
    return res.status(401).json({ error: 'Admin login disabled' });
  }

  let match = false;
  try {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(adminPass, 'utf8');
    if (a.length !== b.length) {
      const filler = Buffer.alloc(b.length);
      crypto.timingSafeEqual(filler, b);
      match = false;
    } else {
      match = crypto.timingSafeEqual(a, b);
    }
  } catch {
    match = false;
  }

  if (!match) return res.status(401).json({ error: 'Incorrect password' });

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.admin = true;
    req.session.save((err2) => {
      if (err2) return next(err2);
      res.json({ ok: true });
    });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/status', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.admin) });
});

module.exports = router;
