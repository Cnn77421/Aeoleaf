const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivatePath } = require('../middleware/privateFiles');

test('private configuration, database and backup paths are blocked after URL decoding', () => {
  for (const pathname of [
    '/.env', '/.env.before-secret-fix', '/.%65nv', '/.git/config',
    '/js/admin.js.bak-20261010', '/js/admin.js%2ebak', '/css/main.css~',
    '/database/aeoleaf.db', '/database/aeoleaf.db-wal', '/uploads/export.sql',
    '/uploads/database.aebak', '/uploads/key.pem', '/uploads/key.KEY', '/invalid%'
  ]) assert.equal(isPrivatePath(pathname), true, pathname);
});

test('normal assets, ACME challenges and authenticated backup routes remain available', () => {
  for (const pathname of [
    '/js/admin.min.js?v=123', '/css/main.css', '/uploads/photo.webp',
    '/.well-known/acme-challenge/abc', '/admin/backups',
    '/admin/backups/20261104/download', '/blog', '/api/auth/login'
  ]) assert.equal(isPrivatePath(pathname), false, pathname);
});
