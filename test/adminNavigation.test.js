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
  assert.match(adminScript, /updateNotificationBadge/);

  for (const name of ['post-edit.ejs', 'work-edit.ejs']) {
    const source = fs.readFileSync(path.join(projectRoot, 'views', 'admin', name), 'utf8');
    assert.doesNotMatch(source, /\/js\/editor\.js/);
  }
  const visitors = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'visitors.ejs'), 'utf8');
  const visitorDetail = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'visitor-detail.ejs'), 'utf8');
  const security = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'security.ejs'), 'utf8');
  const database = fs.readFileSync(path.join(projectRoot, 'config', 'db.js'), 'utf8');
  assert.match(visitors, /id="visitor-chart-data" type="application\/json"/);
  assert.match(visitors, /analytics-traffic-card/);
  assert.match(visitors, /visitors-metrics-grid/);
  assert.match(visitors, /visitors-page-tabs/);
  assert.match(visitors, /role="tabpanel" aria-labelledby="visitors-tab-overview"/);
  assert.match(visitors, /id="visitors-records"[^>]*hidden/);
  assert.match(adminScript, /function initVisitorsPageNavigation\(\)/);
  assert.match(adminScript, /url\.searchParams\.set\('section', 'records'\)/);
  assert.match(visitors, /data-visitor-quick-drawer/);
  assert.match(visitors, /visitor-quality--/);
  assert.match(visitorDetail, /visitor-detail-summary/);
  assert.match(visitorDetail, /visitor-path-timeline/);
  assert.match(security, /后台访问活动/);
  assert.match(database, /path NOT LIKE '\/admin\/%'/);
  assert.match(database, /::ffff:127\.0\.0\.1/);
});

test('long admin pages grow with content and keep settings navigation in sync', () => {
  const projectRoot = path.join(__dirname, '..');
  const adminStyles = fs.readFileSync(path.join(projectRoot, 'public', 'css', 'admin-v2.css'), 'utf8');
  const adminScript = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'admin.js'), 'utf8');
  const settingsView = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'settings.ejs'), 'utf8');

  assert.match(adminStyles, /\.admin-body\s*\{[^}]*height:\s*auto;/s);
  assert.match(adminStyles, /\.admin-main,[\s\S]*?height:\s*max-content;/);
  assert.match(adminStyles, /input\[type="file"\]::file-selector-button/);
  assert.match(adminScript, /function initSettingsSectionNavigation\(\)/);
  assert.doesNotMatch(adminScript, /settingsSectionObserver|new IntersectionObserver/);
  assert.match(adminScript, /panel\.hidden = panel\.id !== id/);
  assert.match(adminScript, /history\.replaceState/);
  assert.match(settingsView, /role="tablist"/);
  assert.match(settingsView, /role="tabpanel"/);
  assert.match(settingsView, /aria-selected="true"/);
});

test('admin pages load the supplied design-system alignment layer last', () => {
  const projectRoot = path.join(__dirname, '..');
  const styles = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'partials', 'styles.ejs'), 'utf8');
  const designSystem = fs.readFileSync(path.join(projectRoot, 'public', 'css', 'admin-design-system.css'), 'utf8');

  assert.ok(styles.indexOf('/css/admin-design-system.css') > styles.indexOf('/css/admin-v2.css'));
  assert.match(designSystem, /--admin-ds-background:\s*hsl\(0 0% 100%\)/);
  assert.match(designSystem, /grid-template-columns:\s*240px minmax\(0, 1fr\)/);
  assert.match(designSystem, /grid-template-rows:\s*56px auto/);
  assert.match(designSystem, /--admin-ds-success:\s*#15803d/);
  assert.match(designSystem, /--admin-ds-warning:\s*#c2410c/);
  assert.match(designSystem, /--admin-ds-danger:\s*#dc2626/);
  assert.match(designSystem, /--admin-ds-info:\s*#1d4ed8/);
  assert.match(designSystem, /:disabled/);
  assert.match(designSystem, /prefers-reduced-motion:\s*reduce/);
});

test('editor preserves offline drafts and detects concurrent changes', () => {
  const projectRoot = path.join(__dirname, '..');
  const script = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'admin.js'), 'utf8');
  const postView = fs.readFileSync(path.join(projectRoot, 'views', 'admin', 'post-edit.ejs'), 'utf8');
  assert.match(script, /localStorage\.setItem\(ctx\.key/);
  assert.match(script, /persistServerDraft/);
  assert.match(postView, /name="content_revision"/);
});
