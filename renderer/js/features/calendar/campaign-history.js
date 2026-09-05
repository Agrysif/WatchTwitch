/**
 * CampaignHistory — память о кампаниях, которые Twitch уже забыл.
 *
 * Настройка «показывать завершённые кампании» существовала, но показать
 * ей было нечего: замер показал, что запрос инвентаря возвращает ноль
 * закончившихся — Twitch выбрасывает их из ответа сразу. Поэтому историю
 * приложение ведёт само: каждый раз, когда кампании загружаются, оно
 * запоминает их, и потом может показать те, что закончились, ответив на
 * вопрос «а что я пропустил».
 *
 * Хранится только то, что нужно для показа: название, обложка, сроки и
 * сколько наград было собрано. Прогресс не обновляется задним числом —
 * запись отражает последнее, что приложение видело.
 */
class CampaignHistory {
  static get KEY() {
    return 'campaignHistory';
  }

  /** Сколько записей держим: список не должен расти бесконечно. */
  static get LIMIT() {
    return 300;
  }

  /** Насколько давние завершённые кампании ещё интересны. */
  static get KEEP_DAYS() {
    return 30;
  }

  /** Урезает кампанию до того, что нужно для показа. */
  static trim(campaign) {
    const game = campaign?.game?.displayName || campaign?.game?.name || campaign?.name || '';
    const drops = Array.isArray(campaign?.drops) ? campaign.drops : [];

    return {
      id: campaign?.id || game,
      name: campaign?.name || game,
      game: {
        displayName: game,
        name: campaign?.game?.name || game,
        boxArtURL: campaign?.game?.boxArtURL || ''
      },
      startsAt: campaign?.startsAt || campaign?.startAt || null,
      endsAt: campaign?.endsAt || campaign?.endAt || null,
      drops: drops.map(d => ({
        name: d?.name || d?.benefitName || '',
        required: Number(d?.required) || 0,
        progress: Number(d?.progress) || 0,
        claimed: !!d?.claimed
      })),
      seenAt: null
    };
  }

  /**
   * Сливает свежие кампании с уже известными.
   *
   * Свежая запись всегда вытесняет старую: прогресс мог измениться.
   * Слишком давно закончившиеся и лишние сверх предела отбрасываются.
   */
  static merge(known, fresh, now) {
    const byId = new Map();

    for (const item of known || []) {
      if (item?.id) byId.set(item.id, item);
    }

    for (const campaign of fresh || []) {
      const trimmed = CampaignHistory.trim(campaign);
      if (!trimmed.id || !trimmed.endsAt) continue;

      // Не изменилась — оставляем прежнюю запись целиком. Иначе новая
      // отметка времени делала бы список «другим» при каждом слиянии, и
      // файл переписывался бы каждую минуту ради одного числа.
      const known = byId.get(trimmed.id);
      if (known && CampaignHistory.sameRecord(known, trimmed)) continue;

      trimmed.seenAt = now;
      byId.set(trimmed.id, trimmed);
    }

    const край = now - CampaignHistory.KEEP_DAYS * 86400000;

    return [...byId.values()]
      .filter(item => {
        const ends = new Date(item.endsAt).getTime();
        return Number.isFinite(ends) && ends > край;
      })
      .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime())
      .slice(0, CampaignHistory.LIMIT);
  }

  /** Одинаковы ли две записи, если не считать отметку времени. */
  static sameRecord(a, b) {
    return JSON.stringify({ ...a, seenAt: null }) === JSON.stringify({ ...b, seenAt: null });
  }

  /** Как часто память вообще стоит трогать. */
  static get MIN_WRITE_INTERVAL_MS() {
    return 10 * 60 * 1000;
  }

  /** Записи, у которых срок уже прошёл. */
  static ended(history, now) {
    return (history || []).filter(item => {
      const ends = new Date(item?.endsAt).getTime();
      return Number.isFinite(ends) && ends <= now;
    });
  }

  /**
   * Запоминает кампании. Ошибки хранилища не должны ломать загрузку.
   *
   * Инвентарь приходит каждую минуту, и прогресс в нём каждый раз чуть
   * другой. Переписывать ради этого 160 КБ файла каждую минуту незачем:
   * памяти хватает точности в десять минут. Ручное обновление (force)
   * пишет сразу. Если после слияния ничего не изменилось — не пишем.
   */
  static async remember(campaigns, now = Date.now(), options = {}) {
    if (!Array.isArray(campaigns) || campaigns.length === 0) return;

    const last = CampaignHistory._lastRememberAt || 0;
    if (!options.force && now - last < CampaignHistory.MIN_WRITE_INTERVAL_MS) return;

    try {
      const known = (await Storage.get(CampaignHistory.KEY, [])) || [];
      const merged = CampaignHistory.merge(known, campaigns, now);
      CampaignHistory._lastRememberAt = now;
      if (JSON.stringify(merged) === JSON.stringify(known)) return;
      await Storage.set(CampaignHistory.KEY, merged);
    } catch (error) {
      console.warn('[История кампаний] Не удалось сохранить:', error?.message);
    }
  }

  /** Все запомненные кампании — и текущие, и уже закончившиеся. */
  static async loadKnown() {
    try {
      return (await Storage.get(CampaignHistory.KEY, [])) || [];
    } catch (error) {
      console.warn('[История кампаний] Не удалось прочитать:', error?.message);
      return [];
    }
  }

  /** Завершённые кампании из памяти приложения. */
  static async loadEnded(now = Date.now()) {
    try {
      const known = (await Storage.get(CampaignHistory.KEY, [])) || [];
      return CampaignHistory.ended(known, now);
    } catch (error) {
      console.warn('[История кампаний] Не удалось прочитать:', error?.message);
      return [];
    }
  }
}

if (typeof window !== 'undefined') {
  window.CampaignHistory = CampaignHistory;
}
