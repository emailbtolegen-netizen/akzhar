// Turns the raw 4K DJI drone footage into light files for the web:
//   public/media/hero.mp4          — silent loop for the first screen (desktop, 1280x720)
//   public/media/hero-mobile.mp4   — the same loop for phones (854x480)
//   public/media/akzhar-drone.mp4  — longer montage for the "Watch video" player
//   public/media/hero-poster.jpg   — cover shown while the video loads / on slow connections
//   public/media/gallery-N.jpg     — stills for the photo gallery
//
// Usage: npm run media            (source files are looked up in the project root)
//        npm run media -- D:\Video (or another folder with DJI_*.MP4 files)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ffmpeg = require('ffmpeg-static');
const SRC_DIR = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..'));
const OUT = path.join(__dirname, '..', 'public', 'media');
fs.mkdirSync(OUT, { recursive: true });

const clip = (id) => {
  const f = fs.readdirSync(SRC_DIR).find((n) => n.includes(`_${id}_`) && /\.mp4$/i.test(n));
  if (!f) throw new Error(`Не найден исходный файл DJI_*_${id}_D.MP4 в ${SRC_DIR}`);
  return path.join(SRC_DIR, f);
};

// Colour grade: the footage was shot on an overcast day and looks grey.
// More saturation and contrast, a touch warmer (sunny steppe tones), cooler highlights kept neutral.
const GRADE = 'eq=saturation=1.45:contrast=1.08:brightness=0.015:gamma=0.97,' +
  'colorbalance=rs=0.04:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03:rh=0.03:bh=-0.02';

function sh(args) {
  console.log('ffmpeg', args.filter((a) => !a.startsWith('/') && !a.includes(':\\')).slice(0, 6).join(' '), '…');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

// Montage of [file, start, duration] segments joined with soft cross-fades.
function montage(segments, out, { width, height, crf, fps = 30, fade = 0.8 }) {
  const inputs = [];
  const filters = [];
  segments.forEach(([id, start, dur], i) => {
    inputs.push('-ss', String(start), '-t', String(dur), '-i', clip(id));
    filters.push(`[${i}:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${GRADE},setsar=1,format=yuv420p[v${i}]`);
  });
  let last = 'v0';
  let length = segments[0][2];
  for (let i = 1; i < segments.length; i++) {
    const offset = (length - fade).toFixed(2);
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset}[x${i}]`);
    last = `x${i}`;
    length = length - fade + segments[i][2];
  }
  sh([...inputs, '-filter_complex', filters.join(';'), '-map', `[${last}]`, '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-movflags', '+faststart', out]);
}

function still(id, at, out, width = 1600) {
  sh(['-ss', String(at), '-i', clip(id), '-frames:v', '1', '-vf', `scale=${width}:-2,${GRADE}`, '-q:v', '4', out]);
}

// Smaller copies of every still (name-480.jpg, name-960.jpg) for srcset: phones download
// a 50–120 KB image instead of the 400–500 KB original. Made from the finished stills.
function variants() {
  for (const f of fs.readdirSync(OUT)) {
    if (!/^(gallery-\d+|hero-poster)\.jpg$/.test(f)) continue;
    for (const w of [480, 960]) {
      sh(['-i', path.join(OUT, f), '-vf', `scale=${w}:-2`, '-q:v', '5', path.join(OUT, f.replace('.jpg', `-${w}.jpg`))]);
    }
  }
}
if (process.argv.includes('--variants-only')) { variants(); process.exit(0); }

const heroSegments = [['0156', 0, 9], ['0155', 3, 6], ['0160', 2, 7]];
montage(heroSegments, path.join(OUT, 'hero.mp4'), { width: 1280, height: 720, crf: 30, fps: 25 });
montage(heroSegments, path.join(OUT, 'hero-mobile.mp4'), { width: 854, height: 480, crf: 31, fps: 25 });
still('0156', 1, path.join(OUT, 'hero-poster.jpg'), 1280);

montage([['0156', 0, 22], ['0155', 0, 12], ['0157', 2, 10], ['0159', 5, 14], ['0160', 30, 16], ['0158', 2, 8]],
  path.join(OUT, 'akzhar-drone.mp4'), { width: 1280, height: 720, crf: 26 });

const stills = [['0156', 3], ['0157', 8], ['0155', 20], ['0159', 2], ['0160', 15], ['0158', 6], ['0156', 150], ['0160', 200]];
stills.forEach(([id, at], i) => still(id, at, path.join(OUT, `gallery-${i + 1}.jpg`)));
variants();

for (const f of fs.readdirSync(OUT)) {
  console.log(f.padEnd(22), (fs.statSync(path.join(OUT, f)).size / 1024 / 1024).toFixed(2), 'MB');
}
