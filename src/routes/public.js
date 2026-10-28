const express = require('express');
const { all, get, run, tx, getSettings } = require('../db');
const { t } = require('../i18n');
const { setLang, digits, whatsappHref, phoneDisplay, formatPrice } = require('../helpers');
const { formToken, checkFormToken, honeypotFilled, ipHash, rateLimit } = require('../security');
const { adPhotos, store, IMAGE_TYPES } = require('../uploads');

const router = express.Router({ mergeParams: true });
const PAGE_SIZE = 12;
const NEWS_KINDS = ['news', 'event', 'sport', 'outage', 'roads', 'notice'];
const REPORT_REASONS = ['spam', 'fraud', 'false', 'offensive', 'outdated', 'other'];
const AD_DURATIONS = [7, 14, 30, 60];
const MESSAGE_TOPICS = ['question', 'news', 'correction', 'history', 'other'];

// Every form submission is also forwarded to the site owner's WhatsApp (settings.whatsapp).
// There is no free way to send a WhatsApp/SMS message from the server, so after saving
// the visitor gets a wa.me link with the text already filled in and presses "Send".
function whatsappPage(res, { text, backUrl, backLabel, photos = false, key }) {
  const settings = getSettings();
  const base = whatsappHref(settings.whatsapp);
  res.render('wa-sent', {
    page: res.locals.page || 'contacts',
    waUrl: base ? `${base}?text=${encodeURIComponent(text)}` : '',
    backUrl, backLabel, photos, waKey: key,
  });
}
const lines = (...rows) => rows.filter((r) => r !== null && r !== undefined && r !== '').join('\n');

router.use((req, res, next) => {
  setLang(req, res, req.params.lang);
  res.locals.formToken = formToken;
  next();
});

// Ads visible to the public: approved and not expired.
const LIVE_AD = `a.status = 'approved' AND (a.expires_at IS NULL OR a.expires_at > datetime('now'))`;
const AD_SELECT = `SELECT a.*, c.slug AS cat_slug, c.name_kk AS cat_kk, c.name_ru AS cat_ru, c.icon AS cat_icon,
  (SELECT filename FROM ad_photos WHERE ad_id = a.id ORDER BY sort LIMIT 1) AS photo
  FROM ads a JOIN ad_categories c ON c.id = a.category_id`;

const featuredPhones = () => all(`SELECT * FROM phones WHERE featured = 1 ORDER BY sort`);
const latestAds = (n) => all(`${AD_SELECT} WHERE ${LIVE_AD} ORDER BY a.published_at DESC LIMIT ?`, n);
const latestNews = (n) => all(`SELECT * FROM news WHERE published = 1 ORDER BY published_at DESC LIMIT ?`, n);
const gallery = (n = 100) => all(`SELECT * FROM media WHERE section = 'gallery' AND kind = 'photo' ORDER BY sort, id LIMIT ?`, n);

// ---------- Home ----------
router.get('/', (req, res) => {
  res.render('home', {
    page: 'home',
    phones: featuredPhones(),
    ads: latestAds(4),
    news: latestNews(3),
    photos: gallery(5),
  });
});

// ---------- History ----------
router.get('/history', (req, res) => {
  const media = all(`SELECT * FROM media WHERE section = 'history' ORDER BY sort, id`);
  res.render('history', {
    page: 'history',
    sections: all('SELECT * FROM history_sections ORDER BY sort, id'),
    photos: media.filter((m) => m.kind === 'photo'),
    memories: media.filter((m) => m.kind === 'memory'),
    documents: media.filter((m) => m.kind === 'document'),
    videos: media.filter((m) => m.kind === 'video'),
  });
});

// ---------- Phones ----------
router.get('/phones', (req, res) => {
  const groups = all('SELECT * FROM phone_groups ORDER BY sort, id')
    .map((g) => ({ ...g, phones: all('SELECT * FROM phones WHERE group_id = ? ORDER BY sort, id', g.id) }))
    .filter((g) => g.phones.length);
  res.render('phones', { page: 'phones', groups });
});

// ---------- Ads ----------
router.get('/ads', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const cat = String(req.query.cat || '');
  const sort = ['new', 'old', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'new';
  const pageNo = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = [LIVE_AD];
  const params = [];
  if (cat) { where.push('c.slug = ?'); params.push(cat); }
  if (q) {
    where.push('(ulower(a.title) LIKE ? OR ulower(a.description) LIKE ?)');
    const like = '%' + q.toLocaleLowerCase('ru').replace(/[%_]/g, '') + '%';
    params.push(like, like);
  }
  const order = {
    new: 'a.published_at DESC',
    old: 'a.published_at ASC',
    price_asc: 'a.price IS NULL, a.price ASC',
    price_desc: 'a.price IS NULL, a.price DESC',
  }[sort];
  const total = get(`SELECT COUNT(*) AS n FROM ads a JOIN ad_categories c ON c.id = a.category_id WHERE ${where.join(' AND ')}`, ...params).n;
  const ads = all(`${AD_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE);
  const categories = all(`SELECT c.*, (SELECT COUNT(*) FROM ads a WHERE a.category_id = c.id AND ${LIVE_AD}) AS n
                          FROM ad_categories c WHERE c.active = 1 ORDER BY c.sort, c.id`);
  res.render('ads', {
    page: 'ads', ads, categories, q, cat, sort, total,
    pageNo, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    anyAds: !!get(`SELECT 1 FROM ads a WHERE ${LIVE_AD}`),
  });
});

function adForm(res, values = {}, errors = {}, status = 200) {
  res.status(status).render('ad-new', {
    page: 'ads',
    categories: all('SELECT * FROM ad_categories WHERE active = 1 ORDER BY sort, id'),
    durations: AD_DURATIONS,
    values, errors,
  });
}

router.get('/ads/new', (req, res) => adForm(res, { duration: 30 }));

router.post('/ads/new', rateLimit({ windowMs: 10 * 60 * 1000, max: 10 }), (req, res, next) => {
  const tr = t(req.params.lang);
  adPhotos(req, res, (err) => {
    const values = req.body || {};
    const errors = {};
    if (err) {
      errors.photos = err.code === 'LIMIT_FILE_SIZE' ? tr('err_photo_size')
        : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') ? tr('err_photo_count') : tr('err_generic');
      return adForm(res, values, errors, 400);
    }
    if (honeypotFilled(values) || !checkFormToken(values.ft, 5)) {
      return adForm(res, values, { _form: tr('err_spam') }, 400);
    }

    const name = String(values.author_name || '').trim();
    const phone = String(values.phone || '').trim();
    const title = String(values.title || '').trim();
    const description = String(values.description || '').trim();
    const category = get('SELECT * FROM ad_categories WHERE id = ? AND active = 1', Number(values.category_id));
    const priceRaw = digits(values.price);
    const duration = AD_DURATIONS.includes(Number(values.duration)) ? Number(values.duration) : 30;

    if (!name) errors.author_name = tr('err_required');
    else if (name.length > 60) errors.author_name = tr('err_too_long');
    const ph = digits(phone);
    if (!ph) errors.phone = tr('err_required');
    else if (!(ph.length === 11 && /^[78]/.test(ph)) && !(ph.length === 10 && ph[0] === '7')) errors.phone = tr('err_phone');
    if (!title) errors.title = tr('err_required');
    else if (title.length > 120) errors.title = tr('err_too_long');
    if (!category) errors.category_id = tr('err_category');
    if (!description) errors.description = tr('err_required');
    else if (description.length > 4000) errors.description = tr('err_too_long');
    if (/(https?:\/\/|www\.)/i.test(title + ' ' + description)) errors.description = tr('err_links');
    if (priceRaw.length > 12) errors.price = tr('err_too_long');
    if (!values.agree) errors.agree = tr('err_agree');

    const files = req.files || [];
    if (files.length > 5) errors.photos = tr('err_photo_count');

    const settings = getSettings();
    const ip = ipHash(req);
    const today = get(`SELECT COUNT(*) AS n FROM ads WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')`, ip).n;
    if (today >= (Number(settings.ads_max_per_day) || 3)) errors._form = tr('err_rate');

    if (Object.keys(errors).length) return adForm(res, values, errors, 400);

    try {
      const normalizedPhone = ph.length === 10 ? '8' + ph : '8' + ph.slice(1);
      const auto = settings.ads_auto_approve === '1';
      const id = tx(() => {
        const r = run(`INSERT INTO ads(category_id, title, description, price, author_name, phone, duration_days, ip_hash, status, published_at, expires_at)
                       VALUES(?,?,?,?,?,?,?,?,?,${auto ? "datetime('now')" : 'NULL'},${auto ? "datetime('now', '+' || ? || ' days')" : 'NULL'})`,
          category.id, title, description, category.has_price && priceRaw ? Number(priceRaw) : null,
          name, normalizedPhone, duration, ip, auto ? 'approved' : 'pending', ...(auto ? [duration] : []));
        const adId = Number(r.lastInsertRowid);
        let sort = 0;
        for (const f of files) {
          const url = store(f, 'ads', IMAGE_TYPES);
          if (!url) throw Object.assign(new Error('bad photo'), { userMessage: tr('err_photo_type') });
          run('INSERT INTO ad_photos(ad_id, filename, sort) VALUES(?,?,?)', adId, url, sort++);
        }
        return adId;
      });
      const lang = req.params.lang;
      const price = category.has_price && priceRaw ? formatPrice(Number(priceRaw)) : tr('ads_price_negotiable');
      res.locals.page = 'ads';
      whatsappPage(res, {
        key: `ad-${id}`,
        photos: true,
        backUrl: `/${lang}/ads`, backLabel: tr('ads_back'),
        text: lines(
          `📢 ${tr('wa_new_ad')} #${id}`,
          '',
          `*${title}*`,
          `${tr('ads_category')}: ${category['name_' + lang]}`,
          `${tr('ads_price')}: ${price}`,
          `${tr('ads_author')}: ${name}, ${phoneDisplay(normalizedPhone)}`,
          `${tr('form_duration')}: ${duration} ${tr('form_days')}`,
          files.length ? `${tr('wa_photos_count')}: ${files.length}` : null,
          '',
          description,
          '',
          `${tr('wa_check')}: ${res.locals.baseUrl}/admin/ads${auto ? '?status=approved' : ''}`,
        ),
      });
    } catch (e) {
      if (e.userMessage) return adForm(res, values, { photos: e.userMessage }, 400);
      next(e);
    }
  });
});

router.get('/ads/:id(\\d+)', (req, res, next) => {
  const ad = get(`${AD_SELECT} WHERE a.id = ?`, Number(req.params.id));
  // Unpublished ads are visible only to logged-in moderators (preview).
  if (!ad || (ad.status !== 'approved' && !req.user)) return next();
  const expired = ad.expires_at && new Date(ad.expires_at.replace(' ', 'T') + 'Z') < new Date();
  res.render('ad', {
    page: 'ads', ad, expired,
    photos: all('SELECT * FROM ad_photos WHERE ad_id = ? ORDER BY sort', ad.id),
    reasons: REPORT_REASONS,
    reported: req.query.reported === '1',
    similar: all(`${AD_SELECT} WHERE ${LIVE_AD} AND a.category_id = ? AND a.id != ? ORDER BY a.published_at DESC LIMIT 3`, ad.category_id, ad.id),
  });
});

router.post('/ads/:id(\\d+)/report', rateLimit({ windowMs: 3600 * 1000, max: 10 }), (req, res, next) => {
  const ad = get(`SELECT id, title FROM ads WHERE id = ? AND status = 'approved'`, Number(req.params.id));
  if (!ad) return next();
  const tr = t(req.params.lang);
  const back = `/${req.params.lang}/ads/${ad.id}`;
  if (honeypotFilled(req.body) || !checkFormToken(req.body.ft, 2)) return res.redirect(back);
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'other';
  const comment = String(req.body.comment || '').trim().slice(0, 500);
  const ip = ipHash(req);
  if (get('SELECT 1 FROM ad_reports WHERE ad_id = ? AND ip_hash = ?', ad.id, ip)) return res.redirect(back + '?reported=1');
  run('INSERT INTO ad_reports(ad_id, reason, comment, ip_hash) VALUES(?,?,?,?)', ad.id, reason, comment, ip);
  // Three independent complaints hide the ad until a moderator looks at it.
  const n = get('SELECT COUNT(*) AS n FROM ad_reports WHERE ad_id = ? AND resolved = 0', ad.id).n;
  if (n >= 3) run(`UPDATE ads SET status = 'pending' WHERE id = ?`, ad.id);
  res.locals.page = 'ads';
  whatsappPage(res, {
    key: `report-${ad.id}`,
    backUrl: back, backLabel: tr('ads_back'),
    text: lines(
      `⚠️ ${tr('wa_new_report')} #${ad.id}`,
      `«${ad.title}»`,
      `${tr('ads_report_reason')}: ${tr('ads_report_' + reason)}`,
      comment ? `${tr('ads_report_comment').replace(/\s*\(.*\)$/, '')}: ${comment}` : null,
      `${res.locals.baseUrl}${back}`,
    ),
  });
});

// ---------- News ----------
router.get('/news', (req, res) => {
  const kind = NEWS_KINDS.includes(req.query.kind) ? req.query.kind : '';
  const pageNo = Math.max(1, parseInt(req.query.page, 10) || 1);
  const where = kind ? 'published = 1 AND kind = ?' : 'published = 1';
  const params = kind ? [kind] : [];
  const total = get(`SELECT COUNT(*) AS n FROM news WHERE ${where}`, ...params).n;
  res.render('news', {
    page: 'news', kind, kinds: NEWS_KINDS, pageNo, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    news: all(`SELECT * FROM news WHERE ${where} ORDER BY is_important DESC, published_at DESC LIMIT ? OFFSET ?`, ...params, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE),
  });
});

router.get('/news/:id(\\d+)', (req, res, next) => {
  const item = get('SELECT * FROM news WHERE id = ?', Number(req.params.id));
  if (!item || (!item.published && !req.user)) return next();
  res.render('news-item', {
    page: 'news', item,
    more: all('SELECT * FROM news WHERE published = 1 AND id != ? ORDER BY published_at DESC LIMIT 3', item.id),
  });
});

// ---------- About ----------
router.get('/about', (req, res) => {
  res.render('about', {
    page: 'about',
    photos: gallery(),
    videos: all(`SELECT * FROM media WHERE section IN ('gallery','about') AND kind = 'video' ORDER BY sort, id`),
    places: all('SELECT * FROM places ORDER BY sort, id'),
    institutions: all(`SELECT p.* FROM phones p JOIN phone_groups g ON g.id = p.group_id WHERE g.slug IN ('main','utility') ORDER BY g.sort, p.sort`),
  });
});

// ---------- Contacts ----------
// ?topic=news|correction|history pre-selects the subject (links from the news, phones and history pages)
const contactsPage = (res, values, errors, status = 200) =>
  res.status(status).render('contacts', { page: 'contacts', values, errors, topics: MESSAGE_TOPICS, sent: false });

router.get('/contacts', (req, res) => {
  contactsPage(res, { topic: MESSAGE_TOPICS.includes(req.query.topic) ? req.query.topic : 'question' }, {});
});

router.post('/contacts', rateLimit({ windowMs: 3600 * 1000, max: 5 }), (req, res) => {
  const tr = t(req.params.lang);
  const values = req.body || {};
  const errors = {};
  if (honeypotFilled(values) || !checkFormToken(values.ft, 3)) errors._form = tr('err_spam');
  const name = String(values.name || '').trim();
  const text = String(values.text || '').trim();
  if (!name) errors.name = tr('err_required');
  if (!text) errors.text = tr('err_required');
  else if (text.length > 3000) errors.text = tr('err_too_long');
  if (Object.keys(errors).length) return contactsPage(res, values, errors, 400);
  const topic = MESSAGE_TOPICS.includes(values.topic) ? values.topic : 'question';
  const contact = String(values.contact || '').trim().slice(0, 120);
  const r = run('INSERT INTO messages(name, contact, text, topic, ip_hash) VALUES(?,?,?,?,?)', name.slice(0, 80), contact, text, topic, ipHash(req));
  whatsappPage(res, {
    key: `msg-${r.lastInsertRowid}`,
    photos: topic === 'news' || topic === 'history',
    backUrl: `/${req.params.lang}`, backLabel: tr('to_home'),
    text: lines(
      `✉️ ${tr('wa_new_msg')}`,
      `${tr('contacts_topic')}: ${tr('topic_' + topic)}`,
      `${tr('contacts_your_name')}: ${name.slice(0, 80)}`,
      contact ? `${tr('contacts_phone')}: ${contact}` : null,
      '',
      text,
    ),
  });
});

module.exports = router;
