// File uploads. The file type is checked by its content (magic bytes), not by the
// name the browser sends; files get random names and are served without execution.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(path.join(UPLOAD_DIR, 'tmp'), { recursive: true });

const MB = 1024 * 1024;

function detectType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(4, 8).toString() === 'ftyp') return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'pdf';
  return null;
}
const IMAGE_TYPES = ['jpg', 'png', 'webp'];

function readHead(file) {
  if (file.buffer) return file.buffer.subarray(0, 16);
  const fd = fs.openSync(file.path, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return buf;
}

// Moves an uploaded file into uploads/<sub>/ and returns its public URL,
// or null if its content is not one of the allowed types.
function store(file, sub, allowed) {
  const type = detectType(readHead(file));
  if (!type || !allowed.includes(type)) {
    if (file.path) fs.rmSync(file.path, { force: true });
    return null;
  }
  const dir = path.join(UPLOAD_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${type}`;
  if (file.buffer) fs.writeFileSync(path.join(dir, name), file.buffer);
  else fs.renameSync(file.path, path.join(dir, name));
  return `/uploads/${sub}/${name}`;
}

function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const p = path.resolve(UPLOAD_DIR, url.slice('/uploads/'.length));
  if (p.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) fs.rmSync(p, { force: true });
}

// Public ad photos: kept in memory (small), max 5 × 8 MB.
const adPhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * MB, files: 5, fields: 30, fieldSize: 20000 },
}).array('photos', 5);

// Admin uploads: written to disk because videos can be large.
const adminUpload = multer({
  storage: multer.diskStorage({ destination: path.join(UPLOAD_DIR, 'tmp') }),
  limits: { fileSize: 500 * MB, files: 20 },
});

module.exports = { UPLOAD_DIR, adPhotos, adminUpload, store, removeUpload, IMAGE_TYPES, detectType };
