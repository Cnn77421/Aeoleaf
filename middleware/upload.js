const multer = require('multer');
const path = require('path');
const fs = require('fs');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function makeStorage(subdir) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(__dirname, '../public/uploads', subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext)
        .toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
      cb(null, `${Date.now()}-${base}${ext}`);
    }
  });
}

function fileFilter(req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
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

module.exports = { uploadPost, uploadWork, uploadGeneral };
