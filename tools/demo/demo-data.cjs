'use strict';
// Данные демо-режима: выдуманные каналы, кампании, подписки, статистика.
//
// Игры и обложки настоящие (их показывает сам Twitch), всё остальное
// придумано: имена стримеров, названия кампаний и наград, зрители. Ответы
// повторяют форму ответов main.js — окно получает то же, что от Twitch,
// только без сети. Время отсчитывается от момента запуска, поэтому сроки
// кампаний и длительность сессии на снимках всегда правдоподобны.

const { hash } = require('./demo-assets.cjs');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Картинки демо-режима (аватарки, награды) отдаёт перехват https в main:
// адрес выдуман, в сеть такие запросы не уходят
const ASSET_HOST = 'wt-demo.invalid';
const asset = (p) => `https://${ASSET_HOST}/${p}`;
// Обложки у Twitch двух видов: почти у всех игр «_IGDB-», у Just Chatting —
// без него. Вид без суффикса у Delta Force отдаёт заглушку 404
const PLAIN_BOX = new Set(['509658']);
const boxBase = (id) => `https://static-cdn.jtvnw.net/ttv-boxart/${id}${PLAIN_BOX.has(id) ? '' : '_IGDB'}`;
const boxTemplate = (id) => `${boxBase(id)}-{width}x{height}.jpg`;
const boxSized = (id, w = 52, h = 72) => `${boxBase(id)}-${w}x${h}.jpg`;

const USER = { id: '90000001', login: 'demoviewer', displayName: 'DemoViewer', email: 'demo@example.invalid' };

const GAMES = {
  rust: { id: '263490', name: 'Rust', viewers: 41230, scene: 'wild' },
  rivals: { id: '1264310518', name: 'Marvel Rivals', viewers: 58710, scene: 'city' },
  valorant: { id: '516575', name: 'VALORANT', viewers: 96420, scene: 'arena' },
  overwatch: { id: '515025', name: 'Overwatch', viewers: 37950, scene: 'day' },
  delta: { id: '1282866981', name: 'Delta Force', viewers: 24880, scene: 'desert' },
  warframe: { id: '66170', name: 'Warframe', viewers: 12340, scene: 'space' },
  apex: { id: '511224', name: 'Apex Legends', viewers: 45110, scene: 'canyon' },
  tarkov: { id: '491931', name: 'Escape from Tarkov', viewers: 31200, scene: 'desert' },
  destiny: { id: '497057', name: 'Destiny 2', viewers: 18900, scene: 'space' },
  wot: { id: '27546', name: 'World of Tanks', viewers: 9800, scene: 'wild' }
};

// Остальной топ категорий — для окна «Добавить категорию»
const OTHER_TOP = [
  ['509658', 'Just Chatting', 312400], ['21779', 'League of Legends', 198500],
  ['32399', 'Counter-Strike', 154800], ['32982', 'Grand Theft Auto V', 121300],
  ['33214', 'Fortnite', 88200], ['29595', 'Dota 2', 76500], ['27471', 'Minecraft', 54300],
  ['512710', 'Call of Duty: Warzone', 42100], ['493057', 'PUBG: BATTLEGROUNDS', 23800],
  ['491487', 'Dead by Daylight', 19700], ['138585', 'Hearthstone', 14200]
];

// login, имя, игра (null — не в эфире), зрители, фолловеры, сколько часов в эфире
const CHANNELS = [
  ['pixelpilot', 'PixelPilot', 'rust', 8420, 184300, 2.2],
  ['nightowlplays', 'NightOwlPlays', 'rust', 5130, 96200, 4.6],
  ['frontierfox', 'FrontierFox', 'rust', 2960, 41800, 1.1],
  ['mossyknight', 'MossyKnight', 'rust', 1240, 18900, 6.3],
  ['lunacasts', 'LunaCasts', 'rivals', 12880, 412000, 3.4],
  ['cometcrafter', 'CometCrafter', 'rivals', 6450, 120500, 1.7],
  ['riftrunner_88', 'RiftRunner_88', 'rivals', 2210, 33600, 0.8],
  ['emberquill', 'EmberQuill', 'valorant', 9720, 256000, 2.9],
  ['orbitotter', 'OrbitOtter', 'valorant', 4380, 74100, 5.2],
  ['velvetvandal', 'VelvetVandal', 'valorant', 1950, 28700, 1.4],
  ['bytebard', 'ByteBard', 'overwatch', 3640, 88800, 2.5],
  ['tundratess', 'TundraTess', 'overwatch', 2870, 51200, 3.8],
  ['novanomad', 'NovaNomad', 'delta', 4120, 67300, 1.9],
  ['ironlotus', 'IronLotus', 'delta', 1780, 22400, 4.1],
  ['glitchgarden', 'GlitchGarden', 'warframe', 2340, 45600, 2.1],
  ['paperplanetv', 'PaperPlaneTV', 'warframe', 890, 12100, 0.6],
  ['sablesignal', 'SableSignal', 'apex', 5520, 133000, 3.1],
  ['quietstorm_tv', 'QuietStorm_tv', null, 0, 58300, 0],
  ['maplemarauder', 'MapleMarauder', null, 0, 21900, 0],
  ['hollowharbor', 'HollowHarbor', null, 0, 9400, 0],
  ['auroraarcade', 'AuroraArcade', null, 0, 36700, 0]
];

const FOLLOWS = ['pixelpilot', 'lunacasts', 'quietstorm_tv', 'nightowlplays', 'emberquill', 'bytebard',
  'sablesignal', 'glitchgarden', 'tundratess', 'maplemarauder', 'hollowharbor', 'auroraarcade'];
const FAVOURITES = ['pixelpilot', 'lunacasts', 'quietstorm_tv'];

// Названия стримов — содержимое, а не интерфейс: на языке демо
const TITLES = {
  en: {
    rust: ['Drops on | cliff base until wipe, then raid night', 'Solo survival, chill vibes, drops enabled', 'Monument runs with the squad | !drops', 'Building a castle from scratch, day 3'],
    rivals: ['Drops are live! Ranked grind to Grandmaster', 'Chill quick play with chat | drops on', 'Learning a new main, send tips'],
    valorant: ['Drops enabled | Immortal climb, coaching chat', 'Late night ranked with friends', 'Aim training, then customs | drops'],
    overwatch: ['Drops on | support gameplay all day', 'Tank one-tricks only, drops enabled'],
    delta: ['Drops live | Operations with the crew', 'Havoc warfare, big maps, drops on'],
    warframe: ['Drops active | farming relics and chill', 'New player friendly, drops on'],
    apex: ['Ranked with the trio, drops enabled']
  },
  ru: {
    rust: ['Дропсы включены | строим базу на скале до вайпа', 'Соло-выживание без спешки, дропсы идут', 'Рейды по монументам с командой | !дропсы', 'Строим замок с нуля, день третий'], // i18n-ignore
    rivals: ['Дропсы идут! Рейтинг до Грандмастера', 'Спокойные быстрые игры с чатом | дропсы', 'Учу нового героя, советы приветствуются'], // i18n-ignore
    valorant: ['Дропсы включены | путь до Immortal, разбор игр', 'Ночной рейтинг с друзьями', 'Разминка аима и кастомки | дропсы'], // i18n-ignore
    overwatch: ['Дропсы | весь день на поддержке', 'Только танки, дропсы включены'], // i18n-ignore
    delta: ['Дропсы | операции с отрядом', 'Большие карты, дропсы включены'], // i18n-ignore
    warframe: ['Дропсы | фармим реликвии без спешки', 'Для новичков, дропсы идут'], // i18n-ignore
    apex: ['Рейтинг втроём, дропсы включены'] // i18n-ignore
  }
};

const DESCRIPTIONS = {
  en: ['Variety streamer, mostly shooters and cozy survival. Schedule in the panels.',
    'Daily streams, friendly chat, lots of drops farming.',
    'Competitive player and part-time coach. Ask anything in chat.',
    'Late night streams for night owls. Be kind.'],
  ru: ['Стримлю шутеры и выживание, расписание в описании.', // i18n-ignore
    'Каждый день в эфире, дружный чат, много дропсов.', // i18n-ignore
    'Играю в рейтинге и помогаю новичкам. Спрашивайте в чате.', // i18n-ignore
    'Ночные стримы для сов. Будьте добрее.'] // i18n-ignore
};

/** Кампании: игра, название, начало и конец от «сейчас», награды [имя, вид, минут, набрано, получена]. */
const ACTIVE_CAMPAIGNS = [
  ['rust', 'Rust Frontier Drops', -4 * DAY, 3 * DAY + 5 * HOUR + 20 * MIN, [
    ['Scrap Hunter Hoodie', 'hoodie', 60, 60, true],
    ['Driftwood Door', 'door', 120, 95],
    ['Ember Crate', 'crate', 180, 95],
    ['Signal Flare Banner', 'banner', 240, 95]]],
  ['rivals', 'Marvel Rivals Twitch Drops', -2 * DAY, 6 * DAY + 2 * HOUR + 20 * MIN, [
    ['Neon Grid Spray', 'spray', 30, 0],
    ['Starlit Nameplate', 'card', 60, 0],
    ['Victory Pose Emote', 'emote', 120, 0]]],
  ['valorant', 'VALORANT Community Drops', -6 * DAY, 1 * DAY + 9 * HOUR + 20 * MIN, [
    ['Pixel Pup Gun Buddy', 'charm', 60, 60],
    ['Midnight Player Card', 'card', 120, 60],
    ['Orbit Spray', 'spray', 180, 60]]],
  ['overwatch', 'Overwatch Drops: Week 2', -5 * DAY, 2 * DAY + 3 * HOUR + 20 * MIN, [
    ['Comet Spray', 'spray', 60, 120, true],
    ['Aurora Player Icon', 'badge', 120, 120, true],
    ['Lumen Legendary Skin', 'gem', 240, 120]]],
  ['delta', 'Delta Force Operation Drops', -1 * DAY, 9 * DAY + 20 * MIN, [
    ['Dune Camo Charm', 'charm', 30, 12],
    ['Field Ops Crate', 'crate', 90, 12],
    ['Night Raid Banner', 'banner', 150, 12]]],
  ['warframe', 'Warframe Tenno Week', -6 * DAY, 18 * HOUR + 20 * MIN, [
    ['Lumen Glyph', 'badge', 45, 30],
    ['Starfall Sigil', 'gem', 90, 30]]]
];

// Будущие и закончившиеся — их календарь берёт из памяти приложения
const HISTORY_CAMPAIGNS = [
  ['tarkov', 'Escape from Tarkov Arena Drops', 2 * DAY, 9 * DAY, [['Arena Dog Tag', 60, 0], ['Raid Backpack Skin', 120, 0], ['Scav Mask', 180, 0]]],
  ['apex', 'Apex Legends Split Drops', 5 * DAY, 12 * DAY, [['Canyon Banner', 60, 0], ['Holo Spray', 120, 0]]],
  ['destiny', 'Destiny 2 Guardian Drops', -10 * DAY, -3 * DAY, [['Guardian Emblem', 60, 60, true], ['Nightfall Shader', 120, 104], ['Exotic Ship', 240, 104]]],
  ['wot', 'World of Tanks Steel Hunt', -16 * DAY, -9 * DAY, [['Steel Hunt Camo', 60, 60, true], ['Commander Portrait', 120, 120, true], ['Premium Days', 180, 180, true]]],
  ['rust', 'Rust Summer Drops', -24 * DAY, -16 * DAY, [['Sunburnt Jacket', 60, 60, true], ['Beach Towel', 120, 120, true], ['Tiki Garage Door', 240, 150]]]
];

function channelIndex() {
  const map = new Map();
  for (const [login, displayName, game, viewers, followers, hours] of CHANNELS) {
    map.set(login, { login, displayName, game, viewers, followers, hours, id: String(40000000 + hash(login) % 9000000) });
  }
  return map;
}

/**
 * Состояние демо: изменяемое (награды получают, минуты идут, баллы
 * капают) и общее для всех ответов. tr — тот же перевод, что в окне:
 * записи журнала и прочее, что приложение пишет само, сеются на языке демо.
 */
function createDemoState({ lang = 'en', now = Date.now(), tr = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => (p && k in p ? p[k] : m)), notify = () => {} } = {}) {
  const content = lang === 'ru' ? 'ru' : 'en';
  const channels = channelIndex();
  const started = now;
  const sessionStart = now - 107 * MIN;

  // Минуты просмотра: базовое значение из таблицы плюс то, что «набежало»
  // за время демо на канале, который сейчас в плеере
  const watching = { game: 'rust', since: now };
  const watchedMs = {};

  const titleOf = (ch) => {
    const list = TITLES[content][ch.game] || [''];
    const sameGame = CHANNELS.filter(c => c[2] === ch.game).map(c => c[0]);
    return list[sameGame.indexOf(ch.login) % list.length] || list[0];
  };

  const campaigns = ACTIVE_CAMPAIGNS.map(([gameKey, name, startOffset, endOffset, drops]) => {
    const game = GAMES[gameKey];
    const id = 'demo-' + gameKey + '-' + (hash(name) % 100000);
    return {
      gameKey,
      id,
      name,
      startsAt: new Date(now + startOffset).toISOString(),
      endsAt: new Date(now + endOffset).toISOString(),
      game,
      drops: drops.map(([title, kind, required, progress, claimed], i) => ({
        id: id + '-drop' + (i + 1),
        name: title,
        kind,
        benefitId: id + '-benefit' + (i + 1),
        required,
        base: progress,
        claimed: !!claimed
      }))
    };
  });

  // Полученные награды (инвентарь): из текущих кампаний и прошлых
  const claimedRewards = [];
  const rememberClaim = (drop, game, at) => {
    if (claimedRewards.some(r => r.id === drop.benefitId)) return;
    claimedRewards.unshift({
      id: drop.benefitId,
      name: drop.name,
      imageURL: asset('reward/' + drop.kind + '/' + drop.benefitId + '.svg'),
      game: { id: game.id, name: game.name, displayName: game.name },
      lastAwardedAt: new Date(at).toISOString()
    });
  };
  const pastKinds = ['hoodie', 'card', 'gem', 'banner', 'crate', 'spray', 'badge', 'charm'];
  HISTORY_CAMPAIGNS.forEach(([gameKey, name, , endOffset, drops]) => {
    drops.forEach(([title, , , claimed], i) => {
      if (!claimed) return;
      const benefitId = 'demo-past-' + gameKey + '-' + (hash(title) % 100000);
      rememberClaim({ benefitId, name: title, kind: pastKinds[(i + hash(name)) % pastKinds.length] }, GAMES[gameKey], now + endOffset - (i + 1) * 9 * HOUR);
    });
  });
  const claimedAt = { 'Scrap Hunter Hoodie': now - 21 * HOUR, 'Comet Spray': now - 3 * DAY, 'Aurora Player Icon': now - 24 * HOUR };
  campaigns.forEach(c => c.drops.forEach(d => {
    if (d.claimed) rememberClaim(d, c.game, claimedAt[d.name] || now - 2 * DAY);
  }));
  claimedRewards.sort((a, b) => Date.parse(b.lastAwardedAt) - Date.parse(a.lastAwardedAt));

  const extraMinutes = (gameKey, at = Date.now()) => {
    const ms = (watchedMs[gameKey] || 0) + (watching.game === gameKey ? at - watching.since : 0);
    return Math.floor(ms / MIN);
  };
  const progressOf = (campaign, drop) => {
    if (drop.claimed) return Math.max(drop.base, drop.required);
    return Math.min(drop.required, drop.base + extraMinutes(campaign.gameKey));
  };

  function watchChannel(login) {
    const ch = channels.get(String(login || '').toLowerCase());
    const game = ch?.game || null;
    if (game === watching.game) return;
    const at = Date.now();
    if (watching.game) watchedMs[watching.game] = (watchedMs[watching.game] || 0) + (at - watching.since);
    watching.game = game;
    watching.since = at;
  }

  // ─── ответы, как у main.js ────────────────────────────────────────

  function inventoryCampaign(c) {
    const drops = c.drops.map(d => {
      const progress = progressOf(c, d);
      const ready = progress >= d.required;
      return {
        id: d.id,
        name: d.name,
        benefitName: d.name,
        benefitId: d.benefitId,
        imageURL: asset('reward/' + d.kind + '/' + d.benefitId + '.svg'),
        progress,
        required: d.required,
        percentage: Math.min(100, Math.floor(progress / d.required * 100)),
        claimed: d.claimed,
        // Twitch выдаёт номер экземпляра, когда награду можно забрать
        dropInstanceID: ready || d.claimed ? USER.id + '#' + c.id + '#' + d.id : null
      };
    });
    const completed = drops.filter(d => d.claimed || d.progress >= d.required).length;
    return {
      id: c.id,
      name: c.name,
      game: { id: c.game.id, name: c.game.name, boxArtURL: boxTemplate(c.game.id) },
      status: 'active',
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      drops,
      totalDrops: drops.length,
      completedDrops: completed,
      allowedChannels: []
    };
  }

  const inventory = () => ({
    campaigns: campaigns.filter(c => Date.parse(c.endsAt) > Date.now()).map(inventoryCampaign),
    claimedDrops: claimedRewards.slice(),
    dashboardComplete: true
  });

  const gameByName = (name) => {
    const key = String(name || '').trim().toLowerCase();
    return Object.entries(GAMES).find(([, g]) => g.name.toLowerCase() === key) || null;
  };

  const liveIn = (gameKey) => [...channels.values()]
    .filter(ch => ch.game === gameKey)
    .sort((a, b) => b.viewers - a.viewers);

  // То же правило, что streamHasDropsSignal в main.js
  const hasDropsSignal = (title) => {
    const t = String(title || '').toLowerCase();
    return t.includes(' drops') || t.startsWith('drops') || t.includes('[drops') || t.includes('дропс') || t.includes('дропы'); // i18n-ignore
  };

  const streamOf = (ch) => ({
    login: ch.login,
    displayName: ch.displayName,
    title: titleOf(ch),
    viewersCount: ch.viewers,
    profileImageUrl: asset('avatar/' + ch.login + '.svg')
  });

  // Баллы канала: первый ответ — баланс, второй — сундук, дальше по чуть-чуть
  const points = new Map();

  function channelPoints(login) {
    const key = String(login || '').toLowerCase();
    const ch = channels.get(key);
    if (!ch) return { points: 0, error: 'no channel' };
    let entry = points.get(key);
    if (!entry) {
      entry = { balance: 12000 + hash(key) % 60000, calls: 0 };
      points.set(key, entry);
    }
    entry.calls += 1;
    let claimed = null;
    if (entry.calls === 2 || (entry.calls > 2 && entry.calls % 45 === 0)) {
      entry.balance += 50;
      claimed = { id: 'demo-claim-' + entry.calls, points: 50 };
      notify('chest-claimed', { channel: key, points: 50, timestamp: Date.now() });
    } else if (entry.calls > 2) {
      entry.balance += 10;
    }
    return { points: entry.balance, error: null, claimed };
  }

  // Длительность эфира — в том же виде, что calculateUptime в main.js
  const uptime = (ch) => {
    const diff = Math.floor((ch.hours * HOUR + (Date.now() - started)) / 1000);
    return tr('{h}ч {m}м', { h: Math.floor(diff / 3600), m: Math.floor((diff % 3600) / 60) });
  };

  const findDrop = (dropInstanceID) => {
    for (const c of campaigns) {
      for (const d of c.drops) {
        if (USER.id + '#' + c.id + '#' + d.id === dropInstanceID) return { c, d };
      }
    }
    return null;
  };

  const claim = (dropInstanceID) => {
    const found = findDrop(dropInstanceID);
    if (!found) return { success: false, error: tr('Twitch не подтвердил награду — возможно, её уже забрали или кампания закончилась. Обновите список.'), stale: true };
    const { c, d } = found;
    if (d.claimed) return { success: true, already: true };
    if (progressOf(c, d) < d.required) return { success: false, error: tr('Twitch не выдал награду — попробуйте позже') };
    d.claimed = true;
    d.base = Math.max(d.base, d.required);
    rememberClaim(d, c.game, Date.now());
    return { success: true, already: false };
  };

  // Трафик: локальная страница плеера почти ничего не качает, и на снимках
  // был бы ноль. Считаем как у стрима в 160p — около 45 КБ/с. Первый сброс
  // счётчика — это восстановленная сессия, ей оставляем набранное с её начала
  const traffic = { since: sessionStart, resets: 0 };
  const trafficStats = () => {
    const at = Date.now();
    const sessionBytes = Math.round((at - traffic.since) / 1000 * 44 * 1024);
    return {
      totalBytes: sessionBytes + Math.round(1.9 * 1024 * 1024 * 1024),
      sessionBytes,
      currentRateKBs: 44 + 7 * Math.sin(at / 7000) + 3 * Math.sin(at / 1900)
    };
  };

  const handlers = {
    'get-traffic-stats': () => trafficStats(),
    'reset-traffic-session': () => {
      traffic.resets += 1;
      if (traffic.resets > 1) traffic.since = Date.now();
      return trafficStats();
    },

    'fetch-twitch-categories': () => [
      ...Object.entries(GAMES).filter(([key]) => !['destiny', 'wot'].includes(key)).map(([, g]) => [g.id, g.name, g.viewers]),
      ...OTHER_TOP
    ]
      .sort((a, b) => b[2] - a[2])
      .map(([id, name, viewers]) => ({ id, name, boxArtURL: boxSized(id), viewersCount: viewers, tags: [] })),

    'check-category-drops': (name) => {
      const found = gameByName(name);
      if (!found) return false;
      return campaigns.some(c => c.gameKey === found[0] && Date.parse(c.endsAt) > Date.now() && c.drops.length > 0);
    },

    'get-streams-with-drops': (name) => {
      const found = gameByName(name);
      if (!found) return [];
      const live = liveIn(found[0]);
      const tagged = live.filter(ch => hasDropsSignal(titleOf(ch)));
      return (tagged.length ? tagged : live).map(streamOf);
    },

    'get-category-overview': (name) => {
      const found = gameByName(name);
      const live = found ? liveIn(found[0]) : [];
      const streams = live.map(ch => ({ ...streamOf(ch), hasDrops: hasDropsSignal(titleOf(ch)) }));
      return {
        gameViewers: found ? found[1].viewers : 0,
        streamsChecked: streams.length,
        streamsWithDrops: streams.filter(s => s.hasDrops).length,
        streams
      };
    },

    'get-stream-stats': (login) => {
      const ch = channels.get(String(login || '').toLowerCase());
      if (!ch || !ch.game) return null;
      const game = GAMES[ch.game];
      return {
        title: titleOf(ch),
        viewers: ch.viewers,
        points: points.get(ch.login)?.balance ?? null,
        uptime: uptime(ch),
        gameName: game.name,
        gameId: game.id
      };
    },

    'fetch-twitch-drops': () => inventory().campaigns,
    'fetch-drops-inventory': () => inventory(),

    'get-drop-session': (login) => {
      const key = String(login || '').replace(/^@/, '').toLowerCase();
      const ch = channels.get(key);
      if (!ch) return { ok: false, error: 'канал не найден' }; // i18n-ignore
      const campaign = campaigns.find(c => c.gameKey === ch.game && Date.parse(c.endsAt) > Date.now());
      const drop = campaign?.drops.find(d => !d.claimed && progressOf(campaign, d) < d.required);
      if (!campaign || !drop || watching.game !== ch.game) return { ok: true, session: null };
      const game = GAMES[ch.game];
      return {
        ok: true,
        session: {
          dropID: drop.id,
          requiredMinutesWatched: drop.required,
          currentMinutesWatched: progressOf(campaign, drop),
          channel: { id: ch.id, name: ch.login, displayName: ch.displayName },
          game: { id: game.id, name: game.name, displayName: game.name }
        }
      };
    },

    'claim-drop': (dropInstanceID) => {
      if (!dropInstanceID) return { success: false, error: tr('Не указана награда') };
      return claim(dropInstanceID);
    },

    'claim-all-drops': () => {
      const ready = [];
      campaigns.forEach(c => c.drops.forEach(d => {
        if (!d.claimed && progressOf(c, d) >= d.required) ready.push(USER.id + '#' + c.id + '#' + d.id);
      }));
      if (ready.length === 0) return { success: true, claimed: 0, total: 0, message: tr('Нет доступных наград для получения') };
      const claimed = ready.filter(id => claim(id).success).length;
      return { success: true, claimed, total: ready.length, message: tr('Получено наград: {claimed}/{total}', { claimed, total: ready.length }) };
    },

    'get-channel-points': (login) => channelPoints(login),

    'get-user-subscriptions': () => ({
      items: FOLLOWS.map(login => {
        const ch = channels.get(login);
        return { id: ch.id, login: ch.login, displayName: ch.displayName, profileImageUrl: asset('avatar/' + login + '.svg') };
      }),
      complete: true
    }),

    'unsubscribe-channel': (_token, login) => {
      const index = FOLLOWS.indexOf(String(login || '').toLowerCase());
      if (index >= 0) FOLLOWS.splice(index, 1);
      return { success: true };
    },

    'get-channel-details': (_token, login) => {
      const ch = channels.get(String(login || '').replace(/^@/, '').trim().toLowerCase());
      if (!ch) return null;
      const live = !!ch.game;
      return {
        profileImageUrl: asset('avatar/' + ch.login + '.svg'),
        description: DESCRIPTIONS[content][hash(ch.login) % DESCRIPTIONS[content].length],
        lastStreamDate: new Date(live ? now - ch.hours * HOUR : now - (1 + hash(ch.login) % 9) * DAY - 5 * HOUR).toISOString(),
        isLive: live,
        followers: ch.followers
      };
    },

    'has-twitch-session': () => ({ loggedIn: true }),

    'get-oauth-user': () => ({
      accessToken: 'demo-access-token',
      refreshToken: 'demo-refresh-token',
      expiresAt: now + 30 * DAY,
      user: { ...USER, profileImageUrl: asset('avatar/' + USER.login + '.svg') }
    }),

    // Вход в демо не нужен: аккаунт уже есть
    'start-twitch-auth': () => ({ success: false, error: 'demo' }),
    'logout-twitch': () => ({ success: true }),

    // Заметки о выпуске — содержимое с GitHub; в демо — короткие, но в том же
    // виде, что настоящие: два раздела с флагами, окно берёт раздел своего языка
    'fetch-release-notes': () => ({
      success: true,
      releases: [{
        version: DEMO_VERSION.current,
        name: 'v' + DEMO_VERSION.current,
        body: '## 🇷🇺 Что нового\n\n- Английский интерфейс\n- Демо-режим для снимков экрана\n\n' + // i18n-ignore
          '## 🇬🇧 What’s new\n\n- English interface\n- Demo mode for screenshots',
        publishedAt: new Date(now - 2 * DAY).toISOString()
      }]
    })
  };

  // ─── то, что приложение хранит само ───────────────────────────────

  const gameCategory = (key, extra = {}) => {
    const g = GAMES[key];
    return {
      id: g.id,
      name: g.name,
      boxArtURL: boxSized(g.id),
      viewersCount: g.viewers,
      tags: [],
      hasDrops: true,
      autoDrops: false,
      enabled: true,
      dropsCompleted: false,
      ...extra
    };
  };

  const categories = [
    gameCategory('rust', { priority: 1, pinned: true }),
    gameCategory('rivals', { priority: 2 }),
    gameCategory('valorant', { priority: 3 }),
    gameCategory('overwatch', { priority: 4 }),
    gameCategory('delta', { priority: 5, autoDrops: true }),
    gameCategory('warframe', { priority: 6, autoDrops: true }),
    gameCategory('apex', { priority: 7, hasDrops: false, enabled: false, userDisabled: true })
  ];

  // Прошлые сессии: последние три недели, по одной-две в день
  const sessionPlan = [
    [0.9, 'overwatch', 'bytebard', 410, 3], [1.8, 'rust', 'nightowlplays', 245, 1], [2.7, 'valorant', 'emberquill', 380, 1],
    [3.6, 'overwatch', 'tundratess', 190, 1], [4.8, 'rivals', 'lunacasts', 125, 0], [5.9, 'rust', 'pixelpilot', 300, 1],
    [7.2, 'warframe', 'glitchgarden', 95, 0], [8.4, 'valorant', 'orbitotter', 260, 1], [9.7, 'delta', 'novanomad', 150, 1],
    [11.1, 'rust', 'frontierfox', 330, 2], [12.6, 'overwatch', 'bytebard', 215, 1], [14.2, 'valorant', 'emberquill', 175, 1],
    [16.0, 'warframe', 'paperplanetv', 80, 0], [18.3, 'rust', 'pixelpilot', 420, 2]
  ];
  const rateHistory = (seed) => Array.from({ length: 60 }, (_, i) => 38 + Math.round(8 * Math.sin(i / 5 + seed) + (hash(seed + ':' + i) % 6)));
  const sessions = sessionPlan.map(([daysAgo, gameKey, login, minutes, drops], index) => {
    const start = now - daysAgo * DAY - (hash(login + index) % 5) * HOUR;
    const chests = Math.floor(minutes / 15);
    return {
      timestamp: start,
      duration: minutes,
      lastSeenAt: start + minutes * MIN,
      category: GAMES[gameKey].name,
      channel: channels.get(login).displayName,
      bandwidth: Math.round(minutes * 60 * 44 * 1024),
      bandwidthHistory: rateHistory(index),
      categoryBoxArtURL: boxSized(GAMES[gameKey].id),
      pointsEarned: Math.round(minutes * 2.1) + chests * 50,
      chestsCollected: chests,
      dropsCollected: drops,
      isActive: false
    };
  }).sort((a, b) => a.timestamp - b.timestamp);

  // Текущая сессия — та, что продолжится при запуске
  sessions.push({
    timestamp: sessionStart,
    duration: 107,
    lastSeenAt: now - 20 * 1000,
    category: 'Rust',
    channel: 'PixelPilot',
    bandwidth: Math.round(107 * 60 * 44 * 1024),
    bandwidthHistory: rateHistory(99),
    categoryBoxArtURL: boxSized(GAMES.rust.id),
    pointsEarned: 0,
    chestsCollected: 0,
    dropsCollected: 0,
    isActive: true
  });

  const watchTimeStats = {};
  sessions.forEach(s => {
    const entry = watchTimeStats[s.category] || (watchTimeStats[s.category] = { totalTime: 0, sessions: 0, lastWatched: 0 });
    entry.totalTime += s.duration * MIN;
    entry.sessions += 1;
    entry.lastWatched = Math.max(entry.lastWatched, s.lastSeenAt);
  });

  // Память кампаний (CampaignHistory): будущие и закончившиеся
  const campaignHistory = HISTORY_CAMPAIGNS.map(([gameKey, name, startOffset, endOffset, drops]) => ({
    id: 'demo-hist-' + gameKey + '-' + (hash(name) % 100000),
    name,
    game: { displayName: GAMES[gameKey].name, name: GAMES[gameKey].name, boxArtURL: boxTemplate(GAMES[gameKey].id) },
    startsAt: new Date(now + startOffset).toISOString(),
    endsAt: new Date(now + endOffset).toISOString(),
    drops: drops.map(([title, required, progress, claimed]) => ({ name: title, required, progress, claimed: !!claimed })),
    seenAt: now + Math.min(endOffset, 0) - HOUR
  }));

  const subscriptions = FOLLOWS.map((login, index) => {
    const ch = channels.get(login);
    const fav = FAVOURITES.indexOf(login);
    return {
      id: ch.id,
      login,
      displayName: ch.displayName,
      profileImageUrl: asset('avatar/' + login + '.svg'),
      followers: ch.followers,
      ...(fav >= 0 ? { isFavorite: true, priority: fav } : {}),
      lastSeen: new Date(now - (30 + index * 3) * DAY).toISOString(),
      // Подробности старше получаса — страница запросит их заново
      detailsCheckedAt: new Date(now - 2 * HOUR).toISOString()
    };
  });

  // Журнал: записи, которые оставило бы приложение за последние сутки
  const ev = (type, offset, title, extra = {}) => ({ type, at: now - offset, title, ...extra });
  const rewardIcon = (name) => {
    for (const c of campaigns) {
      const d = c.drops.find(x => x.name === name);
      if (d) return asset('reward/' + d.kind + '/' + d.benefitId + '.svg');
    }
    return undefined;
  };
  const plan = [
    ev('start', 26 * HOUR, tr('Фарминг запущен'), { detail: 'Overwatch' }),
    ev('chest', 25.6 * HOUR, tr('Сундук собран'), { detail: 'bytebard', points: 50 }),
    ev('drop', 24 * HOUR, 'Aurora Player Icon', { game: 'Overwatch', icon: rewardIcon('Aurora Player Icon') }),
    ev('switch', 23 * HOUR, tr('Переход к {name}', { name: 'Rust' }), { detail: tr('награды прежней категории собраны'), game: 'Rust' }),
    ev('chest', 22.4 * HOUR, tr('Сундук собран'), { detail: 'pixelpilot', points: 50 }),
    ev('drop', 21 * HOUR, 'Scrap Hunter Hoodie', { game: 'Rust', icon: rewardIcon('Scrap Hunter Hoodie') }),
    ev('game-mode', 20.5 * HOUR, tr('Игровой режим включён'), { detail: tr('{game} — стрим на минимальном качестве', { game: 'Counter-Strike 2' }) }),
    ev('game-mode', 19.6 * HOUR, tr('Игровой режим выключен'), { detail: tr('Качество стрима возвращено') }),
    ev('stop', 19 * HOUR, tr('Фарминг остановлен')),
    ev('start', 107 * MIN + 30 * 1000, tr('Фарминг запущен'), { detail: 'Rust' }),
    ev('favourite-live', 62 * MIN, tr('{channel} в эфире', { channel: 'LunaCasts' }), { detail: tr('{game} — по этой игре идут дропсы', { game: 'Marvel Rivals' }) }),
    ev('chest', 31 * MIN, tr('Сундук собран'), { detail: 'pixelpilot', points: 50 })
  ];
  const eventLog = {
    v: 1,
    // Последнюю награду ещё не видели — значок журнала горит; сводка
    // «Пока вас не было» уже показана и на странице не висит
    lastSeenAt: now - 22 * HOUR,
    summaryAt: now,
    entries: plan
      .sort((a, b) => b.at - a.at)
      .map((e, i) => ({ id: e.at.toString(36) + 'demo' + i, ...e }))
      .map(e => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)))
  };

  const pixel = channels.get('pixelpilot');
  const activeSession = {
    startTime: sessionStart,
    categoryStartTime: sessionStart,
    categoryId: GAMES.rust.id,
    categoryName: 'Rust',
    manualCategoryId: null,
    manualPlayLockCategoryId: null,
    streamLogin: pixel.login,
    streamDisplayName: pixel.displayName,
    streamTitle: titleOf(pixel)
  };

  const account = (avatar) => ({
    username: USER.login,
    displayName: USER.displayName,
    avatar,
    email: USER.email,
    cookies: null,
    loginMethod: 'oauth',
    accessToken: 'demo-access-token',
    refreshToken: 'demo-refresh-token',
    twitchLoggedIn: true,
    addedAt: now - 41 * DAY,
    lastLogin: now - 2 * HOUR,
    oauthExpiresAt: new Date(now + 30 * DAY).toISOString()
  });

  return {
    lang: content,
    now,
    user: USER,
    channels,
    games: GAMES,
    handlers,
    watchChannel,
    sceneForChannel: (login) => GAMES[channels.get(String(login || '').toLowerCase())?.game]?.scene || 'wild',
    storeSeed: (avatar) => ({
      accounts: [account(avatar)],
      categories,
      autoDropsModeEnabled: true,
      statistics: { totalWatchTime: 0, totalDrops: 0, categoriesCompleted: 0, sessions },
      watchTimeStats,
      subscriptions,
      subscriptions_priority_enabled: true,
      campaignHistory,
      eventLog,
      activeSession,
      blacklist: []
    })
  };
}

// Версию приложения demo-app подставляет из package.json
const DEMO_VERSION = { current: '0.0.0' };

module.exports = { createDemoState, ASSET_HOST, DEMO_VERSION, GAMES, USER, MIN, HOUR, DAY };
