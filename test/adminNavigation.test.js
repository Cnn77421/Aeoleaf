const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin pages do not enable cross-document view transitions', () => {
  const adminViews = path.join(__dirname, '..', 'views', 'admin');
  const templates = fs.readdirSync(adminViews).filter((name) => name.endsWith('.ejs'));
  templates.forEach((name) => {
    const source = fs.readFileSync(path.join(adminViews, name), 'utf8');
    assert.doesNotMatch(source, /<meta\s+name=["']view-transition["']/i, name);
  });
});

test('admin navigation keeps a persistent shell and uses page lifecycle hooks', () => {
  const projectRoot = path.join(__dirname, '..');
  const adminScript = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'admin.js'), 'utf8');
  assert.doesNotMatch(adminScript, /requiresFullNavigation/);
  assert.doesNotMatch(adminScript, /location\.reload\(\)/);
  assert.doesNotMatch(adminScript, /classList\.add\(['"]pjax-(?:in|out)['"]\)/);
  assert.match(adminScript, /admin:before-swap/);
  assert.match(adminScript, /initAdminEditor/);
  assert.match(adminScript, /initVisitorCharts/);

  for (const name of ['post-edit.ejs', 'work-edit.ejs']) {
    const source = fs.readFileSync(path.join(projectRoot, 'views', 'admin', name), 'utf8');
    assert.doesNotMatch(source, /\/js\/editor\.js/);
  }
  const visitors = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'visitors.ejs'), 'utf8');
  assert.match(visitors, /id="visitor-chart-data" type="application\/json"/);
  assert.match(visitors, /analytics-traffic-card/);
  assert.match(visitors, /visitors-metrics-grid/);
  assert.match(visitors, /visitors-page-tabs/);
});

test('long admin pages grow with content and keep settings navigation in sync', () => {
  const projectRoot = path.join(__dirname, '..');
  const adminStyles = fs.readFileSync(path.join(projectRoot, 'public', 'css', 'admin-v2.css'), 'utf8');
  const adminScript = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'admin.js'), 'utf8');

  assert.match(adminStyles, /\.admin-body\s*\{[^}]*height:\s*auto;/s);
  assert.match(adminStyles, /\.admin-main,[\s\S]*?height:\s*max-content;/);
  assert.match(adminStyles, /input\[type="file"\]::file-selector-button/);
  assert.match(adminScript, /function initSettingsSectionNavigation\(\)/);
  assert.match(adminScript, /new IntersectionObserver/);
  assert.match(adminScript, /aria-current/);
});
