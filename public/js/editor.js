// Initialize EasyMDE editor
const contentEditor = document.getElementById('content-editor');
if (contentEditor && typeof EasyMDE !== 'undefined') {
  window.easyMDE = new EasyMDE({
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
    imageUploadFunction: async (file, onSuccess, onError) => {
      const formData = new FormData();
      formData.append('image', file);

      try {
        const res = await fetch('/api/posts/upload-image', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (res.ok) {
          onSuccess(data.url);
        } else {
          onError(data.error || 'Upload failed');
        }
      } catch (err) {
        onError(err.message);
      }
    }
  });
}
