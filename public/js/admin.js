// ── Admin PJAX navigation ────────────────────────────────────────────────────
(function () {
  var MAIN_SEL = 'main.admin-main';
  var NAV_SEL = '.admin-nav';
  var _busy = false;
  var _loadedScripts = {};
  var _loadedStyles = {};

  function shouldIntercept(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.hasAttribute('download')) return false;
    if (a.origin !== location.origin) return false;
    if (a.pathname === location.pathname && a.search === location.search && a.hash) return false;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return false;
    if (a.closest('form')) return false;
    return true;
  }

  function collectCurrentScripts() {
    document.querySelectorAll('script[src]').forEach(function (s) {
      _loadedScripts[s.src] = 'loaded';
    });
  }

  function collectCurrentStyles() {
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach(function (link) {
      _loadedStyles[link.href] = true;
    });
  }

  function loadScript(src) {
    if (_loadedScripts[src] === 'loaded') return Promise.resolve();
    if (_loadedScripts[src] && _loadedScripts[src].then) return _loadedScripts[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { _loadedScripts[src] = 'loaded'; resolve(); };
      s.onerror = function (e) { delete _loadedScripts[src]; reject(e); };
      document.head.appendChild(s);
    });
    _loadedScripts[src] = p;
    return p;
  }

  function loadStyle(href) {
    if (_loadedStyles[href]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = function () { _loadedStyles[href] = true; resolve(); };
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  async function loadPageAssets(doc) {
    var links = doc.querySelectorAll('link[rel="stylesheet"][href]');
    for (var i = 0; i < links.length; i++) {
      var href = new URL(links[i].getAttribute('href'), location.origin).href;
      if (new URL(href).origin !== location.origin) continue;
      await loadStyle(href);
    }
    var scripts = doc.querySelectorAll('script[src]');
    for (var j = 0; j < scripts.length; j++) {
      var src = new URL(scripts[j].getAttribute('src'), location.origin).href;
      await loadScript(src);
    }
  }

  function execInlineScripts(container) {
    container.querySelectorAll('script:not([src])').forEach(function (old) {
      if (old.type && old.type !== 'text/javascript' && old.type !== 'application/javascript') return;
      var s = document.createElement('script');
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
  }

  function updateNav(url) {
    var nav = document.querySelector(NAV_SEL);
    if (!nav) return;
    var path = url.replace(location.origin, '').split('?')[0].split('#')[0];
    nav.querySelectorAll('a').forEach(function (a) {
      var aPath = a.getAttribute('href') || '';
      if (path === aPath || (aPath !== '/admin/dashboard' && path.indexOf(aPath) === 0)) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      } else {
        a.classList.remove('active');
        a.removeAttribute('aria-current');
      }
    });
  }

  async function pjaxNavigate(url, pushState, options) {
    if (_busy) return;
    _busy = true;
    var opts = options || {};
    var savedScrollY = window.scrollY;
    var mainEl = document.querySelector(MAIN_SEL);
    if (!mainEl) { location.href = url; return; }
    mainEl.setAttribute('aria-busy', 'true');
    mainEl.classList.remove('admin-main-enter');
    mainEl.classList.add('admin-main-leave');

    try {
      var resp = await fetch(url, { headers: { 'X-PJAX': '1' } });
      if (!resp.ok) throw new Error(resp.status);
      var html = await resp.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var newMain = doc.querySelector(MAIN_SEL);
      if (!newMain) throw new Error('no main');
      var incomingPending = doc.querySelector('.admin-nav a[href="/admin/guestbook"] .admin-nav-count');

      await loadPageAssets(doc);
      document.dispatchEvent(new CustomEvent('admin:before-swap'));

      mainEl.innerHTML = newMain.innerHTML;
      Array.from(mainEl.attributes).forEach(function (attr) {
        mainEl.removeAttribute(attr.name);
      });
      Array.from(newMain.attributes).forEach(function (attr) {
        mainEl.setAttribute(attr.name, attr.value);
      });

      execInlineScripts(mainEl);
      initAdminPage();
      mainEl.classList.remove('admin-main-leave');
      mainEl.classList.add('admin-main-enter');
      window.setTimeout(function () { mainEl.classList.remove('admin-main-enter'); }, 220);

      var newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      if (pushState !== false) {
        history.pushState({ pjax: true }, '', url);
      }

      updateNav(url);
      updateGuestbookPendingBadge(incomingPending ? Number(incomingPending.dataset.count) || 0 : 0);
      mainEl.removeAttribute('aria-busy');

      if (opts.preserveScroll) {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      } else {
        var _hash = url.split('#')[1];
        if (_hash) {
          var _el = document.getElementById(_hash);
          if (_el) { _el.scrollIntoView({ behavior: 'instant' }); }
          else { window.scrollTo({ top: 0, behavior: 'instant' }); }
        } else {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      }
    } catch (e) {
      location.href = url;
      return;
    } finally {
      mainEl.removeAttribute('aria-busy');
      mainEl.classList.remove('admin-main-leave');
      _busy = false;
    }
  }

  collectCurrentScripts();
  collectCurrentStyles();

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var a = e.target.closest('a');
    if (!shouldIntercept(a)) return;
    e.preventDefault();
    pjaxNavigate(a.href);
  });

  window.addEventListener('popstate', function () {
    pjaxNavigate(location.href, false);
  });

  window.__adminPjax = pjaxNavigate;
})();

function adminCtx() {
  const main = document.querySelector('main.admin-main');
  return {
    postId: main && main.dataset.postId ? Number(main.dataset.postId) : null,
    workId: main && main.dataset.workId ? Number(main.dataset.workId) : null
  };
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = String(value == null ? '' : value);
  return node.innerHTML;
}

let contentAutosaveTimer = null;
let contentLocalSaveTimer = null;
let contentDraftDirty = false;

function editorDraftData(form) {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);
  if (form.id === 'work-form') data.featured = formData.get('featured') ? 1 : 0;
  if (window.easyMDE) data.content = window.easyMDE.value();
  return data;
}

function draftContext() {
  const form = document.getElementById('post-form') || document.getElementById('work-form');
  if (!form) return null;
  const type = form.id === 'post-form' ? 'posts' : 'works';
  const id = type === 'posts' ? adminCtx().postId : adminCtx().workId;
  return { form: form, type: type, id: id, key: 'aeoleaf:editor-draft:' + type + ':' + (id == null ? 'new' : id) };
}

function setDraftStatus(text, state) {
  const status = document.querySelector('[data-draft-status]');
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state || '';
}

function persistLocalDraft() {
  const ctx = draftContext();
  if (!ctx || !contentDraftDirty) return;
  try {
    localStorage.setItem(ctx.key, JSON.stringify({ savedAt: Date.now(), data: editorDraftData(ctx.form) }));
    setDraftStatus('已保存到本机', 'saved');
  } catch (_error) {
    setDraftStatus('本机草稿保存失败', 'error');
  }
}

async function persistServerDraft() {
  const ctx = draftContext();
  if (!ctx || ctx.id == null || !contentDraftDirty || document.hidden) return;
  try {
    const response = await fetch('/api/' + ctx.type + '/' + ctx.id + '/autosave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(editorDraftData(ctx.form))
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    contentDraftDirty = false;
    persistLocalDraft();
    setDraftStatus('草稿已自动保存', 'saved');
  } catch (_error) {
    setDraftStatus('自动保存失败，已保留本机草稿', 'error');
  }
}

function applyDraft(form, data) {
  Object.entries(data || {}).forEach(function (entry) {
    const field = form.elements.namedItem(entry[0]);
    if (!field || entry[0] === 'content') return;
    if (field.type === 'checkbox') field.checked = entry[1] === 1 || entry[1] === true || entry[1] === '1';
    else field.value = entry[1] == null ? '' : entry[1];
  });
  if (data && Object.prototype.hasOwnProperty.call(data, 'content')) {
    if (window.easyMDE) window.easyMDE.value(data.content || '');
    else {
      const textarea = form.querySelector('#content-editor');
      if (textarea) textarea.value = data.content || '';
    }
  }
}

function initContentAutosave() {
  const ctx = draftContext();
  if (!ctx) return;
  contentDraftDirty = false;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(ctx.key) || 'null'); } catch (_error) {}
  if (cached && cached.data && confirm('检测到未提交的本机草稿，是否恢复？')) {
    applyDraft(ctx.form, cached.data);
    contentDraftDirty = true;
    setDraftStatus('已恢复本机草稿', 'restored');
  }

  const markDirty = function () {
    contentDraftDirty = true;
    setDraftStatus('有未保存更改', 'dirty');
  };
  ctx.form.addEventListener('input', markDirty);
  ctx.form.addEventListener('change', markDirty);
  if (window.easyMDE && window.easyMDE.codemirror) window.easyMDE.codemirror.on('change', markDirty);
  contentLocalSaveTimer = window.setInterval(persistLocalDraft, 5000);
  contentAutosaveTimer = window.setInterval(persistServerDraft, 30000);
}

function clearCurrentDraft() {
  const ctx = draftContext();
  if (!ctx) return;
  try { localStorage.removeItem(ctx.key); } catch (_error) {}
  contentDraftDirty = false;
}

function toggleAdminTheme() {
  const root = document.documentElement;
  const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', nextTheme);
  try { localStorage.setItem('theme', nextTheme); } catch (_error) { /* storage can be disabled */ }
  if (document.getElementById('visitor-chart-data')) {
    (window.__adminCharts || []).forEach(function (chart) { chart.destroy(); });
    window.__adminCharts = [];
    initVisitorCharts();
  }
}

document.addEventListener('click', function (event) {
  if (event.target.closest('[data-admin-theme-toggle]')) toggleAdminTheme();
});

const trashSelectAll = document.querySelector('[data-trash-select-all]');
if (trashSelectAll) {
  trashSelectAll.addEventListener('change', function () {
    document.querySelectorAll('[data-trash-item]').forEach(function (checkbox) {
      checkbox.checked = trashSelectAll.checked;
    });
  });
}

document.addEventListener('keydown', function (event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    toggleAdminSidebar();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openAdminCommand();
  }
  if (event.key === 'Escape') {
    closeAdminCommand();
  }
});

function toggleAdminSidebar() {
  if (window.matchMedia('(max-width: 991.98px)').matches) {
    var mobileMenu = document.getElementById('admin-menu');
    if (mobileMenu) mobileMenu.classList.toggle('show');
    document.body.classList.toggle('admin-drawer-open', !!(mobileMenu && mobileMenu.classList.contains('show')));
    return;
  }
  document.body.classList.toggle('admin-sidebar-collapsed');
  try { localStorage.setItem('adminSidebarCollapsed', document.body.classList.contains('admin-sidebar-collapsed') ? '1' : '0'); } catch (_error) { /* storage can be disabled */ }
}

function openAdminCommand() {
  var command = document.querySelector('[data-admin-command]');
  if (!command) return;
  command.hidden = false;
  requestAnimationFrame(function () {
    command.classList.add('is-open');
    var input = command.querySelector('[data-admin-command-input]');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
  });
}

function closeAdminCommand() {
  var command = document.querySelector('[data-admin-command]');
  if (!command || command.hidden) return;
  command.classList.remove('is-open');
  window.setTimeout(function () {
    command.hidden = true;
    var trigger = document.querySelector('[data-admin-command-open]');
    if (trigger) trigger.focus();
  }, 200);
}

document.addEventListener('click', function (event) {
  if (event.target.closest('[data-admin-sidebar-toggle]')) toggleAdminSidebar();
  if (event.target.closest('[data-admin-command-open]')) openAdminCommand();
  if (event.target.closest('[data-admin-command-close]')) closeAdminCommand();
  if (event.target.closest('[data-admin-drawer-close]')) {
    var drawerMenu = document.getElementById('admin-menu');
    if (drawerMenu) drawerMenu.classList.remove('show');
    document.body.classList.remove('admin-drawer-open');
  }
  if (window.matchMedia('(max-width: 991.98px)').matches && event.target.closest('.admin-nav a')) {
    var mobileMenu = document.getElementById('admin-menu');
    if (mobileMenu) mobileMenu.classList.remove('show');
    document.body.classList.remove('admin-drawer-open');
  }
  if (event.target.closest('.admin-sidebar .navbar-toggler')) {
    window.setTimeout(function () {
      var menu = document.getElementById('admin-menu');
      document.body.classList.toggle('admin-drawer-open', !!(menu && menu.classList.contains('show')));
    }, 0);
  }
});

document.addEventListener('input', function (event) {
  if (!event.target.matches('[data-admin-command-input]')) return;
  var query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-admin-command-item]').forEach(function (item) {
    item.hidden = query && item.textContent.trim().toLowerCase().indexOf(query) === -1;
    item.removeAttribute('data-active');
  });
  var firstResult = document.querySelector('[data-admin-command-item]:not([hidden])');
  if (firstResult) firstResult.setAttribute('data-active', 'true');
});

document.addEventListener('keydown', function (event) {
  var command = document.querySelector('[data-admin-command]');
  if (!command || command.hidden || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  var items = Array.from(command.querySelectorAll('[data-admin-command-item]:not([hidden])'));
  if (!items.length) return;
  var activeIndex = items.findIndex(function (item) { return item.hasAttribute('data-active'); });
  if (event.key === 'Enter') {
    event.preventDefault();
    (items[Math.max(0, activeIndex)] || items[0]).click();
    return;
  }
  event.preventDefault();
  var nextIndex = event.key === 'ArrowDown'
    ? (activeIndex + 1) % items.length
    : (activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
  items.forEach(function (item) { item.removeAttribute('data-active'); });
  items[nextIndex].setAttribute('data-active', 'true');
  items[nextIndex].scrollIntoView({ block: 'nearest' });
});

document.addEventListener('submit', function (event) {
  var button = event.submitter || event.target.querySelector('button[type="submit"]');
  if (!button || button.classList.contains('is-loading')) return;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
});

try {
  if (localStorage.getItem('adminSidebarCollapsed') === '1' && !window.matchMedia('(max-width: 991.98px)').matches) {
    document.body.classList.add('admin-sidebar-collapsed');
  }
} catch (_error) { /* storage can be disabled */ }

function destroyAdminPage() {
  persistLocalDraft();
  if (contentAutosaveTimer) window.clearInterval(contentAutosaveTimer);
  if (contentLocalSaveTimer) window.clearInterval(contentLocalSaveTimer);
  contentAutosaveTimer = null;
  contentLocalSaveTimer = null;
  if (window.easyMDE) {
    try { window.easyMDE.toTextArea(); } catch (_error) { /* page is already leaving */ }
    window.easyMDE = null;
  }
  (window.__adminCharts || []).forEach(function (chart) {
    try { chart.destroy(); } catch (_error) { /* canvas is already leaving */ }
  });
  window.__adminCharts = [];
}

function initAdminEditor() {
  const contentEditor = document.getElementById('content-editor');
  if (!contentEditor || typeof window.EasyMDE === 'undefined' || window.easyMDE) return;
  window.easyMDE = new window.EasyMDE({
    element: contentEditor,
    spellChecker: false,
    status: ['lines', 'words'],
    minHeight: '400px',
    toolbar: [
      'bold', 'italic', 'heading', '|',
      'quote', 'code', 'unordered-list', 'ordered-list', '|',
      'link', 'image', '|',
      'preview', 'side-by-side', 'fullscreen', '|',
      'guide'
    ],
    uploadImage: true,
    imageUploadFunction: async function (file, onSuccess, onError) {
      const formData = new FormData();
      formData.append('image', file);
      try {
        const response = await fetch('/api/posts/upload-image', {
          method: 'POST', body: formData, credentials: 'same-origin'
        });
        const result = await response.json();
        if (response.ok) onSuccess(result.url);
        else onError(result.error || 'Upload failed');
      } catch (error) {
        onError(error.message);
      }
    }
  });
}

function initVisitorCharts() {
  const dataElement = document.getElementById('visitor-chart-data');
  if (!dataElement || typeof window.Chart === 'undefined') return;
  let data;
  try { data = JSON.parse(dataElement.textContent); } catch (_error) { return; }
  const trendRows = data.trendRows || [];
  const regionRows = data.regionRows || [];
  const topPages = data.topPages || [];
  const charts = [];
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const chartPrimary = isDark ? '#fafafa' : '#18181b';
  const chartSecondary = isDark ? '#a1a1aa' : '#71717a';
  const chartGrid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(24,24,27,0.08)';
  const chartSurface = isDark ? '#18181b' : '#ffffff';
  const chartText = isDark ? '#fafafa' : '#18181b';
  const commonPlugins = {
    legend: { display: false },
    tooltip: {
      backgroundColor: chartSurface,
      titleColor: chartText,
      bodyColor: chartSecondary,
      borderColor: chartGrid,
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      displayColors: true,
      usePointStyle: true
    }
  };
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 650, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: commonPlugins
  };
  const valueAxis = {
    beginAtZero: true,
    border: { display: false },
    grid: { color: chartGrid },
    ticks: { color: chartSecondary, font: { size: 12 }, precision: 0, padding: 8 }
  };
  const categoryAxis = {
    border: { display: false },
    grid: { display: false },
    ticks: { color: chartSecondary, font: { size: 12 }, padding: 8 }
  };

  function shortDate(value) {
    const date = new Date(String(value || '') + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? value : (date.getMonth() + 1) + '/' + date.getDate();
  }

  function shortRegion(value) {
    const parts = String(value || '').split(' / ').filter(Boolean);
    if (parts.length >= 3) return parts[1] + ' ' + parts[2];
    if (parts.length === 2) return parts[1];
    return parts[0] || '未知';
  }

  function shortPath(value) {
    const path = String(value || '/');
    return path.length > 20 ? path.slice(0, 18) + '…' : path;
  };

  if (trendRows.length && document.getElementById('trendChart')) {
    charts.push(new window.Chart(document.getElementById('trendChart'), {
      type: 'line',
      data: {
        labels: trendRows.map(function (row) { return shortDate(row.d); }),
        datasets: [
          { label: 'PV', data: trendRows.map(function (row) { return row.pv; }), borderColor: chartPrimary, backgroundColor: isDark ? 'rgba(250,250,250,0.12)' : 'rgba(24,24,27,0.12)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, tension: 0.35, fill: true },
          { label: 'UV', data: trendRows.map(function (row) { return row.uv; }), borderColor: chartSecondary, backgroundColor: isDark ? 'rgba(161,161,170,0.08)' : 'rgba(113,113,122,0.08)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, tension: 0.35, fill: true }
        ]
      },
      options: Object.assign({}, commonOptions, { scales: { x: categoryAxis, y: valueAxis } })
    }));
  }

  if (regionRows.length && document.getElementById('regionChart')) {
    const visibleRegions = regionRows.slice(0, 8);
    charts.push(new window.Chart(document.getElementById('regionChart'), {
      type: 'bar',
      data: {
        labels: visibleRegions.map(function (row) { return shortRegion(row.region); }),
        datasets: [{ label: 'PV', data: visibleRegions.map(function (row) { return row.pv; }), backgroundColor: chartSecondary, borderRadius: 4, borderSkipped: false, maxBarThickness: 18 }]
      },
      options: Object.assign({}, commonOptions, { indexAxis: 'y', scales: { x: valueAxis, y: categoryAxis } })
    }));
  }

  if (topPages.length && document.getElementById('pagesChart')) {
    charts.push(new window.Chart(document.getElementById('pagesChart'), {
      type: 'bar',
      data: {
        labels: topPages.map(function (row) { return shortPath(row.path); }),
        datasets: [{ label: 'PV', data: topPages.map(function (row) { return row.pv; }), backgroundColor: chartPrimary, borderRadius: 4, borderSkipped: false, maxBarThickness: 28 }]
      },
      options: Object.assign({}, commonOptions, { scales: { x: categoryAxis, y: valueAxis } })
    }));
  }
  window.__adminCharts = charts;
}

function filterAdminList() {
  const search = document.querySelector('[data-admin-list-search]');
  const status = document.querySelector('[data-admin-list-status]');
  const rows = Array.from(document.querySelectorAll('[data-admin-filter-row]'));
  if (!rows.length) return;
  const query = search ? search.value.trim().toLowerCase() : '';
  const selectedStatus = status ? status.value : '';
  let visibleCount = 0;
  rows.forEach(function (row) {
    const matchesSearch = !query || (row.dataset.search || '').includes(query);
    const matchesStatus = !selectedStatus || row.dataset.status === selectedStatus;
    row.hidden = !(matchesSearch && matchesStatus);
    if (!row.hidden) visibleCount += 1;
  });
  const empty = document.querySelector('[data-admin-filter-empty]');
  if (empty) empty.hidden = visibleCount !== 0;
}

document.addEventListener('input', function (event) {
  if (event.target.matches('[data-admin-list-search]')) filterAdminList();
});

document.addEventListener('change', function (event) {
  if (event.target.matches('[data-admin-list-status]')) filterAdminList();
});

document.addEventListener('click', function (event) {
  const settingsLink = event.target.closest('.settings-nav a');
  if (!settingsLink) return;
  document.querySelectorAll('.settings-nav a').forEach(function (link) { link.classList.remove('active'); });
  settingsLink.classList.add('active');
});

document.addEventListener('click', function (event) {
  const analyticsTab = event.target.closest('.visitors-page-tabs a');
  if (!analyticsTab) return;
  document.querySelectorAll('.visitors-page-tabs a').forEach(function (link) {
    const active = link === analyticsTab;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
});

let settingsSectionObserver = null;

function initSettingsSectionNavigation() {
  if (settingsSectionObserver) {
    settingsSectionObserver.disconnect();
    settingsSectionObserver = null;
  }

  const nav = document.querySelector('.settings-nav');
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
  const sections = links.map(function (link) {
    return document.querySelector(link.getAttribute('href'));
  }).filter(Boolean);
  if (!sections.length) return;

  function activateSection(id) {
    links.forEach(function (link) {
      const active = link.getAttribute('href') === '#' + id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  if (!('IntersectionObserver' in window)) return;

  settingsSectionObserver = new IntersectionObserver(function (entries) {
    const visible = entries.filter(function (entry) { return entry.isIntersecting; });
    if (!visible.length) return;
    visible.sort(function (a, b) {
      return Math.abs(a.boundingClientRect.top - 96) - Math.abs(b.boundingClientRect.top - 96);
    });
    activateSection(visible[0].target.id);
  }, {
    root: null,
    rootMargin: '-80px 0px -65% 0px',
    threshold: 0
  });

  sections.forEach(function (section) { settingsSectionObserver.observe(section); });
}

function initAdminPage() {
  initAdminEditor();
  initContentAutosave();
  initVisitorCharts();
  filterAdminList();
  initSettingsSectionNavigation();
  document.dispatchEvent(new CustomEvent('admin:page-ready', { detail: { url: location.href } }));
}

document.addEventListener('admin:before-swap', destroyAdminPage);

function updateGuestbookPendingBadge(count) {
  const link = document.querySelector('.admin-nav a[href="/admin/guestbook"]');
  if (!link) return;
  let badge = link.querySelector('.admin-nav-count');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'admin-nav-count';
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.dataset.count = String(count);
    badge.setAttribute('aria-label', count + ' 条待审核');
  } else if (badge) {
    badge.remove();
  }
}

function nextGuestbookFocusId(form) {
  const cards = Array.from(document.querySelectorAll('.guestbook-admin-card[data-message-id]'));
  const current = form.closest('.guestbook-admin-card');
  if (current) {
    const index = cards.indexOf(current);
    const next = cards[index + 1] || cards[index - 1];
    return next ? next.dataset.messageId : '';
  }
  const selected = new Set(new FormData(form).getAll('message_ids').map(String));
  const remaining = cards.find(function (card) { return !selected.has(card.dataset.messageId); });
  return remaining ? remaining.dataset.messageId : '';
}

document.addEventListener('submit', async function (e) {
  const form = e.target.closest('form[data-guestbook-form]');
  if (!form || e.defaultPrevented || form.dataset.submitting === '1') return;
  e.preventDefault();

  const submitter = e.submitter;
  const formData = new FormData(form);
  if (submitter && submitter.name) formData.set(submitter.name, submitter.value);
  const requestBody = new URLSearchParams();
  formData.forEach(function (value, key) {
    if (typeof value === 'string') requestBody.append(key, value);
  });
  const focusId = nextGuestbookFocusId(form);
  const buttons = Array.from(form.querySelectorAll('button[type="submit"]'));
  form.dataset.submitting = '1';
  buttons.forEach(function (button) { button.disabled = true; });

  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: requestBody,
      credentials: 'same-origin'
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok || !result.ok) throw new Error(result.error || ('HTTP ' + response.status));

    updateGuestbookPendingBadge(Number(result.counts && result.counts.pending) || 0);
    Toast.success(result.notice || '留言已更新');
    await window.__adminPjax(location.href, false, { silent: true, preserveScroll: true });
    const focusCard = focusId && document.querySelector('.guestbook-admin-card[data-message-id="' + focusId + '"]');
    if (focusCard) focusCard.focus({ preventScroll: true });
  } catch (error) {
    Toast.error(error.message || '操作失败，请稍后重试');
    delete form.dataset.submitting;
    buttons.forEach(function (button) { button.disabled = false; });
  }
});

// Delete post
async function deletePost(id) {
  if (!confirm('确定删除这篇文章吗？')) return;
  try {
    const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      Toast.success('文章已删除');
      const fromEditor = /\/admin\/posts\/\d+\/edit$/.test(location.pathname);
      await window.__adminPjax(fromEditor ? '/admin/posts' : location.href, fromEditor, { silent: true, preserveScroll: !fromEditor });
    } else {
      Toast.error('删除失败');
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
  }
}

// Delete work
async function deleteWork(id) {
  if (!confirm('确定删除这个作品吗？')) return;
  try {
    const res = await fetch(`/api/works/${id}`, { method: 'DELETE' });
    if (res.ok) {
      Toast.success('作品已删除');
      const fromEditor = /\/admin\/works\/\d+\/edit$/.test(location.pathname);
      await window.__adminPjax(fromEditor ? '/admin/works' : location.href, fromEditor, { silent: true, preserveScroll: !fromEditor });
    } else {
      Toast.error('删除失败');
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
  }
}

// Post / work forms: delegate so bindings survive admin PJAX (main innerHTML swap).
document.addEventListener('submit', async function (e) {
  const postForm = e.target;
  if (!postForm || postForm.id !== 'post-form') return;
  e.preventDefault();
  const submitBtn = postForm.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  submitBtn.classList.add('btn-loading');

  const formData = new FormData(postForm);
  const data = Object.fromEntries(formData);
  if (window.easyMDE) {
    data.content = window.easyMDE.value();
  }

  const coverInput = postForm.querySelector('#cover-upload');
  const coverFile = coverInput && coverInput.files && coverInput.files[0];

  const pid = adminCtx().postId;
  const url = pid != null ? '/api/posts/' + pid : '/api/posts';
  const method = pid != null ? 'PUT' : 'POST';

  try {
    var res;
    if (coverFile) {
      var fdPost = new FormData(postForm);
      if (window.easyMDE) fdPost.set('content', data.content);
      fdPost.append('cover', coverFile, coverFile.name);
      res = await fetch(url, { method: method, body: fdPost, credentials: 'same-origin' });
    } else {
      res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin'
      });
    }
    const resJson = await res.json().catch(() => ({}));
    if (res.ok) {
      clearCurrentDraft();
      Toast.success('文章已保存');
      if (pid == null && resJson.id) {
        await window.__adminPjax('/admin/posts/' + resJson.id + '/edit', true);
      } else {
        await window.__adminPjax('/admin/posts', true);
      }
    } else {
      Toast.error(resJson.error || '保存失败');
      submitBtn.classList.remove('btn-loading');
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
    submitBtn.classList.remove('btn-loading');
  }
});

document.addEventListener('submit', async function (e) {
  const workForm = e.target;
  if (!workForm || workForm.id !== 'work-form') return;
  e.preventDefault();
  const submitBtn = workForm.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  submitBtn.classList.add('btn-loading');

  const formData = new FormData(workForm);
  const data = Object.fromEntries(formData);
  data.featured = formData.get('featured') ? 1 : 0;
  if (window.easyMDE) {
    data.content = window.easyMDE.value();
  }

  const coverInput = workForm.querySelector('#cover-upload');
  const coverFile = coverInput && coverInput.files && coverInput.files[0];

  const wid = adminCtx().workId;
  const url = wid != null ? '/api/works/' + wid : '/api/works';
  const method = wid != null ? 'PUT' : 'POST';

  try {
    var res;
    if (coverFile) {
      var fdWork = new FormData(workForm);
      if (window.easyMDE) fdWork.set('content', data.content);
      fdWork.set('featured', data.featured ? '1' : '0');
      fdWork.append('cover', coverFile, coverFile.name);
      res = await fetch(url, { method: method, body: fdWork, credentials: 'same-origin' });
    } else {
      res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin'
      });
    }
    const resJson = await res.json().catch(() => ({}));
    if (res.ok) {
      clearCurrentDraft();
      Toast.success('作品已保存');
      if (wid == null && resJson.id) {
        await window.__adminPjax('/admin/works/' + resJson.id + '/edit', true);
      } else {
        await window.__adminPjax('/admin/works', true);
      }
    } else {
      Toast.error(resJson.error || '保存失败');
      submitBtn.classList.remove('btn-loading');
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
    submitBtn.classList.remove('btn-loading');
  }
});

document.addEventListener('click', async function (event) {
  const toggle = event.target.closest('[data-revisions-toggle]');
  const restore = event.target.closest('[data-revision-restore]');
  const compare = event.target.closest('[data-revision-compare]');
  if (!toggle && !restore && !compare) return;
  const ctx = draftContext();
  if (!ctx || ctx.id == null) return;
  const list = document.querySelector('[data-revisions-list]');
  if (!list) return;

  if (compare) {
    const revision = (window.__contentRevisions || []).find(function (item) { return String(item.id) === compare.dataset.revisionCompare; });
    if (!revision) return;
    const current = editorDraftData(ctx.form);
    const labels = { title: '标题', slug: 'URL 别名', excerpt: '摘要', description: '摘要', content: '正文', tags: '标签', status: '状态', url: '外部链接', year: '年份', date: '日期', featured: '精选', sort_order: '排序', cover_image: '封面', images: '图片' };
    const changes = Object.keys(revision.snapshot || {}).filter(function (key) {
      return String(revision.snapshot[key] == null ? '' : revision.snapshot[key]) !== String(current[key] == null ? '' : current[key]);
    });
    const target = compare.closest('.revision-item').querySelector('[data-revision-diff]');
    if (!target) return;
    target.hidden = !target.hidden;
    target.innerHTML = changes.length ? changes.map(function (key) {
      const oldValue = String(revision.snapshot[key] == null ? '' : revision.snapshot[key]);
      const newValue = String(current[key] == null ? '' : current[key]);
      return '<div><strong>' + escapeHtml(labels[key] || key) + '</strong><small>历史：' + escapeHtml(oldValue.slice(0, 180) || '（空）') + '</small><small>当前：' + escapeHtml(newValue.slice(0, 180) || '（空）') + '</small></div>';
    }).join('') : '<p>此版本与当前表单一致</p>';
    return;
  }

  if (restore) {
    if (!confirm('恢复此历史版本？当前内容会先自动保存为可恢复版本。')) return;
    const response = await fetch('/api/' + ctx.type + '/' + ctx.id + '/revisions/' + restore.dataset.revisionRestore + '/restore', {
      method: 'POST', credentials: 'same-origin'
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) return Toast.error(result.error || '版本恢复失败');
    clearCurrentDraft();
    Toast.success('历史版本已恢复');
    return window.__adminPjax(location.href, false, { preserveScroll: true });
  }

  list.hidden = !list.hidden;
  if (list.hidden || list.dataset.loaded === '1') return;
  list.innerHTML = '<p class="revision-empty">正在加载…</p>';
  try {
    const response = await fetch('/api/' + ctx.type + '/' + ctx.id + '/revisions', { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '加载失败');
    list.dataset.loaded = '1';
    window.__contentRevisions = result.revisions;
    list.innerHTML = result.revisions.length ? result.revisions.map(function (revision) {
      const title = revision.snapshot && revision.snapshot.title ? revision.snapshot.title : '未命名版本';
      return '<div class="revision-item"><span><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(revision.created_at) + ' · ' + escapeHtml(revision.source) + '</small></span><span class="revision-actions"><button type="button" class="btn-secondary btn-sm" data-revision-compare="' + revision.id + '">对比</button><button type="button" class="btn-secondary btn-sm" data-revision-restore="' + revision.id + '">恢复</button></span><div class="revision-diff" data-revision-diff hidden></div></div>';
    }).join('') : '<p class="revision-empty">还没有历史版本</p>';
  } catch (error) {
    list.innerHTML = '<p class="revision-empty">' + escapeHtml(error.message || '加载失败') + '</p>';
  }
});

function coverUploadTarget() {
  const c = adminCtx();
  if (c.workId != null) {
    return { id: c.workId, type: 'works' };
  }
  if (c.postId != null) {
    return { id: c.postId, type: 'posts' };
  }
  return { id: null, type: null };
}

document.addEventListener('change', async function (e) {
  const input = e.target;
  if (!input || input.id !== 'cover-upload') return;

  const file = input.files && input.files[0];
  if (!file) return;

  const target = coverUploadTarget();
  if (target.id == null) {
    return;
  }

  const formData = new FormData();
  formData.append('cover', file);
  const url = '/api/' + target.type + '/' + target.id + '/cover';

  try {
    const res = await fetch(url, { method: 'POST', body: formData, credentials: 'same-origin' });
    const resJson = await res.json().catch(function () { return {}; });
    if (res.ok) {
      Toast.success('图片已上传');
      await window.__adminPjax(location.href, false, { silent: true, preserveScroll: true });
    } else {
      Toast.error(resJson.error || ('上传失败（' + res.status + '）'));
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
  }
  input.value = '';
});

// Media URL copy and work ordering use delegated events so both keep working
// after the admin shell swaps page content through PJAX.
document.addEventListener('click', async function (e) {
  const copyButton = e.target.closest('.media-copy');
  if (copyButton) {
    const value = copyButton.dataset.url || '';
    try {
      await navigator.clipboard.writeText(location.origin + value);
      Toast.success('图片地址已复制');
    } catch (_err) {
      const input = copyButton.parentElement && copyButton.parentElement.querySelector('input');
      if (input) { input.select(); document.execCommand('copy'); }
      Toast.success('图片地址已复制');
    }
    return;
  }

  const blacklistAdd = e.target.closest('[data-blacklist-add]');
  const blacklistRemove = e.target.closest('[data-blacklist-remove]');
  if (blacklistAdd || blacklistRemove) {
    const ip = (blacklistAdd || blacklistRemove).dataset.ip || '';
    const removing = Boolean(blacklistRemove);
    if (!ip) return;
    const prompt = removing
      ? '确定将 ' + ip + ' 从黑名单中移除？'
      : '确定要将 ' + ip + ' 加入黑名单？该 IP 将无法访问网站。';
    if (!confirm(prompt)) return;
    try {
      const response = await fetch(removing ? '/admin/visitors/blacklist/remove' : '/admin/visitors/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ip: ip, reason: removing ? '' : '手动拉黑' })
      });
      const result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.error || '操作失败');
      Toast.success(removing ? '已移出黑名单' : '已加入黑名单');
      await window.__adminPjax(location.href, false, { silent: true, preserveScroll: true });
    } catch (error) {
      Toast.error(error.message || '网络错误');
    }
    return;
  }

  const orderButton = e.target.closest('.work-order-btn');
  if (!orderButton) return;
  const card = orderButton.closest('.work-admin-card');
  const container = card && card.parentElement;
  if (!card || !container) return;
  const direction = orderButton.dataset.direction;
  if (direction === 'up' && card.previousElementSibling) {
    container.insertBefore(card, card.previousElementSibling);
  } else if (direction === 'down' && card.nextElementSibling) {
    container.insertBefore(card.nextElementSibling, card);
  } else {
    return;
  }
  persistWorkOrder(container);
});

document.addEventListener('submit', async function (e) {
  const form = e.target.closest('form[data-blacklist-form]');
  if (!form) return;
  e.preventDefault();
  const ip = String(new FormData(form).get('ip') || '').trim();
  const reason = String(new FormData(form).get('reason') || '').trim();
  if (!ip) return;
  try {
    const response = await fetch('/admin/visitors/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ip: ip, reason: reason })
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.error || '操作失败');
    Toast.success('已加入黑名单');
    await window.__adminPjax(location.href, false, { silent: true, preserveScroll: true });
  } catch (error) {
    Toast.error(error.message || '网络错误');
  }
});

document.addEventListener('submit', async function (e) {
  const form = e.target.closest('form[data-admin-async-form]');
  if (!form || e.defaultPrevented || form.dataset.submitting === '1') return;
  e.preventDefault();
  const submitButton = e.submitter || form.querySelector('button[type="submit"]');
  form.dataset.submitting = '1';
  if (submitButton) submitButton.disabled = true;
  try {
    const formData = new FormData(form);
    const multipart = form.enctype === 'multipart/form-data';
    const headers = { Accept: 'application/json' };
    let body = formData;
    if (!multipart) {
      body = new URLSearchParams();
      formData.forEach(function (value, key) {
        if (typeof value === 'string') body.append(key, value);
      });
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    const response = await fetch(form.action, {
      method: (form.method || 'POST').toUpperCase(),
      headers: headers,
      credentials: 'same-origin',
      body: body
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok || !result.ok) throw new Error(result.error || ('HTTP ' + response.status));
    Toast.success(result.notice || '操作已完成');
    await window.__adminPjax(location.href, false, { silent: true, preserveScroll: true });
  } catch (error) {
    Toast.error(error.message || '操作失败');
    delete form.dataset.submitting;
    if (submitButton) submitButton.disabled = false;
  }
});

document.addEventListener('submit', function (e) {
  const form = e.target.closest('form[data-admin-pjax-form]');
  if (!form || e.defaultPrevented) return;
  e.preventDefault();
  const target = new URL(form.action, location.origin);
  target.search = new URLSearchParams(new FormData(form)).toString();
  window.__adminPjax(target.href, true);
});

let draggedWorkCard = null;

document.addEventListener('dragstart', function (e) {
  const card = e.target.closest('.work-admin-card[draggable="true"]');
  if (!card) return;
  draggedWorkCard = card;
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.workId || '');
});

document.addEventListener('dragover', function (e) {
  const target = e.target.closest('.work-admin-card[draggable="true"]');
  if (!target || !draggedWorkCard || target === draggedWorkCard) return;
  e.preventDefault();
  const box = target.getBoundingClientRect();
  const insertAfter = e.clientY > box.top + box.height / 2;
  target.parentElement.insertBefore(draggedWorkCard, insertAfter ? target.nextElementSibling : target);
});

document.addEventListener('drop', function (e) {
  if (!draggedWorkCard) return;
  e.preventDefault();
  persistWorkOrder(draggedWorkCard.parentElement);
});

document.addEventListener('dragend', function () {
  if (draggedWorkCard) draggedWorkCard.classList.remove('is-dragging');
  draggedWorkCard = null;
});

document.addEventListener('change', function (e) {
  const selectAll = e.target.closest('[data-guestbook-select-all]');
  const messageCheckbox = e.target.closest('.guestbook-select');
  if (!selectAll && !messageCheckbox) return;

  const checkboxes = Array.from(document.querySelectorAll('.guestbook-select'));
  if (selectAll) checkboxes.forEach(function (checkbox) { checkbox.checked = selectAll.checked; });
  const selected = checkboxes.filter(function (checkbox) { return checkbox.checked; });
  const counter = document.querySelector('[data-guestbook-selected]');
  if (counter) counter.textContent = '已选 ' + selected.length + ' 条';
  document.querySelectorAll('[data-guestbook-bulk-button]').forEach(function (button) {
    button.disabled = selected.length === 0;
  });
  const master = document.querySelector('[data-guestbook-select-all]');
  if (master && !selectAll) {
    master.checked = selected.length === checkboxes.length;
    master.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
  }
});

async function persistWorkOrder(container) {
  const status = document.getElementById('work-order-status');
  const cards = Array.from(container.querySelectorAll('.work-admin-card[data-work-id]'));
  const order = cards.map(function (card, index) {
    return { id: Number(card.dataset.workId), sort_order: index };
  });
  if (status) status.textContent = '正在保存…';
  try {
    const res = await fetch('/api/works/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ order: order })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (status) status.textContent = '顺序已保存';
    Toast.success('作品顺序已保存');
  } catch (_err) {
    if (status) status.textContent = '保存失败，请刷新后重试';
    Toast.error('作品顺序保存失败');
  }
}

initAdminPage();
