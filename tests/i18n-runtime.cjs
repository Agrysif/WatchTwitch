'use strict';
// Проверка перевода на живом интерфейсе: демо-режим (tools/demo/demo-app.cjs)
// на выбранном языке обходит все страницы, открывает окна и разделы настроек
// и собирает видимый текст и подписи (title, placeholder, aria-label,
// data-tooltip, alt) с кириллицей, числа в русском формате («59 311», «0,26»)
// и window.tr.missing(). Так же проверяется то, что main показывает сам:
// заставка, меню и подпись трея, всплывашки Windows, окно о награде.
//
//   node tests/i18n-runtime.cjs                 — английский, оба сценария, код 1 при находках
//   node tests/i18n-runtime.cjs --lang ru --dump before.json
//   node tests/run-electron.cjs tests/i18n-runtime.cjs   (сценарий demo; подробности — в .log)
//
// Сценарии (--scenario): demo — профиль с данными, фарминг идёт;
// empty — без аккаунта и данных, с подсказками первого запуска. Без ключа
// из обычного node проходят оба, каждый в своём Electron.
//
// --dump <файл> — видимый текст каждого экрана по порядку в DOM: так можно
// сравнить русский интерфейс до и после правок. Таймеры и минуты идут, поэтому
// числа между запусками немного расходятся. С двумя сценариями файлов два:
// <имя>.<сценарий>.json.
// --clipped — показать текст, обрезанный многоточием (английский длиннее
// русского: узкие кнопки, пункты меню, значки).
// Ключи: --lang en|ru, --theme dark|light, --style ios27|classic.

const fs = require('fs');
const path = require('path');
const demoApp = require('../tools/demo/demo-app.cjs');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const SCENARIOS = ['demo', 'empty'];

if (demoApp.needsElectron()) {
  if (arg('scenario')) demoApp.relaunch(__filename, argv);
  else runAll();
} else {
  run(SCENARIOS.includes(arg('scenario')) ? arg('scenario') : 'demo');
}

/** Из обычного node: сценарии по очереди, каждый в своём Electron. */
async function runAll() {
  let worst = 0;
  for (const scenario of SCENARIOS) {
    const args = [...argv, '--scenario', scenario];
    const dump = arg('dump');
    if (dump) args[args.indexOf(dump)] = dump.replace(/(\.json)?$/i, '.' + scenario + '.json');
    const code = await demoApp.spawnElectron(__filename, args);
    worst = Math.max(worst, code);
  }
  process.exit(worst);
}

// Кириллица, которой в английском интерфейсе место: название языка на нём самом
const ALLOWED = new Set(['Русский', 'Русский включится после перезапуска']);

// Собирает видимый текст страницы и подписи элементов. Выполняется в окне
const COLLECT = `(() => {
  const CYR = /[А-Яа-яЁё]/;
  // Число в русском формате («59 311» с неразрывным пробелом, «0,26»):
  // toLocaleString() без tr.locale() берёт язык Windows, а не приложения
  const RU_NUMBER = /\\d[\\u00a0\\u202f]\\d{3}(?!\\d)|\\d,\\d{1,2}(?!\\d)/;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tooltip', 'alt'];
  const WRAP_CHECK = 'button, .btn, .badge, [class*="badge"], [class*="chip"], [class*="pill"], [class*="tag"], .nav-item, [role="tab"], .segmented, .kpi-label, .card-title, .dialog-title';
  const norm = (s) => String(s).replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    if (el.tagName === 'OPTION') el = el.closest('select') || el;
    return typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : el.getClientRects().length > 0;
  };
  const where = (el) => {
    let self = el.tagName.toLowerCase();
    if (el.id) self += '#' + el.id;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) self += '.' + cls.join('.');
    const owner = el.parentElement && el.parentElement.closest('[id]');
    return (owner ? '#' + owner.id + ' › ' : '') + self;
  };
  const text = [];
  const attrs = [];
  const found = [];
  const clipped = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) continue;
    const value = norm(node.nodeValue);
    if (!value || !visible(parent)) continue;
    text.push(value);
    const noTr = !!parent.closest('[data-no-tr]');
    if (CYR.test(value)) found.push({ kind: 'text', value, where: where(parent), noTr });
    else if (RU_NUMBER.test(node.nodeValue)) found.push({ kind: 'число', value, where: where(parent), noTr });
  }
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName)) continue;
    for (const name of ATTRS) {
      const value = norm(el.getAttribute(name) || '');
      if (!value) continue;
      const shown = visible(el);
      if (shown) attrs.push(name + '=' + value);
      if (CYR.test(value)) found.push({ kind: name, value, where: where(el), hidden: !shown, noTr: !!el.closest('[data-no-tr]') });
    }
    // Обрезанный текст: многоточие или одна строка без переноса, которая
    // не влезла, и line-clamp, у которого строки кончились
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!own && !(el.children.length === 1 && el.textContent.trim())) continue;
    // Кнопка, значок, вкладка или пункт меню в две строки — тоже признак,
    // что подпись не влезла
    // Строки считаются по собственному тексту элемента: значок или счётчик
    // рядом стоит на другой высоте, и по всему содержимому выходили ложные
    // «переносы» у «Все 8» и подобных
    if (own && el.closest(WRAP_CHECK) && visible(el)) {
      const lines = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width > 0 && !lines.some(top => Math.abs(top - r.top) < r.height / 2)) lines.push(r.top);
        }
      }
      if (lines.length > 1) clipped.push({ value: norm(el.textContent).slice(0, 120), where: where(el), kind: 'перенос' });
    }
    const cs = getComputedStyle(el);
    const line = cs.textOverflow === 'ellipsis' || (cs.whiteSpace === 'nowrap' && cs.overflowX !== 'visible');
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (!line && !clamp) continue;
    // Скрытые для глаз подписи для экранного диктора (1×1 px) — не в счёт
    if (!visible(el) || el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    if ((line && el.scrollWidth > el.clientWidth + 1) || (clamp && el.scrollHeight > el.clientHeight + 1)) {
      clipped.push({ value: norm(el.textContent).slice(0, 120), where: where(el) });
    }
  }
  return { text, attrs, found, clipped, missing: window.tr && window.tr.missing ? window.tr.missing() : [] };
})()`;

// Запись того, что окно показало мимоходом: тосты, записи журнала,
// уведомления Windows от страницы фарминга. Текст тоста часто приходит из
// main готовой фразой, и tr.missing() его не видит. Звать можно сколько
// угодно раз: каждая функция оборачивается один раз (farming-page.js
// подгружается позже остального)
const RECORD = `(() => {
  const shown = window.__wtShown = window.__wtShown || [];
  const wrap = (owner, name, pick) => {
    const fn = owner && owner[name];
    if (typeof fn !== 'function' || fn.__wtRecorded) return;
    const wrapped = function (...args) {
      try {
        for (const [where, value] of pick(args)) {
          if (value != null && String(value).trim()) shown.push({ where, value: String(value) });
        }
      } catch (e) { /* запись не должна ломать окно */ }
      return fn.apply(this, args);
    };
    wrapped.__wtRecorded = true;
    owner[name] = wrapped;
  };
  wrap(window.utils, 'showToast', ([message, type, opts]) => [
    ['тост', message], ['тост: заголовок', opts && opts.title], ['тост: кнопка', opts && opts.action && opts.action.label]
  ]);
  wrap(window.eventLog, 'add', ([entry]) => [['журнал', entry && entry.title], ['журнал: подробности', entry && entry.detail]]);
  wrap(window, 'notifyFarmingEvent', ([title, body]) => [['уведомление Windows', title], ['уведомление Windows', body]]);
  return shown.length;
})()`;

function run(scenario) {
  const { say } = demoApp;
  const lang = (arg('lang') || process.env.WT_DEMO_LANG || 'en').toLowerCase() === 'ru' ? 'ru' : 'en';
  const dumpFile = arg('dump');
  const showClipped = argv.includes('--clipped');
  const demo = demoApp.start({
    headless: true,
    lang,
    theme: arg('theme') || undefined,
    style: arg('style') || undefined,
    profile: scenario === 'empty' ? 'empty' : 'demo',
    onboarding: scenario === 'empty',
    realNotifications: true
  });
  const probe = demo.probe;
  const views = [];
  const problems = [];
  const missingSeen = new Set();

  const CYR = /[А-Яа-яЁё]/;
  const RU_NUMBER = /\d[  ]\d{3}(?!\d)|\d,\d{1,2}(?!\d)/;

  const collect = async (name) => {
    await demo.settle(400);
    const result = await demo.exec(COLLECT);
    result.missing.forEach(m => missingSeen.add(m));
    views.push({ name, ...result });
    return result;
  };

  /** Экран из строк, которые показал main (трей, заставка, всплывашки). */
  const collectStrings = (name, items) => {
    const text = [];
    const found = [];
    for (const { where, value } of items) {
      const shown = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
      if (!shown) continue;
      text.push(shown);
      if (CYR.test(shown)) found.push({ kind: 'main', value: shown, where });
      else if (RU_NUMBER.test(shown)) found.push({ kind: 'число', value: shown, where });
    }
    views.push({ name, text, attrs: [], found, clipped: [], missing: [] });
  };

  /** Текст окна о награде: его собственный DOM и tr.missing() окна. */
  const collectWindow = async (name, win) => {
    const result = await win.webContents.executeJavaScript(COLLECT, true);
    result.missing.forEach(m => missingSeen.add(m));
    views.push({ name, ...result });
  };

  // Экран: подготовка, снимок текста, уборка. Сбой одного не валит остальные
  const view = async (name, prepare, cleanup) => {
    try {
      if (prepare && (await prepare()) === false) {
        problems.push(name + ': не открылось');
      } else {
        await collect(name);
      }
    } catch (error) {
      problems.push(name + ': ' + (error && error.message || error));
    }
    if (cleanup) await Promise.resolve().then(cleanup).catch(() => {});
  };

  const click = (selector) => demo.exec(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const escape = () => demo.exec(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const closeDialogs = async () => {
    await escape();
    await demo.sleep(300);
    await demo.exec(`document.querySelectorAll('.category-detail-modal, .category-picker, #drop-detail-modal, #whats-new-overlay, #confirmation-modal, #login-guard-overlay').forEach(el => el.remove())`);
  };
  const cancelConfirm = async () => {
    await click('#confirm-cancel');
    await demo.sleep(300);
    await closeDialogs();
  };
  const openDetails = () => demo.exec(`document.querySelectorAll('details').forEach(d => { d.open = true; })`);

  // ─── окно о награде ─────────────────────────────────────────────────

  // extra — выражение в окне: подпись «2 из 4» страница фарминга
  // переводит сама, и здесь так же
  const sendDrop = (name, game, extra) => demo.exec(
    `window.electronAPI.showDropNotification(${JSON.stringify(name)}, ${JSON.stringify(game)}, null${extra ? ', ' + extra : ''})`);

  /** Ждёт окно о награде нужного вида с заполненным текстом. */
  const waitDropWindow = async (kind, from) => {
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      for (const entry of probe.dropWindows.slice(from)) {
        const win = entry.window;
        if (win.isDestroyed()) continue;
        try {
          const ready = await win.webContents.executeJavaScript(
            `document.body.classList.contains('kind-${kind}') && !!document.getElementById('drop-name').textContent`, true);
          if (ready) return win;
        } catch (e) { /* окно ещё грузится */ }
      }
      await demo.sleep(200);
    }
    return null;
  };

  const dropWindowView = async (name, kind, trigger) => {
    try {
      const from = probe.dropWindows.length;
      await trigger();
      const win = await waitDropWindow(kind, from);
      if (!win) {
        problems.push(name + ': окно о награде не появилось');
        return;
      }
      await collectWindow(name, win);
      const query = probe.dropWindows.find(e => e.window === win)?.query || {};
      if (query.lang !== lang) problems.push(`${name}: окно открыто с lang=${query.lang}, а не ${lang}`);
      if (!win.isDestroyed()) win.destroy();
    } catch (error) {
      problems.push(name + ': ' + (error && error.message || error));
    }
  };

  // ─── сценарии ───────────────────────────────────────────────────────

  const mainSide = async (suffix) => {
    collectStrings('main › трей' + suffix, [
      ...probe.tray.menu.map(value => ({ where: 'меню трея', value })),
      { where: 'подпись трея', value: probe.tray.tooltip }
    ]);
    if (!probe.tray.menu.length) problems.push('трей: меню не записано');
  };

  const record = () => demo.exec(RECORD).catch(() => 0);
  /** Записанное окном за прогон — отдельным экраном. */
  const collectShown = async () => {
    const shown = await demo.exec('window.__wtShown || []').catch(() => []);
    collectStrings('окно › тосты, журнал, уведомления', shown);
  };

  // Действие и ответ на него (тост, окно, пустое состояние)
  const toggle = (id) => click('#' + id);
  const actions = async () => {
    await record();
    await view('действие › другой стрим', async () => {
      await demo.navigate('farming');
      if (!(await click('#next-stream-btn'))) return false;
      await demo.sleep(3000);
    });
    await view('действие › следующая категория', async () => {
      if (!(await click('#next-category-btn'))) return false;
      await demo.sleep(4000);
    });
    await view('действие › обновить подписки', async () => {
      await demo.navigate('subscriptions');
      await demo.sleep(1000);
      if (!(await click('#refresh-subs-btn'))) return false;
      await demo.sleep(2500);
    });
    await view('действие › очистить неактивные', async () => {
      if (!(await click('#cleanup-subs-btn'))) return false;
      await demo.sleep(1500);
    }, cancelConfirm);
    await view('действие › обновить календарь', async () => {
      await demo.navigate('calendar');
      await demo.sleep(800);
      if (!(await click('#calendar-refresh'))) return false;
      await demo.sleep(2000);
    });
    await view('действие › обновить дропсы', async () => {
      await demo.navigate('drops');
      await demo.sleep(1000);
      if (!(await click('#refreshButton'))) return false;
      await demo.sleep(2500);
    });
    await view('действие › проверить обновления', async () => {
      await demo.navigate('settings');
      await demo.sleep(800);
      if (!(await click('#check-updates-btn'))) return false;
      await demo.sleep(1500);
    });
    // Переключатели — туда и обратно: каждый отвечает тостом
    await view('действие › переключатели настроек', async () => {
      for (const id of ['setting-minimize-tray', 'setting-game-mode', 'setting-low-graphics', 'setting-autostart', 'setting-background-chat']) {
        await toggle(id);
        await demo.sleep(400);
        await toggle(id);
        await demo.sleep(400);
      }
    });
    await view('действие › процессы приложения', async () => {
      if (!(await click('#refresh-processes-btn'))) return false;
      await demo.sleep(1500);
    });
    await view('действие › поиск по настройкам без результата', async () => {
      await demo.exec(`(() => {
        const input = document.getElementById('settings-search');
        input.value = 'qqqzzz';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await demo.sleep(500);
    }, () => demo.exec(`(() => {
      const input = document.getElementById('settings-search');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`));
  };

  const demoScenario = async () => {
    await demo.waitForFarming();
    await record();
    await demo.sleep(1000);

    collectStrings('main › заставка', [
      ...probe.splash.stages.map(value => ({ where: 'этап заставки', value })),
      { where: 'текст заставки', value: probe.splash.text }
    ]);
    if (probe.splash.query.lang !== lang) problems.push(`заставка: lang=${probe.splash.query.lang}, а не ${lang}`);
    if (!probe.splash.stages.length) problems.push('заставка: этапы не записаны');
    await mainSide(' (фарминг идёт)');

    await view('farming');
    await view('farming › category details', async () => {
      await demo.exec(`(() => {
        const page = window.farmingPage;
        const category = page.categories.find(c => c.id === page.currentCategory.id) || page.currentCategory;
        page.showCategoryDetails(category);
      })()`);
      return demo.waitFor('document.querySelector("#category-streams-content") && document.querySelector("#category-streams-content").style.display !== "none"', { timeout: 10000 });
    }, closeDialogs);
    await view('farming › add category', async () => {
      if (!(await click('#add-category-btn'))) return false;
      return demo.waitFor('document.querySelector(".category-picker")', { timeout: 8000 });
    }, closeDialogs);
    await view('journal', async () => {
      if (!(await click('#journal-btn'))) return false;
      return demo.waitFor('document.querySelector("#journal-drawer.open")', { timeout: 5000 });
    }, async () => { await click('#journal-btn'); await demo.sleep(300); });

    // Окна main: о награде, сводка по очереди, проверка из настроек
    await dropWindowView('уведомление › награда', 'drop', () => sendDrop('Driftwood Door', 'Rust', "{ meta: tr('{done} из {total}', { done: 2, total: 4 }) }"));
    await dropWindowView('уведомление › сводка', 'summary', async () => {
      // Первая — сразу, следующие три встают в очередь и показываются сводкой
      await sendDrop('Ember Crate', 'Rust');
      await demo.sleep(600);
      for (const name of ['Signal Flare Banner', 'Lumen Glyph', 'Starfall Sigil']) await sendDrop(name, 'Warframe');
    });
    await dropWindowView('уведомление › проверка', 'test', () => sendDrop('', '', "{ kind: 'test' }"));

    // Отсчёт выключения и его всплывашка Windows
    await view('выключение › отсчёт', async () => {
      await demo.exec(`window.shutdownManager.arm('shutdown', 5, tr('Все дропсы собраны'))`);
      return demo.waitFor('document.querySelector(".shutdown-overlay")', { timeout: 4000 });
    }, () => demo.exec('window.shutdownManager.cancel()'));
    await view('вход › сеанс истёк', async () => {
      await demo.exec(`window.loginGuard.show({ username: 'demoviewer' })`);
      return demo.waitFor('document.getElementById("login-guard-overlay")', { timeout: 4000 });
    }, () => demo.exec('window.loginGuard.close()'));
    await view('обновление › найдено', async () => {
      demo.window().webContents.send('update-available', {
        version: '9.9.9',
        releaseNotes: '## 🇷🇺 Исправления\n\n- Пункт по-русски\n\n## 🇬🇧 Fixes\n\n- An English item'
      });
      return demo.waitFor('document.getElementById("update-notes") && getComputedStyle(document.getElementById("update-notes")).display !== "none"', { timeout: 4000 });
    }, async () => {
      await click('#update-later-btn');
      await demo.sleep(300);
    });

    await view('drops', async () => { await demo.navigate('drops'); await demo.sleep(1500); });
    await view('drops › inventory', () => click('[data-tab="inventory"]'), () => click('[data-tab="progress"]'));
    await view('drops › reward', async () => {
      const opened = await demo.exec(`(() => { const el = document.querySelector('[data-drop]'); if (!el) return false; el.click(); return true; })()`);
      return opened && demo.waitFor('document.getElementById("drop-detail-modal")', { timeout: 5000 });
    }, closeDialogs);

    await view('subscriptions', async () => { await demo.navigate('subscriptions'); await demo.sleep(2000); });
    await view('subscriptions › channel', async () => {
      if (!(await click('.subscription-card .subscription-name, .subscription-card'))) return false;
      return demo.waitFor('document.getElementById("channel-detail-modal") && document.getElementById("channel-detail-modal").style.display !== "none"', { timeout: 5000 });
    }, () => demo.exec('window.subscriptionsPage && window.subscriptionsPage.closeModal()'));
    await view('subscriptions › grid', () => click('[data-view="grid"]'), () => click('[data-view="list"]'));

    await view('calendar', async () => { await demo.navigate('calendar'); await demo.sleep(1200); });
    await view('calendar › ended', () => click('#calendar-show-ended'), () => click('#calendar-show-ended'));

    await view('statistics', async () => { await demo.navigate('statistics'); await demo.sleep(1200); });
    await view('statistics › month', () => click('[data-period="month"]'));
    await view('statistics › custom', () => click('[data-period="custom"]'), () => click('[data-period="all"]'));

    await view('accounts', async () => { await demo.navigate('accounts'); await demo.sleep(800); await openDetails(); });
    await view('accounts › удалить', async () => {
      if (!(await click('.account-btn.delete'))) return false;
      return demo.waitFor('document.getElementById("confirmation-modal")', { timeout: 4000 });
    }, cancelConfirm);
    await view('accounts › подробности', async () => {
      if (!(await click('.account-card'))) return false;
      await demo.sleep(600);
    }, closeDialogs);

    await view('settings', async () => { await demo.navigate('settings'); await demo.sleep(1000); await openDetails(); });
    await view('settings › сброс', async () => {
      if (!(await click('#reset-settings-btn'))) return false;
      return demo.waitFor('document.getElementById("confirmation-modal")', { timeout: 4000 });
    }, cancelConfirm);
    await view('settings › очистить статистику', async () => {
      if (!(await click('#clear-statistics-btn'))) return false;
      return demo.waitFor('document.getElementById("confirmation-modal")', { timeout: 4000 });
    }, cancelConfirm);

    await view('whats new', async () => {
      await demo.exec('window.whatsNew && window.whatsNew.show()');
      return demo.waitFor('document.getElementById("whats-new-overlay")', { timeout: 5000 });
    }, closeDialogs);

    await actions();

    // Фарминг остановлен: страница без стрима и подпись трея
    await view('farming › остановлен', async () => {
      await demo.navigate('farming');
      await demo.exec('window.farmingPage.stopFarming()');
      await demo.waitFor('!(window.sessionState && window.sessionState.isActive())', { timeout: 8000 });
      await demo.sleep(1500);
    });
    await mainSide(' (фарминг остановлен)');
    await view('journal › после остановки', async () => {
      if (!(await click('#journal-btn'))) return false;
      return demo.waitFor('document.querySelector("#journal-drawer.open")', { timeout: 5000 });
    }, async () => { await click('#journal-btn'); await demo.sleep(300); });

    await collectShown();
    // Всплывашки Windows за весь прогон (main их только записал)
    collectStrings('main › уведомления Windows', probe.notifications.flatMap(n => [
      { where: 'заголовок уведомления', value: n.title },
      { where: 'текст уведомления', value: n.body }
    ]));
    collectStrings('main › окна ошибок', probe.dialogs.flatMap(d => [
      { where: 'окно ошибки', value: d.title },
      { where: 'окно ошибки', value: d.content || d.message },
      { where: 'окно ошибки', value: d.detail }
    ]));
  };

  const emptyScenario = async () => {
    await demo.waitFor('window.router && window.router.currentPage', { timeout: 20000 });
    await record();
    await demo.sleep(2500);
    collectStrings('main › заставка', [
      ...probe.splash.stages.map(value => ({ where: 'этап заставки', value })),
      { where: 'текст заставки', value: probe.splash.text }
    ]);
    await mainSide('');
    await view('пусто › первый экран');
    for (const page of ['farming', 'drops', 'subscriptions', 'calendar', 'statistics', 'accounts', 'settings']) {
      await view('пусто › ' + page, async () => {
        await closeDialogs();
        await demo.navigate(page);
        await demo.sleep(page === 'settings' ? 1000 : 1500);
        if (page === 'settings' || page === 'accounts') await openDetails();
      });
    }
    await view('пусто › журнал', async () => {
      if (!(await click('#journal-btn'))) return false;
      return demo.waitFor('document.querySelector("#journal-drawer.open")', { timeout: 5000 });
    }, async () => { await click('#journal-btn'); await demo.sleep(300); });
    await view('пусто › добавить категорию', async () => {
      await demo.navigate('farming');
      if (!(await click('#add-category-btn'))) return false;
      return demo.waitFor('document.querySelector(".category-picker")', { timeout: 8000 });
    }, closeDialogs);
    // «Начать фарминг» без аккаунта и категорий: окно объясняет, чего не хватает
    await view('пусто › начать фарминг', async () => {
      await record();
      if (!(await click('#sidebar-start-farming-btn'))) return false;
      await demo.sleep(1500);
    }, closeDialogs);
    await collectShown();
    collectStrings('main › уведомления Windows', probe.notifications.flatMap(n => [
      { where: 'заголовок уведомления', value: n.title },
      { where: 'текст уведомления', value: n.body }
    ]));
  };

  const main = async () => {
    await demo.ready;
    if (scenario === 'empty') await emptyScenario();
    else await demoScenario();
    report();
  };

  function report() {
    const seen = new Set();
    let total = 0;
    let intended = 0;
    const missing = [...missingSeen];

    if (lang === 'en') {
      for (const v of views) {
        const fresh = v.found.filter(f => {
          if (ALLOWED.has(f.value)) return false;
          const key = f.kind + '|' + f.value + '|' + f.where;
          if (seen.has(key)) return false;
          seen.add(key);
          if (f.noTr) intended += 1;
          return !f.noTr;
        });
        if (!fresh.length) continue;
        total += fresh.length;
        say(`\n== ${v.name} (${fresh.length})`);
        for (const f of fresh) {
          const label = f.kind === 'text' ? '' : `[${f.kind}${f.hidden ? ', скрыт' : ''}] `;
          say(`  ${label}«${f.value.slice(0, 160)}» — ${f.where}`);
        }
      }
      if (missing.length) {
        say(`\n== tr.missing() (${missing.length})`);
        missing.forEach(m => say(`  «${m.slice(0, 160)}»`));
      }
    }

    if (showClipped) {
      const clippedSeen = new Set();
      say('\n== обрезанный текст (не ошибка, для просмотра)');
      for (const v of views) {
        for (const c of v.clipped || []) {
          const key = c.where + '|' + c.value;
          if (clippedSeen.has(key)) continue;
          clippedSeen.add(key);
          say(`  [${v.name}]${c.kind ? ' (' + c.kind + ')' : ''} «${c.value}» — ${c.where}`);
        }
      }
    }

    if (dumpFile) {
      const dump = {
        lang,
        scenario,
        theme: demo.options.theme,
        style: demo.options.style,
        views: Object.fromEntries(views.map(v => [v.name, { text: v.text, attrs: v.attrs, clipped: v.clipped }]))
      };
      const file = path.resolve(process.cwd(), dumpFile);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(dump, null, 1));
      say(`\nТекст ${views.length} экранов записан: ${file}`);
    }

    if (demo.rendererErrors.length) {
      say(`\nОшибки в окне (${demo.rendererErrors.length}):`);
      demo.rendererErrors.slice(0, 15).forEach(e => say('  ' + e));
    }
    problems.forEach(p => say('  не проверено: ' + p));

    const failed = lang === 'en' && (total > 0 || missing.length > 0);
    const summary = lang === 'en'
      ? `${total} находок (кириллица, русский формат чисел), ${missing.length} ключей без перевода на ${views.length} экранах` +
        (intended ? ` (ещё ${intended} — в data-no-tr, намеренно)` : '')
      : `русский режим: ${views.length} экранов, кириллица не проверяется`;
    say(`\nTEST i18n-runtime ${failed || problems.length ? 'FAIL' : 'PASS'} (${lang}, ${scenario}): ${summary}`);
    demo.quit(failed || problems.length ? 1 : 0);
  }

  main().catch(error => {
    say('TEST i18n-runtime FAIL', error && error.stack || error);
    demo.quit(2);
  });
  setTimeout(() => {
    say('TEST i18n-runtime FAIL: timeout');
    demo.quit(2);
  }, 170000).unref();
}
