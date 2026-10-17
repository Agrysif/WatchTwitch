'use strict';
// Снимки для README: английский интерфейс в docs/screenshots/.
//
//   node tools/demo/readme-shots.cjs
//
// Три прогона screenshots.cjs (тёмная iOS 27, светлая, классика), из них
// берутся нужные страницы и пережимаются без потерь: PNG из Electron сжат
// быстро и весит вдвое больше. Палитру не берём — на небе кадра стрима
// появились бы полосы.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

// снимок screenshots.cjs → имя в docs/screenshots
const RUNS = [
  {
    env: { WT_DEMO_THEME: 'dark', WT_DEMO_STYLE: 'ios27' },
    files: {
      farming: 'farming',
      drops: 'drops',
      subscriptions: 'following',
      calendar: 'calendar',
      statistics: 'statistics',
      settings: 'settings'
    }
  },
  { env: { WT_DEMO_THEME: 'light', WT_DEMO_STYLE: 'ios27' }, files: { farming: 'farming-light' } },
  { env: { WT_DEMO_THEME: 'dark', WT_DEMO_STYLE: 'classic' }, files: { farming: 'farming-classic' } }
];

async function main() {
  const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watchtwitch-readme-shots-'));
  let failed = false;
  try {
    const ready = [];
    for (const [index, run] of RUNS.entries()) {
      const dir = path.join(tmp, String(index));
      const result = spawnSync(process.execPath, [path.join(__dirname, 'screenshots.cjs')], {
        cwd: ROOT,
        env: { ...process.env, ...run.env, WT_DEMO_LANG: 'en', WT_SHOTS_DIR: dir },
        stdio: 'inherit'
      });
      // Неудачный прогон (картинки не загрузились, окно не открылось) не
      // должен тихо заменить хорошие снимки в docs
      if (result.status !== 0) {
        console.error(`readme-shots: прогон ${JSON.stringify(run.env)} завершился с кодом ${result.status}`);
        failed = true;
        break;
      }
      for (const [shot, name] of Object.entries(run.files)) ready.push([path.join(dir, shot + '.png'), name]);
    }
    if (failed) return 1;

    fs.mkdirSync(OUT, { recursive: true });
    for (const [src, name] of ready) {
      const file = path.join(OUT, name + '.png');
      const info = await sharp(src).png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toFile(file);
      console.log(`${name}.png  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`);
    }
    console.log('readme-shots: ' + ready.length + ' PNG в ' + OUT);
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().then(code => { process.exitCode = code; }, error => {
  console.error('readme-shots:', error && error.stack || error);
  process.exitCode = 1;
});
