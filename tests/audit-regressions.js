// Diagnostic audit: executes production methods with controlled network/timer responses.
// FAIL means the expected behavior is currently broken; no Twitch account is used.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}
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
  };
  vm.createContext(sandbox);
  for (const file of ['features/farming/stream-picker.js', 'features/farming/drop-credit.js', 'pages/farming-page.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'renderer/js', file), 'utf8'), sandbox);
  }
  const page = Object.create(sandbox.window.FarmingPage.prototype);
  sandbox.window.utils = { showToast() {} };
  return { sandbox, page, timers, elements };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
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
  console.log(`\nAudit: ${failures} reproduced failures.`);
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
