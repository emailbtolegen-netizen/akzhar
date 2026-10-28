// SQLite database (built into Node.js >= 22.5): schema, migrations and initial data.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'akzhar.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'moderator', -- admin | editor | moderator
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_categories (
  id      INTEGER PRIMARY KEY,
  slug    TEXT UNIQUE NOT NULL,
  name_kk TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  icon    TEXT NOT NULL DEFAULT 'tag',
  has_price INTEGER NOT NULL DEFAULT 1,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ads (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES ad_categories(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  price        INTEGER,
  price_note   TEXT NOT NULL DEFAULT '',
  author_name  TEXT NOT NULL,
  phone        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reject_reason TEXT NOT NULL DEFAULT '',
  duration_days INTEGER NOT NULL DEFAULT 30,
  ip_hash      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  expires_at   TEXT
);
CREATE INDEX IF NOT EXISTS ads_status ON ads(status, published_at);

CREATE TABLE IF NOT EXISTS ad_photos (
  id       INTEGER PRIMARY KEY,
  ad_id    INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ad_reports (
  id         INTEGER PRIMARY KEY,
  ad_id      INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'news', -- news | event | sport | outage | roads | notice
  title_kk     TEXT NOT NULL DEFAULT '',
  title_ru     TEXT NOT NULL DEFAULT '',
  body_kk      TEXT NOT NULL DEFAULT '',
  body_ru      TEXT NOT NULL DEFAULT '',
  image        TEXT NOT NULL DEFAULT '',
  is_example   INTEGER NOT NULL DEFAULT 0,
  is_important INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS history_sections (
  id       INTEGER PRIMARY KEY,
  slug     TEXT UNIQUE NOT NULL,
  title_kk TEXT NOT NULL,
  title_ru TEXT NOT NULL,
  body_kk  TEXT NOT NULL DEFAULT '',
  body_ru  TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);

-- Photos, videos, documents and old-timers' memories for the gallery, history and about pages
CREATE TABLE IF NOT EXISTS media (
  id         INTEGER PRIMARY KEY,
  section    TEXT NOT NULL DEFAULT 'gallery', -- gallery | history | about
  kind       TEXT NOT NULL DEFAULT 'photo',   -- photo | video | document | memory
  era        TEXT NOT NULL DEFAULT 'present', -- past | present
  file       TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  title_kk   TEXT NOT NULL DEFAULT '',
  title_ru   TEXT NOT NULL DEFAULT '',
  text_kk    TEXT NOT NULL DEFAULT '',
  text_ru    TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT '',
  year_label TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phone_groups (
  id      INTEGER PRIMARY KEY,
  slug    TEXT UNIQUE NOT NULL,
  name_kk TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS phones (
  id        INTEGER PRIMARY KEY,
  group_id  INTEGER NOT NULL REFERENCES phone_groups(id),
  name_kk   TEXT NOT NULL,
  name_ru   TEXT NOT NULL,
  note_kk   TEXT NOT NULL DEFAULT '',
  note_ru   TEXT NOT NULL DEFAULT '',
  phone     TEXT NOT NULL DEFAULT '',
  phone2    TEXT NOT NULL DEFAULT '',
  icon      TEXT NOT NULL DEFAULT 'phone',
  featured  INTEGER NOT NULL DEFAULT 0,
  verified  INTEGER NOT NULL DEFAULT 0,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS places (
  id       INTEGER PRIMARY KEY,
  name_kk  TEXT NOT NULL,
  name_ru  TEXT NOT NULL,
  text_kk  TEXT NOT NULL DEFAULT '',
  text_ru  TEXT NOT NULL DEFAULT '',
  image    TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL,
  ip_hash    TEXT NOT NULL DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- migrations for databases created by earlier versions ----------
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
if (!columns('messages').includes('topic')) db.exec(`ALTER TABLE messages ADD COLUMN topic TEXT NOT NULL DEFAULT ''`);

// ---------- helpers ----------
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value ?? ''));
}

// ---------- initial data (only inserted into an empty database) ----------
function seed() {
  const defaults = {
    site_name_kk: 'Ақжар',
    site_name_ru: 'Акжар',
    slogan_kk: 'Біздің ауыл — біздің тарихымыз, біздің болашағымыз',
    slogan_ru: 'Наш поселок — наша история, наше будущее',
    welcome_kk: 'Ақжар ауылының ақпараттық сайтына қош келдіңіз! Мұнда ауыл тарихымен танысып, қажетті телефон нөмірлерін тауып, жаңалықтарды оқып, хабарландыру бере аласыз.',
    welcome_ru: 'Добро пожаловать на информационный сайт поселка Акжар! Здесь можно узнать историю поселка, найти нужный телефон, прочитать новости и разместить объявление.',
    region_kk: 'Атырау қаласы, Қазақстан',
    region_ru: 'город Атырау, Казахстан',
    location_kk: '',
    location_ru: '',
    address_kk: '',
    address_ru: '',
    contact_phone: '',
    contact_email: '',
    contact_hours_kk: '',
    contact_hours_ru: '',
    whatsapp: '87789705854', // all messages from the site's forms are sent to this WhatsApp number
    instagram: '',
    map_lat: '',
    map_lon: '',
    hero_video: '/media/hero.mp4',
    hero_video_mobile: '/media/hero-mobile.mp4',
    hero_poster: '/media/hero-poster.jpg',
    full_video: '/media/akzhar-drone.mp4',
    video_url: '',
    ads_auto_approve: '0',
    ads_max_per_day: '3',
  };
  for (const [k, v] of Object.entries(defaults)) {
    run('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)', k, v);
  }

  if (!get('SELECT 1 FROM ad_categories LIMIT 1')) {
    const cats = [
      ['realty', 'Жылжымайтын мүлік', 'Недвижимость', 'home', 1],
      ['jobs', 'Жұмыс және бос орындар', 'Работа и вакансии', 'briefcase', 1],
      ['services', 'Шеберлер мен мамандар қызметі', 'Услуги мастеров и специалистов', 'tool', 1],
      ['goods', 'Тауарларды сату және сатып алу', 'Покупка и продажа товаров', 'bag', 1],
      ['farm', 'Жануарлар және ауыл шаруашылығы', 'Животные и сельское хозяйство', 'leaf', 1],
      ['lost', 'Жоғалған және табылған заттар', 'Потерянные и найденные вещи', 'search', 0],
      ['local', 'Жергілікті жаңалықтар мен маңызды хабарлар', 'Местные новости и важные сообщения', 'megaphone', 0],
      ['business', 'Ұйымдар мен кәсіпкерлердің хабарландырулары', 'Объявления организаций и предпринимателей', 'building', 1],
      ['other', 'Басқа', 'Прочее', 'dots', 1],
    ];
    cats.forEach((c, i) => run('INSERT INTO ad_categories(slug, name_kk, name_ru, icon, has_price, sort) VALUES(?,?,?,?,?,?)', ...c, i));
  }

  if (!get('SELECT 1 FROM history_sections LIMIT 1')) {
    // Structure only: the texts are filled in later by the administrator from verified sources.
    const sections = [
      ['founding', 'Ауылдың құрылу тарихы', 'История основания поселка'],
      ['name', '«Ақжар» атауының шығу тегі', 'Происхождение названия «Акжар»'],
      ['events', 'Негізгі тарихи оқиғалар', 'Основные исторические события'],
      ['development', 'Ауыл мен инфрақұрылымның дамуы', 'Развитие поселка и инфраструктуры'],
      ['life', 'Тұрғындар өміріндегі өзгерістер', 'Изменения в жизни местных жителей'],
      ['today', 'Ауылдың бүгінгі жағдайы', 'Современное состояние поселка'],
    ];
    sections.forEach((s, i) => run('INSERT INTO history_sections(slug, title_kk, title_ru, sort) VALUES(?,?,?,?)', ...s, i));
  }

  if (!get('SELECT 1 FROM phone_groups LIMIT 1')) {
    const groups = [
      ['main', 'Негізгі мекемелер', 'Основные учреждения'],
      ['utility', 'Коммуналдық қызметтер және байланыс', 'Коммунальные службы и связь'],
    ];
    groups.forEach((g, i) => run('INSERT INTO phone_groups(slug, name_kk, name_ru, sort) VALUES(?,?,?,?)', ...g, i));
    const gid = (slug) => get('SELECT id FROM phone_groups WHERE slug = ?', slug).id;

    // Numbers come from the materials provided by the site owner (photo + docx), Oct 2026.
    // Empty phone = not provided yet, the site shows "number will be added".
    const phones = [
      // group, name_kk, name_ru, note_kk, note_ru, phone, phone2, icon, featured
      ['main', 'Медициналық пункт', 'Медицинский пункт', '', '', '87122397365', '', 'medical', 1],
      ['main', 'Тіркеу орны (регистратура)', 'Регистратура', '', '', '87781313678', '87781310098', 'medical', 0],
      ['main', 'Мектеп', 'Школа', '', '', '87122397226', '87122397342', 'school', 1],
      ['main', 'Балабақша', 'Детский сад', '', '', '', '', 'kids', 1],
      ['main', 'Қазпошта', 'Казпочта', '', '', '87122397227', '', 'mail', 1],
      ['main', 'Учаскелік полиция инспекторы', 'Участковый полицейский', '', '', '', '', 'shield', 1],
      ['utility', 'Су арнасы — апаттық қызмет', 'Водоканал — аварийная служба', '', '', '87122760923', '87122760918', 'drop', 0],
      ['utility', 'Қазақтелеком', 'Казахтелеком', '', '', '160', '', 'wifi', 0],
      ['utility', 'Интернет мәселелері бойынша', 'По вопросам интернета', '', '', '87080000160', '', 'wifi', 0],
    ];
    phones.forEach((p, i) => run(
      'INSERT INTO phones(group_id, name_kk, name_ru, note_kk, note_ru, phone, phone2, icon, featured, sort) VALUES(?,?,?,?,?,?,?,?,?,?)',
      gid(p[0]), p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], i));
  }

  if (!get('SELECT 1 FROM news LIMIT 1')) {
    run(`INSERT INTO news(kind, title_kk, title_ru, body_kk, body_ru, image, is_example) VALUES(?,?,?,?,?,?,1)`,
      'notice',
      'Ауыл сайты іске қосылды',
      'Запущен сайт поселка',
      'Бұл — жаңалық беті қалай көрінетінін көрсететін мысал. Әкімші оны басқару панелінде өзгертіп немесе жоя алады.\n\nЖаңалықтарда фотосурет, мәтін, күні және сілтемемен бөлісу батырмасы болады.',
      'Это пример, показывающий, как выглядит страница новости. Администратор может изменить или удалить его в панели управления.\n\nУ каждой новости есть фотография, текст, дата и кнопка «Поделиться».',
      '/media/gallery-1.jpg');
  }

  if (!get('SELECT 1 FROM media LIMIT 1')) {
    // Stills taken from the drone footage (generated by `npm run media`)
    for (let i = 1; i <= 8; i++) {
      if (fs.existsSync(path.join(__dirname, '..', 'public', 'media', `gallery-${i}.jpg`))) {
        const mosque = i === 2;
        run(`INSERT INTO media(section, kind, era, file, title_kk, title_ru, sort) VALUES('gallery','photo','present',?,?,?,?)`,
          `/media/gallery-${i}.jpg`,
          mosque ? '«Әр-Рахман» мешіті' : 'Ақжар — дроннан түсірілген',
          mosque ? 'Мечеть «Ар-Рахман»' : 'Акжар — съемка с дрона', i);
      }
    }
  }

  if (!get('SELECT 1 FROM places LIMIT 1')) {
    // Name taken from the sign on the building (drone footage, Oct 2026). Description is left for the administrator.
    run('INSERT INTO places(name_kk, name_ru, image, sort) VALUES(?,?,?,0)', '«Әр-Рахман» мешіті', 'Мечеть «Ар-Рахман»', '/media/gallery-2.jpg');
  }
}
seed();

module.exports = { db, all, get, run, tx, getSettings, setSetting, DATA_DIR };
