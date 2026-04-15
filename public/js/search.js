(function () {
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const searchResults = document.getElementById('search-results');

  if (!searchInput || !searchBtn || !searchResults) return;

  async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      searchResults.innerHTML = '<p style="color: var(--text-muted);">请输入搜索关键词</p>';
      return;
    }

    searchResults.innerHTML =
      '<div class="search-results-loading" role="status">' +
      '<span class="ui-spinner" aria-hidden="true"></span>' +
      '<span>搜索中…</span></div>';

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.posts.length === 0 && data.works.length === 0) {
        searchResults.innerHTML = '<p style="color: var(--text-muted);">没有找到相关结果</p>';
        return;
      }

      let html = '';

      if (data.posts.length > 0) {
        html += '<h2 style="margin-top: 2rem;">文章 (' + data.posts.length + ')</h2><div class="posts-list">';
        data.posts.forEach(post => {
          html += `
          <article class="post-item">
            <time class="post-date">${new Date(post.created_at).toLocaleDateString()}</time>
            <a href="/blog/${post.slug}" class="post-title">${post.title}</a>
            ${post.excerpt ? '<p style="color: var(--text-muted); margin-top: 0.5rem;">' + post.excerpt + '</p>' : ''}
          </article>
        `;
        });
        html += '</div>';
      }

      if (data.works.length > 0) {
        html += '<h2 style="margin-top: 2rem;">作品 (' + data.works.length + ')</h2><div class="works-grid">';
        data.works.forEach(work => {
          html += `
          <a href="/works/${work.slug}" class="work-card">
            ${work.cover_image ? '<div class="work-card__media"><img src="' + work.cover_image + '" alt="' + work.title + '" class="work-image" loading="lazy"></div>' : ''}
            <h3 class="work-title">${work.title}</h3>
            ${work.year ? '<span class="work-year">' + work.year + '</span>' : ''}
          </a>
        `;
        });
        html += '</div>';
      }

      searchResults.innerHTML = html;
    } catch (error) {
      searchResults.innerHTML = '<p style="color: var(--text-muted);">搜索失败，请重试</p>';
    }
  }

  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  if (searchInput.value) {
    performSearch();
  }
})();
