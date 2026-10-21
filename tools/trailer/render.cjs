// Рендер трейлера: кадры trailer.html → ffmpeg → MP4 с треком.
//
// Ассеты в assets/ в git не входят, их собирают так:
//   assets/track.mp3 — музыка (Suno, 140 BPM; тайминги сцен в trailer.html под неё)
//   assets/shots/    — WT_DEMO_SCALE=2 WT_SHOTS_DIR=tools/trailer/assets/shots node tools/demo/screenshots.cjs
//   assets/env.js    — node tools/trailer/envelope.cjs
//
// Полный ролик (~4 мин; run-electron.cjs обрывает через 90 с, поэтому напрямую):
//   electron tools/trailer/render.cjs                          (без ELECTRON_RUN_AS_NODE)
//   node tests/run-electron.cjs tools/trailer/render.cjs       — годится для кадров-проверок
//   env TRAILER_STILLS=1.5,3.2,10.4  — только эти кадры в out/stills/*.png
//   env TRAILER_FPS=60, TRAILER_FROM / TRAILER_TO — кусок ролика (сек)
//   env TRAILER_OUT — имя файла (по умолчанию out/WatchTwitch-trailer.mp4)
//   env TRAILER_CLEAN=1 — без зерна и строк развёртки (для GIF)
//   env FFMPEG — путь к ffmpeg (по умолчанию C:\ffmpeg\bin\ffmpeg.exe или ffmpeg)
//
// Окно рисуется вне экрана (offscreen): размер 1920×1080 не зависит от
// монитора и масштаба Windows, а кадр снимается только после render(t).
const { app, BrowserWindow, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'out');
const FPS = Number(process.env.TRAILER_FPS) || 60;
const FFMPEG = process.env.FFMPEG || (fs.existsSync('C:\\ffmpeg\\bin\\ffmpeg.exe') ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : 'ffmpeg');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

function log(...args) { console.log('TEST trailer', ...args); }

// Кадр берём из события paint, пришедшего после render(t): capturePage в
// режиме offscreen отдаёт последний уже нарисованный кадр, то есть предыдущий
// Страница пишет номер кадра битами в 16 пикселей первой строки; ждём paint
// с этим номером. Конвейер offscreen отдаёт кадры с задержкой в 1–2 штуки
let frameId = 0;
function readMark(bmp) {
  let id = 0;
  for (let i = 0; i < 16; i++) if (bmp[i * 4 + 1] > 127) id |= 1 << i;
  return id;
}
async function frame(wc, t) {
  frameId = (frameId + 1) & 0xffff;
  const want = frameId;
  let bitmap = null;
  const got = new Promise((resolve) => {
    const onPaint = (_e, _dirty, img) => {
      const size = img.getSize();
      if (size.width !== 1920 || size.height !== 1080) return;
      const bmp = img.toBitmap();
      if (readMark(bmp) !== want) { setTimeout(() => wc.invalidate(), 4); return; }
      wc.removeListener('paint', onPaint);
      resolve(bmp);
    };
    wc.on('paint', onPaint);
  });
  await wc.executeJavaScript(`render(${t}, ${want})`);
  wc.invalidate();
  bitmap = await Promise.race([got, new Promise((_, reject) => setTimeout(() => reject(new Error('нет кадра ' + t)), 15000))]);
  // метку затираем пикселями второй строки
  bitmap.copy(bitmap, 0, 1920 * 4, 1920 * 4 + 16 * 4);
  return bitmap;
}
function png(bitmap) {
  return nativeImage.createFromBitmap(bitmap, { width: 1920, height: 1080 }).toPNG();
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false, useContentSize: true, frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: false },
  });
  win.webContents.setFrameRate(120);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('page:', message); });
  await win.loadFile(path.join(DIR, 'trailer.html'));
  await win.webContents.executeJavaScript('window.ready');
  // TRAILER_CLEAN=1 — без плёночного зерна и строк развёртки: для GIF и
  // сильного сжатия, где шум раздувает файл и превращается в кашу
  if (process.env.TRAILER_CLEAN === '1') {
    await win.webContents.executeJavaScript(`['grain', 'lines'].forEach(id => { document.getElementById(id).style.display = 'none'; })`);
  }
  const duration = await win.webContents.executeJavaScript('window.DURATION');

  if (process.env.TRAILER_STILLS) {
    const dir = path.join(OUT, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of process.env.TRAILER_STILLS.split(',').map(Number)) {
      const image = await frame(win.webContents, s);
      const file = path.join(dir, `t${s.toFixed(2).padStart(5, '0')}.png`);
      fs.writeFileSync(file, png(image));
      log('still', file);
    }
    app.exit(0);
    return;
  }

  const from = Number(process.env.TRAILER_FROM) || 0;
  const to = Math.min(duration, Number(process.env.TRAILER_TO) || duration);
  const file = process.env.TRAILER_OUT || path.join(OUT, 'WatchTwitch-trailer.mp4');
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', '1920x1080', '-r', String(FPS), '-i', '-',
    '-ss', String(from), '-t', String(to - from), '-i', path.join(DIR, 'assets', 'track.mp3'),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'film',
    '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', file,
  ];
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { ff.on('close', code => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code)))); });
  const total = Math.round((to - from) * FPS);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const buf = await frame(win.webContents, from + i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 120 === 0) log(`frame ${i}/${total}  ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await done;
  log('video', file, ((Date.now() - started) / 1000).toFixed(0) + ' s');
  app.exit(0);
}).catch(error => { console.error('TEST trailer FAIL', error); app.exit(1); });
