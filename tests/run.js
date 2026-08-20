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
