// Safety helpers for filesystem operations that accept DB- or
// user-derived paths. All admin upload URLs live under /uploads/**,
// so any unlink that targets something outside that tree is a bug.
//
// Usage:
//   const { unlinkPublicUpload } = require('../../lib/safeFs');
//   unlinkPublicUpload(post.cover_image); // silently ignored if invalid/missing

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const UPLOADS_DIR = path.resolve(PUBLIC_DIR, 'uploads');

function resolveUploadPath(relUrl) {
  if (!relUrl || typeof relUrl !== 'string') return null;
  if (relUrl.indexOf('\0') !== -1) return null;

  // Only allow `/uploads/...` absolute-looking URLs written by our upload
  // middleware. Anything else (http://, ../, absolute fs path) is refused.
  const trimmed = relUrl.trim();
  if (!trimmed.startsWith('/uploads/')) return null;

  const abs = path.resolve(PUBLIC_DIR, trimmed.replace(/^\/+/, ''));
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) return null;
  return abs;
}

function unlinkPublicUpload(relUrl) {
  const abs = resolveUploadPath(relUrl);
  if (!abs) return false;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { resolveUploadPath, unlinkPublicUpload };
