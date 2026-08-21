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

  // Звёздочки вокруг важных пунктов раньше никто не разбирал, и они
  // так и висели в окне обычным текстом
  check('жирный текст', wn.formatInline('**Важно.** Дальше обычный'),
    '<strong>Важно.</strong> Дальше обычный');
  check('два жирных куска', wn.formatInline('**раз** и **два**'),
    '<strong>раз</strong> и <strong>два</strong>');
  check('одиночная звёздочка не ломает', wn.formatInline('5 * 3 = 15'), '5 * 3 = 15');
  check('код в обратных кавычках', wn.formatInline('вызов `foo()`'), 'вызов <code>foo()</code>');

  // Разметка размечается ПОСЛЕ экранирования, иначе это дыра
  check('разметка из описания не выполняется',
    wn.formatInline('**<img src=x onerror=alert(1)>**'),
    '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
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

// ─── Выбор стрима и сравнение названий игр ───────────────────────────
{
  // Раньше здесь лежала копия функции, переписанная в самом тесте, — то
  // есть проверялась не та реализация, что работает в приложении.
  // Теперь логика вынесена в модуль и проверяется настоящая.
  const SP = loadClass('renderer/js/features/farming/stream-picker.js', 'StreamPicker');

  checkTrue('точное совпадение', SP.isSameGame('Albion Online', 'Albion Online'));
  checkTrue('сокращённое название', SP.isSameGame('Albion', 'Albion Online'));
  check('подстрока внутри слова не считается', SP.isSameGame('Line', 'Albion Online'), false);
  check('хвост названия не считается', SP.isSameGame('Online', 'Albion Online'), false);
  checkTrue('регистр не важен', SP.isSameGame('OVERWATCH', 'overwatch'));
  check('пустое значение', SP.isSameGame('', 'Overwatch'), false);
  checkTrue('приставка «Игра:» отбрасывается', SP.isSameGame('Игра: Overwatch', 'Overwatch'));
  checkTrue('апостроф не мешает', SP.isSameGame("Baldur's Gate 3", 'Baldurs Gate 3'));

  // Исключение канала для кнопки «Другой стрим»
  const выдача = [{ login: 'aspen' }, { login: 'Bob' }, { login: 'carol' }];
  check('исключённый канал убран',
    SP.poolWithout(выдача, 'Bob').map(s => s.login), ['aspen', 'carol']);
  check('регистр и собачка не мешают',
    SP.poolWithout(выдача, '@BOB').map(s => s.login), ['aspen', 'carol']);
  // Показать тот же канал лучше, чем не показать никакой
  check('единственный канал не отсеивается',
    SP.poolWithout([{ login: 'aspen' }], 'aspen').map(s => s.login), ['aspen']);
  check('без исключения список цел', SP.poolWithout(выдача, null).length, 3);
  check('пустая выдача', SP.poolWithout([], 'aspen'), []);

  // Порядок проверки подписок: избранные вперёд, дальше по приоритету
  const подписки = [
    { login: 'dave', priority: 1 },
    { login: 'erin', isFavorite: true, priority: 5 },
    { login: 'frank', isFavorite: true, priority: 2 },
    { login: 'grace' }
  ];
  check('избранные вперёд, затем приоритет',
    SP.orderSubscriptions(подписки).map(s => s.login), ['frank', 'erin', 'dave', 'grace']);
  check('исключённый не попадает в очередь',
    SP.orderSubscriptions(подписки, 'frank').map(s => s.login), ['erin', 'dave', 'grace']);
  check('без подписок', SP.orderSubscriptions(null), []);

  // Подписка, случайно попавшая в общую выдачу
  check('подписка найдена в выдаче',
    SP.findInList(выдача, [{ login: 'CAROL' }]).login, 'carol');
  check('подписки в выдаче нет', SP.findInList(выдача, [{ login: 'zoe' }]), null);
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

  // ── Ближайшая награда и шкала для сайдбара ──
  const кампанияСкрина = {
    endsAt: через(9000),
    drops: [
      { required: 60, progress: 12, name: 'Награда 60' },
      { required: 120, progress: 12, name: 'Награда 120' },
      { required: 180, progress: 12, name: 'Награда 180' },
      { required: 300, progress: 12, name: 'Награда 300' }
    ]
  };

  const ближайшая = CampaignValue.nextDrop([кампанияСкрина], now);
  check('ближайшая награда', ближайшая.drop.name, 'Награда 60');
  check('минут до ближайшей', ближайшая.minutesNeeded, 48);

  // Ближайшая — по нехватке времени, а не по порядку в списке
  const вразнобой = { endsAt: через(9000), drops: [
    { required: 300, progress: 290, name: 'Почти готова' },
    { required: 60, progress: 0, name: 'Только начата' }
  ]};
  check('ближайшая не первая по списку',
    CampaignValue.nextDrop([вразнобой], now).drop.name, 'Почти готова');

  // Забранные награды не предлагаются
  const частичноЗабрано = { endsAt: через(9000), drops: [
    { required: 60, progress: 60, claimed: true, name: 'Забрана' },
    { required: 120, progress: 60, name: 'Следующая' }
  ]};
  check('забранная не считается ближайшей',
    CampaignValue.nextDrop([частичноЗабрано], now).drop.name, 'Следующая');

  check('в законченной кампании ближайшей нет',
    CampaignValue.nextDrop([{ endsAt: через(-10), drops: [дропс(60, 0)] }], now), null);

  // Шкала: деления встают там, где награду выдадут
  const шкала = CampaignValue.timeline(кампанияСкрина);
  check('заполнение по времени просмотра', Math.round(шкала.percent), 4);
  check('делений столько же, сколько наград', шкала.marks.length, 4);
  check('положения делений', шкала.marks.map(m => Math.round(m.percent)), [20, 40, 60, 100]);
  check('последняя награда в конце шкалы', шкала.marks[3].percent, 100);
  check('деления отсортированы по возрастанию',
    шкала.marks.map(m => m.percent).slice().sort((a, b) => a - b), шкала.marks.map(m => m.percent));

  // ── Прогноз окончания и план к выключению ──
  check('время до всех наград', CampaignValue.minutesToFinish([кампанияСкрина], now), 288);
  check('брать нечего', CampaignValue.minutesToFinish([всёСобрано], now), null);

  // Недостижимая награда не должна попадать в прогноз: иначе он обещает
  // то, чего не будет
  const частичноДостижима = { endsAt: через(100), drops: [дропс(60, 20), дропс(600, 20)] };
  check('недостижимая не удлиняет прогноз',
    CampaignValue.minutesToFinish([частичноДостижима], now), 40);
  check('всё недостижимо', CampaignValue.minutesToFinish([безнадёжная], now), null);

  // План к выключению: сколько успеется за отведённое время
  check('за час до выключения', CampaignValue.dropsBefore([общийПрогресс], 60, now), 1);
  check('за пять часов', CampaignValue.dropsBefore([общийПрогресс], 300, now), 4);
  check('по двум кампаниям сразу',
    CampaignValue.dropsBefore([общийПрогресс, однаЗаЧас], 60, now), 2);
  check('времени нет совсем', CampaignValue.dropsBefore([общийПрогресс], 0, now), 0);
  check('всего достижимо', CampaignValue.reachableCount([частичноДостижима], now), 1);

  check('шкала без наград', CampaignValue.timeline({ drops: [] }), { percent: 0, marks: [] });
  check('шкала без кампании', CampaignValue.timeline(null), { percent: 0, marks: [] });
}

// ─── Слежение за избранными каналами ─────────────────────────────────
{
  const FW = loadClass('renderer/js/core/favourites-watch.js', 'FavouritesWatch');

  // Правило «сообщаем один раз за эфир»: повторное уведомление каждые
  // пять минут мешало бы сильнее, чем помогало
  const первыйПроход = FW.pickNewlyLive([{ login: 'aspen' }, { login: 'Bob' }], new Set());
  check('в первый раз сообщаем обо всех',
    первыйПроход.fresh.map(c => c.login), ['aspen', 'Bob']);

  const второйПроход = FW.pickNewlyLive([{ login: 'aspen' }, { login: 'Bob' }], первыйПроход.live);
  check('повторно не сообщаем', второйПроход.fresh, []);

  // Регистр логина не должен приводить к повторному уведомлению
  const другойРегистр = FW.pickNewlyLive([{ login: 'BOB' }], первыйПроход.live);
  check('регистр логина не считается новым каналом', другойРегистр.fresh, []);

  // Новый канал среди уже известных
  const третий = FW.pickNewlyLive(
    [{ login: 'aspen' }, { login: 'carol' }], первыйПроход.live);
  check('сообщаем только о новом', третий.fresh.map(c => c.login), ['carol']);

  // Ушёл из эфира и вернулся — это новый эфир, сообщить нужно
  const ушёл = FW.pickNewlyLive([], третий.live);
  const вернулся = FW.pickNewlyLive([{ login: 'carol' }], ушёл.live);
  check('после перерыва сообщаем снова', вернулся.fresh.map(c => c.login), ['carol']);

  check('никого нет в эфире', FW.pickNewlyLive([], new Set()).fresh, []);
}

// ─── Оценка сэкономленного трафика ───────────────────────────────────
{
  const TE = loadClass('renderer/js/core/traffic-estimate.js', 'TrafficEstimate');

  const мин = 60;
  const базаЗаЧас = TE.wouldCost(мин);            // 720p60 за час
  check('расход базового качества за час', Math.round(базаЗаЧас / 1024 / 1024), 1502);

  // Час в минимальном качестве против часа в 720p60
  const минимум = TE.wouldCost(мин, '160p30');
  const сэкономлено = TE.saved(минимум, мин);
  check('экономия за час', Math.round(сэкономлено / 1024 / 1024), 1403);
  checkTrue('во сколько раз экономнее', Math.round(TE.ratio(минимум, мин)) === 15);

  // Показывать «сэкономлено 0» или минус незачем
  check('расход выше базового — экономии нет', TE.saved(базаЗаЧас * 2, мин), null);
  check('ровно по базовому — экономии нет', TE.saved(базаЗаЧас, мин), null);

  check('неизвестное качество', TE.wouldCost(мин, '9000p'), null);
  check('нулевое время', TE.wouldCost(0), null);
  check('без времени экономии нет', TE.saved(1000, 0), null);
  check('без расхода отношение не считается', TE.ratio(0, мин), null);
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
