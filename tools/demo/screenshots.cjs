'use strict';
// Снимки экрана для README: настоящее окно в демо-режиме (demo-app.cjs).
//
//   node tools/demo/screenshots.cjs
//   node tests/run-electron.cjs tools/demo/screenshots.cjs
//
// Переменные: WT_DEMO_LANG=en|ru, WT_DEMO_THEME=dark|light,
// WT_DEMO_STYLE=ios27|classic, WT_SHOTS_DIR — куда класть PNG (по умолчанию
// tools/demo/out/<язык>-<тема>-<оформление>/). Размер окна — 1440×900.
// Набор для README в docs/screenshots собирает readme-shots.cjs.

const path = require('path');
const demoApp = require('./demo-app.cjs');

if (demoApp.needsElectron()) {
  demoApp.relaunch(__filename);
} else {
  run();
}

function run() {
  const { say } = demoApp;
  const demo = demoApp.start({ headless: true });
  const { lang, theme, style } = demo.options;
  const outDir = path.resolve(process.env.WT_SHOTS_DIR || path.join(__dirname, 'out', `${lang}-${theme}-${style}`));
  const saved = [];
  const problems = [];

  // Тосты появляются когда придётся (сундук, обновление) — на снимках
  // их не должно быть, а курсор не должен оставлять подсветку
  const HIDE_TRANSIENT = '#toast-container { display: none !important; }';

  const shot = async (name) => {
    await demo.settle();
    // Обложки игр идут из настоящего CDN Twitch: без сети на снимке были бы
    // пустые рамки, а такой снимок в README не годится
    const broken = await demo.exec(`[...document.images]
      .filter(img => img.getClientRects().length && img.src && img.complete && !img.naturalWidth)
      .map(img => img.src.slice(0, 80))`).catch(() => []);
    if (broken.length) problems.push(name + ': не загрузились картинки: ' + broken.slice(0, 3).join(', '));
    const file = path.join(outDir, name + '.png');
    const size = await demo.capture(file);
    saved.push(file);
    say('TEST demo screenshot', name, size.width + 'x' + size.height, '→', file);
  };

  const step = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      problems.push(name + ': ' + (error && error.message || error));
      say('TEST demo screenshot FAIL', name, error && error.stack || error);
    }
  };

  const closeDialogs = () => demo.exec(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelectorAll('.category-detail-modal, #drop-detail-modal').forEach(el => el.remove());
  })()`);

  const main = async () => {
    const win = await demo.ready;
    await win.webContents.insertCSS(HIDE_TRANSIENT);
    const farming = await demo.waitForFarming();
    say('TEST demo farming:', JSON.stringify(farming));
    // Кадр плеера и обложки успевают дорисоваться
    await demo.sleep(2500);

    await step('farming', () => shot('farming'));

    await step('category-details', async () => {
      await demo.exec(`(() => {
        const page = window.farmingPage;
        const current = page.currentCategory;
        const category = page.categories.find(c => c.id === current.id) || current;
        page.showCategoryDetails(category);
      })()`);
      await demo.waitFor('document.querySelector("#category-streams-content") && document.querySelector("#category-streams-content").style.display !== "none"', { timeout: 10000 });
      await demo.sleep(700);
      await shot('category-details');
      await closeDialogs();
    });

    for (const page of ['drops', 'subscriptions', 'calendar', 'statistics', 'accounts', 'settings']) {
      await step(page, async () => {
        await demo.navigate(page);
        await demo.sleep(page === 'subscriptions' || page === 'drops' ? 2500 : 1500);
        await shot(page);

        if (page === 'drops') {
          // Окно награды: та, что сейчас набирается в фармящейся игре
          const opened = await demo.exec(`(() => {
            const game = window.farmingPage && window.farmingPage.currentCategory && window.farmingPage.currentCategory.name;
            const read = (value) => { try { return JSON.parse(decodeURIComponent(value || '')); } catch (e) { return null; } };
            const parsed = [...document.querySelectorAll('[data-drop]')]
              .map(el => [el, read(el.dataset.drop), read(el.dataset.campaign)])
              .filter(([, drop]) => drop);
            const growing = ([, d]) => !d.claimed && d.progress > 0 && d.progress < d.required;
            const pick = parsed.find(item => growing(item) && item[2] && item[2].game && item[2].game.name === game) ||
              parsed.find(growing) || parsed[0];
            if (!pick) return false;
            pick[0].click();
            return true;
          })()`);
          if (opened && await demo.waitFor('document.getElementById("drop-detail-modal")', { timeout: 5000 })) {
            await demo.sleep(700);
            await shot('drop-details');
            await closeDialogs();
          } else {
            problems.push('drop-details: окно награды не открылось');
          }
        }
      });
    }

    // Ошибки окна — признак того, что демо где-то не дотянуло данные
    const errors = demo.rendererErrors.slice(0, 20);
    if (errors.length) say('TEST demo renderer errors:\n  ' + errors.join('\n  '));
    if (demo.blocked.size) say('TEST demo blocked hosts:', [...demo.blocked].join(', '));
    say(`TEST demo screenshots ${problems.length ? 'FAIL' : 'PASS'}: ${saved.length} files in ${outDir}`);
    problems.forEach(p => say('  ' + p));
    demo.quit(problems.length ? 1 : 0);
  };

  main().catch(error => {
    say('TEST demo screenshots FAIL', error && error.stack || error);
    demo.quit(1);
  });
  // Страховка от зависания: снимки занимают меньше минуты
  setTimeout(() => {
    say('TEST demo screenshots FAIL: timeout');
    demo.quit(2);
  }, 150000).unref();
}
