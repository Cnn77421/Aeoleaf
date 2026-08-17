const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const ORIGIN = (port) => `http://127.0.0.1:${port}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

function startServer(port, databasePath) {
  const child = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      BASE_URL: ORIGIN(port),
      SESSION_SECRET: 'integration-session-secret-123456789',
      ADMIN_PASSWORD: 'integration-password',
      SESSION_COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      DATABASE_PATH: databasePath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server start timed out:\n${output}`)), 10_000);
    const poll = setInterval(() => {
      if (output.includes('aeoleaf running')) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve({ child, output: () => output });
      }
    }, 25);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      clearInterval(poll);
      reject(new Error(`Server exited with ${code}:\n${output}`));
    });
  });
}

async function request(base, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.write !== false && !headers.Origin) headers.Origin = base;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.json === undefined ? options.body : JSON.stringify(options.json),
    redirect: 'manual'
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { response, text, json };
}

test('server routes, auth, CRUD, upload rejection, feeds, and tracking work together', { timeout: 30_000 }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-integration-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  const port = await freePort();
  const base = ORIGIN(port);
  const running = await startServer(port, databasePath);
  t.after(async () => {
    if (running.child.exitCode === null) running.child.kill();
    await new Promise((resolve) => running.child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  for (const pathname of ['/', '/blog', '/works', '/about', '/guestbook', '/rss.xml', '/sitemap.xml']) {
    const result = await request(base, pathname, { write: false });
    assert.equal(result.response.status, 200, pathname);
  }
  assert.equal((await request(base, '/definitely-missing', { write: false })).response.status, 404);

  const loginPage = await request(base, '/admin/login', { write: false });
  const loginCookie = loginPage.response.headers.get('set-cookie').split(';')[0];
  const csrfMatch = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(csrfMatch, 'login form should contain a CSRF token');
  const originlessFormLogin = await request(base, '/admin/login', {
    method: 'POST',
    write: false,
    headers: {
      Cookie: loginCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      _csrf: csrfMatch[1],
      password: 'incorrect-password'
    })
  });
  assert.equal(originlessFormLogin.response.status, 401);

  const rejectedLogin = await request(base, '/api/auth/login', {
    method: 'POST', json: { password: 'integration-password' }, write: false
  });
  assert.equal(rejectedLogin.response.status, 403);

  const login = await request(base, '/api/auth/login', {
    method: 'POST', json: { password: 'integration-password' }
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const authHeaders = { Cookie: cookie };
  assert.equal((await request(base, '/api/auth/status', { headers: authHeaders, write: false })).json.loggedIn, true);

  const post = await request(base, '/api/posts', {
    method: 'POST', headers: authHeaders,
    json: { title: 'Integration Post', slug: 'integration-post', content: '# Body', status: 'published' }
  });
  assert.equal(post.response.status, 201);
  assert.equal((await request(base, '/api/posts/integration-post', { write: false })).json.title, 'Integration Post');
  const updatedPost = await request(base, `/api/posts/${post.json.id}`, {
    method: 'PUT', headers: authHeaders, json: { title: 'Updated Integration Post' }
  });
  assert.equal(updatedPost.json.title, 'Updated Integration Post');

  const work = await request(base, '/api/works', {
    method: 'POST', headers: authHeaders,
    json: { title: 'Integration Work', slug: 'integration-work', featured: 1 }
  });
  assert.equal(work.response.status, 201);
  assert.equal((await request(base, '/api/works/integration-work', { write: false })).json.featured, 1);
  const reorderedWork = await request(base, '/api/works/reorder', {
    method: 'PUT', headers: authHeaders,
    json: { order: [{ id: work.json.id, sort_order: 0 }] }
  });
  assert.equal(reorderedWork.response.status, 200);
  assert.equal(reorderedWork.json.ok, true);

  const moderationSettings = new FormData();
  moderationSettings.append('guestbook_sensitive_words', 'blockedterm');
  const savedModerationSettings = await request(base, '/admin/settings', {
    method: 'POST', headers: { ...authHeaders, Accept: 'application/json' }, body: moderationSettings
  });
  assert.equal(savedModerationSettings.response.status, 200);
  assert.equal(savedModerationSettings.json.ok, true);

  const guestbook = await request(base, '/api/guestbook', {
    method: 'POST', json: { name: '<b>Alice</b>', message: '<script>x</script>Hello' }
  });
  assert.equal(guestbook.response.status, 201);
  assert.equal(guestbook.json.message.includes('<script>'), false);
  assert.equal(guestbook.json.status, 'pending');
  const publicMessagesBeforeApproval = await request(base, '/api/guestbook', { write: false });
  assert.equal(publicMessagesBeforeApproval.json.some((message) => message.id === guestbook.json.id), false);

  const riskyGuestbook = await request(base, '/api/guestbook', {
    method: 'POST', json: { name: 'Link sender', message: 'https://one.example https://two.example' }
  });
  assert.equal(riskyGuestbook.response.status, 201);
  assert.deepEqual(JSON.parse(riskyGuestbook.json.risk_flags), ['包含 2 个链接']);
  const rejectCandidate = await request(base, '/api/guestbook', {
    method: 'POST', json: { name: 'Reject me', message: 'Batch rejection candidate' }
  });
  const deleteCandidate = await request(base, '/api/guestbook', {
    method: 'POST', json: { name: 'Delete me', message: 'Batch deletion candidate' }
  });
  const sensitiveGuestbook = await request(base, '/api/guestbook', {
    method: 'POST', json: { name: 'Sensitive test', message: 'Contains BLOCKEDTERM here' }
  });
  assert.deepEqual(JSON.parse(sensitiveGuestbook.json.risk_flags), ['敏感词：blockedterm']);

  let adminGuestbookPage;
  const adminPaths = [
    '/admin/dashboard', '/admin/posts', '/admin/posts/new', `/admin/posts/${post.json.id}/edit`,
    '/admin/works', '/admin/works/new', `/admin/works/${work.json.id}/edit`,
    '/admin/guestbook', '/admin/media', '/admin/settings', '/admin/visitors', '/admin/visitors/blacklist'
  ];
  for (const pathname of adminPaths) {
    const page = await request(base, pathname, { headers: authHeaders, write: false });
    assert.equal(page.response.status, 200, pathname);
    assert.match(page.text, /name="_csrf" value="[^"]+"/, `${pathname} should expose a form token`);
    if (pathname === '/admin/guestbook') adminGuestbookPage = page;
    if (pathname === `/admin/posts/${post.json.id}/edit`) assert.match(page.text, new RegExp(`data-post-id="${post.json.id}"`));
    if (pathname === `/admin/works/${work.json.id}/edit`) assert.match(page.text, new RegExp(`data-work-id="${work.json.id}"`));
    if (pathname === '/admin/visitors') assert.match(page.text, /id="visitor-chart-data" type="application\/json"/);
  }
  const adminCsrf = adminGuestbookPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.match(adminGuestbookPage.text, /待审核/);
  assert.match(adminGuestbookPage.text, /包含 2 个链接/);
  assert.match(adminGuestbookPage.text, /admin-nav-count/);
  assert.match(adminGuestbookPage.text, /name="return_to" value="\/admin\/guestbook"/);

  const runBulk = (action, id, asJson = false) => request(base, '/admin/guestbook/bulk', {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(asJson ? { Accept: 'application/json' } : {})
    },
    body: new URLSearchParams({
      _csrf: adminCsrf,
      action,
      message_ids: String(id),
      return_to: '/admin/guestbook?status=all'
    })
  });
  const asyncBulkApproval = await runBulk('approve', riskyGuestbook.json.id, true);
  assert.equal(asyncBulkApproval.response.status, 200);
  assert.equal(asyncBulkApproval.json.ok, true);
  assert.equal(asyncBulkApproval.json.status, 'approved');
  assert.equal((await runBulk('reject', rejectCandidate.json.id)).response.status, 302);
  const bulkDeleteFallback = await runBulk('delete', deleteCandidate.json.id);
  assert.equal(bulkDeleteFallback.response.status, 302);
  assert.equal(bulkDeleteFallback.response.headers.get('location'), '/admin/guestbook?status=all&ok=1');
  const publicMessagesAfterBulk = await request(base, '/api/guestbook', { write: false });
  assert.equal(publicMessagesAfterBulk.json.some((message) => message.id === riskyGuestbook.json.id), true);
  assert.equal(publicMessagesAfterBulk.json.some((message) => message.id === rejectCandidate.json.id), false);

  const hideMessage = await request(base, `/admin/guestbook/${guestbook.json.id}/status`, {
    method: 'POST',
    write: false,
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: adminCsrf, status: 'hidden', return_to: '/admin/guestbook?status=approved' })
  });
  assert.equal(hideMessage.response.status, 302);
  assert.equal(hideMessage.response.headers.get('location'), '/admin/guestbook?status=approved&ok=1');
  const publicMessagesAfterHide = await request(base, '/api/guestbook', { write: false });
  assert.equal(publicMessagesAfterHide.json.some((message) => message.id === guestbook.json.id), false);

  const replyMessage = await request(base, `/admin/guestbook/${guestbook.json.id}/reply`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ admin_reply: '感谢你的留言' })
  });
  assert.equal(replyMessage.response.status, 302);
  await request(base, `/admin/guestbook/${guestbook.json.id}/status`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status: 'approved' })
  });
  const publicMessagesAfterReply = await request(base, '/api/guestbook', { write: false });
  assert.equal(publicMessagesAfterReply.json.find((message) => message.id === guestbook.json.id).admin_reply, '感谢你的留言');
  const auditPage = await request(base, '/admin/guestbook/audit', { headers: authHeaders, write: false });
  assert.equal(auditPage.response.status, 200);
  assert.match(auditPage.text, /批量删除/);
  assert.match(auditPage.text, /保存回复/);

  const form = new FormData();
  form.append('image', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'attack.png');
  const badUpload = await request(base, '/api/posts/upload-image', {
    method: 'POST', headers: authHeaders, body: form
  });
  assert.equal(badUpload.response.status, 400);

  const tracking = await request(base, '/api/track', {
    method: 'POST', json: {
      fingerprintId: 'integration-fingerprint', requestId: 'integration-request',
      path: '/integration', publicIp: '8.8.8.8'
    }
  });
  assert.equal(tracking.response.status, 200);
  assert.equal((await request(base, '/api/track', {
    method: 'POST', json: {}, headers: { Origin: 'https://evil.example' }
  })).response.status, 403);

  const rss = await request(base, '/rss.xml', { write: false });
  const sitemap = await request(base, '/sitemap.xml', { write: false });
  assert.match(rss.text, /integration-post/);
  assert.match(sitemap.text, /integration-work/);

  assert.equal((await request(base, `/api/posts/${post.json.id}`, {
    method: 'DELETE', headers: authHeaders
  })).response.status, 200);
  assert.equal((await request(base, `/api/works/${work.json.id}`, {
    method: 'DELETE', headers: authHeaders
  })).response.status, 200);
  assert.equal((await request(base, '/api/auth/logout', {
    method: 'POST', headers: authHeaders
  })).response.status, 200);
  assert.equal((await request(base, '/api/auth/status', { headers: authHeaders, write: false })).json.loggedIn, false);
});
