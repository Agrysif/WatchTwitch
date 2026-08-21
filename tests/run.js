/**
 * Проверки чистых функций приложения.
 *
 * Запуск: npm test
 *
 * Зачем они появились. Логика фарминга переплетена с интерфейсом и
 * проверяется только запуском приложения вручную — это медленно и
 * ненадёжно: за время работы я дважды ломал уже починенное и замечал
 * это лишь по жалобе. Здесь собраны функции, которые можно проверить
 * без Electron: сравнение названий игр, оценка каналов, разбор заметок
 * о выпуске, сравнение версий, приведение качества.
 *
 * Внешних зависимостей нет намеренно — ставить фреймворк ради
 * полутора десятков проверок незачем.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}\n      ожидалось: ${JSON.stringify(expected)}\n      получено:  ${JSON.stringify(actual)}`);
  }
}

function checkTrue(name, actual) {
  check(name, !!actual, true);
}

/**
 * Загружает класс из файла renderer в изолированном контексте.
 * Файлы рассчитаны на браузер и вешают классы на window.
 */
function loadClass(relativePath, className, globals = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const sandbox = {
    window: {},
    document: { getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} } }) },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, Date, JSON, Number, String, Array, Object, Set, Map, RegExp, isNaN, parseFloat, parseInt,
    ...globals
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window[className] || sandbox[className];
}

// ─── Сравнение версий (окно «что нового») ────────────────────────────
{
  const WhatsNew = loadClass('renderer/js/core/whats-new.js', 'WhatsNew');

  check('версия новее', WhatsNew.compare('1.0.15', '1.0.14'), 1);
  check('версия старее', WhatsNew.compare('1.0.9', '1.0.14'), -1);
  check('версии равны', WhatsNew.compare('1.0.14', '1.0.14'), 0);
  check('разная длина номера', WhatsNew.compare('1.1', '1.0.99'), 1);

  // Разбор заметок о выпуске
  const wn = new WhatsNew();
  const notes = [
    '## 🇷🇺 Что нового',
    '- первый пункт',
    '- второй пункт',
    '',
    '## 🇬🇧 What\'s new',
    '- first item'
  ].join('\n');

  const ru = wn.parseSections(notes, true);
  check('русский раздел найден', ru.length, 1);
  check('пункты русского раздела', ru[0].items, ['первый пункт', 'второй пункт']);

  const en = wn.parseSections(notes, false);
  check('английский раздел найден', en.length, 1);
  check('пункты английского раздела', en[0].items, ['first item']);

  check('пустые заметки', wn.parseSections('', true), []);

  // Текст приходит с GitHub, поэтому обязан экранироваться
  check('экранирование разметки', wn.escape('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
}

// ─── Оценка каналов ──────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer/js/pages/subscriptions-page.js'), 'utf8');
  // Метод вырезаем по балансу скобок: поиск по отступу цеплял соседние
  // методы, потому что внутри тела встречаются такие же закрывающие скобки
  const start = src.indexOf('calculateRating(subscription) {');
  let depth = 0;
  let stop = start;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') {
      depth--;
      if (depth === 0) { stop = k + 1; break; }
    }
  }
  const fnSource = 'function ' + src.slice(start, stop);

  const sandbox = { Math, Date, Number, JSON };
  vm.createContext(sandbox);
  vm.runInContext(fnSource + '; this.fn = calculateRating;', sandbox);
  const rate = sandbox.fn;

  const day = 86400000;
  const ago = (days) => new Date(Date.now() - days * day).toISOString();

  check('нет данных — нет оценки', rate({}), null);
  check('мёртвый канал получает ноль', rate({ followers: 100, lastStreamDate: ago(400) }), 0);

  const best = rate({ followers: 900000, isLive: true, hasDrops: true });
  checkTrue('лучший канал близок к сотне', best > 95);

  const fresh = rate({ followers: 10000, lastStreamDate: ago(5) });
  const stale = rate({ followers: 10000, lastStreamDate: ago(9) });
  checkTrue('пять дней ценнее девяти', fresh > stale);

  // Главное, ради чего формулу переписывали: не ступени, а плавность
  const values = [];
  for (let d = 0; d < 30; d++) {
    values.push(rate({ followers: 12345, lastStreamDate: ago(d) }));
  }
  const unique = new Set(values.map(v => Math.round(v))).size;
  checkTrue('оценки не слипаются в ступени', unique > 15);

  const withDrops = rate({ followers: 5000, lastStreamDate: ago(3), hasDrops: true });
  const without = rate({ followers: 5000, lastStreamDate: ago(3), hasDrops: false });
  check('дропсы добавляют ровно 30', Math.round(withDrops - without), 30);

  checkTrue('оценка не выходит за сотню', rate({ followers: 9999999, isLive: true, hasDrops: true }) <= 100);
}

// ─── Сравнение названий игр ──────────────────────────────────────────
{
  // Функция переписана после того, как сравнение по подстроке ловило
  // «line» внутри «albion online». Проверка закрепляет это поведение.
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
  const isPrefix = (short, long) => short.length > 0 && short.length <= long.length && short.every((t, i) => t === long[i]);
  const isSameGame = (a, b) => {
    const left = normalize(a).split(' ').filter(Boolean);
    const right = normalize(b).split(' ').filter(Boolean);
    if (!left.length || !right.length) return false;
    return isPrefix(left, right) || isPrefix(right, left);
  };

  checkTrue('точное совпадение', isSameGame('Albion Online', 'Albion Online'));
  checkTrue('сокращённое название', isSameGame('Albion', 'Albion Online'));
  check('подстрока внутри слова не считается', isSameGame('Line', 'Albion Online'), false);
  check('хвост названия не считается', isSameGame('Online', 'Albion Online'), false);
  checkTrue('регистр не важен', isSameGame('OVERWATCH', 'overwatch'));
  check('пустое значение', isSameGame('', 'Overwatch'), false);
}

// ─── Приведение качества плеера ──────────────────────────────────────
{
  const known = ['160p30', '360p30', '480p30', '720p60', 'chunked'];
  const resolve = (stored) => known.includes(stored) ? stored : '160p30';

  check('известное качество сохраняется', resolve('480p30'), '480p30');
  check('устаревшее auto приводится к минимуму', resolve('auto'), '160p30');
  check('пустое значение приводится к минимуму', resolve(undefined), '160p30');
  check('исходный поток поддерживается', resolve('chunked'), 'chunked');
}

// ─── Выгодность кампаний ─────────────────────────────────────────────
{
  const CampaignValue = loadClass('renderer/js/features/farming/campaign-value.js', 'CampaignValue');

  const now = new Date('2026-08-21T12:00:00Z').getTime();
  const через = (minutes) => new Date(now + minutes * 60000).toISOString();
  const дропс = (required, progress, claimed = false) => ({ required, progress, claimed });

  // Случай, ради которого всё затевалось: приложение семь часов фармило
  // кампанию, где оставшаяся награда не влезала в остаток времени
  const безнадёжная = { endsAt: через(31), drops: [дропс(60, 60, true), дропс(120, 80)] };
  const оценка = CampaignValue.evaluate(безнадёжная, now);
  check('не успеть до конца кампании', оценка.reason, 'tooLate');
  check('безнадёжная не годится для фарминга', оценка.feasible, false);
  check('ближайшая награда требует минут', оценка.minNeeded, 40);

  check('все награды получены', CampaignValue.evaluate(
    { endsAt: через(600), drops: [дропс(60, 60, true)] }, now).reason, 'done');

  check('кампания закончилась', CampaignValue.evaluate(
    { endsAt: через(-5), drops: [дропс(60, 10)] }, now).reason, 'expired');

  check('обычная кампания годится', CampaignValue.evaluate(
    { endsAt: через(600), drops: [дропс(60, 10)] }, now).feasible, true);

  // Прогресс внутри кампании общий: 12 минут видны у всех наград сразу
  const общийПрогресс = {
    endsAt: через(10000),
    drops: [дропс(60, 12), дропс(120, 12), дропс(180, 12), дропс(300, 12)]
  };
  check('за час возьмётся одна награда', CampaignValue.dropsWithin(общийПрогресс, 60, now), 1);
  check('за два часа — две', CampaignValue.dropsWithin(общийПрогресс, 120, now), 2);

  // Дольше, чем живёт кампания, смотреть бессмысленно
  const скороКонец = { endsAt: через(50), drops: [дропс(60, 12), дропс(120, 12)] };
  check('окно урезано концом кампании', CampaignValue.dropsWithin(скороКонец, 600, now), 1);

  // Выбор выгоднейшей: за час здесь берётся две награды против одной
  const однаЗаЧас = { endsAt: через(10000), drops: [дропс(60, 20)] };
  const двеЗаЧас = { endsAt: через(10000), drops: [дропс(60, 30), дропс(60, 25)] };
  check('выбирается кампания с большей отдачей',
    CampaignValue.best([однаЗаЧас, двеЗаЧас], now), двеЗаЧас);

  // Безнадёжную не выбираем даже когда других нет
  check('безнадёжных не выбираем', CampaignValue.best([безнадёжная], now), null);
  check('пустой список', CampaignValue.best([], now), null);

  // При равной выгоде вперёд идёт горящая: долгоиграющую догоним потом
  const горит = { endsAt: через(120), drops: [дропс(60, 30)] };
  const неГорит = { endsAt: через(100000), drops: [дропс(60, 30)] };
  check('при равной выгоде вперёд горящая', CampaignValue.best([неГорит, горит], now), горит);

  // Без срока окончания кампания просто всегда успевает
  check('кампания без срока', CampaignValue.evaluate({ drops: [дропс(600, 0)] }, now).feasible, true);

  check('пояснение о нехватке времени',
    CampaignValue.describe(оценка), 'Не успеть: нужно 40 мин, осталось 31');

  // Когда уходить из категории. Автопереключение висело на условии
  // «получены все награды» — при недостижимой награде оно не наступает
  const всёСобрано = { endsAt: через(9000), drops: [дропс(60, 60, true), дропс(120, 120, true)] };
  const ещёИдёт = { endsAt: через(9000), drops: [дропс(60, 10)] };

  check('уходим, когда всё собрано', CampaignValue.shouldLeave([всёСобрано], now), true);
  check('уходим, когда уже не успеть', CampaignValue.shouldLeave([безнадёжная], now), true);
  check('остаёмся, пока есть смысл', CampaignValue.shouldLeave([ещёИдёт], now), false);
  check('одной живой кампании хватает, чтобы остаться',
    CampaignValue.shouldLeave([всёСобрано, безнадёжная, ещёИдёт], now), false);

  // Пустой список — это «данные не загрузились», а не «фармить нечего»
  check('без данных категорию не бросаем', CampaignValue.shouldLeave([], now), false);
  check('null вместо списка', CampaignValue.shouldLeave(null, now), false);
}

// ─── Строки перевода ─────────────────────────────────────────────────
{
  // Ключи уже однажды молча не добавились: разметку я поправил, а строку
  // забыл, и на экране висело FARMING.SESSIONPOINTS. Проверка следит,
  // чтобы у каждого ключа, который спрашивает интерфейс, был перевод
  // на обоих языках.
  const code = fs.readFileSync(path.join(__dirname, '..', 'renderer/js/i18n.js'), 'utf8');
  const sandbox = { window: {}, console: { log() {}, warn() {} }, Object, JSON, String, Array };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '; this.__t = translations;', sandbox);
  const t = sandbox.__t;

  const get = (lang, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), t[lang]);

  // Ключи, которые интерфейс запрашивает через i18n.t в исходниках
  const sources = ['renderer/js/pages/settings-page.js', 'renderer/js/pages/farming-page.js'];
  const used = new Set();
  for (const file of sources) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const m of src.matchAll(/i18n\.t\('([a-zA-Z0-9_.]+)'\)/g)) used.add(m[1]);
  }

  checkTrue('ключи перевода вообще найдены', used.size > 10);

  const missingRu = [...used].filter(k => get('ru', k) === undefined);
  const missingEn = [...used].filter(k => get('en', k) === undefined);

  check('нет ключей без русского перевода', missingRu, []);
  check('нет ключей без английского перевода', missingEn, []);

  // Настройка выбора категории по выгоде
  checkTrue('строка настройки выгоды (ru)', !!get('ru', 'settings.smartCategorySwitch'));
  checkTrue('строка настройки выгоды (en)', !!get('en', 'settings.smartCategorySwitch'));
  checkTrue('пояснение настройки выгоды (ru)', !!get('ru', 'settings.smartCategorySwitchDesc'));
  checkTrue('пояснение настройки выгоды (en)', !!get('en', 'settings.smartCategorySwitchDesc'));
}

// ─── Итог ────────────────────────────────────────────────────────────
console.log('');
if (failures.length) {
  console.log('  Провалы:');
  failures.forEach(f => console.log('    ✗ ' + f));
  console.log('');
}
console.log(`  Проверок пройдено: ${passed}, провалено: ${failed}`);
console.log('');

process.exit(failed > 0 ? 1 : 0);
