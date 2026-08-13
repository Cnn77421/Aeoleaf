const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectedMime, validateUploadedFiles } = require('../middleware/upload');

test('detects supported image signatures', () => {
  assert.equal(detectedMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectedMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(detectedMime(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(detectedMime(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(detectedMime(Buffer.from('BM')), 'image/bmp');
});

test('rejects HTML and unknown file contents', () => {
  assert.equal(detectedMime(Buffer.from('<script>alert(1)</script>')), '');
});

test('deletes an uploaded file whose claimed image type does not match its contents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-upload-test-'));
  const filePath = path.join(dir, 'attack.png');
  fs.writeFileSync(filePath, '<script>alert(1)</script>');

  await assert.rejects(
    validateUploadedFiles({ file: { path: filePath, mimetype: 'image/png' } }),
    /do not match/
  );
  assert.equal(fs.existsSync(filePath), false);
  fs.rmSync(dir, { recursive: true });
});
