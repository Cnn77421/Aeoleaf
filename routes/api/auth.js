const router = require('express').Router();
const crypto = require('crypto');

router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || '';

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  let match = false;
  try {
    const a = Buffer.from(password.padEnd(adminPass.length));
    const b = Buffer.from(adminPass.padEnd(password.length));
    // Use timing-safe comparison on same-length buffers
    const len = Math.max(a.length, b.length);
    const ba = Buffer.alloc(len); a.copy(ba);
    const bb = Buffer.alloc(len); b.copy(bb);
    match = crypto.timingSafeEqual(ba, bb) && password.length === adminPass.length;
  } catch {
    match = false;
  }

  if (match) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/status', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.admin) });
});

module.exports = router;
