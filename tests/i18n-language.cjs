'use strict';
// Выбор языка: первый запуск и смена языка с перезапуском — на настоящем
// приложении в демо-режиме (tools/demo/demo-app.cjs), во временных профилях.
//
//   node tests/i18n-language.cjs
//
// Первый запуск (пустой профиль): Windows на английском — английский,
// на русском — русский. Установка до 1.2.0 (данные есть, языка нет) — русский
// при любом языке Windows.
// Смена языка: русский → в настройках «English» → предложение перезапуска на
// английском → «Перезапустить» → main вызывает app.relaunch (здесь только
// записывается) и выходит → следующий запуск с тем же профилем — английский
// в окне, трее и заставке, фарминг продолжается. И обратно, на русский.
//
// Каждый этап — отдельный Electron; итог этапа он пишет в профиль
// (phase-<имя>.json), проверяет его этот (внешний) процесс.

const fs = require('fs');
const path = require('path');
const demoApp = require('../tools/demo/demo-app.cjs');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const PHASES = {
  'first-en': { profile: 'keep', locale: 'en-US' },
  'first-ru': { profile: 'keep', locale: 'ru-RU' },
  'legacy-en': { profile: 'legacy', locale: 'en-US', lang: 'ru' },
  'switch-1': { profile: 'demo', locale: 'en-US', lang: 'ru', switchTo: 'en' },
  'switch-2': { profile: 'keep', locale: 'en-US' },
  'switch-3': { profile: 'keep', locale: 'en-US', switchTo: 'ru' },
  'switch-4': { profile: 'keep', locale: 'en-US' }
};

if (arg('phase')) {
  if (demoApp.needsElectron()) throw new Error('Этап запускается под Electron');
  runPhase(arg('phase'));
} else if (demoApp.needsElectron()) {
  runAll();
} else {
  demoApp.say('TEST i18n-language: запускать из обычного node — этапам нужны отдельные процессы Electron');
  process.exit(2);
}

// ─── внешний процесс ────────────────────────────────────────────────

async function runAll() {
  const { say } = demoApp;
  const failures = [];
  const expect = (label, actual, wanted) => {
    const ok = JSON.stringify(actual) === JSON.stringify(wanted);
    say(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' (ожидалось ' + JSON.stringify(wanted) + ')'}`);
    if (!ok) failures.push(label);
  };
  const MENU = { en: ['Show/Hide', 'Open settings', 'Quit'], ru: ['Показать/Скрыть', 'Открыть настройки', 'Выход'] };
  const NAV = { en: 'Farming', ru: 'Фарминг' };

  const phase = async (name, profile) => {
    const code = await demoApp.spawnElectron(__filename, ['--phase', name], { profile, timeoutMs: 75000 });
    let result = null;
    try { result = JSON.parse(fs.readFileSync(path.join(profile, 'phase-' + name + '.json'), 'utf8')); } catch (e) { /* нет итога */ }
    say(`\n== ${name}: код выхода ${code}`);
    if (!result) {
      failures.push(name + ': нет итога');
      say('  FAIL этап не записал итог');
      return null;
    }
    (result.problems || []).forEach(p => { failures.push(name + ': ' + p); say('  FAIL ' + p); });
    return { code, ...result };
  };
  const storeLanguage = (profile) => {
    try { return JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8')).settings?.language ?? null; } catch (e) { return 'нет config.json'; }
  };
  /** Окно, трей и заставка — на одном языке. */
  const sameLanguage = (r, lang) => {
    if (!r) return;
    expect('окно: WT_LANG', r.window.lang, lang);
    expect('окно: <html lang>', r.window.htmlLang, lang);
    expect('окно: язык сохранён', r.window.stored, lang);
    expect('окно: пункт меню', r.window.nav, NAV[lang]);
    expect('окно: i18n.currentLang', r.window.i18n, lang);
    expect('трей: меню', r.tray.menu, MENU[lang]);
    expect('заставка: lang', r.splashLang, lang);
  };

  const profiles = [];
  const fresh = () => { const dir = demoApp.makeProfile(); profiles.push(dir); return dir; };
  try {
    // Первый запуск
    let p = fresh();
    sameLanguage(await phase('first-en', p), 'en');
    expect('main: язык записан в настройки', storeLanguage(p), 'en');
    p = fresh();
    sameLanguage(await phase('first-ru', p), 'ru');
    p = fresh();
    sameLanguage(await phase('legacy-en', p), 'ru');

    // Смена языка: русский → английский → русский
    p = fresh();
    let r = await phase('switch-1', p);
    sameLanguage(r && { ...r, window: r.before }, 'ru');
    if (r) {
      expect('предложение перезапуска — на английском', r.dialog?.title, 'Restart WatchTwitch to switch the language');
      expect('кнопка перезапуска', r.dialog?.confirm, 'Restart now');
      expect('подпись под языком', r.note, 'English will turn on after a restart');
      expect('app.relaunch вызван', r.relaunch.length, 1);
      expect('приложение вышло само', r.quitBy, 'app');
      expect('язык следующего запуска в окне', r.pending, 'en');
      expect('до перезапуска окно на прежнем языке', r.afterChoice?.window, 'ru');
      expect('до перезапуска трей на прежнем языке', r.afterChoice?.tray, MENU.ru);
    }
    expect('main: язык следующего запуска в настройках', storeLanguage(p), 'en');
    r = await phase('switch-2', p);
    sameLanguage(r, 'en');
    if (r) {
      expect('в настройках выбран English', r.selected, 'en');
      expect('фарминг продолжился после перезапуска', r.farming, true);
    }
    r = await phase('switch-3', p);
    if (r) {
      expect('предложение перезапуска — на русском', r.dialog?.title, 'Перезапустите WatchTwitch, чтобы сменить язык');
      expect('кнопка перезапуска', r.dialog?.confirm, 'Перезапустить');
      expect('подпись под языком', r.note, 'Русский включится после перезапуска');
      expect('до перезапуска окно на прежнем языке', r.afterChoice?.window, 'en');
      expect('до перезапуска трей на прежнем языке', r.afterChoice?.tray, MENU.en);
      expect('app.relaunch вызван', r.relaunch.length, 1);
      expect('приложение вышло само', r.quitBy, 'app');
    }
    expect('main: язык следующего запуска в настройках', storeLanguage(p), 'ru');
    r = await phase('switch-4', p);
    sameLanguage(r, 'ru');
    if (r) expect('в настройках выбран Русский', r.selected, 'ru');
  } finally {
    profiles.forEach(dir => demoApp.removeProfile(dir));
  }

  say(`\nTEST i18n-language ${failures.length ? 'FAIL' : 'PASS'}: ${failures.length ? failures.length + ' расхождений' : 'первый запуск и смена языка в обе стороны'}`);
  process.exit(failures.length ? 1 : 0);
}

// ─── этап (под Electron) ────────────────────────────────────────────

function runPhase(name) {
  const cfg = PHASES[name];
  if (!cfg) throw new Error('Нет этапа ' + name);
  const demo = demoApp.start({
    headless: true,
    profile: cfg.profile,
    lang: cfg.lang || 'en',
    locale: cfg.locale,
    realRelaunch: true
  });
  const { app } = demo;
  const result = { phase: name, problems: [], relaunch: demo.probe.relaunch, quitBy: null };
  const file = path.join(demo.userData, 'phase-' + name + '.json');
  const write = () => {
    try { fs.writeFileSync(file, JSON.stringify(result, null, 1)); } catch (e) { /* профиль недоступен */ }
  };
  // Выход по просьбе окна (перезапуск) идёт через app.quit самого main
  app.on('quit', () => {
    if (!result.quitBy) result.quitBy = 'app';
    write();
  });

  const windowState = () => demo.exec(`({
    lang: window.WT_LANG,
    htmlLang: document.documentElement.lang,
    stored: (() => { try { return localStorage.getItem('appLanguage'); } catch (e) { return null; } })(),
    nav: (document.querySelector('.nav-item[data-page="farming"]') || {}).textContent ? document.querySelector('.nav-item[data-page="farming"]').textContent.trim() : null,
    i18n: window.i18n && window.i18n.currentLang
  })`);

  const main = async () => {
    await demo.ready;
    if (!(await demo.waitFor('window.router && window.router.currentPage && window.i18n', { timeout: 20000 }))) {
      result.problems.push('окно не загрузилось');
    }
    await demo.sleep(1500);
    result.window = await windowState();
    result.tray = { menu: demo.probe.tray.menu, tooltip: demo.probe.tray.tooltip };
    result.splashLang = demo.probe.splash.query.lang || null;

    if (cfg.profile === 'keep' && !cfg.switchTo && name.startsWith('switch')) {
      // После перезапуска: восстановленная сессия фарминга
      result.farming = await demo.waitFor('window.sessionState && window.sessionState.isActive()', { timeout: 20000 });
    }

    await demo.navigate('settings');
    await demo.sleep(800);
    result.selected = await demo.exec(`(document.getElementById('language-select') || {}).dataset ? document.getElementById('language-select').dataset.value : null`);

    if (!cfg.switchTo) {
      result.quitBy = 'test';
      write();
      demo.quit(0);
      return;
    }

    result.before = result.window;
    const clicked = await demo.exec(`(() => {
      const b = document.querySelector('#language-select button[data-value="${cfg.switchTo}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!clicked) result.problems.push('нет кнопки языка ' + cfg.switchTo);
    if (!(await demo.waitFor('document.getElementById("confirmation-modal")', { timeout: 5000 }))) {
      result.problems.push('предложение перезапуска не появилось');
    }
    result.dialog = await demo.exec(`(() => {
      const m = document.getElementById('confirmation-modal');
      if (!m) return null;
      const text = (sel) => (m.querySelector(sel) || {}).textContent ? m.querySelector(sel).textContent.trim() : null;
      return { title: text('.dialog-title'), body: text('.dialog-body'), confirm: text('#confirm-ok'), cancel: text('#confirm-cancel') };
    })()`);
    result.note = await demo.exec(`(document.getElementById('language-note') || {}).textContent || ''`);
    // До перезапуска язык не меняется нигде: ни в окне, ни в трее
    await demo.sleep(1000);
    result.afterChoice = { window: (await windowState()).lang, tray: demo.probe.tray.menu };
    result.pending = await demo.exec('window.i18n && window.i18n.pendingLang');
    write();
    await demo.exec(`document.getElementById('confirm-ok') && document.getElementById('confirm-ok').click()`);
    // Дальше main сам вызывает app.relaunch и выходит. Не вышел — сбой
    setTimeout(() => {
      result.problems.push('приложение не вышло после «Перезапустить»');
      result.quitBy = 'timeout';
      write();
      demo.quit(3);
    }, 30000).unref();
  };

  main().catch(error => {
    result.problems.push('сбой: ' + (error && error.stack || error));
    result.quitBy = 'error';
    write();
    demo.quit(2);
  });
}
