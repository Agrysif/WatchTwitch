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

  /** Записи, у которых срок уже прошёл. */
  static ended(history, now) {
    return (history || []).filter(item => {
      const ends = new Date(item?.endsAt).getTime();
      return Number.isFinite(ends) && ends <= now;
    });
  }

  /** Запоминает кампании. Ошибки хранилища не должны ломать загрузку. */
  static async remember(campaigns, now = Date.now()) {
    if (!Array.isArray(campaigns) || campaigns.length === 0) return;

    try {
      const known = (await Storage.get(CampaignHistory.KEY, [])) || [];
      const merged = CampaignHistory.merge(known, campaigns, now);
      await Storage.set(CampaignHistory.KEY, merged);
    } catch (error) {
      console.warn('[История кампаний] Не удалось сохранить:', error?.message);
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
