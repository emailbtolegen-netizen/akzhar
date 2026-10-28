const path = require('node:path');
const express = require('express');

const { db, getSettings } = require('./src/db');
const { LANGS, DEFAULT_LANG } = require('./src/i18n');
const { loadSession, securityHeaders } = require('./src/security');
const { UPLOAD_DIR } = require('./src/uploads');
const helpers = require('./src/helpers');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Behind a hosting proxy (Render, Railway, Nginx) set TRUST_PROXY=1, otherwise every visitor
// looks like the proxy's IP and the anti-spam limits would block everyone together.
const trust = process.env.TRUST_PROXY;
app.set('trust proxy', trust ? (/^\d+$/.test(trust) ? Number(trust) : trust) : 'loopback');
app.disable('x-powered-by');

// Case-insensitive search for Cyrillic/Kazakh text (SQLite LIKE only folds ASCII)
db.function('ulower', { deterministic: true }, (s) => (s == null ? '' : String(s).toLocaleLowerCase('ru')));

app.use(securityHeaders);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '7d' : 0 }));
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: IS_PROD ? '30d' : 0,
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'"),
}));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(loadSession);
app.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  res.locals.user = req.user;
  Object.assign(res.locals, helpers);
  next();
});

// Health check for the hosting platform
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.get('/', (req, res) => {
  const accept = String(req.get('accept-language') || '');
  const lang = /^ru/i.test(accept) && !/kk/i.test(accept) ? 'ru' : DEFAULT_LANG;
  res.redirect(302, `/${lang}`);
});

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/seo'));
app.use('/:lang(kk|ru)', require('./src/routes/public'));

app.use((req, res) => {
  const lang = LANGS.includes(req.path.split('/')[1]) ? req.path.split('/')[1] : DEFAULT_LANG;
  helpers.setLang(req, res, lang);
  res.status(404).render('404', { page: '404' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send('Внутренняя ошибка сервера / Сервердің ішкі қатесі');
});

// First administrator on a fresh server without a shell: ADMIN_USERNAME + ADMIN_PASSWORD
// create the account once, only while the database has no users at all.
const { get: dbGet, run: dbRun } = require('./src/db');
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && !dbGet('SELECT 1 FROM users LIMIT 1')) {
  if (process.env.ADMIN_PASSWORD.length < 10) console.warn('ADMIN_PASSWORD is shorter than 10 characters — admin not created');
  else {
    dbRun(`INSERT INTO users(username, password_hash, role) VALUES(?, ?, 'admin')`, process.env.ADMIN_USERNAME, require('./src/security').hashPassword(process.env.ADMIN_PASSWORD));
    console.log(`Admin "${process.env.ADMIN_USERNAME}" created from environment variables`);
  }
}

app.listen(PORT, () => console.log(`Akzhar site: http://localhost:${PORT}`));
