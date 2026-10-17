/**
 * Окно с подробностями категории: кто сейчас стримит её с дропсами.
 *
 * К управлению фармингом отношения не имеет, поэтому вынесено из
 * farming-page.js. Страница передаётся первым аргументом ради
 * вспомогательных методов форматирования и запуска выбранного канала.
 *
 * Вид — обычное окно приложения (.dialog.dialog-lg): в шапке обложка,
 * название и одна строка подробностей, в теле — список стримов строками.
 * Раньше слева стояла большая обложка с 3D-наклоном, справа — карточки с
 * тенями, жёлтой рамкой «ТОП» и тремя десятками фиолетовых кнопок; окно не
 * помещалось в 1000×650. Теперь прокручивается только список, шапка на месте.
 */
window.showCategoryDetailsModal = async function (page, category) {
  // Названия стримов и описания каналов задают сами стримеры. Вставленные
  // в разметку как есть, они позволяли выполнить код внутри приложения:
  // достаточно было заголовка вида <img onerror=…>. Всё внешнее — через
  // экранирование.
  const esc = (text) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(text) : page.esc(text));
  const icon = (name, size) => window.Icons?.get(name, size) ?? '';
  const DEFAULT_AVATAR = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-70x70.png';

  // Класс category-detail-modal прежний: по нему страница проверяет, не
  // открыто ли уже окно, а снимки — закрывают его
  const modal = document.createElement('div');
  modal.className = 'category-detail-modal dialog-backdrop';

  const modalContent = document.createElement('div');
  modalContent.className = 'dialog dialog-lg category-dialog';
  modalContent.setAttribute('role', 'dialog');
  modalContent.setAttribute('aria-modal', 'true');
  modalContent.setAttribute('aria-labelledby', 'category-dialog-title');
  modal.style.transition = 'opacity var(--dur-base) var(--ease-out)';
  modalContent.style.transition = 'transform var(--dur-base) var(--ease-out)';

  const skeleton = typeof window.DOMHelpers?.skeletonRows === 'function'
    ? window.DOMHelpers.skeletonRows(5)
    : '<div class="loading-state"><div class="spinner"></div></div>';

  modalContent.innerHTML = `
    <div class="dialog-head">
      <img class="category-dialog-cover" src="${esc(page.getHighQualityBoxArt(category.boxArtURL, category.id))}" alt=""
           onerror="this.onerror=null;this.src=window.DROP_PLACEHOLDER||'';">
      <div>
        <h2 class="dialog-title" id="category-dialog-title">${esc(category.name)}</h2>
        <div class="row-meta" id="category-info-blocks">
          <span><span id="category-live-viewers">${esc(page.formatViewersCount(category.viewersCount))}</span> ${esc(typeof page.viewersWord === 'function' ? page.viewersWord(category.viewersCount) : tr('зрителей'))}</span>
          ${category.hasDrops ? `<span class="tone-ok">${tr('Дропсы доступны')}</span>` : ''}
        </div>
      </div>
      <button id="close-category-modal" class="dialog-close" type="button" aria-label="${tr('Закрыть')}" title="${tr('Закрыть (Esc)')}">
        ${icon('close', 16)}
      </button>
    </div>
    <div class="dialog-body" id="streams-scroll-container">
      <div id="category-streams-loading">${skeleton}</div>
      <div id="category-streams-content" style="display: none;"></div>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Обработчик закрытия. Окно может закрыться и само — после «Смотреть» у
  // стримера, — поэтому remove(): повторный removeChild бросал ошибку
  let closing = false;
  // Esc закрывает окно, как и остальные окна приложения. Слушатель на
  // document снимаем вместе с окном, иначе они копились бы
  const keys = new AbortController();
  const closeModal = () => {
    keys.abort();
    if (closing) return;
    closing = true;
    modal.style.opacity = '0';
    modalContent.style.transform = 'translateY(8px)';
    setTimeout(() => modal.remove(), 180);
  };
  // Окно закрыли — сами или снаружи (кнопка «Смотреть» у стримера)
  const isGone = () => closing || !modal.isConnected;

  document.addEventListener('keydown', (e) => {
    if (!modal.isConnected) {
      keys.abort();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  }, { signal: keys.signal });

  // Закрываем по фону, только если нажатие и началось на фоне: иначе
  // выделение текста в окне с отпусканием мыши снаружи закрывало его
  let pressedOnBackdrop = false;
  modal.addEventListener('mousedown', (e) => {
    pressedOnBackdrop = e.target === modal;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && pressedOnBackdrop) closeModal();
    pressedOnBackdrop = false;
  });

  modal.querySelector('#close-category-modal').addEventListener('click', closeModal);
  modal.querySelector('#close-category-modal').focus({ preventScroll: true });

  const showMessage = (iconName, title, text) => {
    const loadingEl = isGone() ? null : modal.querySelector('#category-streams-loading');
    if (!loadingEl) return;
    loadingEl.innerHTML = typeof window.DOMHelpers?.emptyState === 'function'
      ? window.DOMHelpers.emptyState({ icon: iconName, title, text })
      : `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  };

  // Загружаем стримы с дропсами
  try {
    const overview = await window.electronAPI.getCategoryOverview(category.name);
    // Окно могли закрыть, пока шёл запрос. Ищем внутри своего окна, а не
    // по всему документу: за это время могло открыться другое такое же
    if (isGone()) return;
    const loadingEl = modal.querySelector('#category-streams-loading');
    const contentEl = modal.querySelector('#category-streams-content');
    if (!loadingEl || !contentEl) return;

    // null — Twitch не ответил. Это не «стримов нет»: так и говорим
    if (!overview || overview.error) {
      showMessage('warning', tr('Twitch не ответил'), tr('Попробуйте открыть окно ещё раз чуть позже.'));
      return;
    }

    const streams = (overview.streams || []).filter(stream => stream.hasDrops);

    if (!streams || streams.length === 0) {
      showMessage('info', tr('Нет стримов с дропсами'), tr('Сейчас никто не стримит эту игру с включёнными дропсами.'));
      return;
    }

    // Аватарка и число зрителей приходят вместе со списком. Раньше на
    // каждый канал уходил отдельный запрос getChannelDetails с OAuth-токеном:
    // при его отсутствии или истечении аватарки просто не грузились, а
    // зрителей у стримов не было вовсе.
    const streamsData = streams;

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    // Зрители в карточке категории могли быть сохранены давно —
    // подменяем на свежее число из того же ответа Twitch
    const liveViewers = modal.querySelector('#category-live-viewers');
    if (liveViewers && overview.gameViewers > 0) {
      liveViewers.textContent = page.formatViewersCount(overview.gameViewers);
    }

    // Сколько стримов с дропсами из проверенных — третьей частью строки
    // подробностей в шапке
    const infoLine = modal.querySelector('#category-info-blocks');
    if (infoLine) {
      const withDrops = Number(overview.streamsWithDrops) || 0;
      const checked = Number(overview.streamsChecked) || 0;
      const part = document.createElement('span');
      const streamsWord = typeof page.plural === 'function' ? page.plural(checked, 'стрима', 'стримов', 'стримов') : tr('стримов');
      part.textContent = checked > 0
        ? tr('{withDrops} из {checked} {streams} с дропсами', { withDrops, checked, streams: streamsWord })
        : tr('{count} с дропсами', { count: withDrops });
      infoLine.appendChild(part);
    }

    const streamName = (stream) => stream.display_name || stream.displayName || stream.user_name || stream.login;

    contentEl.innerHTML = `
      <div class="section-label category-dialog-label">${tr('Стримы с дропсами')}</div>
      <div class="list">
        ${streamsData.map((stream, index) => {
          const avatar = stream.profileImageUrl ||
            stream.thumbnail_url?.replace('{width}', '70').replace('{height}', '70') ||
            DEFAULT_AVATAR;
          const meta = [
            stream.viewersCount
              ? `<span class="num">${esc(page.formatViewersCount(stream.viewersCount))} ${esc(typeof page.viewersWord === 'function' ? page.viewersWord(stream.viewersCount) : tr('зрителей'))}</span>`
              : '',
            stream.followers
              ? `<span class="num">${esc(page.formatFollowers(stream.followers))} ${esc(stream.followers < 10000 && typeof page.plural === 'function' ? page.plural(stream.followers, 'подписчик', 'подписчика', 'подписчиков') : tr('подписчиков'))}</span>`
              : '',
            stream.language ? `<span>${esc(String(stream.language).toUpperCase())}</span>` : ''
          ].filter(Boolean).join('');

          return `
            <div class="list-row stream-card-clickable" data-stream-index="${index}" role="button" tabindex="0"
                 title="${tr('Смотреть {channel}', { channel: esc(streamName(stream)) })}">
              <img class="row-avatar" src="${esc(avatar)}" alt=""
                   onerror="this.onerror=null; this.src='${DEFAULT_AVATAR}';">
              <div class="row-main">
                <div class="row-title">
                  <span class="stream-name">${esc(streamName(stream))}</span>
                  <span class="stream-login">@${esc(stream.login)}</span>
                  ${index === 0 ? `<span class="badge badge-accent">${tr('Лучший выбор')}</span>` : ''}
                </div>
                ${meta ? `<div class="row-meta">${meta}</div>` : ''}
                ${stream.title ? `<div class="stream-row-title" title="${esc(stream.title)}">${esc(stream.title)}</div>` : ''}
              </div>
              <span class="btn btn-secondary btn-sm stream-row-watch" aria-hidden="true">
                ${icon('play', 14)}
                <span>${tr('Смотреть')}</span>
              </span>
            </div>
          `;
        }).join('')}
      </div>

      ${streamsData[0].description ? `
        <div class="category-dialog-about">
          <div class="section-label">${tr('О канале {channel}', { channel: esc(streamsData[0].displayName || streamName(streamsData[0])) })}</div>
          ${esc(streamsData[0].description)}
        </div>` : ''}
    `;

    // Запуск конкретного стримера — обработчиком, а не атрибутом onclick с
    // подставленным логином: данные Twitch в атрибуте-обработчике можно
    // было превратить в код. И передаём сам выбор, а не только логин:
    // раньше запускался другой канал, выбранный приложением. Строка —
    // кнопка: Enter и пробел работают так же, как щелчок.
    contentEl.querySelectorAll('.stream-card-clickable').forEach(card => {
      const stream = streamsData[Number(card.dataset.streamIndex)];
      if (!stream) return;
      const start = () => {
        page.startStreamFromModal(stream.login, category.id, {
          displayName: streamName(stream),
          title: stream.title || '',
          viewersCount: stream.viewersCount || 0,
          profileImageUrl: stream.profileImageUrl || null
        });
      };
      card.addEventListener('click', start);
      card.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        start();
      });
    });

  } catch (error) {
    console.error('Error loading category details:', error);
    showMessage('warning', tr('Не удалось загрузить стримы'), tr('Проверьте соединение и откройте окно ещё раз.'));
  }
};
