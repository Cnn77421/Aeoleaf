/* global window, document, innerWidth, getComputedStyle */
/* Optional browser acceptance suite. Requires Playwright and Chromium.
 * All database, uploads and backup operations use a fresh temporary directory.
 * QA_OUTPUT_DIR selects where screenshots and the report are written. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-v2-qa-'));
const output = process.env.QA_OUTPUT_DIR || path.join(temp, 'results');
fs.mkdirSync(output, { recursive: true });
const report = { pages: [], errors: [], checks: [], screenshots: [], fixtureDirectory: temp };
const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#dedbd3"/><circle cx="740" cy="120" r="230" fill="#aaa995"/><path d="M0 520Q220 180 480 450T960 300V640H0Z" fill="#656f62"/><text x="60" y="100" font-family="sans-serif" font-size="30" fill="#262626">Aeoleaf / Design notes</text></svg>';

async function run() {
  // Upload storage resolves from __dirname, so isolate the application too.
  const appRoot = path.join(temp, 'app');
  fs.mkdirSync(appRoot);
  for (const name of ['server.js', 'package.json', 'config', 'lib', 'middleware', 'routes', 'views', 'public']) {
    fs.cpSync(path.join(root, name), path.join(appRoot, name), {
      recursive: true, filter: source => !source.startsWith(path.join(root, 'public', 'uploads'))
    });
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(appRoot, 'node_modules'), 'junction');
  const fixtureUploads = path.join(appRoot, 'public', 'uploads', 'general');
  fs.mkdirSync(fixtureUploads, { recursive: true });
  await require('sharp')(Buffer.from(cover)).png().toFile(path.join(fixtureUploads, 'design-notes.png'));
  Object.assign(process.env, {
    DATABASE_PATH: path.join(temp, 'qa.db'), BACKUP_DIR: path.join(temp, 'backups'),
    PUBLIC_DIR: path.join(appRoot, 'public'), MEDIA_TRASH_DIR: path.join(temp, 'media-trash')
  });
  const database = require('../config/db');
  database.initDB();
  const db = database.db;
  const setting = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  for (const [key, value] of Object.entries({ site_title: 'Aeoleaf 风叶', site_subtitle: '记录灵感，让想法慢慢生长。', about_text: '你好，我是风叶。这里记录设计与开发中的思考，也收藏日常生活里的细小发现。', home_hero_image: '/qa-cover.svg', contact_email: 'hello@example.com' })) setting.run(key, value);
  for (let i = 1; i <= 12; i++) db.prepare('INSERT INTO posts(title,slug,excerpt,content,tags,status,cover_image) VALUES (?,?,?,?,?,?,?)').run(
    i === 1 ? '让界面回归内容：一些关于设计与阅读的思考' : `设计笔记 ${i} · 从日常观察开始`, 'qa-post-' + i,
    '留白、层级与节奏共同构成阅读体验。这些记录来自一次次实践，也来自对细节的重新观察。',
    '## 从观察开始\n\n' + '让内容清晰，让交互自然。'.repeat(25) + '\n\n## 实践记录\n\n```js\nconst title = "Aeoleaf";\n' + 'const longValue = "' + 'a'.repeat(200) + '";\n```\n\n> [!WARNING]\n> 请保留内容备份。\n\n| 项目 | 说明 |\n| --- | --- |\n| 长内容 | ' + 'long-column-'.repeat(30) + ' |\n\n### 下一步\n\n继续记录。',
    JSON.stringify(i % 2 ? ['设计', '阅读'] : ['开发']), 'published', i % 2 ? '/qa-cover.svg' : ''
  );
  for (let i = 1; i <= 4; i++) db.prepare('INSERT INTO works(title,slug,description,content,tags,featured,cover_image) VALUES (?,?,?,?,?,?,?)').run(
    '风叶作品 ' + i, 'qa-work-' + i, '一次关于内容组织与交互设计的探索。', '## 项目说明\n\n从一个小想法开始，逐步完成设计与实现。', JSON.stringify(i % 2 ? ['设计'] : ['开发']), 1, i % 2 ? '/qa-cover.svg' : ''
  );
  db.prepare("INSERT INTO guestbook(name,message,status,admin_reply) VALUES (?,?, 'approved',?)").run('来访者', '很喜欢这里安静的阅读体验，期待更多记录。', '谢谢来访，欢迎常来。');
  db.prepare('INSERT INTO visitors(fingerprint_id,ip,tracked_at,path,device_type,browser_name,country,city) VALUES (?,?,?,?,?,?,?,?)').run('qa-fingerprint', '203.0.113.10', Date.now(), '/blog/qa-post-1', 'desktop', 'Chrome', '中国', '上海');
  database.closeDB();
  const portServer = require('node:net').createServer();
  portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: appRoot, env: { ...process.env, NODE_ENV: 'development', PORT: String(port), BASE_URL: origin, ADMIN_PASSWORD: 'qa-password-1234', SESSION_SECRET: 'qa-session-secret-1234567890', SESSION_COOKIE_SECURE: 'false', TRUST_PROXY: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  child.stdout.on('data', chunk => { serverLog += chunk; });
  child.stderr.on('data', chunk => { serverLog += chunk; });
  let browser;
  try {
    for (let i = 0; i < 600; i++) {
      try { if ((await fetch(origin)).ok) break; } catch (_error) { /* starting */ }
      if (child.exitCode !== null || i === 599) throw new Error('Server failed to start: ' + serverLog);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}) });
    if (process.env.QA_MOTION_ONLY === '1') {
      await require('./motion-browser-checks')(browser, origin, output, report, cover);
      assert.equal(report.errors.length, 0, 'Motion browser errors');
      return;
    }
    const context = await browser.newContext({ reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/qa-cover.svg' || (url.origin !== origin && route.request().resourceType() === 'image')) return route.fulfill({ contentType: 'image/svg+xml', body: cover });
      if (url.origin !== origin) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({ url: page.url(), error: error.message, stack: error.stack }));
    await page.goto(origin + '/admin/login');
    await page.locator('input[name="password"]').fill('qa-password-1234');
    await Promise.all([page.waitForURL('**/admin/dashboard'), page.locator('button[type="submit"]').click()]);
    report.checks.push('password login');
    const publicPaths = ['/', '/blog', '/blog?tag=设计', '/blog?page=2', '/blog/qa-post-1', '/blog/qa-post-2', '/works', '/works/qa-work-1', '/works/qa-work-2', '/about', '/guestbook', '/missing-qa-page'];
    const adminPaths = ['dashboard', 'posts', 'posts/new', 'posts/1/edit', 'works', 'works/new', 'works/1/edit', 'media', 'guestbook', 'visitors', 'visitor/1', 'visitors/fingerprint?fp=qa-fingerprint', 'visitors/advanced', 'visitors/blacklist', 'seo', 'settings', 'security', 'notifications', 'audit', 'health', 'backups', 'trash'].map(name => '/admin/' + name);
    for (const theme of ['light', 'dark']) {
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const route of [...publicPaths, ...adminPaths]) {
          const response = await page.goto(origin + route, { waitUntil: 'load' });
          if (response.status() !== (route === '/missing-qa-page' ? 404 : 200)) report.errors.push({ route, status: response.status() });
          await page.evaluate(t => window.aeoleafTheme.set(t), theme);
          await page.waitForTimeout(70);
          const metrics = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
            heading: document.querySelector('h1')?.textContent?.trim(),
            theme: document.documentElement.dataset.theme,
            overflowing: Array.from(document.querySelectorAll('main *')).filter(el => {
              const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && !el.closest('pre, .article-table-wrap, .admin-table-shell, .table-responsive, [hidden]');
            }).slice(0, 6).map(el => el.className || el.tagName)
            , contrast: (() => {
              function rgb(value) { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3); }
              function lum(value) { return rgb(value).map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
              const css = getComputedStyle(document.documentElement);
              const pairs = ['--text', '--text-muted', '--text-subtle'].flatMap(text => ['--bg', '--surface', '--bg-elev-2'].map(bg => [text, bg]));
              for (const tone of ['success', 'warning', 'danger', 'info']) pairs.push(['--' + tone, '--' + tone + '-bg'], ['--status-on-fill', '--' + tone]);
              pairs.push(['--accent-foreground', '--accent']);
              return pairs.map(([text, bg]) => {
                const l1 = lum(css.getPropertyValue(text)), l2 = lum(css.getPropertyValue(bg));
                return { text, bg, ratio: (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05) };
              });
            })()
          }));
          report.pages.push({ route, width, theme, ...metrics });
          if (metrics.scroll > width + 1) report.errors.push({ route, width, theme, overflow: metrics.scroll, elements: metrics.overflowing });
          if (!metrics.heading) report.errors.push({ route, width, theme, error: 'Missing h1' });
          for (const pair of metrics.contrast) if (pair.ratio < 4.5) report.errors.push({ route, width, theme, contrast: pair });
          if (['/admin/trash', '/admin/audit', '/admin/media'].includes(route)) {
            const components = await page.evaluate(() => {
              const header = document.querySelector('.admin-header').getBoundingClientRect();
              const sections = Array.from(document.querySelectorAll('main > .admin-filter-bar, main > .admin-card, main > .media-toolbar, main > .media-upload'));
              const controls = Array.from(document.querySelectorAll('.admin-filter-bar input, .admin-filter-bar select, .media-toolbar .admin-toolbar-search, .media-toolbar select'));
              return {
                aligned: sections.every(el => Math.abs(el.getBoundingClientRect().left - header.left) < 1 && Math.abs(el.getBoundingClientRect().width - header.width) < 1),
                controls: controls.map(el => ({ radius: getComputedStyle(el).borderRadius, height: el.getBoundingClientRect().height, arrow: el.tagName !== 'SELECT' || getComputedStyle(el).backgroundImage !== 'none' })),
                searchBackground: document.querySelector('.media-toolbar input') ? getComputedStyle(document.querySelector('.media-toolbar input')).backgroundColor : null
              };
            });
            if (!components.aligned || components.controls.some(c => c.radius !== '6px' || c.height < 36 || !c.arrow) || (components.searchBackground && components.searchBackground !== 'rgba(0, 0, 0, 0)')) report.errors.push({ route, width, theme, components });
            await page.screenshot({ path: path.join(output, route.split('/').pop() + '-' + width + '-' + theme + '.png'), fullPage: true });
          }
          if (['/', '/admin/dashboard', '/blog/qa-post-1'].includes(route) && [375, 1440].includes(width)) {
            const name = `${route === '/' ? 'home' : route.includes('admin') ? 'admin' : 'article'}-${width}-${theme}.png`;
            await page.screenshot({ path: path.join(output, name), fullPage: true }); report.screenshots.push(name);
          }
        }
        console.log('Completed viewport', width, theme);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/');
    await page.locator('#search-toggle').click();
    await page.locator('#search-input').fill('设计');
    await page.locator('#search-results .search-item').first().waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#search-toggle').evaluate(el => el === document.activeElement), true);
    report.checks.push('search results, Escape and focus restoration');
    await page.goto(origin + '/search?q=qa-no-matching-content');
    await page.getByText('没有找到相关结果', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    await page.locator('#search-close').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#search-input').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await page.goto(origin + '/');
    report.checks.push('search redirect, no results and dialog focus constraint');
    await page.locator('.home-actions a[href="/works"]').click(); await page.waitForURL('**/works');
    await page.locator('[data-tag="开发"]').click();
    assert.equal(await page.locator('.work-card:visible').count(), 2);
    await page.goBack(); await page.waitForURL(origin + '/');
    report.checks.push('public partial navigation, work filter, history back');
    await page.locator('.home-posts h3 a').first().click(); await page.waitForURL('**/blog/qa-post-1');
    await page.locator('[data-copy-code]').first().click();
    await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
    assert.equal(await page.locator('.reading-progress').count(), 1);
    await page.locator('.journal-article__footer a').click(); await page.waitForURL('**/blog');
    assert.equal(await page.locator('.reading-progress').count(), 0);
    report.checks.push('article partial navigation, code copy and progress cleanup');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.locator('.nav-toggle').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.nav-toggle').evaluate(el => el === document.activeElement), true);
    report.checks.push('public mobile menu keyboard dismissal');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/guestbook');
    await page.locator('#gb-name').fill('验收访客'); await page.locator('#gb-message').fill('前端 2.0 隔离测试留言。');
    await page.locator('#gb-submit').click(); await page.getByText('留言已提交，审核通过后会显示在留言墙。').waitFor();
    report.checks.push('guestbook submission and moderation feedback');
    await page.goto(origin + '/admin/guestbook?status=pending');
    const submittedMessage = page.locator('.guestbook-admin-card').filter({ hasText: '前端 2.0 隔离测试留言。' });
    await Promise.all([
      page.waitForResponse(r => /\/admin\/guestbook\/\d+\/status$/.test(r.url()) && r.request().method() === 'POST'),
      submittedMessage.getByRole('button', { name: '通过并公开' }).click()
    ]);
    await page.goto(origin + '/guestbook');
    await page.getByText('前端 2.0 隔离测试留言。', { exact: true }).waitFor();
    report.checks.push('admin moderation publishes submitted message');
    await page.goto(origin + '/admin/dashboard');
    await page.locator('[data-admin-command-open]').click();
    await page.locator('[data-admin-command-input]').fill('文章');
    await page.keyboard.press('Enter'); await page.waitForURL('**/admin/posts');
    report.checks.push('admin command navigation');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.locator('[data-admin-sidebar-toggle]').click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('admin-drawer-open')), false);
    report.checks.push('mobile admin drawer and Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/admin/audit');
    const auditTrigger = page.locator('[data-audit-detail]').first();
    await auditTrigger.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-audit-drawer]').getAttribute('aria-hidden'), 'true');
    assert.equal(await auditTrigger.evaluate(el => el === document.activeElement), true);
    report.checks.push('audit dialog Escape and focus restoration');
    await page.goto(origin + '/admin/posts/new');
    await page.locator('[name="title"]').fill('浏览器验收文章');
    await page.locator('[name="slug"]').fill('qa-browser-created');
    await page.evaluate(() => window.easyMDE.value('## 浏览器验收\n\n编辑器保存内容。'));
    await page.locator('[name="status"]').selectOption('published');
    await page.route('**/api/posts', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '验收模拟：服务暂时不可用，请重试' }) }), { times: 1 });
    await page.locator('#post-form button[type="submit"]').click();
    await page.getByText('验收模拟：服务暂时不可用，请重试').waitFor();
    assert.equal(await page.locator('#post-form button[type="submit"]').isEnabled(), true);
    assert.equal(await page.locator('[name="title"]').inputValue(), '浏览器验收文章');
    report.checks.push('failed save preserves input and enables retry');
    const png = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#737373' } }).png().toBuffer();
    await page.locator('#cover-upload').setInputFiles({ name: 'qa-cover.png', mimeType: 'image/png', buffer: png });
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/posts') && r.request().method() === 'POST'), page.locator('#post-form button[type="submit"]').click()]);
    await page.goto(origin + '/blog/qa-browser-created');
    await page.getByText('编辑器保存内容。', { exact: true }).waitFor();
    assert.equal(await page.locator('.journal-article__hero img').evaluate(el => el.complete && el.naturalWidth > 0), true);
    report.checks.push('rich editor creates and publishes article');
    report.checks.push('image upload persists and renders from isolated application');
    await page.goto(origin + '/admin/works/new');
    await page.locator('[name="title"]').fill('浏览器验收作品');
    await page.locator('[name="slug"]').fill('qa-browser-work');
    await page.evaluate(() => window.easyMDE.value('## 作品内容\n\n保存作品正文。'));
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/works') && r.request().method() === 'POST'), page.locator('#work-form button[type="submit"]').click()]);
    await page.goto(origin + '/works/qa-browser-work');
    await page.getByText('保存作品正文。', { exact: true }).waitFor();
    report.checks.push('rich editor creates work');
    database.initDB();
    db.prepare("UPDATE posts SET status='draft',cover_image=''").run();
    db.prepare("UPDATE works SET deleted_at='2026-01-01'").run();
    db.prepare("UPDATE settings SET value='' WHERE key IN ('home_hero_image','home_hero_image_mobile')").run();
    database.closeDB();
    await page.goto(origin + '/');
    assert.equal(await page.locator('.home-intro__image').count(), 0);
    await page.getByText('文字正在酝酿').waitFor();
    await page.getByText('作品持续整理中').waitFor();
    await page.screenshot({ path: path.join(output, 'home-empty.png'), fullPage: true });
    await page.goto(origin + '/blog'); await page.getByText('这里还没有文章').waitFor();
    await page.goto(origin + '/works'); await page.getByText('尚未有公开作品').waitFor();
    report.checks.push('empty collections and image-free homepage');
    await context.close();
  } finally {
    if (browser) await browser.close();
    child.kill();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'server.log'), serverLog);
    console.log(JSON.stringify({ pages: report.pages.length, errors: report.errors, checks: report.checks, output }, null, 2));
  }
  assert.equal(report.errors.length, 0, 'Browser acceptance errors; inspect report.json');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
