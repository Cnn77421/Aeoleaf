// ── Admin PJAX navigation ────────────────────────────────────────────────────
(function () {
  var MAIN_SEL = 'main.admin-main';
  var NAV_SEL = '.admin-nav';
  var DURATION = 180;
  var _busy = false;
  var _loadedScripts = {};

  function shouldIntercept(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.download) return false;
    if (a.origin !== location.origin) return false;
    if (a.pathname === location.pathname && a.search === location.search && a.hash) return false;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return false;
    if (a.closest('form')) return false;
    return true;
  }

  function collectCurrentScripts() {
    document.querySelectorAll('script[src]').forEach(function (s) {
      _loadedScripts[s.src] = true;
    });
  }

  function loadScript(src) {
    if (_loadedScripts[src]) return Promise.resolve();
    _loadedScripts[src] = true;
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function execInlineScripts(container) {
    container.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      if (old.src) {
        if (!_loadedScripts[old.src]) {
          s.src = old.src;
          _loadedScripts[old.src] = true;
        } else {
          return;
        }
      } else {
        s.textContent = old.textContent;
      }
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
      } else {
        a.classList.remove('active');
      }
    });
  }

  async function pjaxNavigate(url, pushState) {
    if (_busy) return;
    _busy = true;
    var mainEl = document.querySelector(MAIN_SEL);
    if (!mainEl) { location.href = url; return; }

    mainEl.classList.add('pjax-out');

    try {
      var resp = await fetch(url);
      if (!resp.ok) throw new Error(resp.status);
      var html = await resp.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var newMain = doc.querySelector(MAIN_SEL);
      if (!newMain) throw new Error('no main');

      var headScripts = doc.querySelectorAll('head script[src]');
      for (var i = 0; i < headScripts.length; i++) {
        await loadScript(headScripts[i].src);
      }

      await new Promise(function (r) { setTimeout(r, DURATION); });

      mainEl.innerHTML = newMain.innerHTML;
      Array.from(newMain.attributes).forEach(function (attr) {
        mainEl.setAttribute(attr.name, attr.value);
      });

      execInlineScripts(mainEl);

      if (!mainEl.querySelector('#work-form') && !mainEl.querySelector('#post-form')) {
        window.__AEOL_ADMIN_CTX = { postId: null, workId: null };
      }

      var newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      if (pushState !== false) {
        history.pushState({ pjax: true }, '', url);
      }

      updateNav(url);
      mainEl.classList.remove('pjax-out');
      mainEl.classList.add('pjax-in');
      mainEl.addEventListener('animationend', function handler() {
        mainEl.classList.remove('pjax-in');
        mainEl.removeEventListener('animationend', handler);
      });

      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (e) {
      location.href = url;
      return;
    } finally {
      _busy = false;
    }
  }

  collectCurrentScripts();

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
  return window.__AEOL_ADMIN_CTX || {};
}

// Delete post
async function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  try {
    const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      Toast.success('Post deleted');
      setTimeout(() => location.reload(), 500);
    } else {
      Toast.error('Failed to delete');
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
  }
}

// Delete work
async function deleteWork(id) {
  if (!confirm('Delete this work?')) return;
  try {
    const res = await fetch(`/api/works/${id}`, { method: 'DELETE' });
    if (res.ok) {
      Toast.success('Work deleted');
      setTimeout(() => location.reload(), 500);
    } else {
      Toast.error('Failed to delete');
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
      Toast.success('Post saved');
      if (pid == null && resJson.id) {
        setTimeout(function () { location.href = '/admin/posts/' + resJson.id + '/edit'; }, 400);
      } else {
        setTimeout(function () { location.href = '/admin/posts'; }, 500);
      }
    } else {
      Toast.error(resJson.error || 'Failed to save');
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
      Toast.success('Work saved');
      if (wid == null && resJson.id) {
        setTimeout(function () { location.href = '/admin/works/' + resJson.id + '/edit'; }, 400);
      } else {
        setTimeout(function () { location.href = '/admin/works'; }, 500);
      }
    } else {
      Toast.error(resJson.error || 'Failed to save');
      submitBtn.classList.remove('btn-loading');
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
    submitBtn.classList.remove('btn-loading');
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
      Toast.success('Image uploaded');
      setTimeout(function () { location.reload(); }, 400);
    } else {
      Toast.error(resJson.error || ('Upload failed (' + res.status + ')'));
    }
  } catch (err) {
    Toast.error('Error: ' + err.message);
  }
  input.value = '';
});
