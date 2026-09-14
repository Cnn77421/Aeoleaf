const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '../views/partials/theme-init.ejs'), 'utf8');

function setup({ stored, dark = true, blocked = false } = {}) {
  let systemChange;
  const media = { matches: dark, addEventListener: (_name, callback) => { systemChange = callback; } };
  const dom = new JSDOM(script, {
    url: 'https://aeoleaf.test', runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = () => media;
      if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage disabled'); } });
      else if (stored) window.localStorage.setItem('theme', stored);
    }
  });
  return { dom, media, change: () => systemChange(), theme: () => dom.window.document.documentElement.dataset.theme };
}

test('theme follows system until an explicit choice, and synchronizes across tabs', () => {
  const ctx = setup();
  try {
    assert.equal(ctx.theme(), 'dark');
    ctx.media.matches = false; ctx.change();
    assert.equal(ctx.theme(), 'light');
    ctx.dom.window.aeoleafTheme.set('dark');
    assert.equal(ctx.dom.window.localStorage.getItem('theme'), 'dark');
    ctx.change();
    assert.equal(ctx.theme(), 'dark');
    ctx.dom.window.dispatchEvent(new ctx.dom.window.StorageEvent('storage', { key: 'theme', newValue: 'light' }));
    assert.equal(ctx.theme(), 'light');
    ctx.dom.window.dispatchEvent(new ctx.dom.window.StorageEvent('storage', { key: 'theme', newValue: null }));
    ctx.media.matches = true; ctx.change();
    assert.equal(ctx.theme(), 'dark');
  } finally { ctx.dom.window.close(); }
});

test('theme tolerates unavailable storage and rejects invalid preferences', () => {
  for (const options of [{ blocked: true }, { stored: 'invalid' }, { stored: 'light', dark: false }]) {
    const ctx = setup(options);
    try {
      assert.equal(ctx.theme(), options.dark === false ? 'light' : 'dark');
      ctx.dom.window.aeoleafTheme.set('light');
      ctx.dom.window.aeoleafTheme.set('invalid');
      assert.equal(ctx.theme(), 'light');
      ctx.media.matches = true; ctx.change();
      assert.equal(ctx.theme(), 'light');
    } finally { ctx.dom.window.close(); }
  }
});
