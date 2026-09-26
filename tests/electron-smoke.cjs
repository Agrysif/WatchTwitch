const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.join(__dirname, '..');
const appRoot = process.env.WT_TEST_PACKAGED === '1'
  ? path.join(root, 'dist/win-unpacked/resources/app.asar') : root;
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'watchtwitch-smoke-')));
app.setAppPath(appRoot);
const { autoUpdater } = require(path.join(appRoot, 'node_modules/electron-updater'));
autoUpdater.checkForUpdates = async () => null;
const Store = require('electron-store');
new Store().set('settings.gameMode', false);
let tested = false;
app.on('web-contents-created', (_event, contents) => {
  contents.on('did-finish-load', async () => {
    if (tested || !contents.getURL().endsWith('/renderer/index.html')) return;
    tested = true;
    try {
      const result = await contents.executeJavaScript(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && (!window.farmingPage?.isEventListenersSetup || !window.farmingPage?.updateInterval); i++) await sleep(100);
        const page = window.farmingPage;
        if (!page || window.router.currentPage !== 'farming') throw Error('Farming did not initialize');
        const node = document.getElementById('drops-progress-horizontal');
        const interval = page.updateInterval;
        let deadEvents = 0;
        const original = page.onPlayerDead;
        page.onPlayerDead = () => { deadEvents++; };
        const results = [];
        for (const target of ['settings', 'statistics', 'drops', 'subscriptions', 'calendar', 'accounts', 'farming']) {
          await window.router.navigate(target);
          await sleep(150);
          if (window.router.currentPage !== target) throw Error('Navigation failed: ' + target);
          if (window.farmingPage !== page || page._destroyed || page.updateInterval !== interval) throw Error('Farming lost on ' + target);
          if (document.getElementById('drops-progress-horizontal') !== node) throw Error('Farming DOM replaced on ' + target);
          const hidden = document.getElementById('farming-background-content');
          if (target !== 'farming' && (!hidden?.hidden || !hidden.contains(node))) throw Error('Background DOM not parked');
          if (target === 'farming' && hidden) throw Error('Background DOM not restored');
          window.dispatchEvent(new CustomEvent('wt:player-dead', { detail: { channel: 'test' } }));
          results.push(target);
        }
        page.onPlayerDead = original;
        if (deadEvents !== results.length) throw Error('Player-dead listener lost or duplicated: ' + deadEvents);
        // A late navigation response must not replace a newer destination.
        await Promise.all([window.router.navigate('settings'), window.router.navigate('statistics')]);
        if (window.router.currentPage !== 'statistics') throw Error('Navigation race');
        await window.router.navigate('farming');
        if (window.farmingPage !== page) throw Error('Farming instance duplicated');
        const getAccounts = Storage.getAccounts;
        let resolveAccounts;
        Storage.getAccounts = () => new Promise(resolve => { resolveAccounts = resolve; });
        const start = page.startFarmingForCategory({ id: 'test', name: 'Test' });
        page.stopFarming(false);
        resolveAccounts([{ loginMethod: 'oauth' }]);
        await start;
        Storage.getAccounts = getAccounts;
        if (page.currentStream || page.currentCategory || window.playerManager.hasStream()) throw Error('Stopped search restarted playback');
        return { pages: results, playerDeadEvents: deadEvents, farmingInstances: 1, navigationRace: 'passed', stopDuringStart: 'passed' };
      })()`);
      console.log('TEST full application smoke PASS', JSON.stringify(result));
      app.exit(0);
    } catch (error) {
      console.error('TEST full application smoke FAIL', error);
      app.exit(1);
    }
  });
});
require(path.join(appRoot, 'main.js'));
setTimeout(() => { console.error('TEST smoke timed out'); app.exit(2); }, 60000);
