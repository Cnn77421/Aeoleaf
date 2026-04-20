(function () {
  // Dedicated IDs for the /search page; the header modal uses #search-input / #search-results.
  const searchInput = document.getElementById('search-page-input')
    || document.getElementById('search-input');
  const searchBtn = document.getElementById('search-page-btn')
    || document.getElementById('search-btn');
  const searchResults = document.getElementById('search-page-results')
    || document.getElementById('search-results');

  if (!searchInput || !searchBtn || !searchResults) return;

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function showMessage(text) {
    clear(searchResults);
    const p = document.createElement('p');
    p.style.color = 'var(--text-muted)';
    p.textContent = text;
    searchResults.appendChild(p);
  }

  function showLoading() {
    clear(searchResults);
    const wrap = document.createElement('div');
    wrap.className = 'search-results-loading';
    wrap.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'ui-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span');
    txt.textContent = '搜索中…';
    wrap.appendChild(spinner);
    wrap.appendChild(txt);
    searchResults.appendChild(wrap);
  }

  function renderPosts(posts) {
    const h2 = document.createElement('h2');
    h2.style.marginTop = '2rem';
    h2.textContent = `文章 (${posts.length})`;
    searchResults.appendChild(h2);

    const list = document.createElement('div');
    list.className = 'posts-list';
    posts.forEach((post) => {
      const article = document.createElement('article');
      article.className = 'post-item';

      const time = document.createElement('time');
      time.className = 'post-date';
      time.textContent = post.created_at ? new Date(post.created_at).toLocaleDateString() : '';
      article.appendChild(time);

      const a = document.createElement('a');
      a.className = 'post-title';
      a.href = '/blog/' + encodeURIComponent(post.slug || '');
      a.textContent = post.title || '';
      article.appendChild(a);

      if (post.excerpt) {
        const p = document.createElement('p');
        p.style.color = 'var(--text-muted)';
        p.style.marginTop = '0.5rem';
        p.textContent = post.excerpt;
        article.appendChild(p);
      }

      list.appendChild(article);
    });
    searchResults.appendChild(list);
  }

  function renderWorks(works) {
    const h2 = document.createElement('h2');
    h2.style.marginTop = '2rem';
    h2.textContent = `作品 (${works.length})`;
    searchResults.appendChild(h2);

    const grid = document.createElement('div');
    grid.className = 'works-grid';
    works.forEach((work) => {
      const a = document.createElement('a');
      a.className = 'work-card';
      a.href = '/works/' + encodeURIComponent(work.slug || '');

      if (work.cover_image) {
        const media = document.createElement('div');
        media.className = 'work-card__media';
        const img = document.createElement('img');
        img.src = work.cover_image;
        img.alt = work.title || '';
        img.className = 'work-image';
        img.loading = 'lazy';
        media.appendChild(img);
        a.appendChild(media);
      }

      const h3 = document.createElement('h3');
      h3.className = 'work-title';
      h3.textContent = work.title || '';
      a.appendChild(h3);

      if (work.year) {
        const yr = document.createElement('span');
        yr.className = 'work-year';
        yr.textContent = String(work.year);
        a.appendChild(yr);
      }

      grid.appendChild(a);
    });
    searchResults.appendChild(grid);
  }

  async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      showMessage('请输入搜索关键词');
      return;
    }
    if (query.length > 100) {
      showMessage('关键词过长');
      return;
    }

    showLoading();

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const posts = Array.isArray(data.posts) ? data.posts : [];
      const works = Array.isArray(data.works) ? data.works : [];

      if (posts.length === 0 && works.length === 0) {
        showMessage('没有找到相关结果');
        return;
      }

      clear(searchResults);
      if (posts.length > 0) renderPosts(posts);
      if (works.length > 0) renderWorks(works);
    } catch (err) {
      showMessage('搜索失败，请重试');
    }
  }

  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  if (searchInput.value) {
    performSearch();
  }
})();
