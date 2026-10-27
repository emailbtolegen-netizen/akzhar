// Backup: a consistent copy of the database and the uploads folder into backups/<date-time>/
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../src/db');
const { UPLOAD_DIR } = require('../src/uploads');

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const out = path.join(__dirname, '..', 'backups', stamp);
fs.mkdirSync(out, { recursive: true });
db.exec(`VACUUM INTO '${path.join(out, 'akzhar.db').replace(/'/g, "''")}'`);
fs.cpSync(UPLOAD_DIR, path.join(out, 'uploads'), { recursive: true, filter: (src) => !src.includes(`${path.sep}tmp`) });
console.log('Резервная копия:', out);
