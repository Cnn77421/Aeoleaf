const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.join(__dirname, '..', 'scripts', 'minify.js');

test('minify check fails for stale output and passes after regeneration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-minify-test-'));
  const cssDir = path.join(root, 'public', 'css');
  fs.mkdirSync(cssDir, { recursive: true });
  fs.writeFileSync(path.join(cssDir, 'sample.css'), '.sample { color: red; }\n');
  fs.writeFileSync(path.join(cssDir, 'sample.min.css'), 'stale');

  const stale = childProcess.spawnSync(process.execPath, [script, '--check', root], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /sample\.min\.css/);

  const generated = childProcess.spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(generated.status, 0);
  const current = childProcess.spawnSync(process.execPath, [script, '--check', root], { encoding: 'utf8' });
  assert.equal(current.status, 0);
  assert.match(current.stdout, /all minified assets are current/);

  fs.rmSync(root, { recursive: true, force: true });
});
