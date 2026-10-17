// Страница «Дропсы»: прогресс кампаний и инвентарь полученных наград.
//
// Оформление — классы page-drops.css и общие компоненты main.css. Раньше
// почти весь вид жил в инлайновых style="" шаблонов: цвета были зашиты
// (#7c5cff, rgba(255,255,255,…)), и светлая тема держалась на десятках
// подпорок вида [style*="…"] в main.css.
(function() {
  'use strict';

  if (window.DropsPage) {
    return;
  }

  // Названия кампаний, игр и наград задаёт разработчик игры, а не
  // приложение. Вставленные в innerHTML как есть, они становились
  // разметкой и могли выполнить код с доступом к electronAPI.
  const esc = (text) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(text)
    : String(text ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch])));

  // Адрес картинки попадает в атрибут src. Кавычка или скобка в нём
  // могла закрыть атрибут и дописать свою разметку, поэтому пропускаем
  // только http(s) и data:image, а опасные символы кодируем.
  const safeImageUrl = (url) => {
    const value = String(url || '');
    if (!/^(https?:|data:image\/)/i.test(value)) return '';
    return value.replace(/["'()\\\s<>]/g,
      ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  };

  // Иконки — общий набор dom-helpers.js (грузится раньше страниц): один
  // рисунок и одна толщина линии на всё приложение.
  const icon = (name, size = 16) => window.Icons?.get(name, size) ?? '';

  // «1 награда / 2 награды / 5 наград»: русскому нужны три формы
  const plural = (n, one, few, many) => {
    if (typeof window.DOMHelpers?.plural === 'function') return window.DOMHelpers.plural(n, one, few, many);
    const d = Math.abs(n) % 100;
    const u = d % 10;
    if (d > 10 && d < 20) return many;
    if (u === 1) return one;
    if (u >= 2 && u <= 4) return few;
    return many;
  };

  // Длительности — единицами через пробел, как во всём приложении:
  // «45 мин», «2 ч 15 мин». Прежние «2д 23ч» и «Осталось: …» читались хуже.
  const formatMinutes = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return tr('{m} мин', { m });
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? tr('{h} ч {m} мин', { h, m: rest }) : tr('{h} ч', { h });
  };

  // Дробная часть: в русском запятая, в английском точка
  const decimal = (value) => (tr.lang() === 'en' ? value : value.replace('.', ','));

  // То же коротко — для плитки шириной 72px: «25 мин», «2,4 ч», «10 ч».
  // Точное «2 ч 25 мин» остаётся в подсказке плитки.
  const formatMinutesShort = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return tr('{m} мин', { m });
    const hours = m / 60;
    return hours >= 10 || Number.isInteger(hours)
      ? tr('{h} ч', { h: Math.round(hours) })
      : tr('{h} ч', { h: decimal(hours.toFixed(1)) });
  };

  const formatSpan = (ms) => {
    const total = Math.max(0, Math.floor(ms / 60000));
    const d = Math.floor(total / 1440);
    const h = Math.floor((total % 1440) / 60);
    const m = total % 60;
    if (d > 0) return h ? tr('{d} д {h} ч', { d, h }) : tr('{d} д', { d });
    if (h > 0) return m ? tr('{h} ч {m} мин', { h, m }) : tr('{h} ч', { h });
    return tr('{m} мин', { m: Math.max(1, m) });
  };

  const validDate = (raw) => {
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  // Срок кампании одной короткой записью: «9–18 окт.», «28 сент. – 5 окт.».
  // Месяц один раз, если он общий: так строка помещается рядом с игрой.
  const formatDateRange = (startRaw, endRaw) => {
    const start = validDate(startRaw);
    const end = validDate(endRaw);
    const options = { day: 'numeric', month: 'short' };
    const fmt = (date) => date.toLocaleDateString(tr.locale(), options);
    if (start && end) {
      // В английском месяц стоит перед числом («Oct 9–18»): общий месяц
      // выносит сам Intl, склейка «9–Oct 18» была бы неверной
      if (tr.lang() === 'en') {
        try {
          return new Intl.DateTimeFormat(tr.locale(), options).formatRange(start, end);
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

  class DropsPage {
    constructor() {
      this.i18n = window.i18n;
      this.campaigns = [];
      this.claimedDrops = [];
      this.updateTimer = null;
      // Обработчики на document переживают уничтожение страницы,
      // поэтому снимаем их централизованно в destroy()
      this._abort = new AbortController();
      this._destroyed = false;
      // Обработчики кнопок вешаются один раз: init() вызывается повторно
      // после входа в Twitch, и прежде каждая кнопка получала второй
      // обработчик — «Забрать все» отправлял запрос дважды.
      this._wired = false;
      this._claimingAll = false;
      this.activeTab = 'progress';
      // Раскрыт ли блок «Завершённые»: фоновое обновление раз в пять минут
      // перерисовывает список и не должно сворачивать его под рукой
      this.completedExpanded = false;
      this.inventoryPage = 1;
      this.inventoryPageSize = 24;
      this.inventoryFilter = 'all'; // all, game
      this.inventoryGameFilter = null;
      this.initialized = false;

      // Определение редкостей дропов. Цвет — только для точки в окне
      // награды: рамки и свечения цвета редкости спорили с содержимым.
      // Значения — токены темы, чтобы точка читалась и на светлой.
      this.rarityTiers = [
        { name: 'common', label: tr('Обычный'), minMinutes: 0, maxMinutes: 60, minViewers: 50000, color: 'var(--text-tertiary)' },
        { name: 'uncommon', label: tr('Необычный'), minMinutes: 61, maxMinutes: 120, minViewers: 30000, color: 'var(--success)' },
        { name: 'rare', label: tr('Редкий'), minMinutes: 121, maxMinutes: 240, minViewers: 15000, color: '#4aa3ff' },
        { name: 'epic', label: tr('Эпический'), minMinutes: 241, maxMinutes: 480, minViewers: 8000, color: 'var(--accent)' },
        { name: 'legendary', label: tr('Легендарный'), minMinutes: 481, maxMinutes: 720, minViewers: 3000, color: 'var(--warning)' },
        { name: 'mythic', label: tr('Мифический'), minMinutes: 721, maxMinutes: 99999, minViewers: 0, color: 'var(--danger)' }
      ];

      this.init();
    }

    async init() {
      // Проверяем авторизацию.
      //
      // Раньше страница смотрела только на getOAuthUser(), а он возвращает
      // null даже у полностью авторизованного пользователя — вся вкладка
      // показывала «Требуется авторизация», хотя фарминг шёл и подписки
      // грузились. Настоящий признак входа лежит в сохранённом аккаунте,
      // как это и делает страница подписок; ответ getOAuthUser лишь
      // дополняет его свежими полями, если он вообще пришёл.
      try {
        const oauthData = await window.electronAPI.getOAuthUser().catch(() => null);
        const accounts = (await Storage.getAccounts().catch(() => [])) || [];
        const account = accounts[0] || null;
        // Пока шёл запрос, пользователь мог уйти на другую страницу
        if (this._destroyed) return;

        const user = (oauthData?.user) || (account && account.accessToken ? {
          displayName: account.displayName || account.username,
          login: account.username,
          profileImageUrl: account.avatar || ''
        } : null);

        const authSection = document.getElementById('authSection');
        const userInfo = document.getElementById('userInfo');
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        const logoutBtn = document.getElementById('logoutButton');
        const tabsContainer = document.getElementById('tabsContainer');
        const progressTab = document.getElementById('progressTab');
        const inventoryTab = document.getElementById('inventoryTab');

        if (!user) {
          // Показываем приглашение войти; переключатель разделов и
          // кнопки шапки без входа ничего не делают — прячем их
          if (authSection) authSection.style.display = 'block';
          if (userInfo) userInfo.style.display = 'none';
          if (tabsContainer) tabsContainer.style.display = 'none';
          if (progressTab) progressTab.style.display = 'none';
          if (inventoryTab) inventoryTab.style.display = 'none';

          const authButton = document.getElementById('authButton');
          if (authButton) {
            authButton.onclick = async () => {
              // Блокируем только от двойного щелчка. Если закрыть вкладку
              // входа в браузере, ответа не будет вовсе, и навсегда
              // выключенная кнопка не дала бы попробовать ещё раз.
              authButton.disabled = true;
              const unlock = setTimeout(() => { authButton.disabled = false; }, 5000);
              try {
                const result = await window.electronAPI.startTwitchAuth();
                // Перерисовываем только эту страницу. Раньше здесь была
                // перезагрузка всего окна — даже при неудачном входе, — и она
                // обрывала фарминг и плеер.
                if (result?.success) {
                  if (!this._destroyed) await this.init();
                } else {
                  // Ошибка из main бывает служебной и английской
                  // («listen EADDRINUSE…»): переводим её тем же правилом,
                  // что и страница аккаунтов
                  const text = typeof window.friendlyLoginError === 'function'
                    ? window.friendlyLoginError(result?.error)
                    : tr('Не удалось войти в Twitch — попробуйте ещё раз');
                  window.utils?.showToast(text, 'error');
                }
              } catch (error) {
                console.error('Auth error:', error);
                window.utils?.showToast(tr('Не удалось войти через Twitch'), 'error');
              } finally {
                clearTimeout(unlock);
                authButton.disabled = false;
              }
            };
          }
          return;
        }

        // Пользователь авторизован — показываем содержимое
        if (authSection) authSection.style.display = 'none';
        if (userInfo) {
          userInfo.style.display = 'block';
          // Без аватара пустой src прячет картинку (page-drops.css), а не
          // рисует значок битого изображения
          if (userAvatarEl) userAvatarEl.src = safeImageUrl(user.profileImageUrl);
          if (userNameEl) userNameEl.textContent = user.displayName || user.login || 'Twitch';
          if (logoutBtn) {
            // Здесь была кнопка «Выйти». Она стирала только служебный
            // OAuth-ключ — аккаунт с токеном оставался, и после перезагрузки
            // окна страница снова показывала того же пользователя. Итог:
            // выхода нет, а фарминг и плеер обрывались. Настоящее удаление
            // аккаунта с подтверждением живёт на странице аккаунтов — туда
            // кнопка и ведёт, и подписана она теперь по месту назначения.
            logoutBtn.onclick = () => window.router?.navigate('accounts');
          }
        }
        if (tabsContainer) tabsContainer.style.display = 'flex';
        this.showTabPanels();

        if (!this._wired) {
          this._wired = true;
          this.setupTabs();
          this.setupButtons();
          this.setupDropCardClickHandlers();
        }
        await this.loadDrops();
        this.startAutoRefresh();
        this.initialized = true;
      } catch (error) {
        console.error('Error checking auth:', error);
        // В случае ошибки показываем кнопку авторизации
        const authSection = document.getElementById('authSection');
        if (authSection) authSection.style.display = 'block';
      }
    }

    // Видимость панелей по выбранному разделу
    showTabPanels() {
      const progressTab = document.getElementById('progressTab');
      const inventoryTab = document.getElementById('inventoryTab');
      if (progressTab) progressTab.style.display = this.activeTab === 'progress' ? 'block' : 'none';
      if (inventoryTab) inventoryTab.style.display = this.activeTab === 'inventory' ? 'block' : 'none';
    }

    setupTabs() {
      document.querySelectorAll('.drops-page .drops-tab-button').forEach(button => {
        button.addEventListener('click', () => this.switchTab(button.getAttribute('data-tab')), { signal: this._abort.signal });
      });
    }

    switchTab(tab) {
      if (tab !== 'progress' && tab !== 'inventory') return;
      this.activeTab = tab;
      document.querySelectorAll('.drops-page .drops-tab-button').forEach(btn => {
        const on = btn.getAttribute('data-tab') === tab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
      });
      this.showTabPanels();
      // Инвентарь строится при каждом открытии: за время на вкладке
      // «Прогресс» могли прийти новые награды
      if (tab === 'inventory') this.loadInventory();
    }

    setupButtons() {
      const signal = this._abort.signal;

      // Обновить: заново спрашиваем Twitch. Кнопка крутит кольцо, пока
      // идёт запрос, — раньше нажатие ничем не отвечало до ответа
      const refreshBtn = document.getElementById('refreshButton');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          if (refreshBtn.classList.contains('is-loading')) return;
          refreshBtn.classList.add('is-loading');
          refreshBtn.setAttribute('aria-busy', 'true');
          try {
            await this.loadDrops({ force: true });
            // На вкладке инвентаря обновляем и его: раньше кнопка
            // перерисовывала только скрытый список кампаний
            if (!this._destroyed && this.activeTab === 'inventory') await this.loadInventory();
          } finally {
            refreshBtn.classList.remove('is-loading');
            refreshBtn.removeAttribute('aria-busy');
          }
        }, { signal });
      }

      // Забрать все награды, готовые к получению
      const claimAllBtn = document.getElementById('claimAllButton');
      if (claimAllBtn) {
        claimAllBtn.addEventListener('click', async () => {
          if (this._claimingAll || claimAllBtn.disabled) return;
          this._claimingAll = true;
          claimAllBtn.classList.add('is-loading');
          claimAllBtn.setAttribute('aria-busy', 'true');

          try {
            const result = await window.electronAPI.claimAllDrops();
            const claimed = Number(result?.claimed) || 0;
            const total = Number(result?.total) || 0;
            // Раньше любой успешный ответ давал зелёное «Получено наград: 0» —
            // и когда забирать было нечего, и когда ни одна награда не
            // далась. Пользователь думал, что всё в порядке, а награды
            // оставались незабранными и могли сгореть с концом кампании.
            // Тексты error и message main уже переводит сам (i18n-main.js)
            if (!result?.success) {
              window.utils?.showToast(result?.error || tr('Не удалось получить награды'), 'error');
            } else if (claimed === 0 && total > 0) {
              window.utils?.showToast(tr('Не удалось получить награды — заберите их вручную'), 'error');
            } else if (claimed === 0) {
              window.utils?.showToast(result.message || tr('Забирать пока нечего'), 'info');
            } else if (total > claimed) {
              window.utils?.showToast(tr('Получено {claimed} из {total}, остальные заберите вручную', { claimed, total }), 'warning');
            } else {
              window.utils?.showToast(tr('Получено наград: {count}', { count: claimed }), 'success');
            }
            if (claimed > 0) {
              // Журнал событий: утром видно, что награды забраны вручную
              window.eventLog?.add({
                type: 'drop',
                title: tr('Забрано вручную: {rewards}', { rewards: `${claimed} ${plural(claimed, 'награда', 'награды', 'наград')}` })
              });
              setTimeout(() => this.loadDrops(), 2000);
            }
          } catch (error) {
            console.error('Error claiming all drops:', error);
            window.utils?.showToast(tr('Ошибка получения наград'), 'error');
          } finally {
            this._claimingAll = false;
            claimAllBtn.classList.remove('is-loading');
            claimAllBtn.removeAttribute('aria-busy');
            this.updateClaimAllState();
          }
        }, { signal });
      }
    }

    setupDropCardClickHandlers() {
      const signal = this._abort.signal;
      // Делегирование на document: карточки перерисовываются целиком.
      // Только внутри страницы дропсов — фарминг держит свой DOM в окне
      // и после ухода со страницы.
      document.addEventListener('click', (e) => {
        if (!e.target.closest?.('.drops-page')) return;

        // Кнопка «Забрать» лежит внутри карточки дропа. Раньше клик по ней
        // ещё и открывал окно награды поверх, поэтому кнопку разбираем
        // первой и окно в этом случае не открываем.
        const claimBtn = e.target.closest('[data-claim-drop]');
        if (claimBtn) {
          window.claimDropNow(claimBtn.dataset.claimDrop, claimBtn, e);
          return;
        }

        // «Повторить» в пустом состоянии после ошибки загрузки
        if (e.target.closest('[data-drops-retry]')) {
          this.loadDrops({ force: true }).then(() => {
            if (!this._destroyed && this.activeTab === 'inventory') this.loadInventory();
          });
          return;
        }

        // Свой класс, а не общий .drop-card-clickable: на тот же класс
        // подписан и делегат страницы фарминга на document, и каждый клик
        // здесь строил окно награды дважды.
        const dropCard = e.target.closest('.drops-page-drop-card');
        if (dropCard) this.openDropCard(dropCard);
      }, { signal });

      // Плитки — role="button": с клавиатуры открываются Enter и пробелом
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target;
        if (!card?.classList?.contains('drops-page-drop-card') || !card.closest('.drops-page')) return;
        e.preventDefault();
        this.openDropCard(card);
      }, { signal });

      // Битая картинка награды — та же пустая рамка со значком подарка,
      // что и у награды без картинки, вместо значка сломанного файла.
      // error не всплывает, поэтому ловим на погружении.
      document.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !img.classList.contains('drops-img')) return;
        if (img.classList.contains('campaign-cover')) {
          // У <img> нет ::after, а значок рисуется им — меняем на пустую рамку
          const empty = document.createElement('span');
          empty.className = 'campaign-cover is-empty';
          empty.setAttribute('aria-hidden', 'true');
          img.replaceWith(empty);
          return;
        }
        img.parentElement?.classList.add('is-empty');
        img.remove();
      }, { capture: true, signal });
    }

    openDropCard(dropCard) {
      if (!dropCard?.dataset.drop) return;
      try {
        const drop = JSON.parse(decodeURIComponent(dropCard.dataset.drop));
        const campaign = dropCard.dataset.campaign ? JSON.parse(decodeURIComponent(dropCard.dataset.campaign)) : null;
        this.showDropDetailModal(drop, campaign);
      } catch (error) {
        console.error('Error parsing drop data:', error);
      }
    }

    /**
     * Почему инвентарь не пришёл, или null, если ответ настоящий.
     *
     * Без cookie-токена, на паузе Twitch и при сбое main отдаёт пустой список
     * кампаний с флагом. Раньше страница принимала его за «дропсов нет» —
     * пользователь думал, что кампаний нет, хотя данные просто не получены.
     */
    describeUnavailable(data) {
      if (!data || !Array.isArray(data.campaigns)) return tr('Ошибка запроса к Twitch, обновлю позже');
      if (data.needsStream) return tr('Запустите стрим — Twitch отдаёт инвентарь только после этого');
      if (data.rateLimited) return tr('Twitch просит паузу, обновлю позже');
      if (data.error) return tr('Ошибка запроса к Twitch, обновлю позже');
      return null;
    }

    /**
     * Пустое состояние: контурная иконка, заголовок, одно предложение и
     * (при ошибке) кнопка «Повторить». Тексты экранирует DOMHelpers.
     */
    showEmptyState(el, title, text = '', iconName = 'gift', withRetry = false) {
      if (!el) return;
      const actionHtml = withRetry
        ? `<button type="button" class="btn btn-secondary btn-sm" data-drops-retry>${icon('refresh', 14)}<span>${tr('Повторить')}</span></button>`
        : '';
      el.innerHTML = window.DOMHelpers?.emptyState
        ? window.DOMHelpers.emptyState({ icon: iconName, title, text, actionHtml })
        : `<div class="empty-state"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${actionHtml}</div>`;
      el.style.display = 'block';
    }

    async loadDrops(options = {}) {
      // Таймер или поздний ответ уже ушедшей страницы не должен рисовать
      // в разметке чужой
      if (this._destroyed) return;

      const loadingEl = document.getElementById('loadingState');
      const containerEl = document.getElementById('campaignsContainer');
      const emptyEl = document.getElementById('emptyState');

      // Фоновое обновление не стирает список заранее: иначе раз в пять
      // минут он пропадал до ответа Twitch и прокрутка прыгала наверх.
      const hadCampaigns = this.campaigns.length > 0;
      const quiet = hadCampaigns && !options.force;

      if (!quiet) {
        if (loadingEl) loadingEl.style.display = 'block';
        if (containerEl) containerEl.innerHTML = '';
      }
      if (emptyEl) emptyEl.style.display = 'none';

      try {
        const data = await window.electronAPI.fetchDropsInventory(options.force ? { force: true } : undefined);
        if (this._destroyed) return;

        const unavailable = this.describeUnavailable(data);
        if (unavailable) {
          // Незнание — не повод стирать то, что уже показано, и обнулять
          // счётчики: оставляем прежний список, а без него объясняем причину.
          console.log('[Дропсы] Инвентарь недоступен:', unavailable);
          if (hadCampaigns) {
            if (!quiet) this.renderCampaigns();
            if (options.force) window.utils?.showToast(unavailable, 'warning');
          } else {
            this.showEmptyState(emptyEl, tr('Дропсы пока недоступны'), unavailable, 'info');
          }
          return;
        }

        this.campaigns = data.campaigns;
        this.claimedDrops = data.claimedDrops || [];
        this.updateStats();
        if (data.campaigns.length > 0) {
          this.renderCampaigns();
        } else {
          if (containerEl) containerEl.innerHTML = '';
          document.getElementById('completedDropsBlock')?.remove();
          this.showEmptyState(emptyEl, tr('Сейчас кампаний нет'),
            tr('Они появятся здесь, когда фарминг начнёт смотреть стрим с дропсами.'), 'gift');
        }
      } catch (error) {
        console.error('Error loading drops:', error);
        if (this._destroyed) return;
        if (hadCampaigns) {
          if (!quiet) this.renderCampaigns();
          // Ручное обновление без ответа: прежний список вернулся молча,
          // и казалось, что данные свежие
          if (options.force) window.utils?.showToast(tr('Ошибка загрузки дропсов'), 'warning');
        } else {
          this.showEmptyState(emptyEl, tr('Не удалось загрузить дропсы'),
            tr('Проверьте подключение к интернету и попробуйте ещё раз.'), 'warning', true);
        }
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    }

    // Заработан ли дроп — та же логика, что в farming-page.js
    isDropEarned(drop) {
      return !!(
        drop.claimed ||
        drop.canClaim ||
        drop.isClaimable ||
        drop.claimable ||
        drop.isUnlocked ||
        (drop.required > 0 && drop.progress >= drop.required)
      );
    }

    // Кампания завершена, если все её дропы заработаны
    isCampaignCompleted(campaign) {
      if (!campaign.drops || campaign.drops.length === 0) return false;
      return campaign.drops.every(drop => this.isDropEarned(drop));
    }

    // Истёк ли срок кампании
    isCampaignExpired(campaign) {
      if (!campaign.endsAt) return false;
      return new Date(campaign.endsAt) < new Date();
    }

    // Можно ли забрать награду прямо сейчас — то же условие, что у кнопки
    // «Забрать» на плитке
    canClaimDrop(drop) {
      return !!(drop && !drop.claimed && (Number(drop.percentage) || 0) >= 100 && drop.dropInstanceID);
    }

    countClaimable() {
      return this.campaigns.reduce((sum, campaign) =>
        sum + (campaign.drops || []).filter(d => this.canClaimDrop(d)).length, 0);
    }

    /**
     * «Забрать все» — главная кнопка, только когда есть что забрать.
     * Иначе она второстепенная и неактивная: фиолетовая кнопка, которая
     * отвечает «Забирать пока нечего», звала нажать без причины.
     */
    updateClaimAllState() {
      const btn = document.getElementById('claimAllButton');
      if (!btn || this._claimingAll) return;
      const n = this.countClaimable();
      btn.disabled = n === 0;
      btn.classList.toggle('btn-primary', n > 0);
      btn.classList.toggle('btn-secondary', n === 0);
      btn.title = n > 0
        ? tr('Забрать {rewards}', { rewards: `${n} ${plural(n, 'награду', 'награды', 'наград')}` })
        : tr('Забирать пока нечего');
    }

    updateStats() {
      // Подсчитываем статистику
      let completedCampaigns = 0;
      let activeCampaigns = 0;

      this.campaigns.forEach(campaign => {
        // Кампания завершена, если всё получено или вышел срок
        if (this.isCampaignCompleted(campaign) || this.isCampaignExpired(campaign)) {
          completedCampaigns++;
        } else {
          activeCampaigns++;
        }
      });

      // Полученные дропсы считаем по инвентарю, а не по активным кампаниям.
      //
      // Раньше суммировались только те награды, что помечены полученными
      // внутри кампаний, показанных на странице, — а там лежат лишь текущие
      // активные. Всё, что собрано в завершившихся кампаниях, в счётчик не
      // попадало, и цифра выходила заметно меньше реальной.
      const totalClaimedDrops = Array.isArray(this.claimedDrops) && this.claimedDrops.length > 0
        ? this.claimedDrops.length
        : this.campaigns.reduce((sum, campaign) =>
            sum + (campaign.drops || []).filter(d => d.claimed).length, 0);

      const totalClaimedEl = document.getElementById('totalClaimedDrops');
      const completedCampaignsEl = document.getElementById('completedCampaignsCount');
      const activeCampaignsEl = document.getElementById('activeCampaignsCount');

      if (totalClaimedEl) totalClaimedEl.textContent = totalClaimedDrops;
      if (completedCampaignsEl) completedCampaignsEl.textContent = completedCampaigns;
      if (activeCampaignsEl) activeCampaignsEl.textContent = activeCampaigns;
      // Числа настоящие — показываем сводку целиком
      document.getElementById('userInfo')?.classList.remove('is-pending');

      this.updateClaimAllState();
    }

    /**
     * Общий прогресс кампании: среднее по процентам всех её дропов.
     *
     * Карточка раньше считала только целиком заработанные дропы и при
     * первом дропе на 95% показывала 0% — будто прогресса нет, хотя
     * сайдбар и сортировка видели почти готовую награду.
     */
    getCampaignProgress(campaign) {
      if (!campaign.drops || campaign.drops.length === 0) return 0;
      let totalProgress = 0;
      campaign.drops.forEach(drop => {
        const earned = this.isDropEarned(drop);
        const dropPercent = earned ? 100 : (drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0);
        totalProgress += dropPercent;
      });
      return Math.floor(totalProgress / campaign.drops.length);
    }

    renderCampaigns() {
      const container = document.getElementById('campaignsContainer');
      if (!container) return;

      container.innerHTML = '';
      document.getElementById('completedDropsBlock')?.remove();

      // Разделяем на активные (в процессе) и завершенные (100% ИЛИ истёк срок)
      const activeCampaigns = [];
      const completedCampaigns = [];

      this.campaigns.forEach(campaign => {
        if (this.isCampaignCompleted(campaign) || this.isCampaignExpired(campaign)) {
          completedCampaigns.push(campaign);
        } else {
          activeCampaigns.push(campaign);
        }
      });

      // Сортируем активные кампании по прогрессу (от большего к меньшему)
      activeCampaigns.sort((a, b) => this.getCampaignProgress(b) - this.getCampaignProgress(a));

      activeCampaigns.forEach(campaign => {
        container.appendChild(this.createCampaignCard(campaign, false));
      });

      // Активных нет, а завершённые есть — говорим об этом прямо, иначе
      // над свёрнутой строкой «Завершённые» оставалась пустота
      if (activeCampaigns.length === 0 && completedCampaigns.length > 0) {
        const note = document.createElement('div');
        note.className = 'card drops-empty drops-empty-inline';
        note.innerHTML = window.DOMHelpers?.emptyState
          ? window.DOMHelpers.emptyState({
              icon: 'check-circle',
              title: tr('Всё собрано'),
              text: tr('Новые кампании появятся здесь, когда фарминг начнёт смотреть стрим с дропсами.')
            })
          : '';
        container.appendChild(note);
      }

      // Завершённые — свёрнутой строкой под списком, а не отдельной
      // карточкой с большим отступом: они нужны редко
      if (completedCampaigns.length > 0) {
        const progressTab = document.getElementById('progressTab');
        if (progressTab) {
          const expanded = !!this.completedExpanded;
          const block = document.createElement('section');
          block.id = 'completedDropsBlock';
          block.className = 'camp-completed';
          block.innerHTML = `
            <button type="button" id="completedDropsHeader" class="section-label camp-completed-toggle" aria-expanded="${expanded}" aria-controls="completedCampaignsContainer">
              <span id="completedDropsArrow" class="camp-completed-arrow">${icon('chevron-right', 14)}</span>
              <span>${tr('Завершённые')}</span>
              <span class="count num">${completedCampaigns.length}</span>
            </button>
            <div id="completedCampaignsContainer" class="drops-campaigns-grid"${expanded ? '' : ' hidden'}></div>
          `;
          progressTab.appendChild(block);

          const header = block.querySelector('#completedDropsHeader');
          const content = block.querySelector('#completedCampaignsContainer');
          header.addEventListener('click', () => {
            this.completedExpanded = content.hidden;
            content.hidden = !this.completedExpanded;
            header.setAttribute('aria-expanded', String(this.completedExpanded));
          });

          completedCampaigns.forEach(campaign => {
            content.appendChild(this.createCampaignCard(campaign, true, this.isCampaignExpired(campaign)));
          });
        }
      }

      this.updateClaimAllState();
    }

    createCampaignCard(campaign, isCompleted, isExpired = false) {
      const card = document.createElement('article');
      card.className = 'card campaign-card'
        + (isCompleted ? ' is-completed' : '')
        + (isExpired ? ' is-expired' : '');

      // Срок: сколько осталось или когда закончилась
      let timeHtml = '';
      const end = validDate(campaign.endsAt);
      if (end) {
        const diff = end.getTime() - Date.now();
        if (diff < 0) {
          const ago = Math.abs(diff);
          timeHtml = ago >= 3600000
            ? `<span>${tr('закончилась {time} назад', { time: formatSpan(ago) })}</span>`
            : `<span>${tr('закончилась')}</span>`;
        } else if (!isCompleted) {
          // Меньше суток — янтарным: это повод проверить, успеет ли
          const soon = diff < 24 * 3600000;
          timeHtml = `<span class="${soon ? 'tone-warn' : ''}">${tr('осталось {time}', { time: formatSpan(diff) })}</span>`;
        }
      }

      // Прогресс — та же логика, что в farming-page.js. Подпись «N из M»
      // считает целые дропы, а полоса и процент — взвешенный общий
      // прогресс, как в сайдбаре.
      const drops = Array.isArray(campaign.drops) ? campaign.drops : [];
      const totalDrops = drops.length;
      const completedDrops = drops.filter(d => this.isDropEarned(d)).length;
      const progressPercent = this.getCampaignProgress(campaign);

      // Обложку берём из любого доступного поля: у кампаний из разных
      // запросов Twitch она лежит по-разному
      const rawCover = campaign.game?.boxArtURL
        || campaign.game?.boxArtUrl
        || campaign.imageUrl
        || campaign.boxArtURL
        || '';
      const cover = rawCover
        ? safeImageUrl(rawCover.replace('{width}', '144').replace('{height}', '192'))
        : '';
      const coverHtml = cover
        ? `<img class="campaign-cover drops-img" src="${esc(cover)}" alt="" loading="lazy" decoding="async">`
        : '<span class="campaign-cover is-empty" aria-hidden="true"></span>';

      // main отдаёт начало как startsAt; читали только startAt, и срок
      // кампании на карточке не выводился вовсе.
      const range = formatDateRange(campaign.startsAt || campaign.startAt, campaign.endsAt);
      const gameName = campaign.game?.name || campaign.game?.displayName || '';

      // Справа от названия — процент; у завершённых — итог словом
      let status;
      if (isExpired && progressPercent < 100) {
        status = `<span class="badge">${tr('Срок вышел')}</span>`;
      } else if (isCompleted) {
        status = `<span class="badge badge-success">${icon('check', 12)}${tr('Собрано')}</span>`;
      } else {
        status = `<span class="campaign-pct num">${progressPercent}%</span>`;
      }

      const meta = [
        gameName ? `<span class="campaign-game">${esc(gameName)}</span>` : '',
        range ? `<span class="num">${esc(range)}</span>` : '',
        timeHtml
      ].filter(Boolean).join('');

      const name = campaign.name || tr('Кампания');
      card.innerHTML = `
        <header class="campaign-head">
          ${coverHtml}
          <div class="campaign-info">
            <div class="campaign-title-row">
              <h3 class="campaign-title" title="${esc(name)}">${esc(name)}</h3>
              ${status}
            </div>
            <div class="campaign-meta row-meta">${meta}</div>
            <div class="campaign-progress-row">
              <div class="progress campaign-progress-bar${progressPercent === 100 ? ' is-complete' : ''}" role="progressbar" aria-label="${tr('Прогресс кампании')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
                <div class="progress-fill" style="width: ${progressPercent}%"></div>
              </div>
              <span class="campaign-count num">${tr('{done} из {total} получено', { done: completedDrops, total: totalDrops })}</span>
            </div>
          </div>
        </header>
        ${totalDrops > 0
          ? `<div class="camp-tiles">${drops.map(drop => this.createDropElement(drop, campaign)).join('')}</div>`
          : `<div class="campaign-no-drops">${tr('В кампании нет наград')}</div>`}
      `;

      return card;
    }

    createDropElement(drop, campaign = null) {
      // Без картинки — пустая рамка со значком подарка цвета темы
      // (.is-empty в page-drops.css), а не тёмная заглушка на светлой теме
      const imageUrl = safeImageUrl(drop.imageURL);
      const artHtml = imageUrl
        ? `<img class="drops-img" src="${esc(imageUrl)}" alt="" loading="lazy" decoding="async">`
        : '';
      const benefitName = esc(drop.benefitName || drop.name || tr('Награда'));
      const isClaimed = !!drop.claimed;
      const canClaim = this.canClaimDrop(drop);
      const progress = Number(drop.progress) || 0;
      const required = Number(drop.required) || 0;
      const remaining = Math.max(0, required - progress);
      // Процент присылает main; без него (старые данные) считаем по минутам
      const percentage = Math.max(0, Math.min(100, drop.percentage != null
        ? (Number(drop.percentage) || 0)
        : (required > 0 ? Math.floor((progress / required) * 100) : 0)));
      // У кампании, которая уже закончилась, «ещё 2 ч» — неправда:
      // досмотреть не получится, поэтому показываем, на чём остановились
      const ended = !!(campaign && this.isCampaignExpired(campaign));

      // Кампания нужна окну награды (срок, игра). Вызывающий передаёт её
      // сам; поиск по списку — для прежних вызовов с одним аргументом
      const dropCampaign = campaign || this.campaigns.find(c =>
        c.drops && c.drops.some(d =>
          (d.benefitId && d.benefitId === drop.benefitId) ||
          (d.id && d.id === drop.id)
        )
      );

      // Сохраняем данные дропа и кампании для клика
      const dropDataStr = encodeURIComponent(JSON.stringify(drop));
      const campaignDataStr = dropCampaign ? encodeURIComponent(JSON.stringify(dropCampaign)) : '';

      let state = '';
      let stateLabel;
      let bottom;
      if (isClaimed) {
        state = ' is-claimed';
        stateLabel = tr('получено');
        bottom = `<div class="camp-tile-meta">${tr('Получено')}</div>`;
      } else if (canClaim) {
        // Готово к получению.
        // Без инлайн-onclick: id дропа от Twitch подставлялся прямо в код
        // обработчика. Клик разбирает делегат в setupDropCardClickHandlers.
        state = ' is-ready';
        stateLabel = tr('можно забрать');
        bottom = `<button type="button" class="btn btn-primary btn-sm camp-tile-claim" data-claim-drop="${esc(drop.dropInstanceID)}">${tr('Забрать')}</button>`;
      } else if (this.isDropEarned(drop)) {
        // Минуты набраны, но забрать пока нельзя (Twitch ещё не выдал
        // экземпляр награды) — полная зелёная полоса и «Готово»
        state = ' is-earned';
        stateLabel = tr('готово, ждёт выдачи от Twitch');
        bottom = `
          <div class="progress camp-tile-progress is-complete"><div class="progress-fill" style="width: 100%"></div></div>
          <div class="camp-tile-meta">${tr('Готово')}</div>`;
      } else {
        const left = remaining > 0 && !ended;
        stateLabel = left ? tr('{percent}%, ещё {time}', { percent: percentage, time: formatMinutes(remaining) }) : `${percentage}%`;
        bottom = `
          <div class="progress camp-tile-progress"><div class="progress-fill" style="width: ${percentage}%"></div></div>
          <div class="camp-tile-meta num">${left ? tr('ещё {time}', { time: formatMinutesShort(remaining) }) : `${percentage}%`}</div>`;
      }

      return `
        <div class="drops-page-drop-card camp-tile${state}" data-drop="${dropDataStr}" data-campaign="${campaignDataStr}" role="button" tabindex="0" title="${benefitName} — ${stateLabel}">
          <div class="camp-tile-art${imageUrl ? '' : ' is-empty'}">
            ${artHtml}
            ${isClaimed ? `<span class="camp-tile-check" aria-hidden="true">${icon('check', 12)}</span>` : ''}
          </div>
          <div class="camp-tile-name">${benefitName}</div>
          ${bottom}
        </div>
      `;
    }

    async loadInventory() {
      const loadingEl = document.getElementById('inventoryLoading');
      const containerEl = document.getElementById('inventoryContainer');
      const emptyEl = document.getElementById('inventoryEmpty');

      if (loadingEl) loadingEl.style.display = 'block';
      if (containerEl) containerEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'none';

      try {
        // Используем уже загруженные данные
        let claimedDrops = this.claimedDrops;

        if (!claimedDrops || claimedDrops.length === 0) {
          const data = await window.electronAPI.fetchDropsInventory();
          if (this._destroyed) return;
          // Недоступный инвентарь — не «инвентарь пуст»: говорим, почему
          // данных нет, и не затираем то, что уже было известно
          const unavailable = this.describeUnavailable(data);
          if (unavailable) {
            this.showEmptyState(emptyEl, tr('Инвентарь пока недоступен'), unavailable, 'info');
            return;
          }
          claimedDrops = data.claimedDrops || [];
          this.claimedDrops = claimedDrops;
        }

        // Пусто — когда нет ни полученных, ни готовых к получению наград
        if (!this.renderInventory(claimedDrops)) {
          this.showEmptyState(emptyEl, tr('Инвентарь пуст'), tr('Здесь будут все полученные награды.'), 'gift');
        }
      } catch (error) {
        console.error('Error loading inventory:', error);
        this.showEmptyState(emptyEl, tr('Не удалось загрузить инвентарь'),
          tr('Проверьте подключение к интернету и попробуйте ещё раз.'), 'warning', true);
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    }

    // Возвращает false, если показывать нечего (вызывающий рисует пустое состояние)
    renderInventory(claimedDrops) {
      const container = document.getElementById('inventoryContainer');
      if (!container) return false;

      // Прокрутку ряда фильтров сохраняем: ряд строится заново на каждый
      // щелчок, и выбранная игра справа уезжала бы за край
      const oldFilters = container.querySelector('.drops-inventory-filters');
      const filtersScroll = oldFilters ? oldFilters.scrollLeft : 0;

      container.innerHTML = '';

      // Собираем все полученные дропсы И готовые к получению
      const allDrops = [];

      // Настоящая дата получения лежит в инвентаре Twitch (lastAwardedAt)
      // по id награды. Раньше всем наградам текущих кампаний ставилось
      // «сейчас», и сортировка по дате выходила неверной.
      const awardedAt = new Map();
      (Array.isArray(claimedDrops) ? claimedDrops : []).forEach(c => {
        if (c?.id) awardedAt.set(c.id, c.lastAwardedAt || null);
      });

      // Дропсы из активных кампаний.
      // Подписи-заглушки переводятся сразу: игра служит ключом фильтра, но
      // язык до перезапуска не меняется, и ключ у всех плиток один
      this.campaigns.forEach(campaign => {
        campaign.drops?.forEach(drop => {
          // Добавляем полученные дропсы
          if (drop.claimed) {
            allDrops.push({
              id: drop.benefitId || drop.id,
              dropInstanceID: drop.dropInstanceID,
              name: drop.benefitName || drop.name || tr('Награда'),
              image: drop.imageURL,
              game: campaign.game?.name || tr('Неизвестно'),
              claimedAt: awardedAt.get(drop.benefitId) || null,
              claimed: true,
              canClaim: false
            });
          }
          // Добавляем дропсы готовые к получению (100% но не claimed).
          // Даты у них нет: они ещё не получены, «недавно» было бы неправдой.
          else if (drop.percentage >= 100 && !drop.claimed) {
            allDrops.push({
              id: drop.benefitId || drop.id,
              dropInstanceID: drop.dropInstanceID,
              name: drop.benefitName || drop.name || tr('Награда'),
              image: drop.imageURL,
              game: campaign.game?.name || tr('Неизвестно'),
              claimedAt: null,
              claimed: false,
              canClaim: true
            });
          }
        });
      });

      // ВАЖНО: Добавляем ВСЕ полученные дропсы из claimedDrops (включая старые)
      // Эти дропсы могут быть из завершенных кампаний
      if (claimedDrops && Array.isArray(claimedDrops)) {
        claimedDrops.forEach(claimed => {
          // Проверяем не добавили ли мы уже этот дроп из активных кампаний
          if (!allDrops.find(d => d.id === claimed.id)) {
            // Название, игру и картинку берём из инвентаря, если main их
            // прислал; заглушки — только когда о награде не известно ничего
            allDrops.push({
              id: claimed.id,
              name: claimed.name || claimed.benefitName || tr('Полученная награда'),
              image: claimed.imageURL || claimed.imageAssetURL || null,
              game: claimed.game?.displayName || claimed.game?.name || tr('Различные игры'),
              claimedAt: claimed.lastAwardedAt || null,
              claimed: true
            });
          }
        });
      }

      // Сначала то, что ждёт действия (готово к получению), затем
      // полученные — новые сверху, награды без даты в конце
      const timeOf = (d) => {
        const t = d.claimedAt ? new Date(d.claimedAt).getTime() : NaN;
        return Number.isFinite(t) ? t : -Infinity;
      };
      allDrops.sort((a, b) => {
        if (!!a.canClaim !== !!b.canClaim) return a.canClaim ? -1 : 1;
        const ta = timeOf(a);
        const tb = timeOf(b);
        return ta === tb ? 0 : (tb > ta ? 1 : -1);
      });

      if (allDrops.length === 0) return false;

      // Игры для фильтра — с числом наград у каждой
      const perGame = new Map();
      allDrops.forEach(d => perGame.set(d.game, (perGame.get(d.game) || 0) + 1));
      const uniqueGames = [...perGame.keys()].sort((a, b) => a.localeCompare(b, tr.locale()));

      // Фильтр мог остаться от прежних данных, где эта игра ещё была
      if (this.inventoryFilter === 'game' && !perGame.has(this.inventoryGameFilter)) {
        this.inventoryFilter = 'all';
        this.inventoryGameFilter = null;
      }

      // Фильтр по играм — сегменты в один ряд; если игр много, ряд
      // прокручивается вбок, а не разрастается в несколько строк кнопок.
      // Одна игра — фильтровать нечего, ряд не нужен.
      if (uniqueGames.length > 1) {
        const filters = document.createElement('div');
        filters.className = 'drops-inventory-filters';
        const seg = document.createElement('div');
        seg.className = 'segmented';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', tr('Фильтр по игре'));

        const addFilter = (label, count, active, onClick) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          if (active) btn.className = 'active';
          btn.setAttribute('aria-pressed', String(active));
          btn.innerHTML = `<span>${esc(label)}</span><span class="count num">${count}</span>`;
          btn.addEventListener('click', onClick);
          seg.appendChild(btn);
        };

        addFilter(tr('Все'), allDrops.length, this.inventoryFilter !== 'game', () => {
          this.inventoryFilter = 'all';
          this.inventoryGameFilter = null;
          this.inventoryPage = 1;
          this.renderInventory(this.claimedDrops);
        });
        uniqueGames.forEach(game => {
          const active = this.inventoryFilter === 'game' && this.inventoryGameFilter === game;
          addFilter(game, perGame.get(game), active, () => {
            this.inventoryFilter = 'game';
            this.inventoryGameFilter = game;
            this.inventoryPage = 1;
            this.renderInventory(this.claimedDrops);
          });
        });

        filters.appendChild(seg);
        container.appendChild(filters);
        filters.scrollLeft = filtersScroll;
      }

      // Применяем фильтры
      let filteredDrops = allDrops;
      if (this.inventoryFilter === 'game' && this.inventoryGameFilter) {
        filteredDrops = allDrops.filter(d => d.game === this.inventoryGameFilter);
      }

      // Пагинация
      const endIndex = this.inventoryPage * this.inventoryPageSize;
      const displayDrops = filteredDrops.slice(0, endIndex);
      const hiddenCount = Math.max(0, filteredDrops.length - endIndex);

      const grid = document.createElement('div');
      grid.className = 'drops-inventory-grid';
      displayDrops.forEach(drop => grid.appendChild(this.createInventoryDropCard(drop)));
      container.appendChild(grid);

      // «Показать ещё» — обычная второстепенная кнопка с числом
      // оставшихся, а не фиолетовая полоса во всю ширину
      if (hiddenCount > 0) {
        const more = document.createElement('div');
        more.className = 'drops-more';
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.type = 'button';
        loadMoreBtn.className = 'btn btn-secondary btn-sm';
        loadMoreBtn.innerHTML = `${icon('chevron-down', 14)}<span>${tr('Показать ещё')}</span><span class="drops-more-count num">${hiddenCount}</span>`;
        loadMoreBtn.addEventListener('click', () => {
          this.inventoryPage++;
          this.renderInventory(this.claimedDrops);
        });
        more.appendChild(loadMoreBtn);
        container.appendChild(more);
      }
      return true;
    }

    createInventoryDropCard(drop) {
      const imageUrl = safeImageUrl(drop.image);
      const timeAgo = drop.claimedAt ? this.getTimeAgo(drop.claimedAt) : '';

      // Находим кампанию для этого дропа
      const dropCampaign = this.campaigns.find(c =>
        c.drops && c.drops.some(d =>
          (d.benefitId && d.benefitId === drop.id) ||
          (d.id && d.id === drop.id)
        )
      );

      const card = document.createElement('div');
      // Свой класс: на .drop-card-clickable слушает и страница фарминга
      card.className = 'drops-page-drop-card inv-tile' + (drop.canClaim ? ' is-ready' : '');
      card.dataset.drop = encodeURIComponent(JSON.stringify(drop));
      card.dataset.campaign = dropCampaign ? encodeURIComponent(JSON.stringify(dropCampaign)) : '';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.title = [drop.name, drop.game, timeAgo].filter(Boolean).join(' · ');

      // Бейдж «Получено» на каждой плитке убран: в инвентаре всё получено.
      // Отмечаем только исключение — награду, которую ещё надо забрать.
      card.innerHTML = `
        <div class="inv-tile-art${imageUrl ? '' : ' is-empty'}">
          ${imageUrl ? `<img class="drops-img" src="${esc(imageUrl)}" alt="" loading="lazy" decoding="async">` : ''}
        </div>
        <div class="inv-tile-name">${esc(drop.name)}</div>
        <div class="inv-tile-meta">${esc(drop.game)}</div>
        ${timeAgo ? `<div class="inv-tile-meta">${esc(timeAgo)}</div>` : ''}
        ${(drop.canClaim && drop.dropInstanceID)
          ? `<button type="button" class="btn btn-primary btn-sm btn-block inv-tile-claim" data-claim-drop="${esc(drop.dropInstanceID)}">${tr('Забрать')}</button>`
          : ''}
      `;

      return card;
    }

    getTimeAgo(dateString) {
      const now = new Date();
      const past = new Date(dateString);
      const diffMs = now - past;
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffWeeks = Math.floor(diffDays / 7);
      const diffMonths = Math.floor(diffDays / 30);
      const diffYears = Math.floor(diffDays / 365);

      // До 2 часов - показываем как "Недавно"
      if (diffMinutes < 120) {
        return tr('Недавно');
      }
      // До 48 часов - показываем часы
      else if (diffHours < 48) {
        return tr('{time} назад', { time: `${diffHours} ${plural(diffHours, 'час', 'часа', 'часов')}` });
      }
      // До недели - показываем дни
      else if (diffDays < 7) {
        return tr('{time} назад', { time: `${diffDays} ${plural(diffDays, 'день', 'дня', 'дней')}` });
      }
      // До месяца - показываем недели
      else if (diffWeeks < 4) {
        return tr('{time} назад', { time: `${diffWeeks} ${plural(diffWeeks, 'неделю', 'недели', 'недель')}` });
      }
      // До года - показываем месяцы
      else if (diffMonths < 12) {
        return tr('{time} назад', { time: `${diffMonths} ${plural(diffMonths, 'месяц', 'месяца', 'месяцев')}` });
      }
      // Больше года - показываем годы
      else {
        return tr('{time} назад', { time: `${diffYears} ${plural(diffYears, 'год', 'года', 'лет')}` });
      }
    }

    getPluralForm(number, one, two, five) {
      return plural(number, one, two, five);
    }

    // Вычисление редкости дропа
    calculateDropRarity(drop, campaign) {
      const requiredMinutes = drop.required || drop.requiredMinutesWatched || 0;
      const viewersCount = campaign?.game?.viewersCount || campaign?.viewersCount || 0;

      let rarity = this.rarityTiers[0];

      for (let tier of this.rarityTiers) {
        if (requiredMinutes >= tier.minMinutes && requiredMinutes <= tier.maxMinutes) {
          rarity = tier;
          break;
        }
      }

      if (viewersCount > 0 && viewersCount < rarity.minViewers) {
        const currentIndex = this.rarityTiers.indexOf(rarity);
        if (currentIndex < this.rarityTiers.length - 1) {
          rarity = this.rarityTiers[currentIndex + 1];
        }
      }

      // Число «владельцев» отсюда убрано: его выдумывала формула
      // max(зрители × 0,3; 10000) / k², а окно награды показывало его
      // как факт. Настоящих данных о владельцах Twitch не отдаёт.
      const difficulty = Math.min(10, Math.max(1, Math.ceil(requiredMinutes / 90)));

      return {
        ...rarity,
        requiredMinutes,
        viewersCount,
        difficulty
      };
    }

    // «12,4 тыс.», «1,2 млн» — так же, как числа зрителей на других экранах
    formatViewersCount(count) {
      if (!count || count === 0) return '—';
      const short = (value) => decimal(value.toFixed(1).replace(/\.0$/, ''));
      if (count >= 1000000) return tr('{n} млн', { n: short(count / 1000000) });
      if (count >= 1000) return tr('{n} тыс.', { n: short(count / 1000) });
      return count.toString();
    }

    // Показать модальное окно с деталями дропа
    showDropDetailModal(drop, campaign) {
      if (window.showDropDetailModal) {
        window.showDropDetailModal(drop, campaign, this);
      } else {
        console.error('Drop detail modal script not loaded');
      }
    }

    startAutoRefresh() {
      // init() асинхронный, поэтому сюда можно попасть уже после destroy():
      // без этой проверки каждый заход на страницу оставлял вечный таймер.
      if (this._destroyed) return;

      // Обновляем каждые 5 минут
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
      }
      this.updateTimer = setInterval(() => {
        this.loadDrops();
      }, 5 * 60 * 1000);
    }

    destroy() {
      this._destroyed = true;
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
      // Контроллер не обнуляем: отменённый сигнал делает поздние
      // addEventListener безвредными пустышками.
      if (this._abort) {
        this._abort.abort();
      }
    }
  }

  // Глобальная функция для получения дропа.
  // Клик по кнопке не должен доходить до карточки и открывать окно награды.
  window.claimDropNow = async function(dropInstanceID, button, event) {
    event?.stopPropagation?.();
    if (!dropInstanceID || !button || button.disabled || button.classList.contains('is-loading')) return;

    // Кольцо на месте подписи вместо прежних «...»
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');

    const done = () => {
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    };

    try {
      const result = await window.electronAPI.claimDrop(dropInstanceID);

      if (result?.success) {
        done();
        // Кнопка остаётся на месте до обновления списка, но уже как
        // спокойная отметка, а не зелёная заливка поверх плитки
        button.disabled = true;
        button.classList.remove('btn-primary');
        button.classList.add('btn-ghost', 'is-claimed-mark');
        button.innerHTML = `${icon('check', 14)}<span>${tr('Получено')}</span>`;
        button.closest('.drops-page-drop-card')?.classList.add('is-claimed');
        window.chime?.dropClaimed?.();
        window.utils?.showToast(tr('Награда получена'), 'success');

        // Журнал событий: название и игра — из данных плитки
        try {
          const tile = button.closest('.drops-page-drop-card');
          const drop = tile?.dataset.drop ? JSON.parse(decodeURIComponent(tile.dataset.drop)) : null;
          const campaign = tile?.dataset.campaign ? JSON.parse(decodeURIComponent(tile.dataset.campaign)) : null;
          window.eventLog?.add({
            type: 'drop',
            title: drop?.benefitName || drop?.name || tr('Награда'),
            game: campaign?.game?.name || drop?.game || undefined,
            icon: drop?.imageURL || drop?.image || undefined,
            // id награды: если её уже забрал автосбор, вторая запись не нужна
            key: dropInstanceID
          });
        } catch (e) { /* журнал необязателен */ }

        // Обновляем текущий экземпляр страницы, который создаёт роутер.
        // Раньше здесь был собственный экземпляр, созданный самим файлом:
        // его никто не уничтожал, и он жил вечно со своим таймером.
        setTimeout(() => {
          window.dropsPage?.loadDrops?.();
        }, 2000);
      } else {
        done();
        window.utils?.showToast(result?.error || tr('Не удалось получить награду'), 'error');
      }
    } catch (error) {
      console.error('Error claiming drop:', error);
      done();
      window.utils?.showToast(tr('Ошибка получения награды'), 'error');
    }
  };

  // Экспорт.
  // Экземпляр создаёт только роутер (window.dropsPage) и он же его
  // уничтожает. Раньше файл при загрузке создавал ещё и свой
  // window.dropsPageInstance: тот никогда не уничтожался, раз в пять минут
  // перерисовывал список, дважды ловил клики по карточкам и по
  // «Получить все награды» — награды запрашивались дважды.
  window.DropsPage = DropsPage;
})();
