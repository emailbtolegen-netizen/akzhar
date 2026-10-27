const express = require('express');
const { all } = require('../db');

const router = express.Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /*/ads/new\nSitemap: ${res.locals.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const base = res.locals.baseUrl;
  const pages = ['', '/history', '/phones', '/ads', '/news', '/about', '/contacts'];
  const news = all('SELECT id, published_at FROM news WHERE published = 1');
  const ads = all(`SELECT id, published_at FROM ads WHERE status = 'approved' AND (expires_at IS NULL OR expires_at > datetime('now'))`);
  const entry = (p, lastmod) => ['kk', 'ru'].map((l) => `<url><loc>${base}/${l}${p}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}` +
    `<xhtml:link rel="alternate" hreflang="kk" href="${base}/kk${p}"/><xhtml:link rel="alternate" hreflang="ru" href="${base}/ru${p}"/></url>`).join('');
  const body = [
    ...pages.map((p) => entry(p)),
    ...news.map((n) => entry(`/news/${n.id}`, n.published_at)),
    ...ads.map((a) => entry(`/ads/${a.id}`, a.published_at)),
  ].join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>`);
});

module.exports = router;
