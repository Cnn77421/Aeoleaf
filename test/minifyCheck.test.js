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
  fs.writeFileSync(path.join(cssDir, 'sample.css'), '.sample { color: red; padding-top: calc(var(--nav-height) + 48px); top: calc(56px + 28px); }\n.sample + .other { margin: calc(2px + (3px + 4px)); }\n');
  fs.writeFileSync(path.join(cssDir, 'sample.min.css'), 'stale');

  const stale = childProcess.spawnSync(process.execPath, [script, '--check', root], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /sample\.min\.css/);

  const generated = childProcess.spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(generated.status, 0);
  const css = fs.readFileSync(path.join(cssDir, 'sample.min.css'), 'utf8');
  assert.ok(css.includes('calc(var(--nav-height) + 48px)'));
  assert.ok(css.includes('calc(56px + 28px)'));
  assert.ok(css.includes('calc(2px + (3px + 4px))'));
  assert.ok(css.includes('.sample + .other'));
  const current = childProcess.spawnSync(process.execPath, [script, '--check', root], { encoding: 'utf8' });
  assert.equal(current.status, 0);
  assert.match(current.stdout, /all minified assets are current/);

  fs.rmSync(root, { recursive: true, force: true });
});
