/**
 * Chime — короткий сигнал о событии.
 *
 * Флаг playSound в уведомлениях существовал, но звука за ним никогда не
 * было. Звук синтезируется на месте, а не берётся файлом: приложение и
 * так весит восемьдесят мегабайт, а нужен один аккорд на полсекунды.
 *
 * Играет только по действию пользователя или по событию фарминга, всегда
 * тихо и всегда коротко: сигнал должен сообщать, а не пугать в три ночи.
 */
class Chime {
  static get() {
    if (!window._chime) window._chime = new Chime();
    return window._chime;
  }

  constructor() {
    this.context = null;
  }

  /** Громкость по умолчанию: заметно, но не громче самого стрима. */
  static get VOLUME() {
    return 0.12;
  }

  ensureContext() {
    if (this.context) return this.context;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    try {
      this.context = new Ctor();
    } catch (e) {
      console.warn('[Звук] Не удалось создать аудиоконтекст:', e.message);
      return null;
    }
    return this.context;
  }

  /**
   * Проигрывает последовательность нот.
   * @param {Array<{freq: number, at: number, len: number}>} notes
   */
  play(notes, volume = Chime.VOLUME) {
    // Настройка «Звуковые уведомления» в приложении была всегда, но за
    // ней не стояло ни одного звука. Оживляем её, а не заводим вторую
    if (window.settings?.get('soundEnabled') === false) return;

    // Ночью фарминг идёт сам, и сигнал о награде только будит
    if (window.QuietHours?.active()) {
      console.log('[Звук] Тихие часы — сигнал пропущен');
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    // Браузер держит контекст остановленным, пока не было действий
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = note.freq;

      // Плавные края: резкий старт и обрыв дают щелчок
      const start = now + note.at;
      const end = start + note.len;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }

  /** Награда получена: короткий восходящий аккорд. */
  dropClaimed() {
    this.play([
      { freq: 587.33, at: 0, len: 0.13 },    // ре
      { freq: 783.99, at: 0.11, len: 0.15 }, // соль
      { freq: 1046.5, at: 0.24, len: 0.28 }  // до
    ]);
  }

  /** Что-то не получилось: две низкие ноты вниз. */
  failed() {
    this.play([
      { freq: 392.0, at: 0, len: 0.14 },
      { freq: 293.66, at: 0.13, len: 0.24 }
    ], Chime.VOLUME * 0.8);
  }
}

if (typeof window !== 'undefined') {
  window.Chime = Chime;
  window.chime = Chime.get();
}
