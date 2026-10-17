// Diagnostic audit: executes production methods with controlled network/timer responses.
// FAIL means the expected behavior is currently broken; no Twitch account is used.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
let failures = 0;
// Аудит проходит дважды: по-русски и по-английски. В английском tr() берёт
// строки из словарей, а логика — переключения, вердикты зачёта, причины —
// должна остаться той же: коды причин и сравнения на перевод не опираются
let LANG = 'ru';
const results = { ru: new Map(), en: new Map() };
// facts — то, что сравнивается между языками; по умолчанию detail. Свой
// facts нужен там, где в detail попадает переведённый текст
function check(name, ok, detail, facts = detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${LANG === 'en' ? '[en] ' : ''}${name}: ${detail}`);
  if (!ok) failures++;
  if (results[LANG]) results[LANG].set(name, { ok, facts: JSON.stringify(facts) });
}
const CYRILLIC = /[А-Яа-яЁё]/;
// Словари — те же и в том же порядке, что подключает index.html
const EN_DICTIONARIES = [...fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8')
  .matchAll(/<script src="(js\/locales\/en\/[\w-]+\.js)"><\/script>/g)].map(m => m[1]);
const englishSandboxes = [];
function environment() {
  const timers = new Map();
  let id = 0;
  const elements = new Map();
  const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    document: { addEventListener() {}, getElementById(key) { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); } },
    setInterval(fn) { timers.set(++id, fn); return id; },
    clearInterval(key) { timers.delete(key); },
    setTimeout() { return ++id; }, clearTimeout() {},
    Storage: {},
    // Язык tr.js берёт отсюда; в обоих прогонах заглушка одна и та же
    localStorage: { length: 1, getItem: key => (key === 'appLanguage' ? LANG : null), setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'renderer/js/core/tr.js'), 'utf8'), sandbox);
  if (LANG === 'en') {
    for (const file of EN_DICTIONARIES) vm.runInContext(fs.readFileSync(path.join(root, 'renderer', file), 'utf8'), sandbox);
    englishSandboxes.push(sandbox);
  }
  for (const file of ['features/farming/stream-picker.js', 'features/farming/campaign-value.js', 'features/farming/drop-credit.js', 'pages/farming-page.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'renderer/js', file), 'utf8'), sandbox);
  }
  const page = Object.create(sandbox.window.FarmingPage.prototype);
  sandbox.window.utils = { showToast() {} };
  return { sandbox, page, timers, elements };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function scenarios() {
  if (LANG === 'en') {
    const { sandbox: s } = environment();
    const shown = s.window.DropCredit.describe({ state: 'none' });
    check('English dictionaries are active in the sandbox', s.window.WT_LANG === 'en' && EN_DICTIONARIES.length > 0 && !CYRILLIC.test(shown),
      `WT_LANG=${s.window.WT_LANG}, dictionaries=${EN_DICTIONARIES.length}, none → ${shown}`);
  }
  {
    const { sandbox: s, page: p } = environment();
    s.window.electronAPI = { getStreamsWithDrops: async () => [{ login: 'next', displayName: 'Next' }] };
    p.currentCategory = { name: 'Game' };
    p.currentStream = { login: 'current' };
    p.pickPreferredStream = async streams => streams[0];
    p.switchToStream = async stream => { p.currentStream = stream; };
    await p.switchToNextStream();
    check('Normal stream switching still works', p.currentStream.login === 'next', p.currentStream.login);
    const snapshot = p.streamSnapshot();
    await p.switchToNextStream();
    check('No alternative stream does not disable monitoring', p.isCurrentStream(snapshot), 'same stream retained');
  }
  {
    const { sandbox: s, page: p } = environment();
    const requests = [];
    s.window.electronAPI = { getStreamsWithDrops: () => new Promise(resolve => requests.push(resolve)) };
    p.currentCategory = { name: 'Game' };
    p.currentStream = { login: 'current' };
    p.pickPreferredStream = async streams => streams[0];
    const switched = [];
    p.switchToStream = async stream => { switched.push(stream.login); p.currentStream = stream; };
    const first = p.switchToNextStream();
    const second = p.switchToNextStream();
    requests[1]([{ login: 'newest' }]);
    await second;
    requests[0]([{ login: 'obsolete' }]);
    await first;
    check('Only the newest stream search commits', JSON.stringify(switched) === '["newest"]', JSON.stringify(switched));
  }
  {
    const { sandbox: s, page: p } = environment();
    s.Storage.getItem = async () => true;
    s.Storage.getSubscriptions = async () => [{ login: 'favorite', isFavorite: true }];
    s.window.electronAPI = { getStreamStats: async () => ({ gameName: 'Game', viewers: 50 }) };
    p.allowedChannelsFor = async () => ['allowed'];
    const chosen = await p.pickPreferredStream([{ login: 'allowed' }], 'Game');
    check('Campaign channel restriction survives subscription priority', chosen.login === 'allowed', `selected=${chosen.login}, allowed=allowed`);
  }
  {
    // Before the first stream Twitch returns only in-progress campaigns
    // (dashboardComplete false): a restriction from that partial list must
    // not block the whole game, but a live allowed channel is still preferred.
    const { sandbox: s, page: p } = environment();
    s.Storage.getItem = async () => false;
    const inventory = { dashboardComplete: false, campaigns: [{ game: { name: 'Overwatch' }, drops: [], allowedChannels: ['off_a', 'off_b'] }] };
    s.window.electronAPI = { fetchDropsInventory: async () => inventory, getStreamStats: async () => null };
    const toasts = [];
    s.window.utils = { showToast: message => toasts.push(message) };
    const soft = await p.pickPreferredStream([{ login: 'live_one' }], 'Overwatch');
    check('Incomplete campaign list does not block a game with offline allowed channels', soft?.login === 'live_one' && toasts.length === 0, `selected=${soft?.login}, toasts=${toasts.length}`);
    s.window.electronAPI.getStreamStats = async login => (login === 'off_b' ? { gameName: 'Overwatch', viewers: 5 } : null);
    const preferred = await p.pickPreferredStream([{ login: 'live_one' }], 'Overwatch');
    check('Incomplete campaign list still prefers a live allowed channel', preferred?.login === 'off_b', `selected=${preferred?.login}`);
    inventory.dashboardComplete = true;
    s.window.electronAPI.getStreamStats = async () => null;
    const strict = await p.pickPreferredStream([{ login: 'live_one' }], 'Overwatch');
    check('Complete campaign list keeps the channel restriction', strict === null && toasts.length === 1, `selected=${strict?.login}, toasts=${toasts.length}`);
  }
  {
    const { sandbox: s, page: p } = environment();
    let finishRequest;
    s.window.electronAPI = { getStreamsWithDrops: () => new Promise(r => { finishRequest = r; }) };
    p.currentCategory = { name: 'Old game' };
    p.currentStream = { login: 'old' };
    p.pickPreferredStream = async streams => streams[0];
    let switched;
    p.switchToStream = async stream => { switched = { login: stream.login, category: p.currentCategory.name }; };
    const pending = p.switchToNextStream();
    p.currentCategory = { name: 'New game' };
    p.currentStream = { login: 'new' };
    finishRequest([{ login: 'old-game-channel' }]);
    await pending;
    check('Old stream search cannot overwrite a newer category', !switched, JSON.stringify(switched));
  }
  {
    const { sandbox: s, page: p, timers } = environment();
    s.window.settings = { get: () => false };
    s.window.electronAPI = {
      getStreamStats: async () => ({ gameName: 'Other game', viewers: 1 }),
      getStreamsWithDrops: async () => [{ login: 'unfiltered-channel' }]
    };
    p.currentCategory = { name: 'Wanted game' };
    p.currentStream = { login: 'current' };
    p.viewersHistory = [];
    p.startDropsProgressUpdate = () => {};
    let switched = 0;
    p.switchToStream = async () => { switched++; };
    p.startStreamStatsUpdate('current');
    await flush();
    await timers.get(p.streamStatsInterval)();
    check('Disabled autoSwitchStreams prevents game-change switching', switched === 0, `switches=${switched}`);
  }
  {
    const { sandbox: s, page: p, elements } = environment();
    let finishOld;
    s.window.electronAPI = { getStreamStats: login => login === 'old'
      ? new Promise(r => { finishOld = r; })
      : Promise.resolve({ viewers: 20, gameName: 'New game' }) };
    p.currentCategory = { name: 'Old game' };
    p.currentStream = { login: 'old' };
    p.viewersHistory = [];
    p.startDropsProgressUpdate = () => {};
    p.startStreamStatsUpdate('old');
    p.currentCategory = { name: 'New game' };
    p.currentStream = { login: 'new' };
    p.startStreamStatsUpdate('new');
    await flush();
    finishOld({ viewers: 999, gameName: 'Old game' });
    await flush();
    check('Late old-channel stats are ignored', elements.get('stream-viewers').textContent === '20',
      `new channel viewers=${elements.get('stream-viewers').textContent}, mismatch strikes=${p._gameMismatchCount}`);
  }
  {
    const { page: p } = environment();
    check('Different games do not match', !p._gameMatchesCategory('World of Warcraft', 'Warcraft'),
      `World of Warcraft / Warcraft = ${p._gameMatchesCategory('World of Warcraft', 'Warcraft')}`);
  }
  {
    const { sandbox: s, page: p, timers } = environment();
    p.streamStatsInterval = s.setInterval(() => {});
    p.dropsProgressInterval = s.setInterval(() => {});
    p.dropCreditInterval = s.setInterval(() => {});
    let aborted = false;
    p._listenerAbort = { abort() { aborted = true; } };
    vm.runInContext(fs.readFileSync(path.join(root, 'renderer/js/router.js'), 'utf8') + '\nwindow.TestRouter = Router;', s);
    const router = Object.create(s.window.TestRouter.prototype);
    router.currentPage = 'farming';
    s.window.farmingPage = p;
    router.destroyCurrentPage('settings');
    check('Background farming retains its automation after navigation', timers.size === 3 && !aborted,
      `remaining automation timers=${timers.size}, player-dead listener aborted=${aborted}`);
  }
  {
    // Twitch's session query keeps failing and inventory minutes stand still:
    // the credit check must still reach "no credit" instead of waiting all night.
    const { sandbox: s, page: p, timers } = environment();
    const inventory = { dashboardComplete: true, campaigns: [{ game: { name: 'Game' }, drops: [{ id: 'd', required: 60, progress: 10 }] }] };
    s.window.electronAPI = { getDropSession: async () => ({ ok: false, error: 'service unavailable' }), fetchDropsInventory: async () => inventory };
    p.currentCategory = { id: 'g', name: 'Game' };
    p.currentStream = { login: 'chan' };
    p._lastMatchedCount = 1;
    const verdicts = [];
    p.renderDropCredit = v => verdicts.push(v.state);
    let noCredit = 0;
    p.onNoCredit = async () => { noCredit++; };
    p.startDropCreditCheck('chan');
    p._creditStartedAt = p._creditLastGrowthAt = Date.now() - 12 * 60 * 1000;
    const tick = timers.get(p.dropCreditInterval);
    await tick(); await tick();
    check('Silent session query with standing minutes still ends in no-credit', noCredit === 1, `verdicts=${verdicts.join(',')}, onNoCredit=${noCredit}`);
    inventory.campaigns[0].drops[0].progress = 11;
    await tick();
    check('Growing minutes keep credit ok without session answers', verdicts[verdicts.length - 1] === 'ok', `last=${verdicts[verdicts.length - 1]}`);
  }
  {
    // A failed inventory answer (empty list) between normal ones must not look
    // like growth: occasional failures kept "no credit" from ever maturing.
    const { sandbox: s, page: p, timers } = environment();
    let calls = 0;
    const good = { dashboardComplete: true, campaigns: [{ game: { name: 'Game' }, drops: [{ id: 'd', required: 60, progress: 10 }] }] };
    s.window.electronAPI = {
      getDropSession: async () => ({ ok: false, error: 'service unavailable' }),
      fetchDropsInventory: async () => (++calls % 2 === 0 ? { campaigns: [], error: true, dashboardComplete: false } : good)
    };
    p.currentCategory = { id: 'g', name: 'Game' };
    p.currentStream = { login: 'chan' };
    p._lastMatchedCount = 1;
    const verdicts = [];
    p.renderDropCredit = v => verdicts.push(v.state);
    let noCredit = 0;
    p.onNoCredit = async () => { noCredit++; };
    p.startDropCreditCheck('chan');
    p._creditStartedAt = p._creditLastGrowthAt = Date.now() - 12 * 60 * 1000;
    const tick = timers.get(p.dropCreditInterval);
    for (let i = 0; i < 3; i++) await tick();
    check('Inventory failures do not fake growth or reset the no-credit verdict', noCredit === 1 && !verdicts.includes('ok'), `verdicts=${verdicts.join(',')}, onNoCredit=${noCredit}`);
  }
  {
    // Third no-credit channel in a row: leave the category only when there is
    // somewhere to go, and never leave one the user started with Play.
    const run = async ({ manual = false, others = true } = {}) => {
      const { sandbox: s, page: p } = environment();
      s.window.sessionState = { startTime: Date.now() };
      const journal = [];
      s.window.eventLog = { add: e => journal.push(e.title) };
      p.categories = [{ id: 'a', name: 'A', enabled: true, hasDrops: true }];
      if (others) p.categories.push({ id: 'b', name: 'B', enabled: true, hasDrops: true });
      p.currentCategory = p.categories[0];
      p.currentStream = { login: 'a1' };
      p._noStreamsUntil = new Map();
      p.manualCategoryId = manual ? 'a' : null;
      const calls = { stream: 0, category: 0, offer: 0 };
      p.switchToNextStream = async () => { calls.stream++; return 'switched'; };
      p.switchToNextEnabledCategory = async () => { calls.category++; return true; };
      p.showSwitchOffer = () => { calls.offer++; };
      for (let i = 0; i < 3; i++) await p.onNoCredit({ reason: 'test' });
      const result = { ...calls, paused: p._noStreamsUntil.has('a'), journal: journal.join(',') };
      // Для сравнения языков: текст записей журнала свой у каждого языка,
      // а их число — нет. Свойство скрытое, чтобы detail остался прежним
      Object.defineProperty(result, 'facts', { value: { ...calls, paused: result.paused, entries: journal.length } });
      return result;
    };
    const away = await run();
    check('Three no-credit channels move to another category', away.category === 1 && away.stream === 2 && away.paused, JSON.stringify(away), away.facts);
    if (LANG === 'en') check('Journal entry about leaving the category is in English', !!away.journal && !CYRILLIC.test(away.journal), away.journal);
    const alone = await run({ others: false });
    check('With nowhere to go the app keeps trying channels instead of stopping', alone.category === 0 && alone.stream === 3 && !alone.paused && !alone.journal, JSON.stringify(alone), alone.facts);
    const manual = await run({ manual: true });
    check('Play-started category is not paused or announced as left', manual.category === 0 && manual.stream === 3 && manual.offer === 1 && !manual.paused && !manual.journal, JSON.stringify(manual), manual.facts);
  }
  {
    // Вердикты зачёта на всех ветках: состояние и reason (русский код
    // причины, его сверяют describe() и farming-page) от языка не зависят.
    // Подпись для человека — на языке интерфейса; в русском explain() даёт
    // ровно прежнюю подсказку — сам reason
    const { sandbox: s } = environment();
    const DC = s.window.DropCredit;
    const now = Date.now();
    const warm = now - 12 * 60 * 1000;
    const mine = { channel: { name: 'chan' }, currentMinutesWatched: 5, requiredMinutesWatched: 60 };
    const cases = [
      { progressGrew: true },
      { hasWatchable: false },
      { startedAt: warm, staleForMs: 11 * 60 * 1000, samples: [] },
      { startedAt: now, samples: [] },
      { startedAt: warm, samples: [{ at: now, session: mine }] },
      { startedAt: now - 60000, samples: [{ at: now, session: null }] },
      { startedAt: warm, samples: [{ at: now - 1000, session: null }, { at: now, session: { channel: { name: 'other' } } }] },
      { startedAt: warm, samples: [{ at: now - 1000, session: null }, { at: now, session: null }] },
      { startedAt: warm, progressStale: false, samples: [{ at: now - 1000, session: null }, { at: now, session: null }] },
      { startedAt: warm, samples: [{ at: now, session: null }] }
    ];
    const verdicts = cases.map(c => DC.evaluate({ login: 'chan', now, ...c }));
    const facts = verdicts.map(v => `${v.state}:${v.reason}`);
    const labels = verdicts.map(v => [DC.describe(v), DC.explain(v)]);
    const labelsOk = LANG === 'en'
      ? labels.every(([short, long]) => short && long && !CYRILLIC.test(short + long))
      : labels.every(([, long], i) => long === verdicts[i].reason);
    check('Credit verdicts keep states and reason codes on every branch',
      new Set(verdicts.map(v => v.state)).size === 4 && verdicts.every(v => CYRILLIC.test(v.reason)) && labelsOk,
      facts.join(' | ') + (LANG === 'en' ? ' → ' + labels.map(l => l.join(' / ')).join(' | ') : ''), facts);
  }
}
(async () => {
  await scenarios();
  LANG = 'en';
  await scenarios();
  LANG = 'compare';
  const differ = [];
  for (const [name, ru] of results.ru) {
    const en = results.en.get(name);
    if (!en) differ.push(`${name}: no English run`);
    else if (en.ok !== ru.ok || en.facts !== ru.facts) differ.push(`${name}: ru=${ru.facts} en=${en.facts}`);
  }
  check('English run behaves exactly like the Russian one', differ.length === 0,
    differ.length ? differ.join('; ') : `${results.ru.size} scenarios identical`);
  // Строка без перевода в английском прогоне осталась бы на экране русской
  const missing = [...new Set(englishSandboxes.flatMap(s => s.window.tr.missing()))];
  check('English run shows no untranslated strings', missing.length === 0, missing.length ? missing.join(' | ') : 'tr.missing() is empty');
  console.log(`\nAudit: ${failures} reproduced failures.`);
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
