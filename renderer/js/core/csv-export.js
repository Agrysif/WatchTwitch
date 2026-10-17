/**
 * CsvExport — статистика сессий в виде таблицы.
 *
 * Кнопка экспорта в статистике отдавала JSON целиком: для человека это
 * нечитаемо, а в таблицу не вставить. Теперь — CSV с разделителем «;»
 * и меткой BOM: такой файл русский Excel открывает двойным щелчком без
 * вопросов про кодировку и разделители.
 */
class CsvExport {
  /**
   * Таблица для английского интерфейса. Excel с английскими настройками
   * делит строку по запятой и ждёт десятичную точку: «;» и «50,0» он
   * оставил бы одной колонкой текста.
   */
  static get english() {
    return typeof tr === 'function' && tr.lang() === 'en';
  }

  static get SEPARATOR() {
    return CsvExport.english ? ',' : ';';
  }

  static get HEADERS() {
    // Файл подключают и без окна (module.exports) — там перевода нет
    const tr = typeof globalThis.tr === 'function' ? globalThis.tr : (text) => text;
    return [tr('Дата'), tr('Начало'), tr('Минут'), tr('Категория'), tr('Канал'), tr('Баллы'), tr('Сундуки'), tr('Дропсы'), tr('Трафик, МБ')];
  }

  /** Поле CSV: кавычки удваиваются, значения с разделителями — в кавычках. */
  static escape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const special = CsvExport.SEPARATOR === ',' ? /[",\n\r]/ : /[";\n\r]/;
    if (special.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  static pad(n) {
    return String(n).padStart(2, '0');
  }

  static formatDate(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    // В английской таблице — ГГГГ-ММ-ДД: такую дату Excel узнаёт при любых
    // региональных настройках, а «05/09» в США и Британии — разные дни
    if (CsvExport.english) {
      return d.getFullYear() + '-' + CsvExport.pad(d.getMonth() + 1) + '-' + CsvExport.pad(d.getDate());
    }
    return CsvExport.pad(d.getDate()) + '.' + CsvExport.pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  static formatTime(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return CsvExport.pad(d.getHours()) + ':' + CsvExport.pad(d.getMinutes());
  }

  /** Одна сессия → массив полей в порядке HEADERS. */
  static row(session) {
    const s = session || {};
    const mb = Number(s.bandwidth) > 0 ? (Number(s.bandwidth) / 1048576).toFixed(1).replace('.', CsvExport.english ? '.' : ',') : '0';
    return [
      CsvExport.formatDate(s.timestamp),
      CsvExport.formatTime(s.timestamp),
      Number(s.duration) || 0,
      s.category || '',
      s.channel || '',
      Number(s.pointsEarned) || 0,
      Number(s.chestsCollected) || 0,
      Number(s.dropsCollected) || 0,
      mb
    ];
  }

  /** Полный текст файла: BOM, заголовок, строки — свежие сверху. */
  static sessions(sessions) {
    const list = Array.isArray(sessions) ? sessions.slice().reverse() : [];
    const lines = [CsvExport.HEADERS.map(CsvExport.escape).join(CsvExport.SEPARATOR)];
    for (const session of list) {
      lines.push(CsvExport.row(session).map(CsvExport.escape).join(CsvExport.SEPARATOR));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  static fileName(now = new Date()) {
    const d = now;
    return 'watchtwitch-sessions-' + d.getFullYear() + '-' + CsvExport.pad(d.getMonth() + 1) + '-' + CsvExport.pad(d.getDate()) + '.csv';
  }
}

if (typeof window !== 'undefined') {
  window.CsvExport = CsvExport;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CsvExport;
}
