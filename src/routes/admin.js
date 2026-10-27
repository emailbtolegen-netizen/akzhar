// Admin panel: /admin/*. Every route except login requires a session;
// every POST is checked for a CSRF token; areas are limited by role (see security.js).
const express = require('express');
const fs = require('node:fs');
const { all, get, run, tx, getSettings, setSetting } = require('../db');
const sec = require('../security');
const { adminUpload, store, removeUpload, IMAGE_TYPES } = require('../uploads');
const icons = require('../icons');

const router = express.Router();
const { requireLogin, requirePermission: perm, checkCsrf } = sec;

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.locals.csrf = req.csrf;
  res.locals.can = (area) => sec.can(req.user, area);
  res.locals.flash = req.query.ok ? 'Сохранено' : '';
  res.locals.iconNames = Object.keys(icons);
  next();
});

const bool = (v) => (v === '1' || v === 'on' ? 1 : 0);
const str = (v, max = 20000) => String(v ?? '').trim().slice(0, max);
const int = (v, def = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const back = (res, url) => res.redirect(url + (url.includes('?') ? '&' : '?') + 'ok=1');
// Multipart forms: parse first (so the CSRF field is available), then check the token.
const upload = (spec) => [spec, checkCsrf];
const cleanupTmp = (req) => { for (const f of [].concat(req.file || [], ...Object.values(req.files || {}))) if (f && f.path && fs.existsSync(f.path)) fs.rmSync(f.path, { force: true }); };

// ---------- Login / logout ----------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('admin/login', { error: '', next: str(req.query.next, 200), noUsers: !get('SELECT 1 FROM users LIMIT 1') });
});

router.post('/login', sec.rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  const user = get('SELECT * FROM users WHERE username = ?', str(req.body.username, 60));
  const ok = user && sec.verifyPassword(String(req.body.password || ''), user.password_hash);
  if (!ok) return res.status(401).render('admin/login', { error: 'Неверный логин или пароль', next: str(req.body.next, 200), noUsers: false });
  sec.createSession(res, user.id);
  const next = str(req.body.next, 200);
  res.redirect(next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin');
});

router.post('/logout', requireLogin, checkCsrf, (req, res) => {
  sec.destroySession(req, res);
  res.redirect('/admin/login');
});

router.use(requireLogin);

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  res.render('admin/dashboard', {
    stats: {
      pending: get(`SELECT COUNT(*) n FROM ads WHERE status = 'pending'`).n,
      reports: get(`SELECT COUNT(DISTINCT ad_id) n FROM ad_reports WHERE resolved = 0`).n,
      live: get(`SELECT COUNT(*) n FROM ads WHERE status = 'approved' AND (expires_at IS NULL OR expires_at > datetime('now'))`).n,
      news: get('SELECT COUNT(*) n FROM news').n,
      messages: get('SELECT COUNT(*) n FROM messages WHERE is_read = 0').n,
      emptyPhones: get(`SELECT COUNT(*) n FROM phones WHERE phone = ''`).n,
      emptyHistory: get(`SELECT COUNT(*) n FROM history_sections WHERE body_kk = '' AND body_ru = ''`).n,
      examples: get('SELECT COUNT(*) n FROM news WHERE is_example = 1').n,
    },
    settings: getSettings(),
  });
});

// ---------- Ads moderation ----------
router.get('/ads', perm('ads'), (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'reported', 'expired'].includes(req.query.status) ? req.query.status : 'pending';
  const where = {
    pending: `a.status = 'pending'`,
    approved: `a.status = 'approved' AND (a.expires_at IS NULL OR a.expires_at > datetime('now'))`,
    expired: `a.status = 'approved' AND a.expires_at <= datetime('now')`,
    rejected: `a.status = 'rejected'`,
    reported: `a.id IN (SELECT ad_id FROM ad_reports WHERE resolved = 0)`,
  }[status];
  const ads = all(`SELECT a.*, c.name_ru AS cat,
      (SELECT COUNT(*) FROM ad_reports r WHERE r.ad_id = a.id AND r.resolved = 0) AS reports
      FROM ads a JOIN ad_categories c ON c.id = a.category_id WHERE ${where} ORDER BY a.created_at DESC LIMIT 200`);
  for (const ad of ads) {
    ad.photos = all('SELECT filename FROM ad_photos WHERE ad_id = ? ORDER BY sort', ad.id).map((p) => p.filename);
    ad.reportList = ad.reports ? all('SELECT * FROM ad_reports WHERE ad_id = ? AND resolved = 0 ORDER BY created_at DESC', ad.id) : [];
  }
  const counts = {};
  for (const s of ['pending', 'reported']) {
    counts[s] = s === 'pending' ? get(`SELECT COUNT(*) n FROM ads WHERE status = 'pending'`).n
      : get('SELECT COUNT(DISTINCT ad_id) n FROM ad_reports WHERE resolved = 0').n;
  }
  res.render('admin/ads', { ads, status, counts });
});

router.post('/ads/:id/approve', perm('ads'), checkCsrf, (req, res) => {
  const ad = get('SELECT * FROM ads WHERE id = ?', int(req.params.id));
  if (ad) {
    run(`UPDATE ads SET status = 'approved', reject_reason = '',
         published_at = COALESCE(published_at, datetime('now')),
         expires_at = CASE WHEN expires_at IS NULL OR expires_at <= datetime('now') THEN datetime('now', '+' || duration_days || ' days') ELSE expires_at END
         WHERE id = ?`, ad.id);
    run('UPDATE ad_reports SET resolved = 1 WHERE ad_id = ?', ad.id);
  }
  back(res, '/admin/ads?status=' + str(req.body.from || 'pending', 20));
});

router.post('/ads/:id/reject', perm('ads'), checkCsrf, (req, res) => {
  run(`UPDATE ads SET status = 'rejected', reject_reason = ? WHERE id = ?`, str(req.body.reason, 300), int(req.params.id));
  run('UPDATE ad_reports SET resolved = 1 WHERE ad_id = ?', int(req.params.id));
  back(res, '/admin/ads?status=' + str(req.body.from || 'pending', 20));
});

router.post('/ads/:id/dismiss-reports', perm('ads'), checkCsrf, (req, res) => {
  run('UPDATE ad_reports SET resolved = 1 WHERE ad_id = ?', int(req.params.id));
  back(res, '/admin/ads?status=reported');
});

router.post('/ads/:id/delete', perm('ads'), checkCsrf, (req, res) => {
  const id = int(req.params.id);
  for (const p of all('SELECT filename FROM ad_photos WHERE ad_id = ?', id)) removeUpload(p.filename);
  run('DELETE FROM ads WHERE id = ?', id);
  back(res, '/admin/ads?status=' + str(req.body.from || 'pending', 20));
});

// ---------- News ----------
const NEWS_KINDS = [['news', 'Жизнь поселка'], ['event', 'Мероприятия'], ['sport', 'Спорт и культура'], ['outage', 'Отключения света/воды'], ['roads', 'Ремонтные работы'], ['notice', 'Важное уведомление']];

router.get('/news', perm('news'), (req, res) => {
  res.render('admin/news', { news: all('SELECT * FROM news ORDER BY published_at DESC'), kinds: Object.fromEntries(NEWS_KINDS) });
});

function newsForm(item) {
  return {
    title: item.id ? 'Редактировать новость' : 'Новая новость',
    action: item.id ? `/admin/news/${item.id}` : '/admin/news/new',
    multipart: true,
    backUrl: '/admin/news',
    deleteUrl: item.id ? `/admin/news/${item.id}/delete` : '',
    fields: [
      { pair: [{ name: 'title_kk', label: 'Заголовок (ҚАЗ)', value: item.title_kk, required: true }, { name: 'title_ru', label: 'Заголовок (РУС)', value: item.title_ru, required: true }] },
      { pair: [{ name: 'body_kk', label: 'Текст (ҚАЗ)', type: 'textarea', rows: 12, value: item.body_kk }, { name: 'body_ru', label: 'Текст (РУС)', type: 'textarea', rows: 12, value: item.body_ru }] },
      { name: 'kind', label: 'Рубрика', type: 'select', options: NEWS_KINDS, value: item.kind || 'news' },
      { name: 'published_at', label: 'Дата публикации', type: 'datetime-local', value: (item.published_at || new Date().toISOString()).replace(' ', 'T').slice(0, 16), hint: 'Время UTC (Атырау = UTC+5)' },
      { name: 'image', label: 'Фотография', type: 'file', accept: 'image/jpeg,image/png,image/webp', current: item.image },
      { name: 'is_important', label: 'Важное (закрепить сверху, красная метка)', type: 'checkbox', value: item.is_important },
      { name: 'published', label: 'Опубликовано (видно на сайте)', type: 'checkbox', value: item.id ? item.published : 1 },
      { name: 'is_example', label: 'Демонстрационный материал (метка «Пример»)', type: 'checkbox', value: item.is_example },
    ],
    hint: 'Абзацы разделяйте пустой строкой. Если перевод не заполнен, на сайте покажется текст на другом языке с пометкой.',
  };
}
router.get('/news/new', perm('news'), (req, res) => res.render('admin/form', newsForm({})));
router.get('/news/:id', perm('news'), (req, res, next) => {
  const item = get('SELECT * FROM news WHERE id = ?', int(req.params.id));
  if (!item) return next();
  res.render('admin/form', { ...newsForm(item), viewUrl: `/ru/news/${item.id}` });
});
router.post(['/news/new', '/news/:id'], perm('news'), upload(adminUpload.single('image')), (req, res) => {
  const b = req.body;
  const existing = req.params.id ? get('SELECT * FROM news WHERE id = ?', int(req.params.id)) : null;
  let image = existing ? existing.image : '';
  if (req.file) {
    const url = store(req.file, 'news', IMAGE_TYPES);
    if (url) { if (existing) removeUpload(existing.image); image = url; }
  }
  if (bool(b.remove_image)) { removeUpload(image); image = ''; }
  const when = str(b.published_at, 20).replace('T', ' ') || new Date().toISOString().slice(0, 16).replace('T', ' ');
  const kind = NEWS_KINDS.some((k) => k[0] === b.kind) ? b.kind : 'news';
  const vals = [kind, str(b.title_kk, 300), str(b.title_ru, 300), str(b.body_kk), str(b.body_ru), image, bool(b.is_example), bool(b.is_important), bool(b.published), when.length === 16 ? when + ':00' : when];
  if (existing) run('UPDATE news SET kind=?, title_kk=?, title_ru=?, body_kk=?, body_ru=?, image=?, is_example=?, is_important=?, published=?, published_at=? WHERE id=?', ...vals, existing.id);
  else run('INSERT INTO news(kind, title_kk, title_ru, body_kk, body_ru, image, is_example, is_important, published, published_at) VALUES(?,?,?,?,?,?,?,?,?,?)', ...vals);
  cleanupTmp(req);
  back(res, '/admin/news');
});
router.post('/news/:id/delete', perm('news'), checkCsrf, (req, res) => {
  const item = get('SELECT image FROM news WHERE id = ?', int(req.params.id));
  if (item && !item.image.startsWith('/media/')) removeUpload(item.image);
  run('DELETE FROM news WHERE id = ?', int(req.params.id));
  back(res, '/admin/news');
});

// ---------- History sections ----------
router.get('/history', perm('history'), (req, res) => {
  res.render('admin/history', {
    sections: all('SELECT * FROM history_sections ORDER BY sort, id'),
    media: all(`SELECT * FROM media WHERE section = 'history' ORDER BY sort, id`),
  });
});
function historyForm(s) {
  return {
    title: s.id ? 'Раздел истории' : 'Новый раздел истории',
    action: s.id ? `/admin/history/${s.id}` : '/admin/history/new',
    backUrl: '/admin/history',
    deleteUrl: s.id ? `/admin/history/${s.id}/delete` : '',
    viewUrl: s.id ? `/ru/history#${s.slug}` : '',
    fields: [
      { pair: [{ name: 'title_kk', label: 'Название (ҚАЗ)', value: s.title_kk, required: true }, { name: 'title_ru', label: 'Название (РУС)', value: s.title_ru, required: true }] },
      { pair: [{ name: 'body_kk', label: 'Текст (ҚАЗ)', type: 'textarea', rows: 16, value: s.body_kk }, { name: 'body_ru', label: 'Текст (РУС)', type: 'textarea', rows: 16, value: s.body_ru }] },
      { name: 'sort', label: 'Порядок', type: 'number', value: s.sort ?? 0 },
    ],
    hint: 'Публикуйте только проверенные факты с указанием источника. Пока текст пуст, посетители видят «Раздел заполняется».',
  };
}
router.get('/history/new', perm('history'), (req, res) => res.render('admin/form', historyForm({})));
router.get('/history/:id', perm('history'), (req, res, next) => {
  const s = get('SELECT * FROM history_sections WHERE id = ?', int(req.params.id));
  if (!s) return next();
  res.render('admin/form', historyForm(s));
});
router.post(['/history/new', '/history/:id'], perm('history'), checkCsrf, (req, res) => {
  const b = req.body;
  const vals = [str(b.title_kk, 200), str(b.title_ru, 200), str(b.body_kk), str(b.body_ru), int(b.sort)];
  if (req.params.id) run('UPDATE history_sections SET title_kk=?, title_ru=?, body_kk=?, body_ru=?, sort=? WHERE id=?', ...vals, int(req.params.id));
  else run('INSERT INTO history_sections(title_kk, title_ru, body_kk, body_ru, sort, slug) VALUES(?,?,?,?,?,?)', ...vals, 'section-' + Date.now().toString(36));
  back(res, '/admin/history');
});
router.post('/history/:id/delete', perm('history'), checkCsrf, (req, res) => {
  run('DELETE FROM history_sections WHERE id = ?', int(req.params.id));
  back(res, '/admin/history');
});

// ---------- Media: gallery, history archive, videos, memories ----------
const SECTIONS = [['gallery', 'Фотогалерея / О поселке'], ['history', 'История поселка']];
const KINDS = [['photo', 'Фотография'], ['video', 'Видео'], ['document', 'Документ (PDF/скан)'], ['memory', 'Воспоминание старожила (текст)']];

router.get('/media', perm('media'), (req, res) => {
  const section = SECTIONS.some((s) => s[0] === req.query.section) ? req.query.section : 'gallery';
  res.render('admin/media', { section, sections: SECTIONS, kinds: Object.fromEntries(KINDS), media: all('SELECT * FROM media WHERE section = ? ORDER BY sort, id', section) });
});
function mediaForm(m) {
  return {
    title: m.id ? 'Редактировать материал' : 'Добавить материал',
    action: m.id ? `/admin/media/${m.id}` : '/admin/media/new',
    multipart: true,
    backUrl: '/admin/media?section=' + (m.section || 'gallery'),
    deleteUrl: m.id ? `/admin/media/${m.id}/delete` : '',
    fields: [
      { name: 'section', label: 'Раздел', type: 'select', options: SECTIONS, value: m.section || 'gallery' },
      { name: 'kind', label: 'Тип', type: 'select', options: KINDS, value: m.kind || 'photo' },
      { name: 'era', label: 'Период (для фото в истории)', type: 'select', options: [['present', 'Сейчас'], ['past', 'В прошлом']], value: m.era || 'present' },
      { name: 'files', label: m.id ? 'Заменить файл' : 'Файлы (можно выбрать несколько фото)', type: 'file', multiple: !m.id, accept: 'image/jpeg,image/png,image/webp,video/mp4,video/webm,application/pdf', current: m.file, hint: 'Фото JPG/PNG/WEBP, видео MP4/WEBM, документы PDF. До 500 МБ.' },
      { name: 'url', label: 'или ссылка (YouTube, Vimeo, Google Drive)', value: m.url, hint: 'Для видео, размещенного на другом сайте' },
      { pair: [{ name: 'title_kk', label: 'Подпись / название (ҚАЗ)', value: m.title_kk }, { name: 'title_ru', label: 'Подпись / название (РУС)', value: m.title_ru }] },
      { pair: [{ name: 'text_kk', label: 'Описание или текст воспоминания (ҚАЗ)', type: 'textarea', rows: 6, value: m.text_kk }, { name: 'text_ru', label: 'Описание или текст воспоминания (РУС)', type: 'textarea', rows: 6, value: m.text_ru }] },
      { name: 'author', label: 'Автор / источник', value: m.author, hint: 'Кто рассказал, кто снял, откуда документ' },
      { name: 'year_label', label: 'Год или период', value: m.year_label, hint: 'Например: 1970-е' },
      { name: 'sort', label: 'Порядок', type: 'number', value: m.sort ?? 0 },
    ],
  };
}
router.get('/media/new', perm('media'), (req, res) => res.render('admin/form', mediaForm({ section: req.query.section })));
router.get('/media/:id', perm('media'), (req, res, next) => {
  const m = get('SELECT * FROM media WHERE id = ?', int(req.params.id));
  if (!m) return next();
  res.render('admin/form', mediaForm(m));
});
router.post(['/media/new', '/media/:id'], perm('media'), upload(adminUpload.array('files', 20)), (req, res) => {
  const b = req.body;
  const section = SECTIONS.some((s) => s[0] === b.section) ? b.section : 'gallery';
  const kind = KINDS.some((k) => k[0] === b.kind) ? b.kind : 'photo';
  const allowed = { photo: IMAGE_TYPES, video: ['mp4', 'webm'], document: ['pdf', ...IMAGE_TYPES], memory: IMAGE_TYPES }[kind];
  const base = [section, kind, b.era === 'past' ? 'past' : 'present', str(b.url, 500), str(b.title_kk, 300), str(b.title_ru, 300), str(b.text_kk), str(b.text_ru), str(b.author, 200), str(b.year_label, 60), int(b.sort)];
  const files = (req.files || []).map((f) => store(f, 'media', allowed)).filter(Boolean);
  cleanupTmp(req);
  if (req.params.id) {
    const m = get('SELECT * FROM media WHERE id = ?', int(req.params.id));
    if (!m) return res.redirect('/admin/media');
    let file = m.file;
    if (files[0]) { if (!m.file.startsWith('/media/')) removeUpload(m.file); file = files[0]; }
    if (bool(b.remove_files)) { removeUpload(file); file = ''; }
    run('UPDATE media SET section=?, kind=?, era=?, url=?, title_kk=?, title_ru=?, text_kk=?, text_ru=?, author=?, year_label=?, sort=?, file=? WHERE id=?', ...base, file, m.id);
  } else {
    tx(() => {
      for (const file of files.length ? files : ['']) {
        run('INSERT INTO media(section, kind, era, url, title_kk, title_ru, text_kk, text_ru, author, year_label, sort, file) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ...base, file);
      }
    });
  }
  back(res, '/admin/media?section=' + section);
});
router.post('/media/:id/delete', perm('media'), checkCsrf, (req, res) => {
  const m = get('SELECT * FROM media WHERE id = ?', int(req.params.id));
  if (m) { removeUpload(m.file); run('DELETE FROM media WHERE id = ?', m.id); }
  back(res, '/admin/media?section=' + (m ? m.section : 'gallery'));
});

// ---------- Interesting places ----------
router.get('/places', perm('places'), (req, res) => res.render('admin/places', { places: all('SELECT * FROM places ORDER BY sort, id') }));
function placeForm(p) {
  return {
    title: p.id ? 'Интересное место' : 'Новое интересное место',
    action: p.id ? `/admin/places/${p.id}` : '/admin/places/new',
    multipart: true, backUrl: '/admin/places',
    deleteUrl: p.id ? `/admin/places/${p.id}/delete` : '',
    fields: [
      { pair: [{ name: 'name_kk', label: 'Название (ҚАЗ)', value: p.name_kk, required: true }, { name: 'name_ru', label: 'Название (РУС)', value: p.name_ru, required: true }] },
      { pair: [{ name: 'text_kk', label: 'Описание (ҚАЗ)', type: 'textarea', rows: 6, value: p.text_kk }, { name: 'text_ru', label: 'Описание (РУС)', type: 'textarea', rows: 6, value: p.text_ru }] },
      { name: 'image', label: 'Фотография', type: 'file', accept: 'image/jpeg,image/png,image/webp', current: p.image },
      { name: 'sort', label: 'Порядок', type: 'number', value: p.sort ?? 0 },
    ],
  };
}
router.get('/places/new', perm('places'), (req, res) => res.render('admin/form', placeForm({})));
router.get('/places/:id', perm('places'), (req, res, next) => {
  const p = get('SELECT * FROM places WHERE id = ?', int(req.params.id));
  if (!p) return next();
  res.render('admin/form', placeForm(p));
});
router.post(['/places/new', '/places/:id'], perm('places'), upload(adminUpload.single('image')), (req, res) => {
  const b = req.body;
  const p = req.params.id ? get('SELECT * FROM places WHERE id = ?', int(req.params.id)) : null;
  let image = p ? p.image : '';
  if (req.file) { const u = store(req.file, 'places', IMAGE_TYPES); if (u) { if (p && !p.image.startsWith('/media/')) removeUpload(p.image); image = u; } }
  if (bool(b.remove_image)) image = '';
  cleanupTmp(req);
  const vals = [str(b.name_kk, 200), str(b.name_ru, 200), str(b.text_kk), str(b.text_ru), image, int(b.sort)];
  if (p) run('UPDATE places SET name_kk=?, name_ru=?, text_kk=?, text_ru=?, image=?, sort=? WHERE id=?', ...vals, p.id);
  else run('INSERT INTO places(name_kk, name_ru, text_kk, text_ru, image, sort) VALUES(?,?,?,?,?,?)', ...vals);
  back(res, '/admin/places');
});
router.post('/places/:id/delete', perm('places'), checkCsrf, (req, res) => {
  run('DELETE FROM places WHERE id = ?', int(req.params.id));
  back(res, '/admin/places');
});

// ---------- Phones ----------
router.get('/phones', perm('phones'), (req, res) => {
  const groups = all('SELECT * FROM phone_groups ORDER BY sort, id')
    .map((g) => ({ ...g, phones: all('SELECT * FROM phones WHERE group_id = ? ORDER BY sort, id', g.id) }));
  res.render('admin/phones', { groups });
});
function phoneForm(p) {
  const groups = all('SELECT id, name_ru FROM phone_groups ORDER BY sort, id').map((g) => [String(g.id), g.name_ru]);
  return {
    title: p.id ? 'Редактировать телефон' : 'Новый телефон',
    action: p.id ? `/admin/phones/${p.id}` : '/admin/phones/new',
    backUrl: '/admin/phones',
    deleteUrl: p.id ? `/admin/phones/${p.id}/delete` : '',
    fields: [
      { name: 'group_id', label: 'Группа', type: 'select', options: groups, value: String(p.group_id || groups[0][0]) },
      { pair: [{ name: 'name_kk', label: 'Название (ҚАЗ)', value: p.name_kk, required: true }, { name: 'name_ru', label: 'Название (РУС)', value: p.name_ru, required: true }] },
      { pair: [{ name: 'note_kk', label: 'Примечание: адрес, часы (ҚАЗ)', value: p.note_kk }, { name: 'note_ru', label: 'Примечание: адрес, часы (РУС)', value: p.note_ru }] },
      { pair: [{ name: 'phone', label: 'Телефон', value: p.phone, hint: 'Например 87122397365. Пусто = «Номер скоро будет добавлен»' }, { name: 'phone2', label: 'Второй телефон', value: p.phone2 }] },
      { name: 'icon', label: 'Иконка', type: 'select', options: Object.keys(icons).map((k) => [k, k]), value: p.icon || 'phone' },
      { name: 'featured', label: 'Показывать на главной («Быстрая связь»)', type: 'checkbox', value: p.featured },
      { name: 'verified', label: 'Номер проверен (дозвонились)', type: 'checkbox', value: p.verified },
      { name: 'sort', label: 'Порядок', type: 'number', value: p.sort ?? 0 },
    ],
  };
}
router.get('/phones/new', perm('phones'), (req, res) => res.render('admin/form', phoneForm({})));
router.get('/phones/:id', perm('phones'), (req, res, next) => {
  const p = get('SELECT * FROM phones WHERE id = ?', int(req.params.id));
  if (!p) return next();
  res.render('admin/form', phoneForm(p));
});
router.post(['/phones/new', '/phones/:id'], perm('phones'), checkCsrf, (req, res) => {
  const b = req.body;
  const group = get('SELECT id FROM phone_groups WHERE id = ?', int(b.group_id)) || get('SELECT id FROM phone_groups ORDER BY sort LIMIT 1');
  const vals = [group.id, str(b.name_kk, 200), str(b.name_ru, 200), str(b.note_kk, 300), str(b.note_ru, 300), str(b.phone, 30), str(b.phone2, 30),
    icons[b.icon] ? b.icon : 'phone', bool(b.featured), bool(b.verified), int(b.sort)];
  if (req.params.id) run('UPDATE phones SET group_id=?, name_kk=?, name_ru=?, note_kk=?, note_ru=?, phone=?, phone2=?, icon=?, featured=?, verified=?, sort=? WHERE id=?', ...vals, int(req.params.id));
  else run('INSERT INTO phones(group_id, name_kk, name_ru, note_kk, note_ru, phone, phone2, icon, featured, verified, sort) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ...vals);
  back(res, '/admin/phones');
});
router.post('/phones/:id/delete', perm('phones'), checkCsrf, (req, res) => {
  run('DELETE FROM phones WHERE id = ?', int(req.params.id));
  back(res, '/admin/phones');
});
router.post('/phone-groups', perm('phones'), checkCsrf, (req, res) => {
  const b = req.body;
  if (int(b.id)) run('UPDATE phone_groups SET name_kk=?, name_ru=?, sort=? WHERE id=?', str(b.name_kk, 200), str(b.name_ru, 200), int(b.sort), int(b.id));
  else if (str(b.name_ru)) run('INSERT INTO phone_groups(slug, name_kk, name_ru, sort) VALUES(?,?,?,?)', 'g-' + Date.now().toString(36), str(b.name_kk, 200) || str(b.name_ru, 200), str(b.name_ru, 200), int(b.sort, 99));
  back(res, '/admin/phones');
});
router.post('/phone-groups/:id/delete', perm('phones'), checkCsrf, (req, res) => {
  if (!get('SELECT 1 FROM phones WHERE group_id = ?', int(req.params.id))) run('DELETE FROM phone_groups WHERE id = ?', int(req.params.id));
  back(res, '/admin/phones');
});

// ---------- Ad categories ----------
router.get('/categories', perm('categories'), (req, res) => {
  res.render('admin/categories', { categories: all('SELECT c.*, (SELECT COUNT(*) FROM ads a WHERE a.category_id = c.id) AS n FROM ad_categories c ORDER BY sort, id') });
});
router.post('/categories', perm('categories'), checkCsrf, (req, res) => {
  const b = req.body;
  const vals = [str(b.name_kk, 200), str(b.name_ru, 200), icons[b.icon] ? b.icon : 'tag', bool(b.has_price), bool(b.active), int(b.sort)];
  if (int(b.id)) run('UPDATE ad_categories SET name_kk=?, name_ru=?, icon=?, has_price=?, active=?, sort=? WHERE id=?', ...vals, int(b.id));
  else if (vals[1]) run('INSERT INTO ad_categories(name_kk, name_ru, icon, has_price, active, sort, slug) VALUES(?,?,?,?,?,?,?)', ...vals, 'cat-' + Date.now().toString(36));
  back(res, '/admin/categories');
});
router.post('/categories/:id/delete', perm('categories'), checkCsrf, (req, res) => {
  if (!get('SELECT 1 FROM ads WHERE category_id = ?', int(req.params.id))) run('DELETE FROM ad_categories WHERE id = ?', int(req.params.id));
  back(res, '/admin/categories');
});

// ---------- Settings: texts, contacts, map, video ----------
const SETTINGS_FORM = [
  { group: 'Основные тексты', fields: [
    { pair: [{ name: 'site_name_kk', label: 'Название (ҚАЗ)' }, { name: 'site_name_ru', label: 'Название (РУС)' }] },
    { pair: [{ name: 'slogan_kk', label: 'Слоган (ҚАЗ)' }, { name: 'slogan_ru', label: 'Слоган (РУС)' }] },
    { pair: [{ name: 'welcome_kk', label: 'Приветствие на главной (ҚАЗ)', type: 'textarea', rows: 4 }, { name: 'welcome_ru', label: 'Приветствие на главной (РУС)', type: 'textarea', rows: 4 }] },
    { pair: [{ name: 'region_kk', label: 'Регион (ҚАЗ)' }, { name: 'region_ru', label: 'Регион (РУС)' }] },
    { pair: [{ name: 'location_kk', label: '«О поселке» → Расположение (ҚАЗ)', type: 'textarea', rows: 4, hint: 'Только проверенные сведения: район, расстояние до города, как добраться' }, { name: 'location_ru', label: '«О поселке» → Расположение (РУС)', type: 'textarea', rows: 4 }] },
  ] },
  { group: 'Контакты сайта', fields: [
    { pair: [{ name: 'address_kk', label: 'Адрес (ҚАЗ)' }, { name: 'address_ru', label: 'Адрес (РУС)' }] },
    { pair: [{ name: 'contact_phone', label: 'Телефон для связи' }, { name: 'contact_email', label: 'E-mail' }] },
    { pair: [{ name: 'contact_hours_kk', label: 'Время работы (ҚАЗ)' }, { name: 'contact_hours_ru', label: 'Время работы (РУС)' }] },
    { pair: [{ name: 'whatsapp', label: 'WhatsApp (номер)' }, { name: 'instagram', label: 'Instagram (ссылка)' }] },
  ] },
  { group: 'Карта', fields: [
    { pair: [{ name: 'map_lat', label: 'Широта', hint: 'Например 47.1234 — скопируйте из 2GIS/Google Maps/OpenStreetMap' }, { name: 'map_lon', label: 'Долгота', hint: 'Например 51.5678' }] },
  ] },
  { group: 'Видео на главной', fields: [
    { name: 'video_url', label: 'Ссылка на оригинал видео (YouTube, Vimeo, Google Drive)', hint: 'Если указана ссылка YouTube/Vimeo/Drive — кнопка «Смотреть видео» откроет этот плеер (со звуком, если он есть)' },
    { name: 'hero_video_file', label: 'Заменить фоновое видео (MP4, лучше до 5 МБ, без звука, 15–30 сек.)', type: 'file', accept: 'video/mp4,video/webm', currentKey: 'hero_video' },
    { name: 'hero_poster_file', label: 'Заменить обложку видео (JPG)', type: 'file', accept: 'image/jpeg,image/png,image/webp', currentKey: 'hero_poster' },
    { name: 'full_video_file', label: 'Заменить полное видео для просмотра (MP4)', type: 'file', accept: 'video/mp4,video/webm', currentKey: 'full_video' },
    { pair: [{ name: 'hero_video', label: 'Путь к фоновому видео (ПК)' }, { name: 'hero_video_mobile', label: 'Путь к фоновому видео (телефон)' }] },
    { pair: [{ name: 'hero_poster', label: 'Путь к обложке' }, { name: 'full_video', label: 'Путь к полному видео', hint: 'Пусто — кнопка «Смотреть видео» скрыта' }] },
  ] },
  { group: 'Объявления', fields: [
    { name: 'ads_auto_approve', label: 'Публиковать объявления сразу, без модерации (не рекомендуется)', type: 'checkbox' },
    { name: 'ads_max_per_day', label: 'Максимум объявлений с одного устройства в сутки', type: 'number' },
  ] },
];
const settingNames = () => SETTINGS_FORM.flatMap((g) => g.fields.flatMap((f) => (f.pair || [f]))).filter((f) => f.type !== 'file').map((f) => f.name);

router.get('/settings', perm('settings'), (req, res) => res.render('admin/settings', { groups: SETTINGS_FORM, values: getSettings() }));
router.post('/settings', perm('settings'), upload(adminUpload.fields([{ name: 'hero_video_file', maxCount: 1 }, { name: 'hero_poster_file', maxCount: 1 }, { name: 'full_video_file', maxCount: 1 }])), (req, res) => {
  for (const name of settingNames()) {
    const field = SETTINGS_FORM.flatMap((g) => g.fields.flatMap((f) => f.pair || [f])).find((f) => f.name === name);
    setSetting(name, field.type === 'checkbox' ? String(bool(req.body[name])) : str(req.body[name], 5000));
  }
  const f = req.files || {};
  const vid = f.hero_video_file && store(f.hero_video_file[0], 'video', ['mp4', 'webm']);
  if (vid) { setSetting('hero_video', vid); setSetting('hero_video_mobile', vid); }
  const poster = f.hero_poster_file && store(f.hero_poster_file[0], 'video', IMAGE_TYPES);
  if (poster) setSetting('hero_poster', poster);
  const full = f.full_video_file && store(f.full_video_file[0], 'video', ['mp4', 'webm']);
  if (full) setSetting('full_video', full);
  cleanupTmp(req);
  back(res, '/admin/settings');
});

// ---------- Messages from the contact form ----------
router.get('/messages', perm('messages'), (req, res) => res.render('admin/messages', { messages: all('SELECT * FROM messages ORDER BY created_at DESC LIMIT 300') }));
router.post('/messages/:id/read', perm('messages'), checkCsrf, (req, res) => { run('UPDATE messages SET is_read = 1 WHERE id = ?', int(req.params.id)); back(res, '/admin/messages'); });
router.post('/messages/:id/delete', perm('messages'), checkCsrf, (req, res) => { run('DELETE FROM messages WHERE id = ?', int(req.params.id)); back(res, '/admin/messages'); });

// ---------- Users ----------
router.get('/users', perm('users'), (req, res) => res.render('admin/users', { users: all('SELECT id, username, role, created_at FROM users ORDER BY id'), error: req.query.error || '' }));
router.post('/users', perm('users'), checkCsrf, (req, res) => {
  const username = str(req.body.username, 60);
  const password = String(req.body.password || '');
  const role = ['admin', 'editor', 'moderator'].includes(req.body.role) ? req.body.role : 'moderator';
  if (!/^[\w.-]{3,60}$/.test(username)) return res.redirect('/admin/users?error=' + encodeURIComponent('Логин: 3–60 латинских букв, цифр, точек или дефисов'));
  if (password.length < 10) return res.redirect('/admin/users?error=' + encodeURIComponent('Пароль должен быть не короче 10 символов'));
  if (get('SELECT 1 FROM users WHERE username = ?', username)) return res.redirect('/admin/users?error=' + encodeURIComponent('Такой логин уже есть'));
  run('INSERT INTO users(username, password_hash, role) VALUES(?,?,?)', username, sec.hashPassword(password), role);
  back(res, '/admin/users');
});
router.post('/users/:id/delete', perm('users'), checkCsrf, (req, res) => {
  if (int(req.params.id) !== req.user.id) run('DELETE FROM users WHERE id = ?', int(req.params.id));
  back(res, '/admin/users');
});

// Any logged-in user can change their own password.
router.get('/password', (req, res) => res.render('admin/password', { error: '' }));
router.post('/password', checkCsrf, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  const next = String(req.body.new_password || '');
  if (!sec.verifyPassword(String(req.body.current || ''), u.password_hash)) return res.render('admin/password', { error: 'Текущий пароль неверный' });
  if (next.length < 10) return res.render('admin/password', { error: 'Новый пароль должен быть не короче 10 символов' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', sec.hashPassword(next), u.id);
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  sec.createSession(res, u.id);
  back(res, '/admin');
});

router.use((req, res) => res.status(404).render('admin/forbidden', { area: '404' }));

module.exports = router;
