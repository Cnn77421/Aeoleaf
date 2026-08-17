// Safety helpers for filesystem operations that accept DB- or
// user-derived paths. All admin upload URLs live under /uploads/**,
// so any unlink that targets something outside that tree is a bug.
//
// Usage:
//   const { unlinkPublicUpload } = require('../../lib/safeFs');
//   unlinkPublicUpload(post.cover_image); // silently ignored if invalid/missing

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const UPLOADS_DIR = path.resolve(PUBLIC_DIR, 'uploads');
const MEDIA_TRASH_DIR = path.resolve(process.env.MEDIA_TRASH_DIR || path.join(__dirname, '..', 'database', 'media-trash'));

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

function moveFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(source);
  }
}

function quarantinePublicUpload(relUrl) {
  const source = resolveUploadPath(relUrl);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return null;
  const quarantineName = `${crypto.randomUUID()}${path.extname(source).toLowerCase()}`;
  const target = path.join(MEDIA_TRASH_DIR, quarantineName);
  const size = fs.statSync(source).size;
  moveFile(source, target);
  return { quarantineName, size };
}

function restoreQuarantinedUpload(quarantineName, originalUrl) {
  if (!quarantineName || quarantineName !== path.basename(quarantineName)) return null;
  const source = path.join(MEDIA_TRASH_DIR, quarantineName);
  const original = resolveUploadPath(originalUrl);
  if (!original || !fs.existsSync(source)) return null;

  let target = original;
  let restoredUrl = originalUrl;
  if (fs.existsSync(target)) {
    const parsed = path.parse(original);
    let suffix = 1;
    do {
      target = path.join(parsed.dir, `${parsed.name}-restored-${suffix}${parsed.ext}`);
      suffix += 1;
    } while (fs.existsSync(target));
    restoredUrl = `/uploads/${path.relative(UPLOADS_DIR, target).split(path.sep).join('/')}`;
  }
  moveFile(source, target);
  return { url: restoredUrl, renamed: restoredUrl !== originalUrl };
}

function destroyQuarantinedUpload(quarantineName) {
  if (!quarantineName || quarantineName !== path.basename(quarantineName)) return false;
  const target = path.join(MEDIA_TRASH_DIR, quarantineName);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  resolveUploadPath,
  unlinkPublicUpload,
  quarantinePublicUpload,
  restoreQuarantinedUpload,
  destroyQuarantinedUpload
};
