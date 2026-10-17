// Окно награды: картинка, редкость, прогресс и срок кампании.
//
// Открывают и страница «Дропсы», и панель наград на «Фарминге» — поэтому
// окно не полагается на конкретную страницу: всё, что нужно от неё
// (редкость, формат чисел, полученные награды), берётся необязательно.
//
// Вид — общий .dialog из main.css и правила page-drops.css. Прежние 3D-
// наклон за мышью, размытая подложка из картинки, рамка и свечение цвета
// редкости и «Сложность ★★» убраны: окно должно отвечать «что это и
// сколько осталось», а не показывать эффекты.
(function() {
  'use strict';

  // Названия наград и игр приходят от Twitch (их задаёт разработчик игры).
  // Вставленные в innerHTML как есть, они становились разметкой и могли
  // выполнить код с доступом к electronAPI.
  const esc = (text) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(text)
    : String(text ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch])));

  // Адрес картинки стоит в src: кавычка или скобка в нём дописывала бы
  // свою разметку. Пропускаем только http(s) и data:image, опасные
  // символы кодируем.
  const safeImageUrl = (url) => {
    const value = String(url || '');
    if (!/^(https?:|data:image\/)/i.test(value)) return '';
    return value.replace(/["'()\\\s<>]/g,
      ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  };

  const icon = (name, size = 16) => window.Icons?.get(name, size) ?? '';

  // «2 ч», «45 мин», «1 ч 30 мин» — единицы через пробел
  const formatMinutes = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return tr('{m} мин', { m });
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? tr('{h} ч {m} мин', { h, m: rest }) : tr('{h} ч', { h });
  };

  const validDate = (raw) => {
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  // «9–18 октября», «28 сентября – 5 октября»; год — только если не текущий
  const formatRange = (startRaw, endRaw) => {
    const start = validDate(startRaw);
    const end = validDate(endRaw);
    const thisYear = new Date().getFullYear();
    const fmt = (date) => date.toLocaleDateString(tr.locale(), date.getFullYear() === thisYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
    if (start && end) {
      // В английском месяц стоит перед числом («October 9–18»): общий
      // месяц выносит сам Intl
      if (tr.lang() === 'en') {
        const withYear = start.getFullYear() !== thisYear || end.getFullYear() !== thisYear;
        try {
          return new Intl.DateTimeFormat(tr.locale(), withYear
            ? { day: 'numeric', month: 'long', year: 'numeric' }
            : { day: 'numeric', month: 'long' }).formatRange(start, end);
        } catch (error) {
          return `${fmt(start)} – ${fmt(end)}`;
        }
      }
      if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
        return `${start.getDate()}–${fmt(end)}`;
      }
      return `${fmt(start)} – ${fmt(end)}`;
    }
    if (end) return tr('до {date}', { date: fmt(end) });
    if (start) return tr('с {date}', { date: fmt(start) });
    return '';
  };

  window.showDropDetailModal = function(drop, campaign, dropsPageInstance) {
    // Удаляем существующее модальное окно если есть.
    // Вместе с его обработчиками на document: просто remove() оставлял
    // слушатели прежнего окна, и с каждым открытием их копилось больше.
    const existingModal = document.getElementById('drop-detail-modal');
    if (existingModal) {
      existingModal._abort?.abort();
      existingModal.remove();
    }

    // Куда вернуть фокус после закрытия: на плитку, с которой открыли
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Редкость считает вызывающая страница. Если её не передали — окно
    // не должно падать: раньше обращение к отсутствующему объекту роняло
    // отрисовку целиком, и вместо карточки не появлялось ничего.
    // Подпись редкости переводится при показе: таблицу редкостей держит
    // каждая страница своя, и готового перевода в ней может не быть.
    const rarity = (typeof dropsPageInstance?.calculateDropRarity === 'function')
      ? dropsPageInstance.calculateDropRarity(drop, campaign)
      : { color: 'var(--text-tertiary)', label: tr('Награда') };
    // Без картинки — пустая рамка со значком подарка цвета темы
    // (.is-empty в page-drops.css), а не тёмная заглушка на светлой теме
    const imageUrl = safeImageUrl(drop.imageURL || drop.image || drop.imageUrl);
    const dropName = drop.benefitName || drop.name || tr('Награда');
    const gameName = campaign?.game?.name || drop.game || '';

    // Дата получения.
    // У дропа из карточки кампании её нет — она лежит в инвентаре Twitch
    // (lastAwardedAt) по id награды.
    const awarded = Array.isArray(dropsPageInstance?.claimedDrops) && drop.benefitId
      ? dropsPageInstance.claimedDrops.find(c => c?.id === drop.benefitId)
      : null;
    const claimedDateParsed = validDate(drop.claimedAt || drop.lastAwardedAt || drop.claimedDate || awarded?.lastAwardedAt);
    const claimedDate = claimedDateParsed
      ? claimedDateParsed.toLocaleDateString(tr.locale(), { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

    // main отдаёт начало кампании как startsAt; читали только startAt,
    // и в окне вместо периода стояли тире
    const campaignRange = formatRange(
      campaign?.startsAt || campaign?.startAt || campaign?.startDate,
      campaign?.endsAt || campaign?.endDate
    );

    // Вычисляем прогресс
    const requiredMinutes = drop.requiredMinutesWatched || drop.requiredMinutes || drop.required || rarity.requiredMinutes || 0;
    const progressPercent = Number.isFinite(drop.progressPercent)
      ? Math.min(100, Math.max(0, Math.floor(drop.progressPercent)))
      : (Number.isFinite(drop.percentage)
        ? Math.min(100, Math.max(0, Math.floor(drop.percentage)))
        : (requiredMinutes > 0
          ? Math.min(100, Math.max(0, Math.floor(((drop.currentMinutesWatched || drop.progress || 0) / requiredMinutes) * 100)))
          : 0));
    const progressMinutes = Number.isFinite(drop.progressMinutes)
      ? Math.max(0, Math.floor(drop.progressMinutes))
      : (Number.isFinite(drop.currentMinutesWatched)
        ? Math.max(0, Math.floor(drop.currentMinutesWatched))
        : (requiredMinutes > 0 && Number.isFinite(drop.progress) && drop.progress <= requiredMinutes
          ? Math.max(0, Math.floor(drop.progress))
          : 0));
    const minutesLeft = Math.max(0, requiredMinutes - progressMinutes);

    // Статус — бейджем рядом с редкостью: зелёный — получено или можно
    // забрать, остальное нейтральное
    const isClaimed = !!(drop.claimed || drop.isClaimed);
    const isClaimable = !!(drop.canClaim || drop.isClaimable || drop.claimable || drop.isUnlocked);
    let statusText = tr('В процессе');
    let statusClass = 'badge';
    if (isClaimed) {
      statusText = tr('Получено');
      statusClass = 'badge badge-success';
    } else if (progressPercent >= 100 || isClaimable) {
      statusText = tr('Можно забрать');
      statusClass = 'badge badge-success';
    } else if (progressPercent === 0) {
      statusText = tr('Не начато');
    }

    // Получение прямо из приложения. Механика claim-drop была реализована
    // давно, но в этом окне кнопки не было вовсе — оно лишь сообщало
    // «Доступно к получению», и забирать награду приходилось на сайте.
    const dropInstanceID = drop.dropInstanceID || drop.self?.dropInstanceID || null;
    const canClaimHere = !isClaimed && !!dropInstanceID && (progressPercent >= 100 || isClaimable);

    const formatViewersCount = typeof dropsPageInstance?.formatViewersCount === 'function'
      ? dropsPageInstance.formatViewersCount.bind(dropsPageInstance)
      : (count) => (count || count === 0 ? count.toString() : '—');

    // Строки сведений: подпись слева, значение справа
    const fact = (label, value) => `<div class="drop-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
    const facts = [];
    if (requiredMinutes > 0) facts.push(fact(tr('Нужно смотреть'), esc(formatMinutes(requiredMinutes))));
    if (isClaimed) {
      // Дата получения: только у полученных и только с известной датой.
      // Раньше «Получено —» стояло и у наград, которые ещё в процессе.
      if (claimedDate) facts.push(fact(tr('Получено'), esc(claimedDate)));
    } else if (requiredMinutes > 0) {
      const minutesText = tr('{done} / {total} мин', { done: progressMinutes, total: requiredMinutes });
      const leftText = minutesLeft > 0 ? ` · ${esc(tr('ещё {time}', { time: formatMinutes(minutesLeft) }))}` : '';
      facts.push(`
        <div class="drop-fact drop-fact-progress">
          <dt>${tr('Прогресс')}</dt>
          <dd class="num">${progressPercent}%</dd>
          <div class="progress${progressPercent >= 100 ? ' is-complete' : ''}" role="progressbar" aria-label="${tr('Прогресс награды')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <div class="drop-fact-sub num">${minutesText}${leftText}</div>
        </div>`);
    }
    if (campaignRange) facts.push(fact(tr('Кампания'), esc(campaignRange)));
    if (rarity.viewersCount > 0) facts.push(fact(tr('Зрителей категории'), esc(formatViewersCount(rarity.viewersCount))));

    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.id = 'drop-detail-modal';
    modal.className = 'dialog-backdrop drop-dialog-backdrop';
    modal.innerHTML = `
      <div class="dialog drop-dialog" role="dialog" aria-modal="true" aria-labelledby="drop-dialog-title">
        <button type="button" id="close-drop-modal" class="dialog-close drop-dialog-close" title="${tr('Закрыть')}" aria-label="${tr('Закрыть')}">${icon('close', 16)}</button>
        <div class="drop-dialog-body">
          <div class="drop-dialog-art${imageUrl ? '' : ' is-empty'}">
            ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" decoding="async">` : ''}
          </div>
          <div class="drop-dialog-info">
            <h2 class="dialog-title drop-dialog-title" id="drop-dialog-title">${esc(dropName)}</h2>
            ${gameName ? `<div class="drop-dialog-game">${esc(gameName)}</div>` : ''}
            <div class="drop-dialog-badges">
              <span class="badge drop-rarity" title="${tr('Редкость по времени просмотра и числу зрителей')}"><span class="drop-rarity-dot" style="background: ${esc(rarity.color)}"></span>${esc(tr(rarity.label))}</span>
              <span class="${statusClass}" id="drop-dialog-status">${statusText}</span>
            </div>
            ${facts.length ? `<dl class="drop-dialog-facts">${facts.join('')}</dl>` : ''}
          </div>
        </div>
        <div class="dialog-foot">
          ${canClaimHere ? `<button type="button" id="claim-drop-btn" class="btn btn-primary">${icon('gift', 16)}<span>${tr('Забрать')}</span></button>` : ''}
          <button type="button" class="btn btn-secondary" data-drop-dialog-close>${tr('Закрыть')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Обработчики на document снимаются вместе с окном. Храним контроллер
    // на самом окне: следующее открытие снимет обработчики этого, даже
    // если оно закроется не через closeModal, а заменой.
    const modalAbort = new AbortController();
    modal._abort = modalAbort;

    const dialog = modal.querySelector('.drop-dialog');
    const img = modal.querySelector('.drop-dialog-art img');
    // Битая картинка — та же пустая рамка со значком подарка, а не значок
    // сломанного файла
    img?.addEventListener('error', () => {
      img.parentElement?.classList.add('is-empty');
      img.remove();
    });

    // Повторный вызов (двойной клик по крестику, Esc после клика) не
    // должен ничего ломать
    const closeModal = () => {
      modalAbort.abort();
      if (modal.isConnected) modal.remove();
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };

    const claimBtn = modal.querySelector('#claim-drop-btn');
    if (claimBtn) {
      claimBtn.addEventListener('click', async () => {
        if (claimBtn.classList.contains('is-loading')) return;
        claimBtn.classList.add('is-loading');
        claimBtn.setAttribute('aria-busy', 'true');

        try {
          const result = await window.electronAPI.claimDrop(dropInstanceID);
          claimBtn.classList.remove('is-loading');
          claimBtn.removeAttribute('aria-busy');

          if (result?.success) {
            window.chime?.dropClaimed();
            // Журнал событий: ручное получение — такая же награда, как
            // автоматическая
            window.eventLog?.add({
              type: 'drop',
              title: dropName,
              game: gameName || undefined,
              icon: safeImageUrl(drop.imageURL || drop.image || drop.imageUrl) || undefined,
              // id награды: если её уже забрал автосбор, вторая запись не нужна
              key: dropInstanceID
            });
            claimBtn.disabled = true;
            claimBtn.innerHTML = `${icon('check', 16)}<span>${tr('Получено')}</span>`;
            const status = modal.querySelector('#drop-dialog-status');
            if (status) {
              status.textContent = tr('Получено');
              status.className = 'badge badge-success';
            }
            window.utils?.showToast(tr('Награда получена'), 'success');
            // Обновляем список, чтобы состояние совпало с Twitch
            window.dropsPage?.loadDrops?.();
          } else {
            window.chime?.failed();
            // Текст ошибки main уже переводит сам (i18n-main.js)
            window.utils?.showToast(
              tr('Не удалось получить: {error}', { error: result?.error || tr('неизвестная ошибка') }),
              'error'
            );
          }
        } catch (error) {
          claimBtn.classList.remove('is-loading');
          claimBtn.removeAttribute('aria-busy');
          window.utils?.showToast(tr('Ошибка при получении награды'), 'error');
        }
      });
    }

    modal.querySelector('#close-drop-modal')?.addEventListener('click', closeModal);
    modal.querySelector('[data-drop-dialog-close]')?.addEventListener('click', closeModal);

    // Esc закрывает окно, как остальные окна приложения. Tab не уходит из
    // окна на страницу под ним: фокус ходит по кругу внутри.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }, { signal: modalAbort.signal });

    // Закрываем по щелчку на фоне, только если и нажали на фоне: когда
    // кнопку мыши отпускают за пределами окна (например, выделяя текст),
    // браузер шлёт click общему предку — самому фону, и окно закрывалось.
    let pressedOnBackdrop = false;
    modal.addEventListener('mousedown', (e) => {
      pressedOnBackdrop = e.target === modal;
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal && pressedOnBackdrop) closeModal();
    });

    // Фокус — на главное действие окна: «Забрать», если можно, иначе «Закрыть»
    (claimBtn || modal.querySelector('[data-drop-dialog-close]'))?.focus({ preventScroll: true });
  };
})();
