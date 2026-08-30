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

// ─── Потолок скорости загрузки стрима ────────────────────────────────
{
  // Видео качается кусками: каждый отрезок на мгновение забивает канал,
  // очередь в роутере распухает, и пинг в игре подскакивает. Лечится
  // сглаживанием, а не уменьшением объёма.
  const NL = loadClass('renderer/js/core/network-limit.js', 'NetworkLimit');

  check('минимальное качество', NL.forQuality('160p30'), 690);
  check('480p', NL.forQuality('480p30'), 3600);
  check('исходное', NL.forQuality('chunked'), 18000);

  // Слишком тесный предел не даст плееру набрать буфер — он встанет,
  // и подбор качества полезет вверх, сделав только хуже
  check('ниже пола не опускаемся', NL.forQuality('160p30', 0.5), 500);
  check('запас можно поднять', NL.forQuality('160p30', 5), 1150);
  check('негодный запас берёт значение по умолчанию',
    NL.forQuality('160p30', 0), NL.forQuality('160p30'));

  // Неизвестное качество ограничиваем слабо: лучше не сгладить,
  // чем задушить поток
  check('неизвестное качество', NL.forQuality('9000p'), NL.forQuality('chunked'));

  check('перевод в байты в секунду', NL.toBytesPerSecond(800), 100000);
  check('ноль', NL.toBytesPerSecond(0), 0);

  const c = NL.conditions('160p30');
  check('скачивание ограничено', c.downloadThroughput, NL.toBytesPerSecond(690));
  check('отдачу не трогаем', c.uploadThroughput, -1);
  check('задержку не добавляем', c.latency, 0);
  check('не уводим в офлайн', c.offline, false);

  check('снятие ограничения', NL.UNLIMITED.downloadThroughput, -1);
}

// ─── Разовое лечение настройки качества ──────────────────────────────
{
  // Прежняя версия записывала вынужденный подъём лестницы в постоянную
  // настройку, и у многих там осело «Источник»: приложение качало по
  // шесть мегабит вместо двухсот килобит, а выбора такого не было.
  const лечить = (settings) => {
    if (settings.qualityRepaired) return settings;
    const испорчено = settings.preferredStreamQuality === 'chunked' ||
      settings.preferredStreamQuality === '720p60';
    settings.qualityRepaired = true;
    if (испорчено) settings.preferredStreamQuality = '160p30';
    return settings;
  };

  check('исходное сбрасывается',
    лечить({ preferredStreamQuality: 'chunked' }).preferredStreamQuality, '160p30');
  check('720p тоже сбрасывается',
    лечить({ preferredStreamQuality: '720p60' }).preferredStreamQuality, '160p30');

  // Осознанный выбор среднего качества не трогаем
  check('480p оставляем',
    лечить({ preferredStreamQuality: '480p30' }).preferredStreamQuality, '480p30');
  check('минимальное оставляем',
    лечить({ preferredStreamQuality: '160p30' }).preferredStreamQuality, '160p30');

  // Лечим ровно один раз: дальше настройка снова принадлежит пользователю
  const после = лечить({ preferredStreamQuality: 'chunked' });
  после.preferredStreamQuality = 'chunked';
  check('повторно не вмешиваемся',
    лечить(после).preferredStreamQuality, 'chunked');
  checkTrue('отметка о лечении ставится', после.qualityRepaired);
}

// ─── Выбор качества плеера ───────────────────────────────────────────
{
  // Три уровня, от временного к постоянному. Раньше все три писались в
  // одно поле настроек, и один неудачный старт навсегда превращал выбор
  // пользователя в «Источник»: лестница поднималась и сохраняла верхнюю
  // ступень, а автопереключение категорий грузит стримы помногу раз.
  const known = ['160p30', '360p30', '480p30', '720p60', 'chunked'];
  const resolve = (fallback, session, stored) => {
    for (const v of [fallback, session, stored]) {
      if (v && known.includes(v)) return v;
    }
    return '160p30';
  };

  check('без временных берём настройку', resolve(null, null, '480p30'), '480p30');
  check('выбор на сессию важнее настройки', resolve(null, '360p30', '480p30'), '360p30');
  check('вынужденный подъём важнее всего', resolve('720p60', '360p30', '480p30'), '720p60');
  check('устаревшее auto приводится к минимуму', resolve(null, null, 'auto'), '160p30');
  check('пустое значение приводится к минимуму', resolve(null, null, undefined), '160p30');
  check('исходный поток поддерживается', resolve(null, null, 'chunked'), 'chunked');
  check('негодное временное не мешает настройке', resolve('чушь', null, '480p30'), '480p30');
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

  // ── Прогноз окончания и план к выключению ──
  // Эти проверки однажды пропали вместе с неаккуратной вырезкой блока, и
  // отсутствие minutesToFinish никто не заметил до отказа в приложении.
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

  // ── Шкала: одно число во всех местах ──
  // Раньше сайдбар считал по времени, панель под стримом — среднее по
  // наградам, а список категорий по-своему. Под одним названием
  // «дропсы» показывались разные проценты: 63 против 29.
  const шкала = CampaignValue.timeline(кампанияСкрина);

  check('заполнение по времени просмотра', Math.round(шкала.percent), 4);
  check('делений столько же, сколько наград', шкала.marks.length, 4);
  check('положения делений', шкала.marks.map(m => Math.round(m.percent)), [20, 40, 60, 100]);
  check('последняя награда в конце шкалы', шкала.marks[3].percent, 100);
  check('деления отсортированы по возрастанию',
    шкала.marks.map(m => m.percent).slice().sort((a, b) => a - b), шкала.marks.map(m => m.percent));

  // Общий процент берётся по кампании с ближайшей наградой
  check('единый процент', CampaignValue.progressPercent([кампанияСкрина], now), 4);
  check('без кампаний', CampaignValue.progressPercent([], now), 0);

  // Забранная награда не должна занижать время просмотра
  const частично = { endsAt: через(9000), drops: [
    { required: 60, progress: 60, claimed: true },
    { required: 300, progress: 150 }
  ]};
  check('время берётся наибольшее из наград',
    Math.round(CampaignValue.timeline(частично).percent), 50);

  check('шкала без наград', CampaignValue.timeline({ drops: [] }), { percent: 0, marks: [] });
  check('шкала без кампании', CampaignValue.timeline(null), { percent: 0, marks: [] });
}

// ─── Календарь кампаний ──────────────────────────────────────────────
{
  const CC = loadClass('renderer/js/features/calendar/campaign-calendar.js', 'CampaignCalendar');

  // Полдень, чтобы «завтра» не зависело от часа
  const сейчас = new Date('2026-08-22T12:00:00').getTime();
  const через = (ч) => new Date(сейчас + ч * 3600000).toISOString();

  // Дни календарные, а не сутки по 24 часа: до полуночи 12 часов,
  // поэтому «через 13 часов» — это уже завтра, а не сегодня
  check('сегодня', CC.daysUntil(через(6), сейчас), 0);
  check('завтра, хотя прошло меньше суток', CC.daysUntil(через(13), сейчас), 1);
  check('вчера', CC.daysUntil(через(-20), сейчас), -1);

  const кампания = (endsAt, startsAt) => ({ endsAt, startsAt });

  check('кончается сегодня', CC.bucketFor(кампания(через(5)), сейчас), 'today');
  check('кончается завтра', CC.bucketFor(кампания(через(20)), сейчас), 'tomorrow');
  check('на этой неделе', CC.bucketFor(кампания(через(96)), сейчас), 'week');
  check('ещё не скоро', CC.bucketFor(кампания(через(24 * 11)), сейчас), 'later');
  check('уже закончилась', CC.bucketFor(кампания(через(-1)), сейчас), 'ended');
  check('ещё не началась',
    CC.bucketFor(кампания(через(200), через(48)), сейчас), 'upcoming');

  // Раскладка: закончившиеся выбрасываются, внутри группы ближайшее вверху
  const список = [
    кампания(через(-5)),
    кампания(через(8)),
    кампания(через(2)),
    кампания(через(24 * 11)),
    кампания(через(200), через(48))
  ];
  const группы = CC.group(список, сейчас);
  check('закончившиеся выброшены',
    Object.values(группы).reduce((n, g) => n + g.length, 0), 4);
  check('ближайшее вверху группы',
    группы.today.map(c => c.endsAt), [через(2), через(8)]);
  check('не начавшаяся в своей группе', группы.upcoming.length, 1);

  // Настройка «показывать завершённые»: по умолчанию их нет
  check('завершённых не видно по умолчанию', группы.ended.length, 0);

  const сЗавершёнными = CC.group(список, сейчас, { includeEnded: true });
  check('с настройкой завершённые появляются', сЗавершёнными.ended.length, 1);
  check('и стоят последней группой',
    CC.ORDER[CC.ORDER.length - 1], 'ended');
  check('остальные группы не изменились',
    сЗавершёнными.today.length, группы.today.length);
  check('пустой список', CC.group([], сейчас).today, []);

  // ── Лента времени ──
  const полдень = new Date('2026-08-22T12:00:00').getTime();
  const лента = CC.timelineBars([
    кампания(через(24 * 3)),                    // кончается через 3 дня
    кампания(через(24 * 30)),                   // уходит за горизонт окна
    кампания(через(24 * 5), через(24 * 2)),     // начнётся через 2 дня
    кампания(через(-3)),                        // уже кончилась
    кампания(через(24 * 40), через(24 * 20))    // целиком за горизонтом
  ], { now: полдень, days: 14 });

  check('делений на день больше на одно', лента.ticks.length, 15);
  check('«сейчас» в середине первых суток', Math.round(лента.nowAt * 100) / 100, 3.57);
  check('закончившиеся и запредельные не рисуются', лента.bars.length, 3);
  // 18% — это полдень третьих суток окна: 2.5 дня из 14
  check('полосы по сроку окончания',
    лента.bars.map(b => Math.round(b.left)), [0, 18, 0]);

  // Полоса, уходящая за правый край, помечается — иначе обрезка
  // читалась бы как настоящий срок окончания
  const заГоризонт = лента.bars.find(b => b.clippedEnd);
  checkTrue('уходящая за горизонт помечена', !!заГоризонт);
  check('и обрезана ровно по краю', Math.round(заГоризонт.left + заГоризонт.width), 100);

  const ещёНеНачалась = лента.bars.find(b => b.upcoming);
  checkTrue('будущая кампания помечена', !!ещёНеНачалась);
  checkTrue('и начинается правее «сейчас»', ещёНеНачалась.left > лента.nowAt);

  check('пустой список', CC.timelineBars([], { now: полдень }).bars, []);

  // Подписи остатка
  check('дни и часы', CC.formatLeft(11 * 1440 + 5 * 60), '11 д 5 ч');
  check('ровно дни', CC.formatLeft(3 * 1440), '3 д');
  check('часы и минуты', CC.formatLeft(260), '4ч 20м');
  check('только минуты', CC.formatLeft(17), '17 мин');
  check('завершена', CC.formatLeft(0), 'завершена');
}

// ─── Сроки кампаний для обычного календаря ───────────────────────────
{
  const ICS = loadClass('renderer/js/core/ics-export.js', 'IcsExport');

  const сейчас = new Date('2026-08-22T10:00:00Z').getTime();

  check('дата в формате календаря',
    ICS.stamp('2026-08-23T23:59:59Z'), '20260823T235959Z');
  check('негодная дата', ICS.stamp('никогда'), null);

  // Формат придирчив: незаэкранированная запятая рвёт поле надвое.
  // Символы задаём явно: иначе экранирование пришлось бы читать
  // сквозь три слоя и легко ошибиться в самом тесте.
  const КОСАЯ = String.fromCharCode(92);
  const СТРОКА = String.fromCharCode(10);

  check('запятая', ICS.escapeText('Игра, часть'), 'Игра' + КОСАЯ + ', часть');
  check('точка с запятой', ICS.escapeText('раз; два'), 'раз' + КОСАЯ + '; два');
  check('перевод строки',
    ICS.escapeText('раз' + СТРОКА + 'два'), 'раз' + КОСАЯ + 'n' + 'два');
  // Обратная косая заменяется первой, иначе испортит остальные замены
  check('обратная косая',
    ICS.escapeText('путь' + КОСАЯ + 'сюда'), 'путь' + КОСАЯ + КОСАЯ + 'сюда');

  // Складывание длинных строк
  const длинная = 'X'.repeat(200);
  const сложенная = ICS.fold(длинная);
  checkTrue('длинная строка сложена', сложенная.includes('\r\n '));
  checkTrue('каждый кусок укладывается в предел',
    сложенная.split('\r\n').every(l => l.length <= 75));
  check('короткая не трогается', ICS.fold('коротко'), 'коротко');

  const кампания = (id, endsAt, drops) => ({
    id, game: { displayName: 'Игра ' + id }, endsAt, drops: drops || [{ claimed: false }]
  });

  const файл = ICS.build([
    кампания('a', '2026-08-25T20:00:00Z'),
    кампания('b', '2026-08-21T20:00:00Z')   // уже прошла
  ], сейчас);

  check('прошедшие в календарь не попадают', файл.events, 1);
  checkTrue('файл открывается и закрывается',
    файл.text.startsWith('BEGIN:VCALENDAR') && файл.text.trimEnd().endsWith('END:VCALENDAR'));
  checkTrue('переводы строк только CRLF', !/[^\r]\n/.test(файл.text));
  checkTrue('есть напоминание', файл.text.includes('BEGIN:VALARM'));
  checkTrue('напоминание за час', файл.text.includes('TRIGGER:-PT60M'));
  checkTrue('в описании видно, сколько не забрано', файл.text.includes('Не забрано наград'));

  const пустой = ICS.build([], сейчас);
  check('без кампаний событий нет', пустой.events, 0);
  checkTrue('но файл остаётся правильным', пустой.text.includes('END:VCALENDAR'));
}

// ─── Упущенные награды ───────────────────────────────────────────────
{
  const MD = loadClass('renderer/js/features/calendar/missed-drops.js', 'MissedDrops');

  const сейчас = new Date('2026-08-22T12:00:00Z').getTime();
  const день = 86400000;
  const прошлое = new Date(сейчас - день).toISOString();
  const будущее = new Date(сейчас + день).toISOString();

  const кампания = (game, endsAt, drops) => ({ game: { displayName: game }, endsAt, drops });

  const история = [
    кампания('Овервотч', прошлое, [
      { name: 'Ящик', required: 60, progress: 45 },              // не хватило 15 мин
      { name: 'Спрей', required: 120, progress: 120, claimed: true },
      { name: 'Скин', required: 600, progress: 60 }              // не хватило 9 часов
    ]),
    кампания('Фортнайт', прошлое, [
      { name: 'Кирка', required: 90, progress: 80 }              // не хватило 10 мин
    ]),
    // Идущая кампания в потери не идёт: время ещё есть
    кампания('Гэньшин', будущее, [{ name: 'Смола', required: 60, progress: 5 }])
  ];

  const итог = MD.analyze(история, сейчас);

  check('упущено всего', итог.total, 3);
  check('из них почти собрано', итог.close, 2);
  check('ближайшая первой', итог.closest[0].name, 'Кирка');
  check('порядок по недобору', итог.closest.map(m => m.shortBy), [10, 15, 540]);
  check('суммарный недобор в минутах', итог.shortMinutes, 565);
  check('по играм', итог.byGame.map(g => g.game + ':' + g.count), ['Овервотч:2', 'Фортнайт:1']);

  // Забранная награда потерей не считается
  check('забранная не в потерях',
    MD.isMissed({ required: 60, progress: 60, claimed: true }), false);
  // К награде, к которой не приступали, претензий нет
  check('нетронутая не считается упущенной',
    MD.isMissed({ required: 60, progress: 0 }), false);
  checkTrue('начатая и недобранная считается',
    MD.isMissed({ required: 60, progress: 1 }));

  check('пустая история', MD.analyze([], сейчас).total, 0);
  check('без истории', MD.analyze(null, сейчас).total, 0);

  check('вывод с почти собранными', MD.describe(итог),
    'Упущено 3 награды, из них 2 почти собрано');
  check('вывод без потерь', MD.describe({ total: 0 }), 'Ничего не упущено');
  check('вывод об одной', MD.describe({ total: 1, close: 0 }), 'Упущено 1 награда');
}

// ─── Тихие часы ──────────────────────────────────────────────────────
{
  const QH = loadClass('renderer/js/core/quiet-hours.js', 'QuietHours');

  check('разбор времени', QH.toMinutes('23:00'), 1380);
  check('полночь', QH.toMinutes('00:00'), 0);
  check('мусор вместо времени', QH.toMinutes('abc'), null);
  check('часов больше суток', QH.toMinutes('25:00'), null);
  check('минут больше шестидесяти', QH.toMinutes('10:75'), null);
  check('пусто', QH.toMinutes(''), null);

  const в = (ч, м) => new Date(2026, 7, 22, ч, м);

  // Обычный промежуток внутри суток
  checkTrue('внутри дневного промежутка', QH.isQuiet(в(14, 0), '13:00', '15:00'));
  check('снаружи дневного промежутка', QH.isQuiet(в(16, 0), '13:00', '15:00'), false);

  // Главный случай: промежуток переходит через полночь, и обычное
  // сравнение «больше начала и меньше конца» здесь не работает вовсе
  checkTrue('поздний вечер', QH.isQuiet(в(23, 30), '23:00', '09:00'));
  checkTrue('глубокая ночь', QH.isQuiet(в(3, 0), '23:00', '09:00'));
  checkTrue('раннее утро', QH.isQuiet(в(8, 59), '23:00', '09:00'));
  check('ровно к началу тишины', QH.isQuiet(в(23, 0), '23:00', '09:00'), true);
  check('ровно к концу тишины', QH.isQuiet(в(9, 0), '23:00', '09:00'), false);
  check('день', QH.isQuiet(в(15, 0), '23:00', '09:00'), false);

  // Совпадающие границы — это «молчать всегда», а не «никогда»
  checkTrue('круглые сутки', QH.isQuiet(в(12, 0), '10:00', '10:00'));

  check('неразбираемые границы не включают тишину',
    QH.isQuiet(в(3, 0), 'нет', '09:00'), false);

  check('описание через полночь',
    QH.describe('23:00', '09:00'), 'Молчит с 23:00 до 09:00 (через полночь)');
  check('описание внутри суток',
    QH.describe('13:00', '15:00'), 'Молчит с 13:00 до 15:00');
  check('описание круглых суток',
    QH.describe('10:00', '10:00'), 'Приложение будет молчать круглые сутки');
}

// ─── Память о кампаниях ──────────────────────────────────────────────
{
  // Замер показал, что Twitch выбрасывает закончившиеся кампании из
  // ответа: их там ровно ноль. Поэтому настройка «показывать
  // завершённые» опирается на память самого приложения.
  const CH = loadClass('renderer/js/features/calendar/campaign-history.js', 'CampaignHistory');

  const сейчас = new Date('2026-08-22T12:00:00Z').getTime();
  const день = 86400000;
  const кампания = (id, черезДней, drops) => ({
    id, game: { displayName: 'Игра ' + id, boxArtURL: '' },
    endsAt: new Date(сейчас + черезДней * день).toISOString(),
    drops: drops || [{ required: 60, progress: 60, claimed: true }]
  });

  const свежие = CH.merge([], [кампания('a', 2), кампания('b', -1)], сейчас);
  check('запомнены обе', свежие.length, 2);
  check('позже кончающаяся впереди', свежие.map(c => c.id), ['a', 'b']);

  check('завершённой считается только прошедшая',
    CH.ended(свежие, сейчас).map(c => c.id), ['b']);

  // Свежая запись вытесняет старую: прогресс мог измениться
  const обновлённые = CH.merge(свежие, [кампания('a', 2, [{ required: 60, progress: 60, claimed: true }])], сейчас);
  check('дубликатов не появляется', обновлённые.length, 2);

  // Слишком давнее забываем, иначе список растёт без конца
  const древняя = CH.merge([кампания('старая', -40)], [], сейчас);
  check('кампании старше месяца забываются', древняя.length, 0);

  // Лишнее сверх предела отбрасывается
  const много = [];
  for (let i = 0; i < CH.LIMIT + 25; i++) много.push(кампания('к' + i, -1));
  check('список ограничен', CH.merge([], много, сейчас).length, CH.LIMIT);

  // Урезание оставляет то, что нужно для показа
  const урезанная = CH.trim({ id: 'x', game: { displayName: 'Игра' },
    endsAt: 'дата', drops: [{ name: 'Награда', required: 60, progress: 12 }] });
  check('название игры сохранено', урезанная.game.displayName, 'Игра');
  check('награды сохранены', урезанная.drops.length, 1);
  check('прогресс сохранён', урезанная.drops[0].progress, 12);

  check('без записей', CH.ended([], сейчас), []);
  check('без входных данных', CH.merge(null, null, сейчас), []);
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

// ─── Падежи по числу ─────────────────────────────────────────────────
{
  // Русский требует трёх форм, а подставлялась всегда третья: на экране
  // висело «1 недель назад».
  const plural = (n, одна, две, много) => {
    const десятки = Math.abs(n) % 100;
    const единицы = десятки % 10;
    if (десятки > 10 && десятки < 20) return много;
    if (единицы === 1) return одна;
    if (единицы >= 2 && единицы <= 4) return две;
    return много;
  };
  const н = (x) => plural(x, 'неделю', 'недели', 'недель');

  check('одна', н(1), 'неделю');
  check('две', н(2), 'недели');
  check('четыре', н(4), 'недели');
  check('пять', н(5), 'недель');
  // Второй десяток — исключение: одиннадцать, а не «одиннадцать неделю»
  check('одиннадцать', н(11), 'недель');
  check('двенадцать', н(12), 'недель');
  check('четырнадцать', н(14), 'недель');
  check('двадцать один', н(21), 'неделю');
  check('двадцать два', н(22), 'недели');
  check('сто одиннадцать', н(111), 'недель');
  check('ноль', н(0), 'недель');
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
