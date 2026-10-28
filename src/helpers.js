// Functions available inside every EJS template.
const { t, formatDate, pick, LANGS } = require('./i18n');
const icons = require('./icons');

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plain text from the admin panel -> safe HTML paragraphs.
function paragraphs(text) {
  return String(text ?? '').trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

const digits = (p) => String(p ?? '').replace(/\D/g, '');

// 87122397365 -> 8 (7122) 39-73-65; 87758815733 -> 8 (775) 881-57-33; 160 -> 160
function phoneDisplay(p) {
  let d = digits(p);
  if (d.length === 11 && d[0] === '7') d = '8' + d.slice(1);
  if (d.length !== 11) return String(p ?? '');
  if (d.startsWith('87122')) return `8 (7122) ${d.slice(5, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return `8 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}
function phoneHref(p) {
  const d = digits(p);
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) return 'tel:+7' + d.slice(1);
  return 'tel:' + d;
}
function whatsappHref(p) {
  const d = digits(p);
  return d.length === 11 ? 'https://wa.me/7' + d.slice(1) : '';
}

function formatPrice(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₸';
}

// YouTube/Vimeo/Google Drive link -> embeddable player URL (or '' if not embeddable)
function embedUrl(url) {
  const u = String(url || '');
  let m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0`;
  m = u.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}?autoplay=1`;
  m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return '';
}

function excerpt(text, n = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
}

// Responsive images: if smaller copies exist next to the file (name-480.jpg, name-960.jpg,
// made by `npm run media`), return srcset/sizes so phones download the small one.
const fs = require('node:fs');
const path = require('node:path');
const PUBLIC = path.join(__dirname, '..', 'public');
const variantCache = new Map();
function respImg(url, sizes = '100vw') {
  const u = String(url || '');
  if (!u.startsWith('/media/') || !u.endsWith('.jpg')) return '';
  if (!variantCache.has(u)) {
    const base = u.slice(0, -4);
    const found = [480, 960].filter((w) => fs.existsSync(path.join(PUBLIC, `${base}-${w}.jpg`)));
    const full = /hero-poster/.test(u) ? 1280 : 1600;
    variantCache.set(u, found.length ? [...found.map((w) => `${base}-${w}.jpg ${w}w`), `${u} ${full}w`].join(', ') : '');
  }
  const set = variantCache.get(u);
  return set ? ` srcset="${set}" sizes="${sizes}"` : '';
}

function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true" viewBox="0 0 24 24">${icons[name] || icons.dot}</svg>`;
}

// Sets per-request language helpers (used by the public router and the 404 page).
function setLang(req, res, lang) {
  const rest = req.originalUrl.replace(/^\/(kk|ru)(?=\/|$|\?)/, '');
  Object.assign(res.locals, {
    lang,
    t: t(lang),
    p: (obj, field) => pick(obj, field, lang),
    date: (v) => formatDate(v, lang),
    url: (p = '') => `/${lang}${p}`,
    altLangs: LANGS.map((l) => ({ code: l, href: `/${l}${rest.split('#')[0]}`, active: l === lang })),
    pathNoLang: rest.split('?')[0] || '/',
  });
}

module.exports = { escapeHtml, paragraphs, phoneDisplay, phoneHref, whatsappHref, formatPrice, embedUrl, excerpt, icon, setLang, digits, respImg };
