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
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
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
  res.status(404).render('404');
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send('Внутренняя ошибка сервера / Сервердің ішкі қатесі');
});

app.listen(PORT, () => console.log(`Akzhar site: http://localhost:${PORT}`));
