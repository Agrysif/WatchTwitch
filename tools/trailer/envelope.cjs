// Огибающая трека для трейлера: assets/track.mp3 → assets/env.js.
// По ней эквалайзер и свечение в trailer.html «дышат» в такт музыке.
//
//   node tools/trailer/envelope.cjs
//
// Шаг 20 мс; rms — общая громкость, low — низ (бочка и бас) через
// простой фильтр нижних частот. Обе кривые нормированы к 0..1.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FFMPEG = process.env.FFMPEG || (fs.existsSync('C:\\ffmpeg\\bin\\ffmpeg.exe') ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : 'ffmpeg');
const SR = 22050, HOP = 441;

const raw = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', path.join(DIR, 'assets', 'track.mp3'),
  '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);

const rms = [], low = [];
let lp = 0;
for (let i = 0; i + HOP <= x.length; i += HOP) {
  let s = 0, l = 0;
  for (let j = 0; j < HOP; j++) {
    const v = x[i + j];
    s += v * v;
    lp += 0.02 * (v - lp);
    l += lp * lp;
  }
  rms.push(Math.sqrt(s / HOP));
  low.push(Math.sqrt(l / HOP));
}
const norm = a => { const m = Math.max(...a) || 1; return a.map(v => +(v / m).toFixed(3)); };
fs.writeFileSync(path.join(DIR, 'assets', 'env.js'),
  '// Огибающая трека (шаг 20 мс, 0..1): общая громкость и низ — для реакции на звук\n' +
  'window.ENV = ' + JSON.stringify({ hop: HOP / SR, rms: norm(rms), low: norm(low) }) + ';\n');
console.log('env.js:', rms.length, 'точек');
