class SubscriptionsPage {
  // Подробности канала (фолловеры, дата эфира, «в эфире») считаем свежими
  // полчаса. Раньше они запрашивались заново при каждом открытии страницы,
  // по запросу на каждый канал разом, и Twitch в ответ начинал ограничивать
  // и сам фарминг.
  static DETAILS_TTL_MS = 30 * 60 * 1000;
  // Не больше стольких запросов подробностей одновременно
  static DETAILS_PARALLEL = 5;
  // Канал, не стримивший дольше этого, считается неактивным
  static INACTIVE_DAYS = 30;
  // Для массовой отписки дата эфира должна быть проверена не раньше, чем
  // столько назад: по давно сохранённой дате отписывать нельзя — канал мог
  // с тех пор стримить
  static CLEANUP_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  constructor() {
    this.i18n = window.i18n;
    this._destroyed = false;
    // Номер текущей загрузки: ответ от прежней (страницу обновили или
    // открыли заново) не должен перезаписать свежие данные
    this._loadRun = 0;
    this.subscriptions = [];
    this.filteredSubscriptions = [];
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.currentView = 'list';
    this.subscriptionStats = {
      total: 0,
      withDrops: 0,
      active: 0,
      inactive: 0
    };
    this.init();
  }

  async init() {
    this.setupEventListeners();
    // Переключатель приоритета читаем сразу, а не после ответа Twitch:
    // раньше при неудачной загрузке он так и оставался выключенным, хотя
    // настройка включена и фарминг её учитывает
    this.loadPrioritySetting();
    this.loadSubscriptions();
  }

  /**
   * Роутер вызывает при уходе со страницы.
   *
   * Раньше метода не было: загрузка, начатая до перехода, доходила до
   * обращения к уже удалённым элементам и показывала на чужой странице
   * красное «Ошибка загрузки подписок».
   */
  destroy() {
    this._destroyed = true;
  }

  // Ответ пришёл, когда страница уже закрыта или запущена новая загрузка
  isStale(run) {
    return this._destroyed || run !== this._loadRun;
  }

  // Строки от Twitch (имена, логин, описание) идут в разметку только
  // экранированными: описание канала задаёт сам стример, и вставка как есть
  // позволяла чужому каналу выполнить код в окне приложения
  esc(text) {
    if (window.escapeHtml) return window.escapeHtml(text);
    return String(text ?? '').replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  }

  // Адрес картинки из ответа Twitch: только https и без символов, которыми
  // можно выйти из атрибута или из url('…') в стиле
  safeImageUrl(url) {
    return typeof url === 'string' && /^https:\/\/[^\s"'()<>\\]+$/i.test(url) ? url : '';
  }

  // Селектор карточки канала. id приходит от Twitch, поэтому экранируем
  cardSelector(id) {
    return `[data-channel-id="${CSS.escape(String(id))}"]`;
  }

  setupEventListeners() {
    // Фильтры
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.applyFilter();
      });
    });

    // Кнопки управления
    document.getElementById('refresh-subs-btn')?.addEventListener('click', () => this.refreshSubscriptions());
    document.getElementById('cleanup-subs-btn')?.addEventListener('click', () => this.cleanupInactive());
    document.getElementById('priority-subs-toggle')?.addEventListener('change', (e) => this.savePrioritySetting(e.target.checked));

    // Поиск
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.applyFilter();
    });

    // Переключатель вида
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentView = btn.dataset.view;
        this.updateViewMode();
      });
    });

    // Авторизация
    // У роутера нет switchPage — вызов бросал TypeError, и кнопка ничего
    // не делала
    document.getElementById('subscriptions-auth-btn')?.addEventListener('click', () => {
      window.router?.navigate('accounts');
    });

    // Модальное окно
    document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('channel-detail-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'channel-detail-modal') this.closeModal();
    });
  }

  /**
   * Загружает список подписок.
   *
   * Возвращает true, только если Twitch отдал полный свежий список: по
   * этому результату «Обновить» решает, показывать ли «Подписки обновлены».
   * Раньше тост успеха появлялся всегда, даже следом за «Не удалось
   * обновить список».
   */
  async loadSubscriptions({ force = false } = {}) {
    const run = ++this._loadRun;
    try {
      const accounts = await Storage.getAccounts();
      if (this.isStale(run)) return false;
      if (!accounts || accounts.length === 0) {
        this.showAuthSection();
        return false;
      }

      const account = accounts[0];
      let oauthData = null;
      try {
        oauthData = await window.electronAPI.getOAuthUser?.();
      } catch (e) {
        console.warn('Failed to get OAuth data:', e);
      }
      if (this.isStale(run)) return false;

      if (oauthData?.accessToken) {
        const tokenChanged = oauthData.accessToken !== account.accessToken;
        const refreshChanged = oauthData.refreshToken && oauthData.refreshToken !== account.refreshToken;

        if (tokenChanged || refreshChanged) {
          account.accessToken = oauthData.accessToken;
          if (oauthData.refreshToken) {
            account.refreshToken = oauthData.refreshToken;
          }
          await Storage.saveAccount(account);
          if (this.isStale(run)) return false;
        }
      }

      if (!account.accessToken) {
        console.log('[Subscriptions] Нет токена — показываю вход');
        this.showAuthSection();
        return false;
      }

      this.showContentSection();

      // Сохранённое показываем ПЕРВЫМ делом, до всяких запросов.
      //
      // Раньше сначала включался спиннер, а он прячет список целиком:
      // возвращаясь на вкладку, пользователь видел, как всё пропадает и
      // собирается заново — вместе с аватарками, хотя они и так лежат в
      // кеше браузера. Спиннер теперь появляется, только когда показать
      // действительно нечего.
      const stored = (await Storage.getSubscriptions()) || [];
      if (this.isStale(run)) return false;
      const savedSubs = (Array.isArray(stored) ? stored : [])
        .filter(s => s && typeof s === 'object')
        .map(s => this.prepareSaved(s));

      if (savedSubs.length > 0) {
        this.subscriptions = savedSubs;
        this.applyFilter();
        this.showRefreshingHint();
      } else {
        this.showLoadingState();
      }

      console.log('[Subscriptions] Обновляю список…');

      let timer = null;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Twitch не ответил за 10 секунд')), 10000);
      });

      let response = null;
      try {
        response = await Promise.race([
          window.electronAPI.getUserSubscriptions(account.accessToken),
          timeoutPromise
        ]);
      } catch (e) {
        console.warn('[Subscriptions] Запрос не удался:', e?.message);
      } finally {
        clearTimeout(timer);
      }
      if (this.isStale(run)) return false;

      const fetched = this.normalizeFetched(response);
      const items = (fetched?.items || []).filter(f => f && f.id && f.login);

      // Пустой ответ НЕ считаем правдой. Раньше он записывался поверх
      // сохранённого списка, стирая избранное и заданные приоритеты —
      // достаточно было один раз открыть страницу с протухшим токеном.
      if (items.length === 0) {
        console.warn('[Subscriptions] Twitch вернул пусто — оставляем сохранённый список');
        this.hideLoadingState();

        if (savedSubs.length === 0) {
          this.showEmptyState();
          // Полный пустой ответ — правда: подписок действительно нет
          if (fetched?.complete) return true;
          if (force) window.utils.showToast('Не удалось загрузить подписки с Twitch', 'warning');
        } else {
          window.utils.showToast('Не удалось обновить список, показаны сохранённые подписки', 'warning');
          this.applyFilter();
          // Сам список не пришёл, но подробности каналов от него не
          // зависят — обновляем их, иначе статусы остались бы старыми
          this.loadChannelDetails(run, account, { force });
        }
        return false;
      }

      console.log('[Subscriptions] Loaded:', items.length, 'subscriptions');

      // Слияние. Основа — то, что уже есть (метрики, избранное, приоритет),
      // а из ответа берём только поля самого списка: id, логин, имя.
      //
      // Раньше сохранённое целиком накладывалось поверх свежего, и
      // устаревшие данные перекрывали новые. Обратный порядок тоже не
      // годится: в ответе лежат заглушки followers: 0 и isLive: false,
      // и они затёрли бы настоящие значения.
      const current = new Map(this.subscriptions.map(s => [s.id, s]));
      const merged = items.map(fresh => {
        const saved = current.get(fresh.id);
        const sub = {
          ...(saved || {}),
          id: fresh.id,
          login: fresh.login,
          displayName: fresh.displayName || fresh.login
        };
        // Аватарка из подробностей канала крупнее той, что в списке
        // (300 против 70 точек), поэтому сохранённую не заменяем
        if (!sub.profileImageUrl) {
          const avatar = this.safeImageUrl(fresh.profileImageUrl);
          if (avatar) sub.profileImageUrl = avatar;
        }
        sub.lastSeen = saved?.lastSeen || new Date().toISOString();
        sub.rating = this.calculateRating(sub);
        sub.recommended = this.shouldRecommendUnsubscribe(sub);
        return sub;
      });

      // Twitch отдал не весь список: одна из страниц не пришла. Каналы,
      // которых нет в ответе, не выбрасываем — раньше вместе с ними
      // пропадали избранное и заданные приоритеты
      if (!fetched.complete) {
        const got = new Set(merged.map(s => s.id));
        const fromTwitch = merged.length;
        for (const sub of this.subscriptions) {
          if (!got.has(sub.id)) merged.push(sub);
        }
        // Про сохранённые говорим, только если они действительно добавлены:
        // при пустом сохранённом списке добавлять нечего
        window.utils.showToast(
          merged.length > fromTwitch
            ? 'Twitch отдал не весь список — остальные каналы показаны из сохранённых'
            : 'Twitch отдал не весь список подписок',
          'warning'
        );
      }

      this.subscriptions = merged;
      await Storage.saveSubscriptions(this.subscriptions);
      if (this.isStale(run)) return false;

      this.hideLoadingState();
      this.applyFilter();

      // Подробности грузятся в фоне: список уже на экране
      this.loadChannelDetails(run, account, { force });
      return fetched.complete;
    } catch (error) {
      if (this.isStale(run)) return false;
      console.error('Error loading subscriptions:', error);
      window.utils.showToast('Ошибка загрузки подписок', 'error');
      this.hideLoadingState();
      if (this.subscriptions.length > 0) this.applyFilter();
      else this.showEmptyState();
      return false;
    }
  }

  /**
   * Ответ get-user-subscriptions в одном виде: { items, complete }.
   *
   * Прежний main отдавал просто массив и не сообщал, что список урезан.
   * Пустой массив от него означал и «подписок нет», и «нет токена», поэтому
   * полным его не считаем.
   */
  normalizeFetched(response) {
    if (Array.isArray(response)) return { items: response, complete: response.length > 0 };
    if (response && Array.isArray(response.items)) {
      return { items: response.items, complete: response.complete === true };
    }
    return null;
  }

  /**
   * Сохранённый канал перед показом.
   *
   * «В эфире» — состояние на момент проверки. Раньше сохранённое значение
   * показывалось как есть, и канал, стримивший вчера, при открытии страницы
   * висел «в эфире». Держим его, только если проверка была недавно.
   */
  prepareSaved(saved) {
    const sub = { ...saved };
    if (!this.isDetailsFresh(sub)) delete sub.isLive;
    sub.rating = this.calculateRating(sub);
    return sub;
  }

  // Проверялись ли подробности канала не раньше maxAge назад
  isDetailsFresh(sub, maxAge = SubscriptionsPage.DETAILS_TTL_MS) {
    const at = Date.parse(sub?.detailsCheckedAt);
    if (!Number.isFinite(at)) return false;
    const age = Date.now() - at;
    return age >= 0 && age < maxAge;
  }

  /**
   * Подробности каналов: аватарка, описание, фолловеры, дата эфира.
   *
   * Раньше запрос уходил по каждому каналу сразу — на 62 подписки сотни
   * обращений к Twitch за секунду, и Twitch начинал ограничивать и сам
   * фарминг. Теперь одновременно не больше DETAILS_PARALLEL запросов, а
   * каналы, проверенные за последние полчаса, не запрашиваются вовсе
   * (кроме ручного «Обновить»).
   *
   * Сохранение и сортировка — один раз, когда пришло всё. Раньше список
   * сортировался по рейтингу до прихода данных, а полученное не
   * сохранялось, и каждый заход начинался со старого.
   */
  async loadChannelDetails(run, account, { force = false } = {}) {
    if (!window.electronAPI?.getChannelDetails) return;

    const queue = this.subscriptions.filter(s => s?.login && (force || !this.isDetailsFresh(s)));
    if (queue.length === 0) return;

    // Номер загрузки, чьи подробности сейчас идут. Простой флаг залипал:
    // прерванная загрузка его не снимала, а новая могла не начать своих
    this._detailsRun = run;
    let changed = false;

    const worker = async () => {
      while (queue.length > 0 && !this.isStale(run)) {
        const sub = queue.shift();
        let details = null;
        try {
          // Токен main больше не использует, но сигнатура вызова прежняя
          details = await window.electronAPI.getChannelDetails(account?.accessToken, sub.login);
        } catch (e) {
          console.warn(`[Subscriptions] Подробности ${sub.login} не получены:`, e?.message);
        }
        if (this.isStale(run)) return;
        if (this.applyChannelDetails(sub, details)) {
          changed = true;
          this.updateChannelCard(sub);
        }
      }
    };

    try {
      const workers = Math.min(SubscriptionsPage.DETAILS_PARALLEL, queue.length);
      await Promise.allSettled(Array.from({ length: workers }, () => worker()));
      if (this.isStale(run) || !changed) return;

      await Storage.saveSubscriptions(this.subscriptions);
      if (this.isStale(run)) return;
      this.applyFilter();
    } catch (e) {
      console.error('[Subscriptions] Ошибка загрузки подробностей:', e);
    } finally {
      if (this._detailsRun === run) this._detailsRun = null;
    }
  }

  isDetailsLoading() {
    return this._detailsRun != null && this._detailsRun === this._loadRun && !this._destroyed;
  }

  /**
   * Переносит подробности канала в подписку. Возвращает true, если данные
   * действительно пришли.
   *
   * Поле берём, только если оно получено и похоже на правду. Раньше при
   * сбое main отдавал заглушку с нулями, а страница принимала её за ответ
   * (0 >= 0): у всех каналов становилось 0 фолловеров и «не в эфире»,
   * очистка считала их неактивными, и нули уходили на диск.
   */
  applyChannelDetails(sub, details) {
    if (!details || typeof details !== 'object') return false;

    // Заглушка прежнего обработчика при неудаче: ни аватарки, ни даты,
    // одни нули. У настоящего канала аватарка есть всегда
    const isFailureStub = !details.profileImageUrl && !details.description &&
      !details.lastStreamDate && details.followers === 0 && details.isLive === false;
    if (isFailureStub) return false;

    const avatar = this.safeImageUrl(details.profileImageUrl);
    if (avatar) sub.profileImageUrl = avatar;
    if (typeof details.description === 'string') sub.description = details.description;
    if (typeof details.followers === 'number' && Number.isFinite(details.followers) && details.followers >= 0) {
      sub.followers = details.followers;
    }
    if (typeof details.isLive === 'boolean') sub.isLive = details.isLive;
    if (details.lastStreamDate) {
      const ts = new Date(details.lastStreamDate).getTime();
      if (Number.isFinite(ts)) sub.lastStreamDate = new Date(ts).toISOString();
    }

    sub.detailsCheckedAt = new Date().toISOString();
    sub.rating = this.calculateRating(sub);
    return true;
  }

  /**
   * Оценка канала для фарминга, 0–100.
   *
   * Прежняя формула не работала. Она стартовала с 50 баллов и только
   * добавляла — рейтинг ниже 50 был невозможен, поэтому нулевых каналов
   * не существовало в принципе. Три её слагаемых из пяти (частота стримов,
   * регулярность, язык) считались по полям, которые никто никогда не
   * заполнял, то есть 60% веса всегда были нулём. Сверху добавлялась
   * «вариация» из кода первого символа id — она не несла смысла, но
   * создавала видимость точности.
   *
   * Хуже всего, что рейтинг считался в момент слияния списков, когда
   * подробности канала ещё не загружены: у всех каналов выходило одно и
   * то же число.
   *
   * Здесь используются только те данные, которые приложение реально
   * получает, а до их загрузки рейтинг не выдумывается — возвращается null.
   */
  calculateRating(subscription) {
    const followers = Number(subscription.followers);
    const hasFollowers = Number.isFinite(followers);
    const hasActivity = !!subscription.lastStreamDate || subscription.isLive !== undefined;

    // Пока подробности не подгружены, честнее не показывать ничего
    if (!hasFollowers && !hasActivity) return null;

    // Активность — 45 баллов. Для фарминга важнее всего, идут ли эфиры.
    //
    // Затухание плавное, а не ступенями: ступени давали одинаковые оценки
    // каналам, которые стримили неделю назад и три недели назад, и все
    // значения выходили кратными пяти. Период полураспада — две недели.
    let activity = 0;
    if (subscription.isLive) {
      activity = 45;
    } else if (subscription.lastStreamDate) {
      const days = Math.max(0, (Date.now() - new Date(subscription.lastStreamDate).getTime()) / 86400000);
      activity = 45 * Math.pow(0.5, days / 14);
    }

    // Аудитория — 25 баллов по логарифмической шкале.
    //
    // Логарифм потому, что разница между 100 и 1000 подписчиков значит
    // куда больше, чем между 500 000 и 600 000. Шкала растянута от сотни
    // (0 баллов) до миллиона (25 баллов).
    let audience = 0;
    if (hasFollowers && followers > 0) {
      const scale = (Math.log10(followers) - 2) / 4;
      audience = 25 * Math.min(1, Math.max(0, scale));
    }

    // Дропсы — 30 баллов. Ради них приложение и существует.
    const drops = subscription.hasDrops ? 30 : 0;

    // Округляем до десятых: целые числа снова слипались бы в одинаковые
    // значения у близких каналов, а именно этого и хотелось избежать
    const total = Math.max(0, Math.min(100, activity + audience + drops));
    return Math.round(total * 10) / 10;
  }

  shouldRecommendUnsubscribe(subscription, saved = {}) {
    const lastStreamDate = new Date(subscription.lastStreamDate || 0);
    const daysSinceStream = (Date.now() - lastStreamDate.getTime()) / (1000 * 60 * 60 * 24);

    // Рекомендуем отписаться если:
    // 1. Не стримил более 90 дней
    // 2. Рейтинг очень низкий (< 20)
    // 3. Есть дропсы но регулярность низкая

    return daysSinceStream > 90 || this.calculateRating(subscription, saved) < 20;
  }

  updateStats() {
    this.subscriptionStats = {
      total: this.subscriptions.length,
      withDrops: this.subscriptions.filter(s => s.hasDrops).length,
      active: this.subscriptions.filter(s => this.isChannelActive(s)).length,
      inactive: this.subscriptions.filter(s => this.isChannelInactive(s)).length
    };

    // Подпись тоже склоняется: было «62 подписок» вместо «62 подписки»
    const n = this.subscriptionStats.total;
    const слово = (this.i18n?.currentLang || 'ru') === 'ru'
      ? this.plural(n, 'подписка', 'подписки', 'подписок')
      : this.i18n.t('subscriptions.subsCount');

    const counter = document.getElementById('subs-count');
    if (counter) counter.textContent = `${n} ${слово}`;
  }

  /**
   * Падеж существительного по числу.
   * Русский требует трёх форм: 1 неделю, 2 недели, 5 недель — а раньше
   * везде подставлялась третья, и выходило «1 недель назад».
   */
  plural(n, одна, две, много) {
    const десятки = Math.abs(n) % 100;
    const единицы = десятки % 10;

    if (десятки > 10 && десятки < 20) return много;
    if (единицы === 1) return одна;
    if (единицы >= 2 && единицы <= 4) return две;
    return много;
  }

  // «Активный» для фильтра «В эфире» — идёт эфир прямо сейчас
  isChannelActive(subscription) {
    return subscription?.isLive === true;
  }

  /**
   * Неактивный — не в эфире, и последний эфир был больше 30 дней назад.
   *
   * Раньше «неактивным» считался любой канал не в эфире прямо сейчас, а
   * если подробности не загрузились — вообще все. Очистка поэтому
   * отписывала почти от всех подписок, включая стримивших вчера. Канал с
   * неизвестной датой эфира неактивным не считается.
   */
  isChannelInactive(subscription) {
    if (subscription?.isLive === true) return false;
    const ts = Date.parse(subscription?.lastStreamDate);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts > SubscriptionsPage.INACTIVE_DAYS * 86400000;
  }

  applyFilter() {
    // Счётчик считался только после успешного ответа Twitch, а сохранённый
    // список показывается раньше — в шапке висело «0 подписок» при полном
    // списке на экране
    this.updateStats();

    let filtered = this.subscriptions;

    // Применяем фильтр
    switch (this.currentFilter) {
      case 'active':
        filtered = this.subscriptions.filter(s => this.isChannelActive(s));
        break;
      case 'with-drops':
        filtered = this.subscriptions.filter(s => s.hasDrops);
        break;
      case 'inactive':
        filtered = this.subscriptions.filter(s => this.isChannelInactive(s));
        break;
      case 'favorites':
        filtered = this.subscriptions.filter(s => s.isFavorite);
        break;
    }

    // Применяем поиск. По логину тоже: поля loginName, по которому искали
    // раньше, не существует, и канал с нелатинским именем было не найти
    if (this.searchQuery) {
      filtered = filtered.filter(s =>
        s.displayName?.toLowerCase().includes(this.searchQuery) ||
        s.login?.toLowerCase().includes(this.searchQuery)
      );
    }

    // Сортируем: избранные вверху, потом по приоритету (если есть), иначе по рейтингу
    this.filteredSubscriptions = filtered.sort((a, b) => {
      // Избранные всегда вверху
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      
      // Внутри избранных — заданный вручную порядок, а при равном
      // приоритете (то есть когда порядок не задавали) тоже по рейтингу
      if (a.isFavorite && b.isFavorite) {
        const aPriority = a.priority !== undefined ? a.priority : 9999;
        const bPriority = b.priority !== undefined ? b.priority : 9999;
        if (aPriority !== bPriority) return aPriority - bPriority;
      }
      
      // Обычные каналы по рейтингу, выше — впереди.
      // Каналы без оценки уходят вниз: раньше сравнение null с числом
      // давало NaN, и порядок получался произвольным.
      const rank = (sub) => Number.isFinite(sub.rating) ? sub.rating : -1;
      return rank(b) - rank(a);
    });

    this.renderSubscriptions();
  }

  renderSubscriptions() {
    const list = document.getElementById('subscriptions-list');
    const empty = document.getElementById('subscriptions-empty');
    const loading = document.getElementById('subscriptions-loading');

    if (!list) return;

    // Скрываем loading
    if (loading) loading.style.display = 'none';
    this.hideRefreshingHint();

    if (this.filteredSubscriptions.length === 0) {
      list.style.display = 'none';
      if (empty) empty.style.display = 'block';
      return;
    }

    list.style.display = 'grid';
    if (empty) empty.style.display = 'none';

    // Разделяем на избранные и обычные
    const favorites = this.filteredSubscriptions.filter(s => s.isFavorite);
    const regular = this.filteredSubscriptions.filter(s => !s.isFavorite);

    let html = '';
    if (favorites.length > 0) {
      html += favorites.map(sub => this.renderSubscriptionItem(sub)).join('');
      if (regular.length > 0) {
        html += '<div class="subscriptions-divider"><span>Остальные каналы</span></div>';
      }
    }
    html += regular.map(sub => this.renderSubscriptionItem(sub)).join('');

    // Если разметка не изменилась, DOM не трогаем вовсе.
    //
    // Возвращаясь на вкладку, пользователь чаще всего видит ровно тот же
    // список: перезапись innerHTML пересоздала бы все элементы и заставила
    // браузер заново раскладывать картинки — отсюда и ощущение, что
    // аватарки грузятся каждый раз. Обработчики при этом остаются на
    // месте, потому что сами узлы не менялись.
    if (html === this._renderedHtml && list.children.length > 0) {
      return;
    }
    this._renderedHtml = html;

    list.innerHTML = html;

    // Добавляем event listeners
    this.filteredSubscriptions.forEach(sub => {
      const item = list.querySelector(this.cardSelector(sub.id));
      if (item) {
        // Перетаскивание задаёт порядок только избранных. Остальные каналы
        // всегда сортируются по рейтингу: их перестановка откатывалась,
        // а приложение при этом писало «Порядок обновлен»
        if (sub.isFavorite) {
          item.draggable = true;
          item.addEventListener('dragstart', (e) => this.handleDragStart(e, sub));
          item.addEventListener('dragend', (e) => this.handleDragEnd(e));
          item.addEventListener('dragover', (e) => this.handleDragOver(e));
          item.addEventListener('drop', (e) => this.handleDrop(e, sub));
          item.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        }

        item.addEventListener('click', (e) => {
          if (!e.target.closest('.subscription-action-btn')) {
            this.showChannelDetails(sub);
          }
        });

        // Кнопка отписки
        const unsubBtn = item.querySelector('.unsub-btn');
        if (unsubBtn) {
          unsubBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.unsubscribeChannel(sub);
          });
        }

        // Кнопка просмотра на Twitch
        const twitchBtn = item.querySelector('.twitch-btn');
        if (twitchBtn) {
          twitchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.electronAPI.openExternal(`https://www.twitch.tv/${sub.login}`);
          });
        }

        // Кнопка старта фарминга
        const farmBtn = item.querySelector('.farm-btn');
        if (farmBtn) {
          farmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.startFarmingChannel(sub);
          });
        }

        // Кнопка избранного
        const favoriteBtn = item.querySelector('.favorite-btn');
        if (favoriteBtn) {
          favoriteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.toggleFavorite(sub);
          });
        }
      }
    });
  }

  renderSubscriptionItem(sub) {
    // Рейтинг может быть ещё не посчитан: подробности канала грузятся
    // отдельными запросами уже после отрисовки списка
    const hasRating = Number.isFinite(sub.rating);
    const ratingValue = hasRating ? Math.round(sub.rating) : '—';
    const ratingColor = !hasRating ? 'neutral' : sub.rating >= 70 ? 'good' : sub.rating >= 40 ? 'neutral' : 'bad';
    const lastStreamText = this.getLastStreamText(sub.lastStreamDate);
    const isLive = sub.isLive === true;
    const ratingText = !hasRating
      ? 'Оценка появится после загрузки данных канала'
      : sub.rating >= 70 ? this.i18n.t('subscriptions.excellentRating')
      : sub.rating >= 40 ? this.i18n.t('subscriptions.averageRating')
      : this.i18n.t('subscriptions.lowRating');
    const isFavorite = sub.isFavorite || false;
    // Всё, что пришло от Twitch, — только экранированным
    const gameName = this.esc(sub.gameName || '');
    const displayName = this.esc(sub.displayName || sub.login || '');
    const avatarUrl = this.esc(this.safeImageUrl(sub.profileImageUrl));

    return `
      <div class="subscription-card ${isFavorite ? 'favorite' : ''}" data-channel-id="${this.esc(sub.id)}">
        <div class="subscription-card-main">
          <div class="subscription-card-left">
            <div class="subscription-card-avatar-wrapper" style="background-image: url('${avatarUrl}');">
              <img src="${avatarUrl || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22%3E%3Crect fill=%22%234a3f9f%22 width=%2248%22 height=%2248%22/%3E%3Ctext x=%2224%22 y=%2235%22 font-size=%2230%22 fill=%22white%22 text-anchor=%22middle%22%3E?%3C/text%3E%3C/svg%3E'}"
                   alt="${displayName}"
                   class="subscription-card-avatar">
              ${isLive ? '<div class="subscription-card-live-indicator"></div>' : ''}
              
              <div class="subscription-card-rating ${ratingColor}" title="${ratingText}${hasRating ? ': ' + ratingValue + '/100' : ''} (оценка канала для фарминга)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  ${sub.rating >= 70 ? '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' :
        sub.rating >= 40 ? '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>' :
          '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>'}
                </svg>
                <span>${ratingValue}</span>
              </div>
              
              <div class="subscription-card-status-overlay ${isLive ? 'live' : 'offline'}">
                <span class="status-dot"></span>
                <span class="status-text">${isLive ? 'В эфире' : 'Офлайн'}</span>
              </div>
              
              <div class="subscription-card-stats-overlay">
                <div class="subscription-stat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <span>${this.formatFollowers(sub.followers)}</span>
                </div>
                <div class="subscription-stat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>${lastStreamText}</span>
                </div>
              </div>
            </div>
            
            <div class="subscription-card-info">
              <div class="subscription-card-name-line">
                <span class="subscription-card-name">${displayName}</span>
                <div class="subscription-card-rating-inline ${ratingColor}" title="${ratingText}${hasRating ? ': ' + ratingValue + '/100' : ''}">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    ${sub.rating >= 70 ? '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' :
        sub.rating >= 40 ? '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>' :
          '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>'}
                  </svg>
                  <span>${ratingValue}</span>
                </div>
              </div>
              <div class="subscription-card-status ${isLive ? 'live' : 'offline'}">
                <span class="status-dot"></span>
                <span class="status-text">${isLive ? this.i18n.t('subscriptions.live') : this.i18n.t('subscriptions.offline')}</span>
                ${isLive && gameName ? `<span class="game-name">${gameName}</span>` : ''}
              </div>
              <div class="subscription-card-mini-stats">
                <div class="mini-stat">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <span>${this.formatFollowers(sub.followers)}</span>
                </div>
                <span class="mini-stat-separator">•</span>
                <div class="mini-stat">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>${lastStreamText}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="subscription-card-right">
            <div class="subscription-card-stats">
              <div class="subscription-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>${this.formatFollowers(sub.followers)}</span>
              </div>
              
              <div class="subscription-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>${lastStreamText}</span>
              </div>
            </div>
            
            <div class="subscription-card-actions">
              <button class="subscription-action-btn favorite-btn ${isFavorite ? 'active' : ''}" title="${isFavorite ? this.i18n.t('subscriptions.removeFromFavorites') : this.i18n.t('subscriptions.addToFavorites')}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
              <button class="subscription-action-btn twitch-btn" title="${this.i18n.t('subscriptions.openOnTwitch')}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
                </svg>
              </button>
              <button class="subscription-action-btn farm-btn" title="${this.i18n.t('subscriptions.startFarm')}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                </svg>
              </button>
              <button class="subscription-action-btn unsub-btn" title="${this.i18n.t('subscriptions.unsubscribe')}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  formatFollowers(count) {
    // Неизвестное число — прочерк, а не ноль: раньше до загрузки
    // подробностей (и при их сбое) у всех каналов стояло «0»
    if (typeof count !== 'number' || !Number.isFinite(count)) return '—';
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
    return count.toString();
  }

  updateChannelCard(sub) {
    const cardElement = document.querySelector(this.cardSelector(sub.id));
    if (!cardElement) return;

    // Обновляем аватарку
    const img = cardElement.querySelector('.subscription-card-avatar');
    const avatar = this.safeImageUrl(sub.profileImageUrl);
    if (img && avatar) {
      img.src = avatar;
    }

    // Обновляем статус
    const isLive = sub.isLive === true;
    const statusEl = cardElement.querySelector('.subscription-card-status');
    if (statusEl) {
      statusEl.className = `subscription-card-status ${isLive ? 'live' : 'offline'}`;
      const statusText = statusEl.querySelector('.status-text');
      if (statusText) {
        statusText.textContent = isLive ? this.i18n.t('subscriptions.live') : this.i18n.t('subscriptions.offline');
      }
    }

    // Обновляем индикатор в эфире
    const avatarWrapper = cardElement.querySelector('.subscription-card-avatar-wrapper');
    const liveIndicator = avatarWrapper?.querySelector('.subscription-card-live-indicator');
    if (isLive && !liveIndicator) {
      avatarWrapper.insertAdjacentHTML('beforeend', '<div class="subscription-card-live-indicator"></div>');
    } else if (!isLive && liveIndicator) {
      liveIndicator.remove();
    }

    // Обновляем статистику
    const statsEl = cardElement.querySelector('.subscription-card-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="subscription-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>${this.formatFollowers(sub.followers)}</span>
        </div>
        
        <div class="subscription-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>${this.getLastStreamText(sub.lastStreamDate)}</span>
        </div>
      `;
    }

    // Обновляем рейтинг
    const ratingEl = cardElement.querySelector('.subscription-card-rating');
    if (ratingEl) {
      const hasRating = Number.isFinite(sub.rating);
      const ratingColor = !hasRating ? 'neutral' : sub.rating >= 70 ? 'good' : sub.rating >= 40 ? 'neutral' : 'bad';
      const ratingText = !hasRating
        ? 'Оценка появится после загрузки данных канала'
        : sub.rating >= 70 ? this.i18n.t('subscriptions.excellentRating')
        : sub.rating >= 40 ? this.i18n.t('subscriptions.averageRating')
        : this.i18n.t('subscriptions.lowRating');

      ratingEl.className = `subscription-card-rating ${ratingColor}`;
      ratingEl.title = ratingText + (hasRating ? `: ${Math.round(sub.rating)}/100` : '');

      const valueEl = ratingEl.querySelector('span');
      if (valueEl) {
        valueEl.textContent = hasRating ? Math.round(sub.rating) : '—';
      }
    }
  }

  getLastStreamText(lastStreamDate) {
    if (!lastStreamDate) return this.i18n.t('subscriptions.never');

    const ts = new Date(lastStreamDate).getTime();
    if (!Number.isFinite(ts)) return this.i18n.t('subscriptions.never');
    // У идущего эфира дата — его начало. Часы компьютера могут чуть
    // отставать от Twitch, и только что начатый эфир оказывался «в будущем»:
    // выходило «-1 день назад»
    const days = Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));

    if (days === 0) return this.i18n.t('subscriptions.today');
    if (days === 1) return this.i18n.t('subscriptions.yesterday');
    // Падежи по числу: раньше выходило «2 дней назад», «1 недель назад»
    // и «1 месяцев назад»
    if (days < 7) return `${days} ${this.plural(days, 'день', 'дня', 'дней')} назад`;
    if (days < 30) return `${Math.floor(days / 7)} ${this.plural(Math.floor(days / 7), 'неделю', 'недели', 'недель')} назад`;
    if (days < 365) return `${Math.floor(days / 30)} ${this.plural(Math.floor(days / 30), 'месяц', 'месяца', 'месяцев')} назад`;
    return `${Math.floor(days / 365)} ${this.plural(Math.floor(days / 365), 'год', 'года', 'лет')} назад`;
  }

  showChannelDetails(sub) {
    const modal = document.getElementById('channel-detail-modal');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    const isLive = sub.isLive === true;
    // Дата эфира неизвестна — так и пишем. Раньше она подменялась 1970 годом,
    // и любой канал без загруженных данных выглядел «неактивным»
    const lastStreamTs = Date.parse(sub.lastStreamDate);
    const activityKnown = isLive || Number.isFinite(lastStreamTs);
    const daysSinceStream = isLive ? 0 : (Date.now() - lastStreamTs) / (1000 * 60 * 60 * 24);
    const ratingColor = sub.rating >= 70 ? '#35d08a' : sub.rating >= 40 ? '#7c5cff' : '#f0555f';
    const activityStatus = !activityKnown ? 'Нет данных' : daysSinceStream > 30 ? this.i18n.t('subscriptions.inactive') : daysSinceStream > 7 ? this.i18n.t('subscriptions.rarely') : this.i18n.t('subscriptions.activeStatus');
    const activityIcon = !activityKnown ? '⚪' : daysSinceStream > 30 ? '🔴' : daysSinceStream > 7 ? '🟡' : '🟢';
    const activityColor = !activityKnown ? 'var(--text-secondary)' : daysSinceStream > 30 ? '#f0555f' : daysSinceStream > 7 ? '#ffaa00' : '#35d08a';

    // Всё, что пришло от Twitch, — только экранированным: описание канала
    // пишет сам стример, и раньше оно вставлялось в окно как разметка
    const avatarUrl = this.esc(this.safeImageUrl(sub.profileImageUrl));
    const displayName = this.esc(sub.displayName || sub.login || '');

    content.innerHTML = `
      <div style="position: relative; margin-bottom: 20px;">
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 120px; background-image: url('${avatarUrl}'); background-size: cover; background-position: center; filter: blur(40px); opacity: 0.3; border-radius: var(--radius-md);"></div>
        <div style="position: relative; text-align: center; padding: 20px 0;">
          <div style="position: relative; display: inline-block;">
            <img src="${avatarUrl}" alt="${displayName}" style="width: 100px; height: 100px; border-radius: var(--radius-circle); border: 4px solid var(--bg-primary); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
            ${isLive ? '<div style="position: absolute; bottom: 5px; right: 5px; width: 20px; height: 20px; background: #ff0000; border: 3px solid var(--bg-primary); border-radius: var(--radius-circle); box-shadow: 0 0 10px rgba(255, 0, 0, 0.8);"></div>' : ''}
          </div>
          <h2 style="color: var(--text-primary); font-size: 24px; font-weight: 700; margin: 12px 0 4px;">${displayName}</h2>
          <p style="color: var(--text-secondary); font-size: 14px; margin: 0 0 8px;">@${this.esc(sub.login)}</p>
          ${sub.description ? `
          <div style="max-width: 400px; margin: 0 auto 12px;">
            <p id="channel-description" style="color: var(--text-secondary); font-size: 13px; line-height: 1.4; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.esc(sub.description)}</p>
            <button id="show-more-desc" style="display: none; background: none; border: none; color: var(--accent-color); font-size: 12px; cursor: pointer; margin: 4px auto 0; padding: 0;"></button>
          </div>` : ''}
          ${isLive ? `<div style="display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 4px 12px; background: rgba(255, 0, 0, 0.15); border: 1px solid rgba(255, 0, 0, 0.3); border-radius: var(--radius-md); font-size: 12px; font-weight: 600; color: #ff4444;">
            <span style="width: 8px; height: 8px; background: #ff0000; border-radius: var(--radius-circle); animation: pulse-live 2s ease-in-out infinite;"></span>
            <span>В эфире</span>
            ${sub.gameName ? `<span style="opacity: 0.7;">• ${this.esc(sub.gameName)}</span>` : ''}
          </div>` : ''}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
        <div style="padding: 16px; background: rgba(53, 208, 138, 0.1); border: 1px solid rgba(53, 208, 138, 0.2); border-radius: var(--radius-md); text-align: center;">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.i18n.t('subscriptions.rating')}</div>
          <div style="font-size: 24px; font-weight: 700; color: ${ratingColor};">
            ${Number.isFinite(sub.rating) ? Math.round(sub.rating) : '—'}
          </div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${sub.rating >= 70 ? this.i18n.t('subscriptions.excellent') : sub.rating >= 40 ? this.i18n.t('subscriptions.average') : this.i18n.t('subscriptions.low')}</div>
        </div>
        
        <div style="padding: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: var(--radius-md); text-align: center;">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.i18n.t('subscriptions.followers')}</div>
          <div style="font-size: 24px; font-weight: 700; color: var(--accent-color);">${this.formatFollowers(sub.followers)}</div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${Number.isFinite(sub.followers) ? sub.followers.toLocaleString() : ''}</div>
        </div>
        
        <div style="padding: 16px; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: var(--radius-md); text-align: center;">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.i18n.t('subscriptions.activity')}</div>
          <div style="font-size: 20px; margin-bottom: 2px;">${activityIcon}</div>
          <div style="font-size: 13px; font-weight: 600; color: ${activityColor};">${activityStatus}</div>
        </div>
      </div>

      <div style="padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary);">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <div style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">${this.i18n.t('subscriptions.lastStream')}</div>
        </div>
        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${this.getLastStreamText(sub.lastStreamDate)}</div>
      </div>

      ${sub.hasDrops ? `<div style="padding: 16px; background: rgba(124, 92, 255, 0.15); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); display: flex; align-items: center; gap: 12px; margin-bottom: 16px;"><div style="font-size: 24px;">💎</div><div><div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${this.i18n.t('subscriptions.dropsAvailable')}</div><div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${this.i18n.t('subscriptions.canGetRewards')}</div></div></div>` : ''}

      <div style="display: flex; gap: 10px;">
        <button class="modal-btn modal-btn-primary" id="farm-channel-detail-btn" style="flex: 1; padding: 12px; background: var(--accent-color); border: none; border-radius: var(--radius-md); color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: none;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
            </svg>
            <span>${this.i18n.t('subscriptions.startFarming')}</span>
          </div>
        </button>
        <button class="modal-btn modal-btn-secondary" id="view-twitch-btn" style="padding: 12px 16px; background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); color: var(--accent-color); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
          </svg>
        </button>
        <button class="modal-btn modal-btn-danger" id="unsub-channel-detail-btn" style="padding: 12px 16px; background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: var(--radius-md); color: #f0555f; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    `;

    document.getElementById('farm-channel-detail-btn')?.addEventListener('click', () => {
      this.startFarmingChannel(sub);
      this.closeModal();
    });

    document.getElementById('view-twitch-btn')?.addEventListener('click', () => {
      window.electronAPI.openExternal(`https://www.twitch.tv/${sub.login}`);
    });

    document.getElementById('unsub-channel-detail-btn')?.addEventListener('click', () => {
      this.unsubscribeChannel(sub);
      this.closeModal();
    });

    // Добавляем стили для кнопок при наведении
    const style = document.createElement('style');
    style.textContent = `
      .modal-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
      .modal-btn-primary:hover {
        box-shadow: none;
      }
      .modal-btn-secondary:hover {
        background: rgba(124, 92, 255, 0.2);
      }
      .modal-btn-danger:hover {
        background: rgba(255, 107, 107, 0.2);
      }
    `;
    if (!document.getElementById('modal-btn-styles')) {
      style.id = 'modal-btn-styles';
      document.head.appendChild(style);
    }

    // Проверяем, нужна ли кнопка "Показать больше" для описания
    if (sub.description) {
      setTimeout(() => {
        const descElement = document.getElementById('channel-description');
        const btnElement = document.getElementById('show-more-desc');

        if (descElement && btnElement) {
          // Проверяем, переполнен ли текст (есть ли обрезка)
          const isOverflowing = descElement.scrollWidth > descElement.clientWidth;

          if (isOverflowing) {
            btnElement.style.display = 'block';
            btnElement.textContent = 'Показать больше';

            btnElement.onclick = () => {
              if (descElement.style.whiteSpace === 'nowrap') {
                descElement.style.whiteSpace = 'normal';
                descElement.style.overflow = 'visible';
                btnElement.textContent = 'Скрыть';
              } else {
                descElement.style.whiteSpace = 'nowrap';
                descElement.style.overflow = 'hidden';
                btnElement.textContent = 'Показать больше';
              }
            };
          }
        }
      }, 100);
    }

    modal.style.display = 'flex';
  }

  closeModal() {
    const modal = document.getElementById('channel-detail-modal');
    if (modal) modal.style.display = 'none';
  }

  // Элементы страницы к этому моменту могут быть уже удалены (со страницы
  // ушли, пока шла загрузка), поэтому стиль ставим только существующим
  setDisplay(id, value) {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  }

  showAuthSection() {
    this.setDisplay('subscriptions-auth-section', 'block');
    this.setDisplay('subscriptions-content', 'none');
  }

  showContentSection() {
    this.setDisplay('subscriptions-auth-section', 'none');
    this.setDisplay('subscriptions-content', 'block');
  }

  /**
   * Ненавязчивая отметка «обновляю» поверх уже показанного списка.
   *
   * Прятать список ради спиннера незачем: старые данные полезнее пустого
   * места, а обновление занимает секунду-другую.
   */
  showRefreshingHint() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    list.classList.add('refreshing');
  }

  hideRefreshingHint() {
    document.getElementById('subscriptions-list')?.classList.remove('refreshing');
  }

  showLoadingState() {
    this.setDisplay('subscriptions-loading', 'block');
    this.setDisplay('subscriptions-list', 'none');
    this.setDisplay('subscriptions-empty', 'none');
  }

  hideLoadingState() {
    this.setDisplay('subscriptions-loading', 'none');
    this.hideRefreshingHint();
  }

  showEmptyState() {
    this.setDisplay('subscriptions-loading', 'none');
    this.setDisplay('subscriptions-list', 'none');
    this.setDisplay('subscriptions-empty', 'block');
  }

  async refreshSubscriptions() {
    if (this._refreshing) return;
    this._refreshing = true;

    // Кнопка — одна иконка без текста. Раньше на время загрузки в неё
    // ставился текст «Загрузка...», а после — другая разметка с подписью
    // «Обновить»: панель прыгала, и кнопка навсегда меняла вид. Теперь
    // исходная разметка запоминается и возвращается, а пока идёт загрузка,
    // иконка просто крутится.
    const btn = document.getElementById('refresh-subs-btn');
    const originalHtml = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.querySelector('svg')?.style.setProperty('animation', 'spin 1s linear infinite');
    }

    try {
      // Тост успеха — только если Twitch действительно отдал список.
      // О неудаче loadSubscriptions сообщает сама
      const ok = await this.loadSubscriptions({ force: true });
      if (ok && !this._destroyed) window.utils.showToast('Подписки обновлены', 'success');
    } catch (error) {
      window.utils.showToast('Ошибка обновления подписок', 'error');
    } finally {
      this._refreshing = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  }

  /**
   * «Очистить неактивные»: массовая отписка на Twitch.
   *
   * Раньше неактивным считался любой канал не в эфире прямо сейчас, а при
   * несработавших подробностях — вообще все. Одно нажатие отписывало почти
   * от всех подписок, ошибки отписки не проверялись, а из списка каналы
   * убирались в любом случае.
   *
   * Теперь под очистку попадают только каналы, у которых дата последнего
   * эфира проверена недавно и старше 30 дней. Избранные и идущие в эфире
   * не трогаются. Перед отпиской — список с галочками, отписка по одному
   * с прогрессом на кнопке, из списка убираются только успешно отписанные.
   */
  async cleanupInactive() {
    if (this._cleanupRunning) return;

    const candidates = this.subscriptions.filter(s =>
      !s.isFavorite &&
      this.isChannelInactive(s) &&
      this.isDetailsFresh(s, SubscriptionsPage.CLEANUP_CHECK_MAX_AGE_MS)
    );

    if (candidates.length === 0) {
      // Дата есть только в старых сохранённых данных — по ней не отписываем
      const unchecked = this.subscriptions.some(s => !s.isFavorite && this.isChannelInactive(s));
      window.utils.showToast(
        this.isDetailsLoading()
          ? 'Данные каналов ещё загружаются — попробуйте чуть позже'
          : unchecked
            ? 'Активность каналов давно не проверялась — нажмите «Обновить»'
            : 'Нет каналов, которые не стримили больше 30 дней',
        'info'
      );
      return;
    }

    const rows = candidates.map(s => `
      <label style="display: flex; align-items: center; gap: 10px; padding: 6px 4px; cursor: pointer;">
        <input type="checkbox" data-sub-id="${this.esc(s.id)}" checked>
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 14px;">${this.esc(s.displayName || s.login)}</span>
        <span style="color: var(--text-secondary); font-size: 12px; white-space: nowrap;">${this.esc(this.getLastStreamText(s.lastStreamDate))}</span>
      </label>
    `).join('');

    const modalHtml = `
      <div id="subs-cleanup-confirm">
        <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin: 0 0 8px; text-align: center;">Отписаться от неактивных каналов?</h3>
        <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin: 0 0 16px; text-align: center;">Эти каналы не стримили больше 30 дней. Снимите галочки с тех, кого хотите оставить. Отписка выполнится на Twitch.</p>
        <div style="max-height: 260px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 4px 8px;">${rows}</div>
      </div>
    `;

    const confirmLabel = (n) => `Отписаться от ${n}`;
    const selected = new Set(candidates.map(s => String(s.id)));

    const pending = window.utils.showCustomConfirmation(modalHtml, {
      confirmText: confirmLabel(candidates.length),
      cancelText: 'Отмена',
      confirmClass: 'btn-danger'
    });

    // Окно уже в документе: следим за галочками и держим число на кнопке
    // в соответствии с выбором
    const root = document.getElementById('subs-cleanup-confirm');
    const okBtn = root?.closest('#confirmation-modal')?.querySelector('#confirm-ok');
    if (okBtn) {
      // «Отписаться от 12» не помещается в стандартную ширину кнопки
      okBtn.style.maxWidth = '220px';
      okBtn.style.whiteSpace = 'nowrap';
    }
    root?.addEventListener('change', (e) => {
      const box = e.target.closest?.('input[data-sub-id]');
      if (!box) return;
      if (box.checked) selected.add(box.dataset.subId);
      else selected.delete(box.dataset.subId);
      if (okBtn) {
        okBtn.textContent = confirmLabel(selected.size);
        okBtn.disabled = selected.size === 0;
      }
    });

    if (!(await pending)) return;

    const targets = candidates.filter(s => selected.has(String(s.id)));
    if (targets.length === 0) return;

    this._cleanupRunning = true;
    const btn = document.getElementById('cleanup-subs-btn');
    const originalHtml = btn?.innerHTML;
    if (btn) btn.disabled = true;

    const done = [];
    let failed = 0;
    let crashed = false;

    try {
      for (let i = 0; i < targets.length; i++) {
        const sub = targets[i];
        // Отписка занимает секунды на канал: без прогресса казалось, что
        // ничего не происходит, и кнопку нажимали ещё раз
        if (btn) btn.textContent = `Отписываюсь… ${i + 1} из ${targets.length}`;

        let result = null;
        try {
          result = await window.electronAPI.unsubscribeChannel(null, sub.login);
        } catch (e) {
          result = { success: false, error: e?.message };
        }

        if (result?.success) {
          done.push(sub.id);
        } else {
          failed++;
          console.warn('[Subscriptions] Не удалось отписаться от', sub.login, result?.error);
        }
      }

      await this.forgetChannels(done);
    } catch (error) {
      crashed = true;
      console.error('Error cleaning up subscriptions:', error);
    } finally {
      this._cleanupRunning = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }

    const ok = done.length;
    const total = targets.length;
    if (crashed) {
      window.utils.showToast('Ошибка при удалении подписок', 'error');
    } else if (failed === 0) {
      window.utils.showToast(`Отписались от ${ok} ${this.plural(ok, 'канала', 'каналов', 'каналов')}`, 'success');
    } else if (ok === 0) {
      window.utils.showToast('Не удалось отписаться ни от одного канала — они остались в списке', 'error');
    } else {
      window.utils.showToast(`Отписались от ${ok} из ${total}, не удалось: ${failed} — они остались в списке`, 'warning');
    }
  }

  /**
   * Убирает отписанные каналы из списка и с диска.
   *
   * Если со страницы уже ушли, правим то, что лежит на диске: список этого
   * экземпляра мог устареть, и его запись затёрла бы изменения, сделанные
   * на заново открытой странице.
   */
  async forgetChannels(ids) {
    const gone = new Set(ids);
    if (gone.size === 0) return;

    this.subscriptions = this.subscriptions.filter(s => !gone.has(s.id));

    if (this._destroyed) {
      const stored = (await Storage.getSubscriptions()) || [];
      await Storage.saveSubscriptions(stored.filter(s => !gone.has(s?.id)));
      return;
    }

    await Storage.saveSubscriptions(this.subscriptions);
    this.applyFilter();
  }

  async unsubscribeChannel(sub) {
    const modalHtml = `
      <div style="text-align: center;">
        <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255, 107, 107, 0.2); border-radius: var(--radius-circle); display: flex; align-items: center; justify-content: center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f0555f" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </div>
        <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Отписаться от ${this.esc(sub.displayName || sub.login)}?</h3>
        <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 24px;">Отписка выполнится прямо здесь, переходить на Twitch не нужно.</p>
      </div>
    `;

    const confirmed = await window.utils.showCustomConfirmation(modalHtml, {
      confirmText: 'Отписаться',
      cancelText: 'Отмена',
      confirmClass: 'btn-danger'
    });

    if (!confirmed) return;

    try {
      // Настоящая отписка через Twitch. Раньше приложение только убирало
      // канал из своего списка и открывало сайт, предлагая отписаться
      // вручную — при том, что вызов для отписки давно был реализован,
      // просто его никто не вызывал.
      // Передаём login: отписка выполняется действием на самой странице
      // канала, а не запросом по идентификатору
      const result = await window.electronAPI.unsubscribeChannel(null, sub.login);

      if (!result?.success) {
        console.error('Не удалось отписаться:', result?.error);
        window.utils.showToast(
          'Не удалось отписаться: ' + (result?.error || 'неизвестная ошибка'),
          'error'
        );
        return;
      }

      // Из списка убираем только после подтверждённой отписки, иначе канал
      // исчезал бы из приложения, оставаясь в подписках на Twitch
      await this.forgetChannels([sub.id]);

      const name = sub.displayName || sub.login;
      window.utils.showToast(
        result.already
          ? `Вы уже не подписаны на ${name}`
          : `Отписка от ${name} выполнена`,
        'success'
      );
    } catch (error) {
      console.error('Error removing subscription:', error);
      window.utils.showToast('Ошибка при отписке', 'error');
    }
  }

  /**
   * «Начать фарминг» с карточки канала.
   *
   * Раньше вызывался несуществующий router.switchPage — переход падал с
   * ошибкой, а тост «Начинаем фарминг» появлялся до того, как стало
   * известно, получилось ли. Теперь тост — по результату.
   */
  async startFarmingChannel(sub) {
    if (this._startingFarm) return;
    this._startingFarm = true;
    // После восстановления из копии displayName может быть пустым
    const name = sub.displayName || sub.login;

    try {
      // Страница фарминга создаётся при запуске приложения и живёт всё
      // время, но если её почему-то нет — сначала открываем её, иначе
      // добавлять канал некуда
      if (!window.farmingPage?.addChannelToFarming) {
        await window.router?.navigate('farming');
      }

      const farming = window.farmingPage;
      if (!farming?.addChannelToFarming) {
        window.utils.showToast('Страница фарминга ещё не готова — попробуйте ещё раз', 'warning');
        return;
      }

      window.utils.showToast(`Запускаю ${name}…`, 'info');
      // Имя и аватарка нужны фармингу для тостов и карточки стрима: без них
      // там стоял логин («ow_esports_kr сейчас не в эфире») и пустая аватарка
      const result = await farming.addChannelToFarming(sub.login, {
        displayName: name,
        profileImageUrl: this.safeImageUrl(sub.profileImageUrl) || null
      });

      // { ok: false, reason } — канал запустить нельзя (офлайн, у игры нет
      // дропсов). Остаёмся на подписках и объясняем почему
      if (result?.ok === false) {
        const reason = typeof result.reason === 'string' && /[а-яё]/i.test(result.reason)
          ? result.reason
          : `Не удалось запустить ${name}`;
        window.utils.showToast(reason, 'warning');
        return;
      }

      // Прежняя версия ничего не возвращала и сама сообщала о неудаче,
      // поэтому без явного отказа просто переходим на фарминг. Запуск
      // занимает несколько секунд: если за это время пользователь ушёл на
      // другую страницу, не выдёргиваем его оттуда — хватит тоста
      if (!this._destroyed && window.router && window.router.currentPage !== 'farming') {
        await window.router.navigate('farming');
      }
      if (result?.ok === true) {
        window.utils.showToast(`Фарминг ${name} запущен`, 'success');
      }
    } catch (error) {
      console.error('Error starting farming:', error);
      window.utils.showToast('Ошибка при запуске фарминга', 'error');
    } finally {
      this._startingFarm = false;
    }
  }

  async toggleFavorite(sub) {
    try {
      sub.isFavorite = !sub.isFavorite;

      // Обновляем в массиве
      const index = this.subscriptions.findIndex(s => s.id === sub.id);
      if (index !== -1) {
        this.subscriptions[index].isFavorite = sub.isFavorite;
      }

      // Сохраняем
      await Storage.saveSubscriptions(this.subscriptions);

      // Перерисовываем
      this.applyFilter();

      // После восстановления из копии displayName бывает пустым — как и в
      // остальных тостах страницы, тогда показываем логин, а не «null»
      const name = sub.displayName || sub.login;
      window.utils.showToast(
        sub.isFavorite ? `${name} добавлен в избранное` : `${name} убран из избранного`,
        'success'
      );
    } catch (error) {
      console.error('Error toggling favorite:', error);
      window.utils.showToast('Ошибка при обновлении избранного', 'error');
    }
  }

  updateViewMode() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    list.className = this.currentView === 'grid' ? 'subscriptions-grid-view' : 'subscriptions-list-view';
  }

  async savePrioritySetting(enabled) {
    try {
      await Storage.setItem('subscriptions_priority_enabled', enabled);
      window.utils.showToast(
        enabled ? 'Приоритет подписок включен' : 'Приоритет подписок отключен',
        'success'
      );
    } catch (error) {
      console.error('Error saving priority setting:', error);
    }
  }

  async loadPrioritySetting() {
    try {
      const enabled = await Storage.getItem('subscriptions_priority_enabled');
      const toggle = document.getElementById('priority-subs-toggle');
      if (toggle) {
        toggle.checked = enabled || false;
      }
    } catch (error) {
      console.error('Error loading priority setting:', error);
    }
  }

  // Drag and Drop methods
  handleDragStart(e, sub) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.innerHTML);
    e.target.classList.add('dragging');
    this.draggedSub = sub;
  }

  handleDragEnd(e) {
    e.target.classList.remove('dragging');
    this.draggedSub = null;
    document.querySelectorAll('.subscription-card').forEach(card => {
      card.classList.remove('drag-over');
    });
  }

  handleDragOver(e) {
    if (e.preventDefault) {
      e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';

    const card = e.target.closest('.subscription-card');
    if (card && !card.classList.contains('dragging')) {
      card.classList.add('drag-over');
    }

    return false;
  }

  handleDragLeave(e) {
    const card = e.target.closest('.subscription-card');
    if (card) {
      card.classList.remove('drag-over');
    }
  }

  async handleDrop(e, targetSub) {
    if (e.stopPropagation) {
      e.stopPropagation();
    }

    const card = e.target.closest('.subscription-card');
    if (card) {
      card.classList.remove('drag-over');
    }

    if (!this.draggedSub || this.draggedSub.id === targetSub.id) {
      return false;
    }

    // Порядок задаётся только между избранными
    if (!this.draggedSub.isFavorite || !targetSub.isFavorite) {
      return false;
    }

    // Получаем индексы
    const draggedIndex = this.filteredSubscriptions.findIndex(s => s.id === this.draggedSub.id);
    const targetIndex = this.filteredSubscriptions.findIndex(s => s.id === targetSub.id);

    if (draggedIndex === -1 || targetIndex === -1) {
      return false;
    }

    // Меняем местами в filteredSubscriptions
    const temp = this.filteredSubscriptions[draggedIndex];
    this.filteredSubscriptions[draggedIndex] = this.filteredSubscriptions[targetIndex];
    this.filteredSubscriptions[targetIndex] = temp;

    // Обновляем приоритет ТОЛЬКО для избранных каналов
    const newPriorities = new Map();
    this.filteredSubscriptions.forEach((sub, index) => {
      if (sub.isFavorite) {
        newPriorities.set(sub.id, index);
      }
    });

    let changed = false;
    this.subscriptions.forEach(sub => {
      if (newPriorities.has(sub.id) && sub.priority !== newPriorities.get(sub.id)) {
        sub.priority = newPriorities.get(sub.id);
        changed = true;
      }
    });

    // «Порядок обновлен» — только если он действительно изменился.
    // Иначе возвращаем список к сохранённому порядку
    if (!changed) {
      this.applyFilter();
      return false;
    }

    // Сохраняем
    await Storage.saveSubscriptions(this.subscriptions);

    // Перерисовываем
    this.renderSubscriptions();

    window.utils.showToast('Порядок обновлен', 'success');

    return false;
  }
}

// Экспортируем класс в window для использования в router
window.SubscriptionsPage = SubscriptionsPage;
