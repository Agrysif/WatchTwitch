/**
 * CampaignCalendar — раскладка кампаний по срокам.
 *
 * Приложение видит сотню с лишним кампаний со сроками начала и конца, но
 * до сих пор молчало о них: узнать, что одна игра идёт ещё одиннадцать
 * дней, а другая кончается сегодня к ночи, было неоткуда. Здесь эти даты
 * превращаются в понятные группы.
 *
 * Дни считаются календарные, а не сутками по 24 часа: «завтра» должно
 * означать завтра, даже если до него сорок минут.
 */
class CampaignCalendar {
  /** Начало суток для указанного момента. */
  static startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Разница в календарных днях: 0 — сегодня, 1 — завтра, -1 — вчера.
   * Считаем по границам суток, иначе «завтра» зависело бы от времени суток.
   */
  static daysUntil(value, now = Date.now()) {
    const target = new Date(value).getTime();
    if (!Number.isFinite(target)) return null;

    const diff = CampaignCalendar.startOfDay(target) - CampaignCalendar.startOfDay(now);
    return Math.round(diff / 86400000);
  }

  /** Кампания ещё не началась. */
  static isUpcoming(campaign, now = Date.now()) {
    const starts = campaign?.startsAt || campaign?.startAt;
    if (!starts) return false;

    const time = new Date(starts).getTime();
    return Number.isFinite(time) && time > now;
  }

  /**
   * В какую группу попадает кампания.
   *
   *   'upcoming' — ещё не началась;
   *   'ended'    — уже закончилась;
   *   'today' / 'tomorrow' — заканчивается сегодня или завтра;
   *   'week'     — на этой неделе (до семи дней);
   *   'later'    — дальше.
   */
  static bucketFor(campaign, now = Date.now()) {
    const ends = campaign?.endsAt || campaign?.endAt;
    if (!ends) return 'later';

    const time = new Date(ends).getTime();
    if (!Number.isFinite(time)) return 'later';
    if (time <= now) return 'ended';

    if (CampaignCalendar.isUpcoming(campaign, now)) return 'upcoming';

    const days = CampaignCalendar.daysUntil(time, now);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days <= 7) return 'week';
    return 'later';
  }

  /** Порядок групп на экране: сначала то, что горит. */
  static get ORDER() {
    return ['today', 'tomorrow', 'week', 'later', 'upcoming'];
  }

  static get TITLES() {
    return {
      today: 'Заканчивается сегодня',
      tomorrow: 'Заканчивается завтра',
      week: 'На этой неделе',
      later: 'Ещё не скоро',
      upcoming: 'Скоро начнётся'
    };
  }

  /**
   * Раскладывает кампании по группам.
   *
   * Закончившиеся отбрасываются: показывать их незачем. Внутри группы
   * сортировка по сроку — ближайшее вверху; у ещё не начавшихся по дате
   * начала, там важно противоположное.
   */
  static group(campaigns, now = Date.now()) {
    const groups = {};
    for (const key of CampaignCalendar.ORDER) groups[key] = [];

    for (const campaign of campaigns || []) {
      const bucket = CampaignCalendar.bucketFor(campaign, now);
      if (bucket === 'ended') continue;
      groups[bucket].push(campaign);
    }

    const timeOf = (c, upcoming) => new Date(
      upcoming ? (c.startsAt || c.startAt) : (c.endsAt || c.endAt)
    ).getTime() || 0;

    for (const key of CampaignCalendar.ORDER) {
      groups[key].sort((a, b) => timeOf(a, key === 'upcoming') - timeOf(b, key === 'upcoming'));
    }

    return groups;
  }

  /** Человеческий остаток времени: «11 дней», «4ч 20м», «17 мин». */
  static formatLeft(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 'завершена';

    const days = Math.floor(minutes / 1440);
    if (days >= 1) {
      const hours = Math.floor((minutes - days * 1440) / 60);
      return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    if (hours > 0) return rest > 0 ? `${hours}ч ${rest}м` : `${hours}ч`;
    return `${Math.max(1, rest)} мин`;
  }
}

if (typeof window !== 'undefined') {
  window.CampaignCalendar = CampaignCalendar;
}
