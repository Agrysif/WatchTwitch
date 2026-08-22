/**
 * QuietHours — промежуток, когда приложение молчит.
 *
 * Фарминг идёт ночью, а звук и уведомления добавлены недавно: сигнал о
 * награде в три часа будит, а не радует. По умолчанию включено — иначе
 * про эту настройку узнаёшь ровно тогда, когда она уже разбудила.
 *
 * Промежуток почти всегда переходит через полночь, поэтому проверка
 * написана с учётом этого случая, а не «от меньшего к большему».
 */
class QuietHours {
  static get DEFAULT_FROM() {
    return '23:00';
  }

  static get DEFAULT_TO() {
    return '09:00';
  }

  /** «23:00» → 1380 минут от полуночи. Неразбираемое значение даёт null. */
  static toMinutes(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m) return null;

    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
  }

  /**
   * Попадает ли момент в тихий промежуток.
   *
   * Промежуток «с 23:00 до 09:00» переходит через полночь: конец меньше
   * начала. В этом случае тихо снаружи отрезка, а не внутри — обычное
   * сравнение «больше начала и меньше конца» здесь не работает вовсе.
   * Совпадающие границы означают «молчать круглые сутки».
   */
  static isQuiet(date, from, to) {
    const start = QuietHours.toMinutes(from);
    const end = QuietHours.toMinutes(to);
    if (start === null || end === null) return false;

    const d = date instanceof Date ? date : new Date(date);
    const now = d.getHours() * 60 + d.getMinutes();

    if (start === end) return true;
    if (start < end) return now >= start && now < end;

    return now >= start || now < end;
  }

  /** Молчим ли прямо сейчас, по настройкам приложения. */
  static active(now = new Date()) {
    const settings = window.settings;
    if (!settings) return false;
    if (settings.get('quietHours') === false) return false;

    return QuietHours.isQuiet(
      now,
      settings.get('quietFrom') || QuietHours.DEFAULT_FROM,
      settings.get('quietTo') || QuietHours.DEFAULT_TO
    );
  }

  /** Понятное описание для настроек. */
  static describe(from, to) {
    const start = QuietHours.toMinutes(from);
    const end = QuietHours.toMinutes(to);
    if (start === null || end === null) return 'Промежуток задан неверно';
    if (start === end) return 'Приложение будет молчать круглые сутки';

    const через = start > end ? ' (через полночь)' : '';
    return `Молчит с ${from} до ${to}${через}`;
  }
}

if (typeof window !== 'undefined') {
  window.QuietHours = QuietHours;
}
