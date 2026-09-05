/**
 * GameMode — распознавание запущенной игры по списку процессов.
 *
 * Жалоба, с которой всё началось: «в Overwatch пинг резко подрастает,
 * потом отпускает». Стрим качается кусками, и каждый кусок на мгновение
 * забивает канал. Пока пользователь просто сидит за компьютером, это
 * терпимо; в матче — нет. Игровой режим замечает игру среди процессов и
 * на время игры сажает плеер на минимальное качество с жёстким потолком
 * скорости, а когда игра закрыта — возвращает всё как было.
 *
 * Здесь только чистое сопоставление: список процессов даёт main-процесс.
 */
class GameMode {
  /** Во сколько раз потолок выше битрейта, пока идёт игра. */
  static get HEADROOM() {
    return 1.3;
  }

  /** Качество на время игры. */
  static get QUALITY() {
    return '160p30';
  }

  /** Известные игры: имя процесса → название. */
  static get KNOWN() {
    return {
      'overwatch.exe': 'Overwatch',
      'r5apex.exe': 'Apex Legends',
      'r5apex_dx12.exe': 'Apex Legends',
      'cs2.exe': 'Counter-Strike 2',
      'csgo.exe': 'CS:GO',
      'valorant-win64-shipping.exe': 'VALORANT',
      'league of legends.exe': 'League of Legends',
      'dota2.exe': 'Dota 2',
      'fortniteclient-win64-shipping.exe': 'Fortnite',
      'rustclient.exe': 'Rust',
      'gta5.exe': 'GTA V',
      'gta5_enhanced.exe': 'GTA V',
      'rainbowsix.exe': 'Rainbow Six Siege',
      'rainbowsix_dx11.exe': 'Rainbow Six Siege',
      'tslgame.exe': 'PUBG',
      'warframe.x64.exe': 'Warframe',
      'marvel-win64-shipping.exe': 'Marvel Rivals',
      'project8.exe': 'Deadlock',
      'eldenring.exe': 'Elden Ring',
      'destiny2.exe': 'Destiny 2',
      'escapefromtarkov.exe': 'Escape from Tarkov',
      'helldivers2.exe': 'Helldivers 2',
      'thefinals.exe': 'The Finals',
      'discovery.exe': 'The Finals',
      'battlefield 2042.exe': 'Battlefield 2042',
      'bf6.exe': 'Battlefield 6',
      'cod.exe': 'Call of Duty',
      'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
      'robloxplayerbeta.exe': 'Roblox',
      'minecraft.windows.exe': 'Minecraft',
      'javaw.exe': 'Minecraft (Java)',
      'wow.exe': 'World of Warcraft',
      'worldofwarships64.exe': 'World of Warships',
      'worldoftanks.exe': 'World of Tanks',
      'genshinimpact.exe': 'Genshin Impact',
      'starrail.exe': 'Honkai: Star Rail',
      'ffxiv_dx11.exe': 'Final Fantasy XIV',
      'huntgame.exe': 'Hunt: Showdown',
      'pathofexile.exe': 'Path of Exile',
      'pathofexilesteam.exe': 'Path of Exile',
      'pathofexile_x64.exe': 'Path of Exile',
      'poe2.exe': 'Path of Exile 2',
      'diablo iv.exe': 'Diablo IV',
      'sotgame.exe': 'Sea of Thieves',
      'deltaforce.exe': 'Delta Force',
      'deltaforceclient-win64-shipping.exe': 'Delta Force',
      'rocketleague.exe': 'Rocket League',
      'squadgame.exe': 'Squad',
      'arma3_x64.exe': 'Arma 3',
      'starcitizen.exe': 'Star Citizen',
      'eve.exe': 'EVE Online',
      'albion-online.exe': 'Albion Online',
      'newworld.exe': 'New World',
      'lostark.exe': 'Lost Ark',
      'tera.exe': 'TERA',
      'bo6.exe': 'Call of Duty'
    };
  }

  static normalize(name) {
    return String(name || '').trim().replace(/^.*[\\/]/, '').toLowerCase();
  }

  /**
   * Разбирает список дополнительных имён из настройки: через запятую,
   * точку с запятой или перенос строки. Расширение .exe можно не писать.
   */
  static parseExtra(text) {
    return String(text || '')
      .split(/[,;\n]+/)
      .map(GameMode.normalize)
      .filter(Boolean)
      .map(name => (name.endsWith('.exe') ? name : name + '.exe'));
  }

  /**
   * Первая найденная игра среди процессов или null.
   * Пользовательский список проверяется раньше известного: он точнее.
   */
  static match(processNames, extra = '') {
    const names = new Set((processNames || []).map(GameMode.normalize).filter(Boolean));
    if (names.size === 0) return null;

    for (const exe of GameMode.parseExtra(extra)) {
      if (names.has(exe)) return { exe, title: exe.replace(/\.exe$/, '') };
    }

    const known = GameMode.KNOWN;
    for (const exe of Object.keys(known)) {
      if (names.has(exe)) return { exe, title: known[exe] };
    }
    return null;
  }

  /** Разбор вывода `tasklist /fo csv /nh`: первое поле каждой строки. */
  static parseTasklist(output) {
    const names = [];
    for (const line of String(output || '').split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)"/);
      if (m) names.push(m[1]);
    }
    return names;
  }
}

if (typeof window !== 'undefined') {
  window.GameMode = GameMode;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameMode;
}
