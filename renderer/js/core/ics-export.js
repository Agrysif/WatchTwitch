/**
 * IcsExport — сроки кампаний в виде файла для обычного календаря.
 *
 * Приложение знает, когда каждая кампания закончится, но знание это живёт
 * только внутри него: чтобы не пропустить дропс, надо было открыть
 * приложение и посмотреть. Файл .ics кладёт те же сроки в календарь на
 * телефоне или в почте, вместе с напоминанием за час.
 *
 * Формат придирчив к мелочам: переводы строк только CRLF, запятые и
 * точки с запятой в тексте экранируются, длинные строки складываются.
 * Ошибка в любом из этих мест — и календарь молча не откроет файл.
 */
class IcsExport {
  static get PRODID() {
    return '-//WatchTwitch//Drops Calendar//RU';
  }

  /** За сколько минут до конца кампании напомнить. */
  static get REMIND_BEFORE_MINUTES() {
    return 60;
  }

  /** Дата в виде 20260823T235959Z. */
  static stamp(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;

    const p = (n, len = 2) => String(n).padStart(len, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
           `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }

  /**
   * Экранирование текста поля.
   * Порядок важен: обратная косая черта заменяется первой, иначе она
   * испортит подставленные следом escape-последовательности.
   */
  static escapeText(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /**
   * Складывание длинных строк: по стандарту строка не длиннее 75 октетов,
   * продолжение начинается с пробела.
   */
  static fold(line) {
    if (line.length <= 75) return line;

    const parts = [line.slice(0, 75)];
    let rest = line.slice(75);
    while (rest.length > 74) {
      parts.push(' ' + rest.slice(0, 74));
      rest = rest.slice(74);
    }
    if (rest.length) parts.push(' ' + rest);

    return parts.join('\r\n');
  }

  /** Одно событие: окончание кампании. */
  static event(campaign, stampNow) {
    const ends = IcsExport.stamp(campaign?.endsAt || campaign?.endAt);
    if (!ends) return null;

    const game = campaign?.game?.displayName || campaign?.game?.name || campaign?.name || 'Кампания';
    const drops = Array.isArray(campaign?.drops) ? campaign.drops : [];
    const unclaimed = drops.filter(d => !d?.claimed).length;

    const uid = `${campaign?.id || game}@watchtwitch`.replace(/\s+/g, '-');

    const description = unclaimed > 0
      ? `Не забрано наград: ${unclaimed} из ${drops.length}`
      : 'Все награды получены';

    return [
      'BEGIN:VEVENT',
      `UID:${IcsExport.escapeText(uid)}`,
      `DTSTAMP:${stampNow}`,
      `DTSTART:${ends}`,
      `DTEND:${ends}`,
      `SUMMARY:${IcsExport.escapeText(game + ' — конец кампании дропсов')}`,
      `DESCRIPTION:${IcsExport.escapeText(description)}`,
      'BEGIN:VALARM',
      `TRIGGER:-PT${IcsExport.REMIND_BEFORE_MINUTES}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${IcsExport.escapeText(game + ': кампания скоро закончится')}`,
      'END:VALARM',
      'END:VEVENT'
    ];
  }

  /**
   * Собирает файл целиком.
   *
   * Закончившиеся кампании пропускаем: класть в календарь напоминание о
   * том, что уже прошло, незачем.
   */
  static build(campaigns, now = Date.now()) {
    const stampNow = IcsExport.stamp(now);

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:${IcsExport.PRODID}`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:WatchTwitch — дропсы'
    ];

    let added = 0;
    for (const campaign of campaigns || []) {
      const ends = new Date(campaign?.endsAt || campaign?.endAt).getTime();
      if (!Number.isFinite(ends) || ends <= now) continue;

      const event = IcsExport.event(campaign, stampNow);
      if (!event) continue;

      lines.push(...event);
      added++;
    }

    lines.push('END:VCALENDAR');

    return { text: lines.map(IcsExport.fold).join('\r\n') + '\r\n', events: added };
  }
}

if (typeof window !== 'undefined') {
  window.IcsExport = IcsExport;
}
