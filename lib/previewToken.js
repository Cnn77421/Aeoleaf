const crypto = require('crypto');

function secret() {
  const value = String(process.env.SESSION_SECRET || '');
  if (!value) throw new Error('SESSION_SECRET is required for preview links');
  return value;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function createPreviewToken(postId, ttlSeconds = 3600, nowMs = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, type: 'post', id: Number(postId), exp: Math.floor(nowMs / 1000) + ttlSeconds })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyPreviewToken(token, postId, nowMs = Date.now()) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return false;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.v === 1 && data.type === 'post' && data.id === Number(postId) && Number(data.exp) >= Math.floor(nowMs / 1000);
  } catch (_error) {
    return false;
  }
}

module.exports = { createPreviewToken, verifyPreviewToken };
