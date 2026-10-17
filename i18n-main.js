// Перевод строк главного процесса: трей, уведомления Windows, заставка,
// окна ошибок, страницы входа в браузере и тексты, которые main отдаёт окну.
//
// Устроено так же, как tr() в окне (renderer/js/core/tr.js): строка пишется
// в коде по-русски, а в английском режиме берётся из словаря ниже, где ключ —
// русский исходник. Подстановки — {имя}:
//
//   trMain('Twitch не ответил: {reason}', { reason })
//
// Словарь ищется по шаблону до подстановки, поэтому порядок слов в переводе
// свободный. Склеивать переведённые куски нельзя.
//
// Язык — settings.language в electron-store: его пишет окно через
// settings-merge. Выбирается один раз за запуск, как и в окне: смена языка
// в настройках применяется после перезапуска. Исключение — если окно при
// загрузке оказалось на другом языке (см. noteRendererLanguage).
'use strict';

const has = Object.prototype.hasOwnProperty;

// Те же языки, что и в окне (tr.js): с Windows на них — русский интерфейс
const RU_FAMILY = /^(ru|uk|be|kk)\b/i;

const EN = {
  // Сеть
  'таймаут: сервер молчит {sec} с': 'timeout: no response from the server for {sec} s',
  'обрыв ответа: соединение закрыто посреди передачи': 'response cut off: the connection closed mid-transfer',
  'таймаут': 'timeout',
  'Twitch не ответил: {reason}': 'Twitch didn\'t respond: {reason}',
  'ответ не разобран': 'unreadable response',
  'ошибка GraphQL': 'GraphQL error',

  // Файл настроек
  'Не удалось открыть файл настроек:\n{path}\n\n{error}': 'Couldn\'t open the settings file:\n{path}\n\n{error}',
  'Файл настроек был повреждён. Восстановлена копия с прошлого запуска.': 'The settings file was damaged. Restored the copy from the last launch.',
  'Файл настроек был повреждён, настройки сброшены.': 'The settings file was damaged, so settings were reset.',
  'Файл настроек был повреждён, настройки сброшены. Испорченный файл сохранён в папке приложения.': 'The settings file was damaged, so settings were reset. The damaged file is saved in the app folder.',
  'лог не ведётся': 'logging is off',

  // «Что нового»: заметки о выпусках с GitHub
  'Код ответа {code}': 'Response code {code}',
  'Не удалось разобрать ответ': 'Couldn\'t read the response',
  'Превышено время ожидания': 'Timed out',

  // Заставка
  'Загружаю интерфейс…': 'Loading the interface…',
  'Восстанавливаю сессию…': 'Restoring the session…',
  'Готово': 'Ready',

  // Трей
  'WatchTwitch свёрнут в трей': 'WatchTwitch is in the tray',
  'Приложение работает в фоне. Нажмите на значок в трее, чтобы открыть окно.': 'The app keeps running in the background. Click the tray icon to open the window.',
  'Показать/Скрыть': 'Show/Hide',
  'Открыть настройки': 'Open settings',
  'Выход': 'Quit',
  'WatchTwitch — фарминг остановлен': 'WatchTwitch — farming stopped',
  'дропсы {percent}%': 'Drops {percent}%',
  'следующая через {time}': 'next reward in {time}',

  // Вход через браузер: страницы локального сервера
  'Ссылка входа устарела. Вернитесь в WatchTwitch и нажмите «Войти через Twitch» ещё раз.': 'This sign-in link has expired. Go back to WatchTwitch and click “Sign in with Twitch” again.',
  'Вход отменён в браузере': 'Sign-in was canceled in the browser',
  'Twitch отклонил вход': 'Twitch rejected the sign-in',
  'Ошибка авторизации': 'Sign-in failed',
  'Авторизация успешна': 'Signed in',
  'Авторизация успешна!': 'You\'re signed in',
  'Добро пожаловать в WatchTwitch': 'Welcome to WatchTwitch',
  'Можете закрыть эту вкладку': 'You can close this tab',

  // Стрим
  '{h}ч {m}м': '{h}h {m}m',

  // Окно о награде
  'награда': 'reward',
  'наград': 'rewards',
  'Получена {n} {word}': '{n} {word} claimed',
  'Получено {n} {word}': '{n} {word} claimed',
  '{list} и ещё {n}': '{list} and {n} more',
  'Пока вы играли': 'While you were playing',

  // Получение наград
  'Не указана награда': 'No reward specified',
  'Требуется вход в Twitch. Откройте стрим в приложении.': 'Twitch sign-in required. Open a stream in the app.',
  'Twitch не принял запрос — попробуйте позже': 'Twitch didn\'t accept the request — try again later',
  'Twitch отклонил авторизацию. Откройте стрим в приложении и повторите.': 'Twitch rejected the sign-in. Open a stream in the app and try again.',
  'Нет связи с Twitch — попробуйте позже': 'Can\'t reach Twitch — try again later',
  'Twitch не выдал награду — попробуйте позже': 'Twitch didn\'t grant the reward — try again later',
  'Twitch не подтвердил награду — возможно, её уже забрали или кампания закончилась. Обновите список.': 'Twitch didn\'t confirm the reward. It may be claimed already, or the campaign has ended. Refresh the list.',
  'Twitch не принял вход — войдите в Twitch заново': 'Twitch didn\'t accept the sign-in — sign in to Twitch again',
  'Twitch не ответил, попробуйте позже': 'Twitch didn\'t respond, try again later',
  'Нет доступных наград для получения': 'No rewards to claim',
  'Twitch не выдал ни одной награды — заберите их вручную': 'Twitch didn\'t grant any rewards — claim them manually',
  'Получено наград: {claimed}/{total}': 'Rewards claimed: {claimed}/{total}',

  // Отписка от канала
  'Не указан канал': 'No channel given',
  'Канал не найден или Twitch не ответил': 'Channel not found or Twitch didn\'t respond',
  'Не удалось найти кнопку подписки на странице канала': 'Couldn\'t find the follow button on the channel page',
  'Twitch не подтвердил отписку. Похоже, изменилась страница канала.': 'Twitch didn\'t confirm the unfollow. The channel page may have changed.',

  // Общий с окном rate-limit.js: в main его tr() — это trMain, а пояснение
  // уходит окну причиной отказа («Twitch не ответил: …»)
  'Twitch просит подождать ещё {sec} с': 'Twitch asks to wait another {sec} s',
  'ограничений нет': 'no limits'
};

let store = null;
let electronApp = null;
// Были ли в хранилище данные приложения к запуску: снимок до первых записей
let hadData = false;
let lang = null;

/** Подключить хранилище и приложение. До этого язык — по Windows. */
function setup(options = {}) {
  store = options.store || null;
  electronApp = options.app || null;
  try {
    hadData = !!store && Object.keys(store.store || {}).length > 0;
  } catch (e) {
    hadData = false;
  }
}

function savedLanguage() {
  try {
    const value = store ? store.get('settings.language') : null;
    return value === 'ru' || value === 'en' ? value : null;
  } catch (e) {
    return null;
  }
}

function isReady() {
  try {
    return !!electronApp && electronApp.isReady();
  } catch (e) {
    return false;
  }
}

function systemLocale() {
  // getLocale на Windows отвечает только после готовности приложения
  if (isReady()) {
    try {
      const locale = electronApp.getLocale();
      if (locale) return locale;
    } catch (e) { /* ниже — запасные способы */ }
  }
  try {
    const list = electronApp && typeof electronApp.getPreferredSystemLanguages === 'function'
      ? electronApp.getPreferredSystemLanguages()
      : null;
    if (list && list[0]) return list[0];
  } catch (e) { /* ниже — язык из ICU */ }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch (e) {
    return '';
  }
}

/**
 * Язык этого запуска: 'ru' | 'en'.
 *
 * Пока окно его не записало — русский для установки, которой уже
 * пользовались: до 1.2.0 интерфейс был только русским, и менять язык без
 * спроса нельзя. Новая установка — по языку Windows.
 */
function language() {
  if (lang) return lang;
  const guess = savedLanguage() ||
    (hadData || RU_FAMILY.test(systemLocale()) ? 'ru' : 'en');
  // До готовности приложения язык Windows ещё не известен наверняка, а без
  // хранилища (оно не открылось) нечего и запоминать: ответ только на сейчас
  if (store && isReady()) lang = guess;
  return guess;
}

/**
 * Язык, на котором окно на самом деле работает (window.WT_LANG), — main
 * спрашивает его после каждой загрузки окна. Main мог решить иначе: окно
 * смотрит на свой localStorage, main — на config.json, и они расходятся,
 * если один из них стёрт. Тогда до перезапуска трей говорил бы на другом
 * языке. settings.language из settings-merge для этого не годится: первым
 * его шлёт settings-manager со значением по умолчанию 'ru', а после выбора
 * в настройках там язык следующего запуска.
 * true — язык сменился, трей нужно перерисовать.
 */
function noteRendererLanguage(value) {
  if (value !== 'ru' && value !== 'en') return false;
  const before = language();
  lang = value;
  return before !== value;
}

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (has.call(params, key) ? String(params[key]) : match));
}

function trMain(ru, params) {
  if (typeof ru !== 'string') return ru;
  const text = language() === 'en' && has.call(EN, ru) ? EN[ru] : ru;
  return fill(text, params);
}

/**
 * Форма слова по числу — как tr.plural в окне. В английском единственное
 * число только у 1, переводы форм — из словаря (первая и третья форма).
 */
trMain.plural = function plural(n, one, few, many) {
  const value = Number(n) || 0;
  if (language() === 'en') return trMain(Math.abs(value) === 1 ? one : many);
  if (!Number.isInteger(value)) return few;
  const tens = Math.abs(value) % 100;
  const units = tens % 10;
  if (tens > 10 && tens < 20) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
};

trMain.lang = language;
trMain.locale = () => (language() === 'en' ? 'en-US' : 'ru-RU');

module.exports = { trMain, setup, noteRendererLanguage, EN };
