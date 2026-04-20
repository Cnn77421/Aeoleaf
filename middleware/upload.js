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
      next();
    });
  };
}

module.exports = { uploadPost, uploadWork, uploadGeneral, wrapUpload };
