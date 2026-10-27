// Passwords, admin sessions, CSRF, rate limiting and anti-spam checks.
const crypto = require('node:crypto');
const { get, run } = require('./db');

const SESSION_COOKIE = 'akz_sid';
const SESSION_TTL_MS = 12 * 3600 * 1000;
// Server-side secret for signing form tokens. Generated on start if not set:
// then form tokens simply become invalid after a restart, nothing else breaks.
const SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- passwords (scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// ---------- cookies ----------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (IS_PROD) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// ---------- admin sessions ----------
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions(token, user_id, csrf, expires_at) VALUES(?,?,?,?)', token, userId, csrf, Date.now() + SESSION_TTL_MS);
  setCookie(res, SESSION_COOKIE, token, SESSION_TTL_MS);
}
function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  setCookie(res, SESSION_COOKIE, '', 0);
}
function loadSession(req, _res, next) {
  const token = parseCookies(req)[SESSION_COOKIE];
  req.user = null;
  if (token) {
    const row = get(`SELECT s.csrf, s.expires_at, u.id, u.username, u.role
                     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, username: row.username, role: row.role };
      req.csrf = row.csrf;
    }
  }
  next();
}

// Roles: admin — everything; editor — content (news, history, phones, media);
// moderator — ads, reports and messages only.
const PERMISSIONS = {
  admin: ['ads', 'news', 'history', 'phones', 'media', 'categories', 'settings', 'users', 'messages', 'places'],
  editor: ['ads', 'news', 'history', 'phones', 'media', 'messages', 'places'],
  moderator: ['ads', 'messages'],
};
const can = (user, area) => !!user && (PERMISSIONS[user.role] || []).includes(area);

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}
function requirePermission(area) {
  return (req, res, next) => {
    if (!can(req.user, area)) return res.status(403).render('admin/forbidden', { area });
    next();
  };
}
function checkCsrf(req, res, next) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!req.csrf || !sent || sent.length !== req.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrf))) {
    return res.status(403).send('CSRF token mismatch. Обновите страницу и попробуйте снова.');
  }
  next();
}

// ---------- public forms: signed time token + honeypot ----------
// The form carries a signed timestamp. A submission is rejected if it comes back
// faster than a human can fill the form (bots) or after many hours (stale/replayed).
function formToken() {
  const ts = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', SECRET).update('form:' + ts).digest('hex').slice(0, 24);
  return `${ts}.${sig}`;
}
function checkFormToken(token, minSeconds = 4) {
  const [ts, sig] = String(token || '').split('.');
  if (!ts || !sig) return false;
  const expected = crypto.createHmac('sha256', SECRET).update('form:' + ts).digest('hex').slice(0, 24);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const age = Date.now() - parseInt(ts, 36);
  return age >= minSeconds * 1000 && age < 6 * 3600 * 1000;
}
// Honeypot: a hidden "website" field. People never see it, simple bots fill it in.
const honeypotFilled = (body) => !!(body && String(body.website || '').trim());

// IPs are stored only as salted hashes — enough to limit spam, not to identify people.
const ipHash = (req) => crypto.createHmac('sha256', SECRET + ':ip').update(String(req.ip)).digest('hex').slice(0, 32);

// ---------- in-memory rate limiter ----------
const buckets = new Map();
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  return (req, res, next) => {
    const k = key(req) + '|' + req.baseUrl + req.path;
    const now = Date.now();
    const list = (buckets.get(k) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      res.status(429);
      return res.send('Слишком много запросов. Подождите немного. / Тым көп сұраныс. Біраз күтіңіз.');
    }
    list.push(now);
    buckets.set(k, list);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of buckets) if (!list.some((t) => now - t < 24 * 3600 * 1000)) buckets.delete(k);
}, 3600 * 1000).unref();

// ---------- HTTP security headers ----------
function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: https://*.tile.openstreetmap.org https://i.ytimg.com",
      "media-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "frame-src 'self' https://www.openstreetmap.org https://www.youtube-nocookie.com https://player.vimeo.com https://drive.google.com",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  });
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, loadSession,
  requireLogin, requirePermission, checkCsrf, can, PERMISSIONS,
  formToken, checkFormToken, honeypotFilled, ipHash, rateLimit, securityHeaders,
};
