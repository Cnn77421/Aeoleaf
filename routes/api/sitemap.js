const router = require('express').Router();
const { db } = require('../../config/db');

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Convert `YYYY-MM-DD HH:MM:SS` (SQLite default) to W3C datetime (`YYYY-MM-DDTHH:MM:SSZ`).
function toW3CDate(s) {
  if (!s) return '';
  const str = String(s).trim();
  // Already ISO-ish? pass through.
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str;
  const m = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}Z`;
  return str;
}

router.get('/sitemap.xml', (req, res) => {
  const baseUrl = escapeXml(process.env.BASE_URL || 'http://localhost:3000');

  const posts = db.prepare(
    "SELECT slug, updated_at FROM posts WHERE status = 'published' ORDER BY updated_at DESC"
  ).all();

  const works = db.prepare(
    'SELECT slug, updated_at FROM works ORDER BY updated_at DESC'
  ).all();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/</loc>\n`;
  xml += '    <changefreq>daily</changefreq>\n';
  xml += '    <priority>1.0</priority>\n';
  xml += '  </url>\n';

  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/blog</loc>\n`;
  xml += '    <changefreq>daily</changefreq>\n';
  xml += '    <priority>0.9</priority>\n';
  xml += '  </url>\n';

  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/works</loc>\n`;
  xml += '    <changefreq>weekly</changefreq>\n';
  xml += '    <priority>0.9</priority>\n';
  xml += '  </url>\n';

  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/about</loc>\n`;
  xml += '    <changefreq>monthly</changefreq>\n';
  xml += '    <priority>0.8</priority>\n';
  xml += '  </url>\n';

  posts.forEach((post) => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/blog/${escapeXml(post.slug)}</loc>\n`;
    if (post.updated_at) xml += `    <lastmod>${escapeXml(toW3CDate(post.updated_at))}</lastmod>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.7</priority>\n';
    xml += '  </url>\n';
  });

  works.forEach((work) => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/works/${escapeXml(work.slug)}</loc>\n`;
    if (work.updated_at) xml += `    <lastmod>${escapeXml(toW3CDate(work.updated_at))}</lastmod>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.7</priority>\n';
    xml += '  </url>\n';
  });

  xml += '</urlset>';

  res.header('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
});

module.exports = router;
