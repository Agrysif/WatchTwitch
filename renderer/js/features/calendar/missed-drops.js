/**
 * MissedDrops — что не удалось добрать до конца кампании.
 *
 * Раньше эти данные исчезали вместе с кампанией: Twitch выбрасывает
 * закончившиеся из ответа, и посмотреть, чего именно не хватило, было
 * негде. Теперь приложение ведёт свою память, и по ней видно не просто
 * «упущено семь наград», а на чём именно теряется время: награда, до
 * которой не дотянули двадцать минут, и награда, требовавшая ещё десять
 * часов, — это совсем разные поводы.
 */
class MissedDrops {
  /** До скольких минут недобора считаем, что награда была близко. */
  static get CLOSE_MINUTES() {
    return 60;
  }

  /** Награда упущена: кампания кончилась, а время не набрано. */
  static isMissed(drop) {
    if (!drop || drop.claimed) return false;

    const required = Number(drop.required) || 0;
    const progress = Number(drop.progress) || 0;

    // Награда, к которой не приступали вовсе, — не «упущенная», а просто
    // нетронутая: считать её потерей нечестно
    return required > 0 && progress > 0 && progress < required;
  }

  /**
   * Разбирает историю кампаний.
   *
   * Учитываются только закончившиеся: у идущей кампании ещё есть время,
   * и записывать её награды в потери рано.
   */
  static analyze(history, now = Date.now()) {
    const missed = [];

    for (const campaign of history || []) {
      const ends = new Date(campaign?.endsAt).getTime();
      if (!Number.isFinite(ends) || ends > now) continue;

      const game = campaign?.game?.displayName || campaign?.game?.name || campaign?.name || '';

      for (const drop of (campaign.drops || [])) {
        if (!MissedDrops.isMissed(drop)) continue;

        const short = (Number(drop.required) || 0) - (Number(drop.progress) || 0);
        missed.push({
          game,
          name: drop.name || 'Награда',
          shortBy: short,
          endsAt: campaign.endsAt
        });
      }
    }

    missed.sort((a, b) => a.shortBy - b.shortBy);

    const close = missed.filter(m => m.shortBy <= MissedDrops.CLOSE_MINUTES);

    const byGame = new Map();
    for (const item of missed) {
      byGame.set(item.game, (byGame.get(item.game) || 0) + 1);
    }

    return {
      total: missed.length,
      close: close.length,
      // Сумма недобора: сколько часов просмотра отделяло от всего разом
      shortMinutes: missed.reduce((sum, m) => sum + m.shortBy, 0),
      closest: missed.slice(0, 5),
      byGame: [...byGame.entries()]
        .map(([game, count]) => ({ game, count }))
        .sort((a, b) => b.count - a.count)
    };
  }

  /** Короткий вывод для интерфейса. */
  static describe(result) {
    if (!result || result.total === 0) return 'Ничего не упущено';

    const наград = result.total;
    const хвост = наград === 1 ? 'награда' : (наград < 5 ? 'награды' : 'наград');

    if (result.close === 0) return `Упущено ${наград} ${хвост}`;

    return `Упущено ${наград} ${хвост}, из них ${result.close} почти собрано`;
  }
}

if (typeof window !== 'undefined') {
  window.MissedDrops = MissedDrops;
}
