const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * MIME → canonical extension whitelist. The saved filename's extension is
 * always derived from the MIME type (never the user-supplied filename) so
 * that e.g. someone cannot upload `evil.html` with `image/png` MIME and have
 * the static server hand it back as HTML.
 */
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'image/x-ms-bmp': '.bmp'
};

function makeStorage(subdir) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(__dirname, '../public/uploads', subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = MIME_TO_EXT[file.mimetype];
      if (!ext) return cb(new Error('Unsupported image type'));
      const origExt = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, origExt)
        .toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40) || 'image';
      const rand = crypto.randomBytes(4).toString('hex');
      cb(null, `${Date.now()}-${rand}-${base}${ext}`);
    }
  });
}

function fileFilter(req, file, cb) {
  if (Object.prototype.hasOwnProperty.call(MIME_TO_EXT, file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
}

function detectedMime(header) {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (header.length >= 6 && (header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (header.length >= 2 && header.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = header.subarray(8, 12).toString('ascii').toLowerCase();
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return '';
}

function uploadedFiles(req) {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
  return [];
}

async function validateUploadedFiles(req) {
  const files = uploadedFiles(req);
  for (const file of files) {
    const handle = await fs.promises.open(file.path, 'r');
    const header = Buffer.alloc(16);
    try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
    const actual = detectedMime(header);
    const claimed = file.mimetype === 'image/x-ms-bmp' ? 'image/bmp' : file.mimetype;
    const compatibleHeif = claimed === 'image/heif' && actual === 'image/heic';
    if (!actual || (actual !== claimed && !compatibleHeif)) {
      await Promise.all(files.map((item) => fs.promises.unlink(item.path).catch(() => {})));
      throw new Error('File contents do not match an allowed image type');
    }
  }
}

const uploadPost = multer({
  storage: makeStorage('posts'),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter
});

const uploadWork = multer({
  storage: makeStorage('works'),
  limits: { fileSize: 8 * 1024 * 1024, files: 11 },
  fileFilter
});

const uploadGeneral = multer({
  storage: makeStorage('general'),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter
});

/** Turns multer middleware into one that responds with JSON on filter/size errors. */
function wrapUpload(mw) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'File upload failed' });
      }
      validateUploadedFiles(req).then(() => next(), (validationErr) => {
        res.status(400).json({ error: validationErr.message });
      });
    });
  };
}

module.exports = { uploadPost, uploadWork, uploadGeneral, wrapUpload, validateUploadedFiles, detectedMime };
