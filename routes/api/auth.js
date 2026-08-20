const router = require('express').Router();
const crypto = require('crypto');
const { rateLimit } = require('../../middleware/rateLimit');
const { db } = require('../../config/db');
const { logAudit } = require('../../lib/auditLog');
const { getLoginState, recordFailure, clearFailures, initializeSession } = require('../../lib/loginSecurity');
const passkeyService = require('../../lib/passkeys');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many login attempts, try again later',
  keyPrefix: 'login:'
});

router.post('/login', loginLimiter, (req, res, next) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const adminPass = process.env.ADMIN_PASSWORD || '';
  const loginState = getLoginState(db, req);
  if (loginState.locked) {
    logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'failure', summary: { reason: 'temporarily_locked', lockedUntil: loginState.lockedUntil } });
    return res.status(429).json({ error: '登录尝试过多，请稍后再试', lockedUntil: loginState.lockedUntil });
  }

  if (!password) {
    logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'failure', summary: { reason: 'missing_password' } });
    return res.status(400).json({ error: 'Password required' });
  }
  if (!adminPass) {
    logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'failure', summary: { reason: 'disabled' } });
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

  if (!match) {
    const failed = recordFailure(db, req);
    logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'failure', summary: { reason: failed.locked ? 'temporarily_locked' : 'incorrect_password', failures: failed.failures } });
    return res.status(failed.locked ? 429 : 401).json({ error: failed.locked ? '登录尝试过多，请稍后再试' : 'Incorrect password', lockedUntil: failed.lockedUntil || undefined });
  }

  req.session.regenerate((err) => {
    if (err) return next(err);
    initializeSession(req);
    req.session.save((err2) => {
      if (err2) return next(err2);
      clearFailures(db, req);
      logAudit(db, req, { action: 'auth.login', entityType: 'admin', outcome: 'success' });
      res.json({ ok: true });
    });
  });
});

router.post('/logout', (req, res) => {
  logAudit(db, req, { action: 'auth.logout', entityType: 'admin', entityId: req.sessionID || '' });
  req.session.destroy(() => res.json({ ok: true }));
});

router.post('/passkey/options', async (req, res) => {
  try { res.json(await passkeyService.authenticationOptions(db, req)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/passkey/verify', async (req, res, next) => {
  try {
    const verified = await passkeyService.verifyAuthentication(db, req, req.body.response);
    if (!verified) return res.status(401).json({ error: '通行密钥验证失败' });
    req.session.regenerate((error) => {
      if (error) return next(error);
      initializeSession(req);
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        clearFailures(db, req);
        logAudit(db, req, { action: 'auth.passkey_login', entityType: 'admin' });
        res.json({ ok: true });
      });
    });
  } catch (error) {
    logAudit(db, req, { action: 'auth.passkey_login', entityType: 'admin', outcome: 'failure', summary: { reason: error.message } });
    res.status(400).json({ error: error.message });
  }
});

router.get('/status', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.admin) });
});

module.exports = router;
