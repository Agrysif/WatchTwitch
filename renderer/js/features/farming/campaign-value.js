/**
 * CampaignValue — успеет ли кампания принести награду и насколько она выгодна.
 *
 * Появился после ночи, проведённой приложением впустую: фарминг шёл семь
 * часов на кампании, где из двух наград одна была уже получена, а вторая
 * недостижима — до конца кампании оставалось меньше времени, чем требовал
 * оставшийся дропс. Переключение срабатывало только при условии «получены
 * все награды», и оно не выполнялось никогда.
 *
 * Две величины:
 *
 *   успеваемость — влезает ли ближайшая незабранная награда в остаток
 *                  времени кампании. Если нет, фармить бессмысленно;
 *   выгодность   — сколько наград реально возьмётся за час просмотра.
 *
 * Важное свойство данных Twitch: прогресс внутри кампании общий. Награды
 * на 60, 120 и 180 минут показывают одно и то же число просмотренных минут,
 * то есть минута просмотра двигает их все разом. Поэтому «сколько успеем»
 * считается точно, а не оценочно.
 *
 * Время везде в минутах.
 */
class CampaignValue {
  /** Окно, за которое считаем выгодность. */
  static get WINDOW_MINUTES() {
    return 60;
  }

  /**
   * Награда уже получена или уже заработана и ждёт получения.
   *
   * Полей несколько, потому что Twitch отдаёт готовность награды по-разному
   * в зависимости от запроса, а приложение сводит их в свой формат.
   */
  static isEarned(drop) {
    if (!drop) return false;
    return !!(
      drop.claimed ||
      drop.canClaim ||
      drop.isClaimable ||
      drop.claimable ||
      drop.isUnlocked ||
      (drop.required > 0 && drop.progress >= drop.required)
    );
  }

  /** Сколько минут осталось до конца кампании. Без срока — бесконечность. */
  static minutesLeft(campaign, now = Date.now()) {
    if (!campaign || !campaign.endsAt) return Infinity;

    const ends = new Date(campaign.endsAt).getTime();
    if (!Number.isFinite(ends)) return Infinity;

    return (ends - now) / 60000;
  }

  /** Сколько минут просмотра требует награда сверх уже набранного. */
  static minutesNeeded(drop) {
    const required = Number(drop?.required) || 0;
    const progress = Number(drop?.progress) || 0;
    return Math.max(0, required - progress);
  }

  /** Незабранные награды кампании. */
  static unclaimedDrops(campaign) {
    return (campaign?.drops || []).filter(d => !CampaignValue.isEarned(d));
  }

  /**
   * Сколько наград возьмётся за `minutes` минут просмотра.
   *
   * Ограничено и заказанным окном, и остатком времени кампании: смотреть
   * дольше, чем она живёт, бессмысленно.
   */
  static dropsWithin(campaign, minutes, now = Date.now()) {
    const budget = Math.min(minutes, CampaignValue.minutesLeft(campaign, now));
    if (!(budget > 0)) return 0;

    return CampaignValue.unclaimedDrops(campaign)
      .filter(d => CampaignValue.minutesNeeded(d) <= budget)
      .length;
  }

  /**
   * Полная оценка кампании.
   *
   * reason:
   *   'ok'      — есть что фармить и мы успеваем;
   *   'done'    — незабранных наград не осталось;
   *   'expired' — кампания уже закончилась;
   *   'tooLate' — награды есть, но ближайшая не влезает в остаток времени.
   */
  static evaluate(campaign, now = Date.now()) {
    const minutesLeft = CampaignValue.minutesLeft(campaign, now);
    const unclaimed = CampaignValue.unclaimedDrops(campaign);

    const needed = unclaimed.map(CampaignValue.minutesNeeded);
    const minNeeded = needed.length ? Math.min(...needed) : Infinity;

    const perHour = CampaignValue.dropsWithin(campaign, CampaignValue.WINDOW_MINUTES, now);

    let reason;
    if (unclaimed.length === 0) reason = 'done';
    else if (minutesLeft <= 0) reason = 'expired';
    else if (minNeeded > minutesLeft) reason = 'tooLate';
    else reason = 'ok';

    return {
      minutesLeft,
      unclaimedCount: unclaimed.length,
      minNeeded,
      perHour,
      reachable: CampaignValue.dropsWithin(campaign, Infinity, now),
      feasible: reason === 'ok',
      reason
    };
  }

  /**
   * Сравнение кампаний для сортировки: выгоднее — раньше.
   *
   * Сначала те, где вообще есть смысл фармить. Дальше — где за час
   * возьмётся больше наград. При равной выгоде вперёд идёт та, что
   * заканчивается раньше: долгоиграющая никуда не денется, а горящую
   * потом уже не догнать.
   */
  static compare(a, b, now = Date.now()) {
    const ea = CampaignValue.evaluate(a, now);
    const eb = CampaignValue.evaluate(b, now);

    if (ea.feasible !== eb.feasible) return ea.feasible ? -1 : 1;
    if (ea.perHour !== eb.perHour) return eb.perHour - ea.perHour;

    if (ea.minutesLeft !== eb.minutesLeft) return ea.minutesLeft - eb.minutesLeft;
    return 0;
  }

  /**
   * Лучшая кампания из списка или null, если фармить негде.
   *
   * Безнадёжные не возвращаются никогда — в этом весь смысл: приложение
   * не должно тратить ночь на кампанию, которая всё равно не успеет.
   */
  static best(campaigns, now = Date.now()) {
    const worthwhile = (campaigns || []).filter(c => CampaignValue.evaluate(c, now).feasible);
    if (!worthwhile.length) return null;

    return worthwhile.slice().sort((a, b) => CampaignValue.compare(a, b, now))[0];
  }

  /**
   * Пора ли уходить из категории.
   *
   * Истина, когда ни одна из кампаний игры больше ничего не принесёт:
   * всё забрано, кампания кончилась или ближайшая награда не влезает в
   * остаток времени. Пустой список ничего не значит — данные могли
   * просто не загрузиться, и бросать категорию из-за этого нельзя.
   */
  static shouldLeave(campaigns, now = Date.now()) {
    const list = campaigns || [];
    if (!list.length) return false;

    return !list.some(c => CampaignValue.evaluate(c, now).feasible);
  }

  /**
   * Ближайшая награда среди всех кампаний игры.
   *
   * «Ближайшая» — по оставшемуся времени просмотра, а не по порядку в
   * списке: награды выдаются по мере набора минут, и первой придёт та,
   * которой меньше всего не хватает.
   */
  static nextDrop(campaigns, now = Date.now()) {
    let best = null;

    for (const campaign of campaigns || []) {
      if (CampaignValue.minutesLeft(campaign, now) <= 0) continue;

      for (const drop of CampaignValue.unclaimedDrops(campaign)) {
        const minutesNeeded = CampaignValue.minutesNeeded(drop);
        if (!best || minutesNeeded < best.minutesNeeded) {
          best = { drop, campaign, minutesNeeded };
        }
      }
    }

    return best;
  }

  /**
   * Шкала кампании по времени просмотра и отметки выдачи наград.
   *
   * Считаем именно по времени, а не по среднему проценту наград. Прогресс
   * внутри кампании общий, поэтому средний процент — величина без
   * наглядного смысла: у наград на 60 и 300 минут при 12 просмотренных
   * он даёт 20% и 4%, а их среднее ни на что не указывает. На шкале
   * времени отметка каждой награды встаёт ровно туда, где её выдадут.
   */
  static timeline(campaign) {
    const drops = (campaign?.drops || []).filter(d => Number(d.required) > 0);
    if (!drops.length) return { percent: 0, marks: [] };

    const longest = Math.max(...drops.map(d => Number(d.required) || 0));
    if (!(longest > 0)) return { percent: 0, marks: [] };

    // Прогресс общий, но у забранных наград он может быть подрезан
    // до требуемого — берём наибольший как истинное время просмотра
    const watched = Math.max(...drops.map(d => Number(d.progress) || 0));

    const marks = drops
      .map(drop => ({
        percent: Math.min(100, (Number(drop.required) / longest) * 100),
        name: drop.name || drop.benefitName || 'Награда',
        earned: CampaignValue.isEarned(drop),
        minutesNeeded: CampaignValue.minutesNeeded(drop)
      }))
      .sort((a, b) => a.percent - b.percent);

    return { percent: Math.min(100, (watched / longest) * 100), watched, longest, marks };
  }

  /**
   * Сколько минут просмотра нужно, чтобы забрать всё достижимое.
   *
   * Считаем по самой дальней награде, которую ещё успеваем: прогресс
   * внутри кампании общий, поэтому остальные наберутся попутно.
   * Недостижимые в расчёт не идут — иначе прогноз обещал бы то, чего
   * не будет. null означает «брать нечего».
   */
  static minutesToFinish(campaigns, now = Date.now()) {
    let longest = null;

    for (const campaign of campaigns || []) {
      const left = CampaignValue.minutesLeft(campaign, now);
      if (left <= 0) continue;

      for (const drop of CampaignValue.unclaimedDrops(campaign)) {
        const needed = CampaignValue.minutesNeeded(drop);
        if (needed > left) continue;
        if (longest === null || needed > longest) longest = needed;
      }
    }

    return longest;
  }

  /**
   * Сколько наград успеется забрать за отведённое время.
   *
   * Нужно для плана к автовыключению: до срабатывания таймера остаётся
   * известное число минут, и заранее видно, что из этого выйдет.
   */
  static dropsBefore(campaigns, minutes, now = Date.now()) {
    let count = 0;
    for (const campaign of campaigns || []) {
      count += CampaignValue.dropsWithin(campaign, minutes, now);
    }
    return count;
  }

  /** Сколько всего незабранных наград ещё достижимо. */
  static reachableCount(campaigns, now = Date.now()) {
    return CampaignValue.dropsBefore(campaigns, Infinity, now);
  }

  /** Короткое пояснение для интерфейса. */
  static describe(evaluation) {
    switch (evaluation.reason) {
      case 'done':
        return 'Все награды получены';
      case 'expired':
        return 'Кампания закончилась';
      case 'tooLate': {
        const need = Math.ceil(evaluation.minNeeded);
        const left = Math.max(0, Math.floor(evaluation.minutesLeft));
        return `Не успеть: нужно ${need} мин, осталось ${left}`;
      }
      default:
        return evaluation.perHour > 0
          ? `За час наград: ${evaluation.perHour}`
          : 'Награда дальше часа просмотра';
    }
  }
}

if (typeof window !== 'undefined') {
  window.CampaignValue = CampaignValue;
}
