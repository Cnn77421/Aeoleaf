const router = require('express').Router();
const { db } = require('../../config/db');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

function resolveBaseUrl(req) {
  const configured = String(process.env.BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/rss.xml', (req, res) => {
  const baseUrl = escapeXml(resolveBaseUrl(req));
  const siteTitle = getSetting('site_title') || 'aeoleaf';
  const siteSubtitle = getSetting('site_subtitle') || '风叶';

  const posts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' AND deleted_at = '' AND COALESCE(noindex, 0) = 0 ORDER BY created_at DESC LIMIT 20"
  ).all();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
  xml += '  <channel>\n';
  xml += `    <title>${escapeXml(siteTitle)}</title>\n`;
  xml += `    <link>${baseUrl}/blog</link>\n`;
  xml += `    <description>${escapeXml(siteSubtitle)}</description>\n`;
  xml += `    <language>zh-CN</language>\n`;
  xml += `    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml" />\n`;

  posts.forEach((post) => {
    const slug = escapeXml(post.slug);
    xml += '    <item>\n';
    xml += `      <title>${escapeXml(post.title)}</title>\n`;
    xml += `      <link>${baseUrl}/blog/${slug}</link>\n`;
    xml += `      <guid isPermaLink="true">${baseUrl}/blog/${slug}</guid>\n`;
    const d = new Date(post.created_at);
    if (!isNaN(d.getTime())) {
      xml += `      <pubDate>${escapeXml(d.toUTCString())}</pubDate>\n`;
    }

    if (post.excerpt) {
      xml += `      <description>${escapeXml(post.excerpt)}</description>\n`;
    }

    if (post.cover_image) {
      xml += `      <enclosure url="${baseUrl}${escapeXml(post.cover_image)}" type="image/jpeg" />\n`;
    }

    let tags = [];
    try { tags = JSON.parse(post.tags || '[]'); } catch {}
    if (Array.isArray(tags)) {
      tags.forEach((tag) => {
        xml += `      <category>${escapeXml(tag)}</category>\n`;
      });
    }

    xml += '    </item>\n';
  });

  xml += '  </channel>\n';
  xml += '</rss>';

  res.header('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
});

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
