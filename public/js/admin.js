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

// Post form submit
const postForm = document.getElementById('post-form');
if (postForm) {
  postForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = postForm.querySelector('button[type="submit"]');
    submitBtn.classList.add('btn-loading');

    const formData = new FormData(postForm);
    const data = Object.fromEntries(formData);
    if (window.easyMDE) {
      data.content = window.easyMDE.value();
    }

    const url = postId ? `/api/posts/${postId}` : '/api/posts';
    const method = postId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        Toast.success('Post saved');
        setTimeout(() => location.href = '/admin/posts', 500);
      } else {
        Toast.error('Failed to save');
        submitBtn.classList.remove('btn-loading');
      }
    } catch (err) {
      Toast.error('Error: ' + err.message);
      submitBtn.classList.remove('btn-loading');
    }
  });
}

// Work form submit
const workForm = document.getElementById('work-form');
if (workForm) {
  workForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = workForm.querySelector('button[type="submit"]');
    submitBtn.classList.add('btn-loading');

    const formData = new FormData(workForm);
    const data = Object.fromEntries(formData);
    data.featured = formData.get('featured') ? 1 : 0;
    if (window.easyMDE) {
      data.content = window.easyMDE.value();
    }

    const url = workId ? `/api/works/${workId}` : '/api/works';
    const method = workId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        Toast.success('Work saved');
        setTimeout(() => location.href = '/admin/works', 500);
      } else {
        Toast.error('Failed to save');
        submitBtn.classList.remove('btn-loading');
      }
    } catch (err) {
      Toast.error('Error: ' + err.message);
      submitBtn.classList.remove('btn-loading');
    }
  });
}

// Cover image upload
const coverUpload = document.getElementById('cover-upload');
if (coverUpload) {
  coverUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('cover', file);

    const id = postId || workId;
    const type = postId ? 'posts' : 'works';
    const url = `/api/${type}/${id}/cover`;

    try {
      const res = await fetch(url, { method: 'POST', body: formData });
      if (res.ok) {
        Toast.success('Image uploaded');
        setTimeout(() => location.reload(), 500);
      } else {
        Toast.error('Upload failed');
      }
    } catch (err) {
      Toast.error('Error: ' + err.message);
    }
  });
}
