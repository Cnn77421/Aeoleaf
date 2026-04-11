const router = require('express').Router();
const { db } = require('../../config/db');

router.get('/sitemap.xml', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  // Get all published posts
  const posts = db.prepare(
    "SELECT slug, updated_at FROM posts WHERE status = 'published' ORDER BY updated_at DESC"
  ).all();

  // Get all works
  const works = db.prepare(
    'SELECT slug, updated_at FROM works ORDER BY updated_at DESC'
  ).all();

  // Build sitemap XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Homepage
  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/</loc>\n`;
  xml += '    <changefreq>daily</changefreq>\n';
  xml += '    <priority>1.0</priority>\n';
  xml += '  </url>\n';

  // Blog page
  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/blog</loc>\n`;
  xml += '    <changefreq>daily</changefreq>\n';
  xml += '    <priority>0.9</priority>\n';
  xml += '  </url>\n';

  // Works page
  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/works</loc>\n`;
  xml += '    <changefreq>weekly</changefreq>\n';
  xml += '    <priority>0.9</priority>\n';
  xml += '  </url>\n';

  // About page
  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/about</loc>\n`;
  xml += '    <changefreq>monthly</changefreq>\n';
  xml += '    <priority>0.8</priority>\n';
  xml += '  </url>\n';

  // All blog posts
  posts.forEach(post => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
    xml += `    <lastmod>${post.updated_at}</lastmod>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.7</priority>\n';
    xml += '  </url>\n';
  });

  // All works
  works.forEach(work => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/works/${work.slug}</loc>\n`;
    xml += `    <lastmod>${work.updated_at}</lastmod>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.7</priority>\n';
    xml += '  </url>\n';
  });

  xml += '</urlset>';

  res.header('Content-Type', 'application/xml');
  res.send(xml);
});

module.exports = router;
