/**
 * ЖУРНАЛ СОБЫТИЙ — хранилище и API window.eventLog.
 *
 * Зачем. Фарминг идёт ночью и в фоне, а утром непонятно, что было:
 * сколько наград, почему сменилась категория, не было ли ошибок. Тосты
 * исчезают через несколько секунд, системные уведомления глушатся тихими
 * часами. Журнал помнит всё это две недели.
 *
 * Хранение — ключ eventLog в общем хранилище:
 *   { v: 1, lastSeenAt, summaryAt, entries: [новые первыми] }
 * Не больше 400 записей и не старше 14 дней (обрезается при записи). На
 * диск пишем пачкой через 2 секунды после последнего события и сразу при
 * закрытии окна: награды приходят сериями, и писать файл на каждую — лишняя
 * работа диска посреди ночи. В резервную копию журнал не входит: это
 * история, а не настройки.
 *
 * API (контракт 2 спецификации):
 *   eventLog.add({ type, title, detail?, game?, icon? }) — синхронно, не бросает
 *   eventLog.list({ since?, limit?, types? }) → Promise<Entry[]>, новые первыми
 *   eventLog.markSeen()            — всё до этого момента просмотрено
 *   eventLog.onChange(cb) → отписка
 * Вызывающие пишут window.eventLog?.add(…) одной строкой: журнал — не
 * часть логики фарминга, и его сбой не должен её задевать.
 *
 * DOM здесь не нужен совсем: файл можно грузить и без окна.
 */
class EventLog {
  static get KEY() {
    return 'eventLog';
  }

  static get MAX_ENTRIES() {
    return 400;
  }

  static get MAX_AGE_MS() {
    return 14 * 24 * 60 * 60 * 1000;
  }

  static get SAVE_DELAY_MS() {
    return 2000;
  }

  /** Одинаковые type+title за минуту — одна запись (сбой повторяется сериями). */
  static get MERGE_MS() {
    return 60 * 1000;
  }

  /**
   * Сундуки подряд — одна строка «Сундуков собрано: 5». Они приходят каждые
   * 15 минут, и за ночь три десятка одинаковых строк закрыли бы награды
   * и смены категорий. Подряд — значит без других событий между ними.
   */
  static get CHEST_MERGE_MS() {
    return 3 * 60 * 60 * 1000;
  }

  static get TYPES() {
    return ['drop', 'chest', 'switch', 'start', 'stop', 'warning', 'error', 'login',
      'all-done', 'game-mode', 'favourite-live'];
  }

  /** Важные: по ним загорается значок журнала в заголовке окна. */
  static get IMPORTANT() {
    return ['drop', 'all-done', 'error', 'login'];
  }

  /** Проблемы: фильтр «Проблемы» и счётчик в сводке. */
  static get PROBLEMS() {
    return ['warning', 'error', 'login'];
  }

  static text(value, max) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /**
   * Приводит запись к виду хранилища или возвращает null. Картинка — только
   * https: адрес уходит в <img src>, и file: или javascript: там не нужны.
   */
  static normalize(input, now = Date.now()) {
    if (!input || typeof input !== 'object') return null;
    const title = EventLog.text(input.title, 160);
    if (!title) return null;

    const type = EventLog.text(input.type, 24) || 'warning';
    const at = Number.isFinite(input.at) && input.at > 0 && input.at <= now ? input.at : now;
    const entry = {
      id: at.toString(36) + Math.random().toString(36).slice(2, 7),
      at,
      type,
      title
    };

    const detail = EventLog.text(input.detail, 300);
    if (detail) entry.detail = detail;
    const game = EventLog.text(input.game, 120);
    if (game) entry.game = game;
    const icon = typeof input.icon === 'string' ? input.icon.trim() : '';
    if (/^https:\/\//i.test(icon) && icon.length <= 600) entry.icon = icon;

    const count = Math.floor(Number(input.count));
    if (count > 1) entry.count = Math.min(count, 9999);

    if (type === 'chest') {
      // Баллы приходят и числом, и строкой «+50»
      let points = Number(input.points);
      if (!Number.isFinite(points)) {
        const match = String(input.detail ?? '').match(/[+]?\s*(\d[\d\s]*)/);
        points = match ? Number(match[1].replace(/\s/g, '')) : 0;
      }
      if (points > 0) entry.points = Math.min(Math.round(points), 1e7);
    }
    return entry;
  }

  /** Только записи нужного вида, не старше 14 дней и не больше 400. */
  static trim(entries, now = Date.now()) {
    const oldest = now - EventLog.MAX_AGE_MS;
    return entries
      .filter(e => e && typeof e.title === 'string' && Number.isFinite(e.at) && e.at >= oldest)
      .slice(0, EventLog.MAX_ENTRIES);
  }

  /**
   * Добавляет запись в начало списка, склеивая её с предыдущей, если это
   * повтор. Чистая функция: возвращает новый массив.
   */
  static insert(entries, entry, now = Date.now()) {
    const list = Array.isArray(entries) ? entries : [];
    const head = list[0];

    if (head && head.type === 'chest' && entry.type === 'chest' && entry.at - head.at < EventLog.CHEST_MERGE_MS) {
      const merged = {
        ...head,
        at: entry.at,
        count: (head.count || 1) + (entry.count || 1),
        points: (head.points || 0) + (entry.points || 0)
      };
      if (!merged.points) delete merged.points;
      if (entry.detail) merged.detail = entry.detail;
      return EventLog.trim([merged, ...list.slice(1)], now);
    }

    if (head && head.type === entry.type && head.title === entry.title && entry.at - head.at < EventLog.MERGE_MS) {
      const merged = {
        ...head,
        at: entry.at,
        count: (head.count || 1) + 1
      };
      if (entry.detail) merged.detail = entry.detail;
      if (entry.game) merged.game = entry.game;
      if (entry.icon) merged.icon = entry.icon;
      return EventLog.trim([merged, ...list.slice(1)], now);
    }

    return EventLog.trim([entry, ...list], now);
  }

  /** Состояние из хранилища. Нет журнала — начинаем «всё просмотрено». */
  static fromStored(raw, now = Date.now()) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) {
      return { v: 1, lastSeenAt: now, summaryAt: 0, entries: [] };
    }
    const entries = EventLog.trim(raw.entries
      .map(e => (e && typeof e === 'object' && e.id ? e : null))
      .filter(Boolean)
      .sort((a, b) => b.at - a.at), now);
    return {
      v: 1,
      lastSeenAt: Number.isFinite(raw.lastSeenAt) ? raw.lastSeenAt : now,
      summaryAt: Number.isFinite(raw.summaryAt) ? raw.summaryAt : 0,
      entries
    };
  }

  /** Сколько записей важных типов появилось после отметки. */
  static countUnseen(entries, lastSeenAt, types = EventLog.IMPORTANT) {
    if (!Array.isArray(entries)) return 0;
    let n = 0;
    for (const e of entries) {
      if (e.at <= lastSeenAt) break;
      if (types.includes(e.type)) n += 1;
    }
    return n;
  }

  constructor() {
    this.state = { v: 1, lastSeenAt: Date.now(), summaryAt: 0, entries: [] };
    this.loaded = false;
    this.loading = null;
    // События, пришедшие до чтения журнала с диска: фарминг может
    // восстановить сессию раньше, чем ответит хранилище
    this.pending = [];
    this.listeners = new Set();
    this.saveTimer = null;
  }

  /** Читает журнал с диска один раз; повторные вызовы ждут того же чтения. */
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let raw = null;
      try {
        raw = await window.electronAPI?.storeGet?.(EventLog.KEY);
      } catch (e) {
        console.warn('[Журнал] Не прочитан:', e?.message);
      }
      const now = Date.now();
      this.state = EventLog.fromStored(raw, now);
      this.loaded = true;
      if (this.pending.length) {
        for (const entry of this.pending) this.state.entries = EventLog.insert(this.state.entries, entry, now);
        this.pending = [];
        this.scheduleSave();
      }
      this.emit();
      return this.state;
    })();
    return this.loading;
  }

  add(input) {
    try {
      const entry = EventLog.normalize(input);
      if (!entry) return null;
      if (!this.loaded) {
        this.pending.push(entry);
        this.load();
        return entry;
      }
      this.state.entries = EventLog.insert(this.state.entries, entry);
      this.scheduleSave();
      this.emit();
      return entry;
    } catch (e) {
      console.warn('[Журнал] Запись не добавлена:', e?.message);
      return null;
    }
  }

  async list({ since = 0, limit = EventLog.MAX_ENTRIES, types = null } = {}) {
    await this.load();
    return this.entriesSync({ since, limit, types });
  }

  /** То же, что list, но без ожидания: до чтения с диска — пусто. */
  entriesSync({ since = 0, limit = EventLog.MAX_ENTRIES, types = null } = {}) {
    const wanted = Array.isArray(types) && types.length ? types : null;
    const out = [];
    for (const e of this.state.entries) {
      if (e.at <= since) break;
      if (wanted && !wanted.includes(e.type)) continue;
      out.push({ ...e });
      if (out.length >= limit) break;
    }
    return out;
  }

  get lastSeenAt() {
    return this.state.lastSeenAt || 0;
  }

  get summaryAt() {
    return this.state.summaryAt || 0;
  }

  /** Сколько важных событий пользователь ещё не видел. */
  unseenCount() {
    return EventLog.countUnseen(this.state.entries, this.lastSeenAt);
  }

  markSeen() {
    this.state.lastSeenAt = Date.now();
    this.scheduleSave();
    this.emit();
  }

  /** Сводка «Пока вас не было» показана: следующая — только о новом. */
  markSummarized() {
    this.state.summaryAt = Date.now();
    this.scheduleSave();
  }

  clear() {
    this.state.entries = [];
    this.pending = [];
    this.state.lastSeenAt = Date.now();
    this.save();
    this.emit();
  }

  onChange(callback) {
    if (typeof callback !== 'function') return () => {};
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit() {
    for (const cb of [...this.listeners]) {
      try {
        cb(this);
      } catch (e) {
        console.warn('[Журнал] Ошибка подписчика:', e?.message);
      }
    }
  }

  scheduleSave() {
    if (!this.loaded) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), EventLog.SAVE_DELAY_MS);
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.loaded) return;
    try {
      const result = window.electronAPI?.storeSet?.(EventLog.KEY, {
        v: 1,
        lastSeenAt: this.state.lastSeenAt,
        summaryAt: this.state.summaryAt,
        entries: this.state.entries
      });
      result?.catch?.(e => console.warn('[Журнал] Не сохранён:', e?.message));
    } catch (e) {
      console.warn('[Журнал] Не сохранён:', e?.message);
    }
  }

  /** Записать отложенное сразу: окно закрывается. */
  flush() {
    if (this.saveTimer) this.save();
  }
}

if (typeof window !== 'undefined') {
  window.EventLog = EventLog;
  window.eventLog = window.eventLog || new EventLog();
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', () => window.eventLog.flush());
  }
}
