/**
 * Chime — короткие сигналы о событиях фарминга.
 *
 * Звук синтезируется на месте, а не берётся файлом: приложение и так весит
 * восемьдесят мегабайт, а нужно пять коротких мотивов по полсекунды.
 *
 * Сигнал должен сообщать, а не пугать в три ночи. Поэтому:
 * — у каждого события свой выключатель (soundDrop, soundChest…), а общий
 *   «Звук» (soundEnabled) глушит всё сразу;
 * — в тихие часы молчит всё;
 * — во время игры звучит только «нужно внимание» (фарминг встал, нет входа):
 *   остальное подождёт, а это пользователь должен узнать сразу;
 * — одно и то же событие не чаще раза в полторы секунды, «внимание» — не
 *   чаще раза в минуту: серия сбоев не должна превращаться в сирену.
 *
 * Прослушивание из настроек (preview) играет всегда: это явное действие
 * пользователя, и проверять «а не тихие ли сейчас часы» было бы странно.
 *
 * Контракт (спецификация, раздел H и контракт 6):
 *   Chime.EVENTS            — список событий для настроек
 *   chime.play(id, { preview })
 *   chime.preview(id)
 *   chime.dropClaimed(), chime.failed() — прежние имена, их зовут страницы
 */
class Chime {
  static get() {
    if (!window._chime) window._chime = new Chime();
    return window._chime;
  }

  constructor() {
    // Контекст создаётся при первом звуке, а не при загрузке: пустой
    // AudioContext держит аудиопоток Windows открытым всё время работы
    this.context = null;
    this.master = null;
    this.lastPlayedAt = new Map();
  }

  /**
   * События со звуком. Подписи и пояснения — для строк в настройках;
   * setting — ключ выключателя, defaultOn — значение до первой настройки.
   */
  static get EVENTS() {
    return [
      {
        id: 'drop',
        label: tr('Награда получена'),
        hint: tr('Короткий восходящий аккорд'),
        setting: 'soundDrop',
        defaultOn: true
      },
      {
        id: 'chest',
        label: tr('Сундук собран'),
        hint: tr('Тихая «монетка». Сундуки бывают каждые 15 минут, поэтому по умолчанию выключено'),
        setting: 'soundChest',
        defaultOn: false
      },
      {
        id: 'allDone',
        label: tr('Все награды собраны'),
        hint: tr('Аккорд на завершение: фармить больше нечего'),
        setting: 'soundAllDone',
        defaultOn: true
      },
      {
        id: 'attention',
        label: tr('Нужно внимание'),
        hint: tr('Фарминг остановился, нет входа в Twitch или награда не забрана. Звучит и во время игры'),
        setting: 'soundAttention',
        defaultOn: true
      },
      {
        id: 'favourite',
        label: tr('Избранный канал в эфире'),
        hint: tr('Одна мягкая нота'),
        setting: 'soundFavourite',
        defaultOn: true
      }
    ];
  }

  /**
   * Мотивы. freq — Гц, at — начало от старта, len — длина ноты (с);
   * weight у ноты — её доля громкости внутри мотива.
   * Аккорд награды — прежний, его уже узнают.
   */
  static get PATTERNS() {
    return {
      drop: {
        weight: 1.0,
        notes: [
          { freq: 587.33, at: 0, len: 0.13 },    // ре
          { freq: 783.99, at: 0.11, len: 0.15 }, // соль
          { freq: 1046.5, at: 0.24, len: 0.30 }  // до
        ]
      },
      chest: {
        weight: 0.45,
        notes: [
          { freq: 1318.5, at: 0, len: 0.07 },
          { freq: 1975.5, at: 0.06, len: 0.16 }
        ]
      },
      allDone: {
        weight: 1.0,
        notes: [
          { freq: 523.25, at: 0, len: 0.16 },
          { freq: 659.25, at: 0.12, len: 0.16 },
          { freq: 783.99, at: 0.24, len: 0.16 },
          { freq: 1046.5, at: 0.36, len: 0.7 },
          { freq: 659.25, at: 0.36, len: 0.7, weight: 0.5 },
          { freq: 783.99, at: 0.36, len: 0.7, weight: 0.5 }
        ]
      },
      attention: {
        weight: 0.9,
        // Треугольная волна чуть резче синуса: сигнал о сбое не должен
        // звучать как ещё одна награда
        wave: 'triangle',
        notes: [
          { freq: 392.0, at: 0, len: 0.16 },
          { freq: 293.66, at: 0.15, len: 0.30 }
        ]
      },
      favourite: {
        weight: 0.6,
        notes: [
          { freq: 880, at: 0, len: 0.25 },
          { freq: 1318.5, at: 0.05, len: 0.2, weight: 0.4 }
        ]
      }
    };
  }

  /** Пиковая громкость при soundVolume = 1. При 0.5 выходит 0.11 — как прежние 0.12. */
  static get PEAK() {
    return 0.22;
  }

  /** Прежняя громкость; оставлена для совместимости, если её кто-то читает. */
  static get VOLUME() {
    return 0.12;
  }

  /** Не чаще, чем раз в столько миллисекунд, для одного события. */
  static minGapMs(id) {
    return id === 'attention' ? 60 * 1000 : 1500;
  }

  /** Описание события по id или null. */
  static eventInfo(id) {
    return Chime.EVENTS.find(e => e.id === id) || null;
  }

  /**
   * Включено ли событие своим выключателем. Включённое по умолчанию
   * считается включённым, пока ключ не false; выключенное — пока ключ не
   * true. Так работает и до того, как ключи появятся в настройках.
   */
  static eventEnabled(id, getSetting) {
    const info = Chime.eventInfo(id);
    if (!info) return false;
    const value = typeof getSetting === 'function' ? getSetting(info.setting) : undefined;
    return info.defaultOn ? value !== false : value === true;
  }

  /**
   * Почему событие сейчас не звучит; null — звучит. Чистая функция, все
   * обстоятельства приходят снаружи.
   *   get        — чтение настройки по ключу
   *   quiet      — идут тихие часы
   *   gameActive — запущена игра (игровой режим)
   *   lastAt     — когда это событие звучало в прошлый раз
   */
  static muteReason(id, { get, quiet = false, gameActive = false, now = Date.now(), lastAt = 0, preview = false } = {}) {
    if (!Chime.PATTERNS[id]) return 'unknown';
    if (preview) return null;
    const read = typeof get === 'function' ? get : () => undefined;
    if (read('soundEnabled') === false) return 'sound-off';
    if (!Chime.eventEnabled(id, read)) return 'event-off';
    if (quiet) return 'quiet-hours';
    if (gameActive && id !== 'attention' && read('soundInGame') !== true) return 'in-game';
    if (lastAt && now - lastAt < Chime.minGapMs(id)) return 'too-often';
    return null;
  }

  /** Громкость из настроек: 0…1, по умолчанию 0.5. */
  static volumeFrom(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
  }

  ensureContext() {
    if (this.context) return this.context;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    try {
      this.context = new Ctor();
      // Общая громкость одной ручкой: ноты аккорда складываются, и без
      // общего узла их пришлось бы считать по отдельности
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);
    } catch (e) {
      console.warn('[Звук] Не удалось создать аудиоконтекст:', e.message);
      this.context = null;
      this.master = null;
      return null;
    }
    return this.context;
  }

  /**
   * Сыграть событие.
   * @param {string} id - drop | chest | allDone | attention | favourite
   * @param {{ preview?: boolean }} [options]
   * @returns {boolean} прозвучало ли
   */
  play(id, { preview = false } = {}) {
    // Прежняя форма play(notes, volume) — массив нот. Снаружи её никто не
    // зовёт, но разбирать её дешевле, чем ловить ошибку от забытого вызова
    if (Array.isArray(id)) {
      return this.playNotes({ weight: 1, notes: id }, Chime.volumeFrom(window.settings?.get?.('soundVolume')));
    }

    const settings = window.settings;
    const get = (key) => settings?.get?.(key);
    const now = Date.now();
    let quiet = false;
    try {
      quiet = !!window.QuietHours?.active?.();
    } catch (e) { /* без тихих часов звучим как обычно */ }

    const reason = Chime.muteReason(id, {
      get,
      quiet,
      gameActive: !!window.gameModeState?.active,
      now,
      lastAt: this.lastPlayedAt.get(id) || 0,
      preview
    });
    if (reason) {
      if (reason === 'quiet-hours' || reason === 'in-game') {
        console.log('[Звук] Сигнал «' + id + '» пропущен:', reason === 'quiet-hours' ? 'тихие часы' : 'идёт игра');
      }
      return false;
    }

    const played = this.playNotes(Chime.PATTERNS[id], Chime.volumeFrom(get('soundVolume')));
    if (played && !preview) this.lastPlayedAt.set(id, now);
    return played;
  }

  /** Прослушать событие из настроек: звучит всегда, с текущей громкостью. */
  preview(id) {
    return this.play(id, { preview: true });
  }

  /**
   * Сыграть мотив. Тембр «колокольчик»: основная волна плюс треугольник на
   * октаву выше на 15%; атака 8 мс, затухание по экспоненте до конца ноты.
   * Резкий старт и обрыв дают щелчок, поэтому края всегда плавные.
   */
  playNotes(pattern, volume) {
    if (!pattern || !Array.isArray(pattern.notes)) return false;
    if (!(volume > 0.001)) return false;

    const ctx = this.ensureContext();
    if (!ctx) return false;

    // Браузер держит контекст остановленным, пока не было действий
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    // Небольшой запас: нота, назначенная «на сейчас», теряет начало атаки
    const base = ctx.currentTime + 0.02;
    const wave = pattern.wave || 'sine';
    const patternWeight = Number(pattern.weight) || 1;

    try {
      for (const note of pattern.notes) {
        const peak = Chime.PEAK * volume * patternWeight * (note.weight ?? 1);
        const start = base + (note.at || 0);
        const end = start + Math.max(0.03, note.len || 0.1);
        this.voice(ctx, wave, note.freq, start, end, peak);
        this.voice(ctx, 'triangle', note.freq * 2, start, end, peak * 0.15);
      }
    } catch (e) {
      console.warn('[Звук] Сигнал не сыгран:', e.message);
      return false;
    }
    return true;
  }

  voice(ctx, type, freq, start, end, peak) {
    if (!(peak > 0)) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(this.master || ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  /** Награда получена. Прежнее имя: его зовут страницы. */
  dropClaimed() {
    return this.play('drop');
  }

  /** Что-то не получилось. Прежнее имя: его зовёт окно награды. */
  failed() {
    return this.play('attention');
  }
}

if (typeof window !== 'undefined') {
  window.Chime = Chime;
  window.chime = Chime.get();
}
