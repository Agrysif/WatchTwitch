// Страница настроек.
//
// Раньше это была одна колонка из шести карточек, где «Автоматизация»
// смешивала двадцать пунктов: награды, автовыключение, качество, автозапуск.
// Теперь — восемь разделов по смыслу, навигация слева, поиск и зависимые
// пункты, которые появляются только тогда, когда включён их «родитель».
// Все id переключателей и полей прежние: на них завязаны обработчики ниже
// и чужой код (например, сводка автовыключения).
class SettingsPage {
  constructor() {
    // Обработчики на document не исчезают вместе со страницей —
    // снимаем их разом в destroy()
    this._abort = new AbortController();
    this.init();
  }

  destroy() {
    // Контроллер не обнуляем: render() асинхронный, и setupEventListeners
    // может отработать уже после уничтожения страницы — отменённый сигнал
    // не даст обработчикам закрепиться на document.
    if (this._abort) {
      this._abort.abort();
    }
    this._renderAbort?.abort();
    clearTimeout(this._navLockTimer);
  }

  async init() {
    await this.render();
    this.setupEventListeners();
    this.loadAppVersion();
  }

  /**
   * События звука. Список ведёт chime.js (Chime.EVENTS); пока его там нет,
   * берём запасной с теми же ключами настроек — переключатели работают и
   * без него, звук просто сыграет по-старому.
   */
  static soundEvents() {
    const events = window.Chime?.EVENTS;
    if (Array.isArray(events) && events.length > 0) return events;
    return SettingsPage.FALLBACK_SOUND_EVENTS;
  }

  static get FALLBACK_SOUND_EVENTS() {
    return [
      { id: 'drop', label: tr('Награда получена'), hint: tr('Восходящий аккорд из трёх нот'), setting: 'soundDrop', defaultOn: true },
      { id: 'chest', label: tr('Сундук собран'), hint: tr('Короткая «монетка». Сундуки бывают каждые 15 минут'), setting: 'soundChest', defaultOn: false },
      { id: 'allDone', label: tr('Все награды собраны'), hint: tr('Фарминг закончил всё, что было в списке'), setting: 'soundAllDone', defaultOn: true },
      { id: 'attention', label: tr('Нужно вмешаться'), hint: tr('Фарминг остановился, нет входа в Twitch или награда не забрана'), setting: 'soundAttention', defaultOn: true },
      { id: 'favourite', label: tr('Избранный канал в эфире'), hint: tr('Стример из избранного начал трансляцию'), setting: 'soundFavourite', defaultOn: true }
    ];
  }

  async render() {
    const container = document.getElementById('page-container');
    if (!container) return;

    const settings = window.settings;
    if (!settings) {
      console.error('Settings manager not initialized');
      return;
    }

    // Обработчики на document и прокрутке .content привязаны к разметке:
    // перерисовка (смена языка, сброс, восстановление копии) снимает старые
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();

    const i18n = window.i18n;
    const esc = window.escapeHtml;
    const I = (name, size = 16) => window.Icons?.get(name, size) ?? '';
    // Значки меню разделов, которых нет в общем наборе: «монитор» там уже
    // означает фарминг (главное меню), а у окна, питания и оформления своих
    // рисунков нет. Тот же стиль — контур 1.75 на сетке 24
    const navIcon = (name) => {
      const own = {
        window: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><path d="M6 6.5h.01M9 6.5h.01"/>',
        power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
        palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/><path d="M13.5 6.5h.01M17.5 10.5h.01M8.5 7.5h.01M6.5 12.5h.01"/>'
      }[name];
      return own
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${own}</svg>`
        : I(name, 16);
    };
    const get = (key) => settings.get(key);

    const toggle = (id, checked, attrs = '', describedBy = `${id}-desc`) => `
      <label class="settings-toggle">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} aria-describedby="${describedBy}" ${attrs}>
        <span class="settings-slider"></span>
      </label>`;

    // Строка настройки. id — элемент управления: подпись становится его
    // <label>, и щелчок по тексту переключает так же, как по самому
    // переключателю. parent / parentValue — от чего строка зависит:
    // скрывается (или приглушается при mode: 'dim'), пока родитель выключен
    const item = ({ id = '', labelId = '', label, desc = '', control = '', sub = false, stacked = false,
                    parent = '', parentValue = '', mode = '', cls = '', extra = '', live = false,
                    descId = '', descAttrs = '', keywords = '' }) => {
      const classes = ['settings-item', sub && 'is-sub', stacked && 'is-stacked', cls].filter(Boolean).join(' ');
      const labelHtml = id
        ? `<label class="settings-item-label" for="${id}">${label}</label>`
        : `<div class="settings-item-label"${labelId ? ` id="${labelId}"` : ''}>${label}</div>`;
      const dId = descId || (id ? `${id}-desc` : '');
      const attrs = [
        parent && `data-parent="${parent}"`,
        parentValue && `data-parent-value="${parentValue}"`,
        mode && `data-mode="${mode}"`,
        keywords && `data-keywords="${esc(keywords)}"`
      ].filter(Boolean).join(' ');
      return `
        <div class="${classes}" ${attrs}>
          <div class="settings-item-info">
            ${labelHtml}
            ${desc || live ? `<div class="settings-item-description"${dId ? ` id="${dId}"` : ''}${live ? ' data-live' : ''} ${descAttrs}>${desc}</div>` : ''}
            ${extra}
          </div>
          ${control ? `<div class="settings-item-control">${control}</div>` : ''}
        </div>`;
    };

    const segmented = (id, current, options, labelledBy) => `
      <div class="segmented" id="${id}" role="group" aria-labelledby="${labelledBy}" data-value="${current}">
        ${options.map(o => `
          <button type="button" data-value="${o.value}" class="${o.value === current ? 'active' : ''}" aria-pressed="${o.value === current}"${o.noTr ? ' data-no-tr' : ''}>
            ${o.icon ? I(o.icon, 14) : ''}<span>${o.label}</span>
          </button>`).join('')}
      </div>`;

    const section = (id, title, body) => `
      <section class="settings-section" id="${id}" aria-labelledby="${id}-title">
        <h2 class="settings-section-title" id="${id}-title" tabindex="-1">${title}</h2>
        ${body}
      </section>`;

    const sections = [
      { id: 'set-farming', icon: 'play', title: tr('Фарминг') },
      { id: 'set-notify', icon: 'bell', title: tr('Уведомления и звук') },
      { id: 'set-perf', icon: 'gamepad', title: tr('Игры и нагрузка') },
      { id: 'set-window', icon: 'window', title: tr('Окно и запуск') },
      { id: 'set-shutdown', icon: 'power', title: tr('Автовыключение') },
      { id: 'set-look', icon: 'palette', title: tr('Оформление') },
      { id: 'set-data', icon: 'folder', title: tr('Данные') },
      { id: 'set-about', icon: 'info', title: tr('О программе') }
    ];
    const titleOf = (id) => sections.find(s => s.id === id).title;

    // ── 1. Фарминг ──
    const quality = get('preferredStreamQuality');
    const farmingHtml = [
      item({
        id: 'setting-auto-claim',
        label: tr('Автоматически забирать награды'),
        desc: tr('Награда забирается сама, как только Twitch её выдал'),
        control: toggle('setting-auto-claim', get('autoClaimDrops'))
      }),
      item({
        id: 'setting-auto-switch',
        label: tr('Автопереключение стримов'),
        desc: tr('Эфир закончился, канал не засчитывает минуты или стример сменил игру — перейти на другой стрим'),
        control: toggle('setting-auto-switch', get('autoSwitchStreams'))
      }),
      item({
        id: 'setting-smart-switch',
        label: tr('Выбирать категорию по выгоде'),
        desc: tr('Пропускать кампании, которые уже не успеть, и идти туда, где за час больше наград'),
        control: toggle('setting-smart-switch', get('smartCategorySwitch') !== false)
      }),
      item({
        id: 'setting-suggest',
        label: tr('Подсказывать выгодные категории'),
        desc: tr('Показывать на «Фарминге» игры с дропсами, которых нет в вашем списке'),
        control: toggle('setting-suggest', get('suggestCategories') !== false)
      }),
      item({
        id: 'setting-quality',
        label: tr('Качество стрима'),
        desc: tr('Для зачёта минут хватает 160p. Выше качество — больше трафика'),
        control: `
          <select class="input-field" id="setting-quality" aria-describedby="setting-quality-desc">
            <option value="160p30" ${quality === '160p30' ? 'selected' : ''}>${tr('Минимальное (160p)')}</option>
            <option value="360p30" ${quality === '360p30' ? 'selected' : ''}>360p</option>
            <option value="480p30" ${quality === '480p30' ? 'selected' : ''}>480p</option>
          </select>`
      }),
      item({
        id: 'setting-background-chat',
        label: tr('Фоновый чат Twitch'),
        desc: tr('Включите, только если сундуки перестали собираться. Без чата — на 190 МБ памяти меньше'),
        control: toggle('setting-background-chat', get('backgroundChat') === true),
        keywords: tr('сундук баллы память chat')
      })
    ].join('');

    // ── 2. Уведомления и звук ──
    const soundVolume = settings.constructor.clampVolume
      ? settings.constructor.clampVolume(get('soundVolume'))
      : (Number(get('soundVolume')) || 0.5);
    const systemOn = get('systemNotifications') !== false && get('notifications') !== false;

    const soundEvents = SettingsPage.soundEvents();
    // Название сигнала «нужно вмешаться» — из того же списка событий, что и
    // строка выше: подпись про игру не должна называть его иначе
    // Подписи событий приходят из chime.js; tr() на случай, если там они
    // остались русскими: уже переведённую строку он вернёт как есть
    const attentionLabel = tr(soundEvents.find(ev => ev.id === 'attention')?.label) || tr('Нужно вмешаться');
    const soundEventsHtml = soundEvents.map(ev => {
      const id = `setting-sound-${String(ev.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const enabled = ev.defaultOn ? get(ev.setting) !== false : get(ev.setting) === true;
      const label = tr(ev.label) || ev.id;
      return item({
        id,
        label: esc(label),
        desc: esc(tr(ev.hint) || ''),
        sub: true,
        parent: 'setting-sound',
        control: `
          <button type="button" class="btn btn-ghost btn-icon btn-sm settings-preview" data-preview="${esc(ev.id)}"
                  title="${tr('Прослушать')}" aria-label="${tr('Прослушать: {name}', { name: esc(label) })}">${I('play', 14)}</button>
          ${toggle(id, enabled, `data-sound-key="${esc(ev.setting)}" data-default-on="${ev.defaultOn ? '1' : '0'}"`)}`
      });
    }).join('');

    const notifyHtml = [
      item({
        id: 'setting-toast',
        label: tr('Всплывающие сообщения в окне'),
        desc: tr('Короткие сообщения в углу окна. Ошибки и ответы на нажатия видны всегда'),
        control: toggle('setting-toast', get('toastNotifications'))
      }),
      item({
        id: 'setting-system-notifications',
        label: tr('Уведомления Windows'),
        desc: tr('Сообщения в углу экрана, пока окно свёрнуто или в трее: фарминг остановился, нужен вход, кампания заканчивается'),
        control: toggle('setting-system-notifications', systemOn)
      }),
      item({
        id: 'setting-notify-drop',
        label: tr('О полученных наградах'),
        desc: tr('Карточка с картинкой награды. Во время игры — одна сводка после неё'),
        control: toggle('setting-notify-drop', get('notifyOnDropClaimed')),
        sub: true, parent: 'setting-system-notifications', mode: 'dim'
      }),
      item({
        id: 'setting-favourite-live',
        label: tr('О выходе избранных каналов'),
        desc: tr('Избранный стример начал эфир — и есть ли по его игре дропсы'),
        control: toggle('setting-favourite-live', get('notifyFavouriteLive') !== false),
        sub: true, parent: 'setting-system-notifications', mode: 'dim'
      }),
      item({
        labelId: 'test-notification-label', descId: 'test-notification-desc',
        label: tr('Пробное уведомление'),
        desc: tr('Покажет, как выглядит окно о награде'),
        control: `<button type="button" class="btn btn-secondary btn-sm" id="test-notification-btn" aria-describedby="test-notification-label test-notification-desc">${I('bell', 14)}<span>${tr('Показать')}</span></button>`,
        sub: true, keywords: tr('проверить тест')
      }),
      item({
        id: 'setting-sound',
        label: tr('Звуки'),
        desc: tr('Короткие сигналы о наградах и о том, что нужно вмешаться'),
        control: toggle('setting-sound', get('soundEnabled')),
        keywords: tr('звук сигнал громкость колокольчик sound')
      }),
      item({
        id: 'setting-sound-volume',
        label: tr('Громкость'),
        sub: true, parent: 'setting-sound',
        control: `
          <input type="range" class="ios-range settings-range" id="setting-sound-volume" min="0" max="1" step="0.05" value="${soundVolume}">
          <output class="settings-range-value num" id="setting-sound-volume-value" for="setting-sound-volume">${Math.round(soundVolume * 100)}%</output>`
      }),
      soundEventsHtml,
      item({
        id: 'setting-sound-in-game',
        label: tr('Звуки во время игры'),
        desc: tr('Обычно в игре приложение молчит. Сигнал «{name}» звучит всегда', { name: esc(attentionLabel) }),
        control: toggle('setting-sound-in-game', get('soundInGame') === true),
        sub: true, parent: 'setting-sound'
      }),
      item({
        id: 'setting-quiet',
        label: tr('Тихие часы'),
        desc: tr('Ночью без звуков и уведомлений — фарминг идёт сам, будить незачем'),
        control: toggle('setting-quiet', get('quietHours') !== false),
        keywords: tr('ночь тишина')
      }),
      item({
        labelId: 'quiet-range-label',
        label: tr('Промежуток'),
        desc: '', live: true, descId: 'quiet-note',
        control: `
          <div class="quiet-range" role="group" aria-labelledby="quiet-range-label">
            <input type="time" id="setting-quiet-from" value="${esc(get('quietFrom') || '23:00')}" aria-label="${tr('С')}">
            <span aria-hidden="true">—</span>
            <input type="time" id="setting-quiet-to" value="${esc(get('quietTo') || '09:00')}" aria-label="${tr('До')}">
          </div>`,
        sub: true, parent: 'setting-quiet'
      })
    ].join('');

    // ── 3. Игры и нагрузка ──
    const perfHtml = [
      item({
        id: 'setting-game-mode',
        label: tr('Игровой режим'),
        desc: tr('Пока запущена игра, стрим уходит в 160p с потолком скорости — пинг не прыгает. Overwatch, CS2, VALORANT, Dota 2 и десятки других узнаются сами'),
        control: toggle('setting-game-mode', get('gameMode') !== false),
        keywords: tr('игра пинг процесс exe')
      }),
      item({
        id: 'setting-game-processes',
        label: tr('Свои игры'),
        desc: tr('Имена файлов .exe через запятую — их видно в Диспетчере задач на вкладке «Подробности»'),
        control: `
          <input type="text" id="setting-game-processes" class="settings-input" spellcheck="false" autocomplete="off"
                 placeholder="${tr('например, mygame.exe, other.exe')}"
                 aria-describedby="setting-game-processes-desc game-processes-note"
                 value="${esc(String(get('gameModeProcesses') || ''))}">
          <div class="settings-note" id="game-processes-note" data-live></div>`,
        sub: true, stacked: true, parent: 'setting-game-mode'
      }),
      item({
        id: 'setting-limit-speed',
        label: tr('Не мешать играм и связи'),
        desc: tr('Растягивать загрузку стрима: рывки видео не забивают канал и не подбрасывают пинг'),
        control: toggle('setting-limit-speed', get('limitStreamSpeed') !== false),
        extra: '<div class="settings-note" id="limit-note" data-live></div>',
        keywords: tr('скорость пинг сеть интернет')
      }),
      item({
        id: 'setting-low-graphics',
        label: tr('Экономный режим графики'),
        desc: tr('Не занимать видеокарту ради видео в 160p. Сработает после перезапуска'),
        control: toggle('setting-low-graphics', get('lowGraphics') !== false),
        keywords: tr('видеокарта gpu ускорение память')
      })
    ].join('');

    // ── 4. Окно и запуск ──
    const combo = (...keys) => `<span class="kbd-combo">${keys.map(k => `<kbd>${k}</kbd>`).join('')}</span>`;
    const windowHtml = [
      item({
        id: 'setting-autostart',
        label: tr('Запускать вместе с Windows'),
        desc: tr('Приложение откроется само после включения компьютера'),
        control: toggle('setting-autostart', get('autostart')),
        keywords: tr('автозапуск')
      }),
      item({
        id: 'setting-minimize-tray',
        label: tr('Сворачивать в трей'),
        desc: tr('Крестик прячет окно в трей, фарминг продолжается'),
        control: toggle('setting-minimize-tray', get('minimizeToTray')),
        keywords: tr('закрыть крестик')
      }),
      item({
        id: 'setting-shortcuts',
        label: tr('Горячие клавиши'),
        desc: tr('Работают поверх других окон, даже в игре'),
        control: toggle('setting-shortcuts', get('globalShortcuts') !== false),
        cls: 'is-top',
        extra: `
          <div class="settings-keys">
            ${combo('Ctrl', 'Alt', 'F')}<span>${tr('запустить или остановить фарминг')}</span>
            ${combo('Ctrl', 'Alt', 'N')}<span>${tr('другой стрим')}</span>
            ${combo('Ctrl', 'Alt', 'W')}<span>${tr('показать или скрыть окно')}</span>
          </div>
          <div class="settings-note tone-warn" id="shortcuts-note" data-live></div>`,
        keywords: tr('ctrl alt клавиатура сочетание')
      })
    ].join('');

    // ── 5. Автовыключение ──
    const shutdownOn = !!get('enableShutdown');
    // Подпись под переключателем: пока он выключен — что он делает вообще,
    // включён — что и когда произойдёт (сводку пишет shutdownManager)
    const shutdownIdle = tr('Выключить или усыпить компьютер, когда фарминг закончит работу');
    const sel = (key, value) => String(get(key)) === String(value) ? 'selected' : '';
    const shutdownHtml = [
      item({
        id: 'setting-shutdown',
        label: tr('Выключать компьютер после фарминга'),
        desc: shutdownOn && window.shutdownManager ? esc(window.shutdownManager.describeSchedule()) : shutdownIdle,
        live: true, descId: 'shutdown-summary', descAttrs: `data-idle="${esc(shutdownIdle)}"`,
        control: toggle('setting-shutdown', shutdownOn, '', 'shutdown-summary'),
        keywords: tr('выключение сон гибернация таймер')
      }),
      item({
        id: 'setting-shutdown-action',
        label: tr('Что сделать'),
        control: `
          <select class="input-field" id="setting-shutdown-action">
            <option value="shutdown" ${sel('shutdownAction', 'shutdown')}>${tr('Выключить компьютер')}</option>
            <option value="sleep" ${sel('shutdownAction', 'sleep')}>${tr('Спящий режим')}</option>
            <option value="hibernate" ${sel('shutdownAction', 'hibernate')}>${tr('Гибернация')}</option>
          </select>`,
        sub: true, parent: 'setting-shutdown', cls: 'shutdown-option'
      }),
      item({
        id: 'setting-shutdown-trigger',
        label: tr('Когда'),
        control: `
          <select class="input-field" id="setting-shutdown-trigger">
            <option value="drops" ${sel('shutdownTrigger', 'drops')}>${tr('Все дропсы собраны')}</option>
            <option value="streamEnd" ${sel('shutdownTrigger', 'streamEnd')}>${tr('Стрим завершён')}</option>
            <option value="any" ${sel('shutdownTrigger', 'any')}>${tr('Любое из событий')}</option>
            <option value="timer" ${sel('shutdownTrigger', 'timer')}>${tr('По таймеру')}</option>
          </select>`,
        sub: true, parent: 'setting-shutdown', cls: 'shutdown-option'
      }),
      // Часы нужны только таймеру: при других условиях строка ничего не
      // меняла, но стояла и сбивала с толку
      item({
        id: 'setting-shutdown-timer',
        label: tr('Через сколько часов'),
        desc: tr('Отсчёт идёт от начала фарминга'),
        control: `
          <select class="input-field" id="setting-shutdown-timer" aria-describedby="setting-shutdown-timer-desc">
            ${[1, 2, 3, 4, 6, 8, 12].map(h => `<option value="${h}" ${sel('shutdownTimerHours', h)}>${tr('{n} ч', { n: h })}</option>`).join('')}
          </select>`,
        sub: true, parent: 'setting-shutdown', parentValue: 'setting-shutdown-trigger:timer', cls: 'shutdown-option'
      }),
      item({
        id: 'setting-shutdown-delay',
        label: tr('Задержка'),
        desc: tr('Сколько ждать перед выключением — отсчёт можно отменить'),
        control: `
          <select class="input-field" id="setting-shutdown-delay" aria-describedby="setting-shutdown-delay-desc">
            <option value="0" ${sel('shutdownDelayMinutes', 0)}>${tr('Сразу')}</option>
            ${[5, 15, 30, 60].map(m => `<option value="${m}" ${sel('shutdownDelayMinutes', m)}>${tr('{n} мин', { n: m })}</option>`).join('')}
          </select>`,
        sub: true, parent: 'setting-shutdown', cls: 'shutdown-option'
      })
    ].join('');

    // ── 6. Оформление ──
    const theme = get('theme') === 'light' ? 'light' : 'dark';
    const uiStyle = get('uiStyle') === 'ios27' ? 'ios27' : 'classic';
    // Язык показываем выбранный, а не действующий: он сменится только
    // после перезапуска, и сегмент не должен «отскакивать» назад
    const lang = (i18n?.pendingLang || i18n?.currentLang) === 'en' ? 'en' : 'ru';
    const glass = settings.constructor.clampGlassOpacity(get('glassOpacity'));
    const lookHtml = [
      item({
        labelId: 'theme-label',
        label: tr('Тема'),
        control: segmented('theme-select', theme, [
          { value: 'dark', label: tr('Тёмная'), icon: 'moon' },
          { value: 'light', label: tr('Светлая'), icon: 'sun' }
        ], 'theme-label'),
        keywords: tr('тёмная светлая dark light')
      }),
      item({
        labelId: 'ui-style-label',
        label: tr('Оформление'),
        desc: tr('iOS 27 — полупрозрачное стекло. Размытие работает при выключенном экономном режиме графики'),
        control: segmented('ui-style-select', uiStyle, [
          { value: 'classic', label: tr('Классика') },
          { value: 'ios27', label: 'iOS 27' }
        ], 'ui-style-label'),
        keywords: tr('ios стекло классика вид')
      }),
      `<div class="settings-item is-sub" id="glass-opacity-item" data-parent-value="ui-style-select:ios27">
        <div class="settings-item-info">
          <label class="settings-item-label" for="setting-glass-opacity">${tr('Прозрачность стекла')}</label>
          <div class="settings-item-description">${tr('Левее — прозрачнее, правее — плотнее')}</div>
        </div>
        <div class="settings-item-control glass-opacity-control">
          <div class="glass-opacity-stack">
            <input type="range" class="ios-range settings-range" id="setting-glass-opacity" min="0.25" max="0.9" step="0.05" value="${glass.toFixed(2)}">
            <div class="glass-opacity-scale" aria-hidden="true">
              <span>${tr('Прозрачнее')}</span>
              <span>${tr('Плотнее')}</span>
            </div>
          </div>
        </div>
      </div>`,
      item({
        id: 'setting-compact',
        label: tr('Компактный режим'),
        desc: tr('Плотнее строки и карточки — больше помещается на экран'),
        control: toggle('setting-compact', get('compactMode'))
      }),
      item({
        id: 'setting-animations',
        label: tr('Анимации'),
        desc: tr('Плавные появления и переходы'),
        control: toggle('setting-animations', get('animationsEnabled'))
      }),
      item({
        labelId: 'language-label',
        label: tr('Язык'),
        // Под сегментом — напоминание, что выбранный язык ждёт перезапуска.
        // Оно на выбранном языке, поэтому перевод разметки (tr.dom) его
        // не трогает — как и название «Русский»
        desc: this.languageNote(lang), live: true, descId: 'language-note', descAttrs: 'data-no-tr',
        control: segmented('language-select', lang, [
          // Название языка — на нём самом: русский ищут по слову «Русский»
          // и в английском интерфейсе
          { value: 'ru', label: 'Русский', noTr: true }, // i18n-ignore
          { value: 'en', label: 'English' }
        ], 'language-label'),
        keywords: tr('language english русский')
      })
    ].join('');

    // ── 7. Данные ──
    const dataHtml = [
      item({
        labelId: 'backup-label',
        label: tr('Резервная копия'),
        desc: tr('Категории с порядком и закреплениями, подписки, статистика и настройки. Аккаунты не сохраняются — после переноса войдите заново'),
        stacked: true,
        control: `
          <button type="button" class="btn btn-secondary btn-sm" id="backup-export-btn">${I('download', 14)}<span>${tr('Сохранить копию')}</span></button>
          <button type="button" class="btn btn-secondary btn-sm" id="backup-import-btn">${I('upload', 14)}<span>${tr('Восстановить')}</span></button>
          <button type="button" class="btn btn-ghost btn-sm" id="export-settings-btn">${I('copy', 14)}<span>${tr('Копировать настройки')}</span></button>
          <input type="file" id="backup-file-input" accept="application/json,.json" hidden>`,
        keywords: tr('перенос экспорт импорт буфер обмена')
      }),
      item({
        labelId: 'journal-label',
        label: tr('Журнал событий'),
        desc: tr('Награды, сундуки, смены категорий и ошибки за последние две недели'),
        control: `<button type="button" class="btn btn-secondary btn-sm" id="journal-open-btn">${I('journal', 14)}<span>${tr('Открыть')}</span></button>`,
        keywords: tr('история лог')
      }),
      item({
        labelId: 'ics-label',
        label: tr('Сроки кампаний в календарь'),
        desc: tr('Файл .ics для телефона или почты: когда заканчиваются кампании ваших игр, с напоминанием за час'),
        control: `<button type="button" class="btn btn-secondary btn-sm" id="ics-export-btn">${I('calendar', 14)}<span>${tr('Сохранить .ics')}</span></button>`,
        keywords: tr('ics календарь напоминание')
      }),
      item({
        labelId: 'logs-label',
        label: tr('Логи приложения'),
        desc: tr('Пригодятся, если ночью что-то пошло не так'),
        control: `<button type="button" class="btn btn-secondary btn-sm" id="open-logs-btn">${I('folder', 14)}<span>${tr('Открыть папку')}</span></button>`,
        keywords: tr('журнал работы log')
      }),
      `<div class="settings-danger" role="group" aria-labelledby="danger-title">
        <div class="settings-danger-title" id="danger-title">${tr('Опасная зона')}</div>
        ${item({
          labelId: 'clear-stats-label',
          label: tr('Очистить статистику'),
          desc: tr('Удалит все сессии и итоги. Вернуть нельзя'),
          control: `<button type="button" class="btn btn-danger-ghost btn-sm" id="clear-statistics-btn">${I('trash', 14)}<span>${tr('Очистить…')}</span></button>`
        })}
        ${item({
          labelId: 'reset-label',
          label: tr('Сбросить настройки'),
          desc: tr('Все настройки вернутся к стандартным. Категории, аккаунты и статистика останутся'),
          control: `<button type="button" class="btn btn-danger-ghost btn-sm" id="reset-settings-btn">${I('refresh', 14)}<span>${tr('Сбросить…')}</span></button>`
        })}
      </div>`
    ].join('');

    // ── 8. О программе ──
    const aboutHtml = [
      item({
        labelId: 'version-label',
        label: tr('Версия'),
        desc: '—', live: true, descId: 'setting-app-version',
        control: `
          <button type="button" class="btn btn-ghost btn-sm" id="whats-new-btn">${I('sparkles', 14)}<span>${tr('Что нового')}</span></button>
          <button type="button" class="btn btn-secondary btn-sm" id="check-updates-btn">${I('refresh', 14)}<span>${tr('Проверить обновления')}</span></button>`,
        keywords: tr('обновление update')
      }),
      item({
        labelId: 'links-label',
        label: tr('Проект'),
        desc: tr('Исходный код, новости и поддержка разработки'),
        control: `
          <button type="button" class="btn btn-ghost btn-sm" id="github-link-btn" title="${tr('Исходный код и документация')}">GitHub ${I('external', 14)}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="telegram-link-btn" title="${tr('Новости и поддержка')}">Telegram ${I('external', 14)}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="boosty-link-btn" title="Boosty">${tr('Поддержать')} ${I('external', 14)}</button>`,
        keywords: tr('github telegram boosty донат поддержать')
      }),
      // Процессы свёрнуты: список нужен раз в сто лет, а опрашивать его при
      // каждом открытии настроек незачем
      `<div class="settings-block settings-details-wrap" data-keywords="${tr('процессы диагностика память cpu диспетчер')}">
        <details class="settings-details" id="processes-details">
          <summary class="settings-details-summary">
            <span class="settings-item-info">
              <span class="settings-item-label">${tr('Процессы приложения')}</span>
              <span class="settings-item-description" id="processes-summary" data-live>${tr('Сколько памяти и процессора занимает каждая часть')}</span>
            </span>
            <span class="settings-details-chevron" aria-hidden="true">${I('chevron-down', 16)}</span>
          </summary>
          <div class="settings-details-body">
            <div id="processes-list" class="process-list"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="refresh-processes-btn">${I('refresh', 14)}<span>${tr('Обновить')}</span></button>
          </div>
        </details>
      </div>`,
      item({
        id: 'setting-developer-mode',
        label: tr('Режим разработчика'),
        desc: tr('Тест уведомлений: Shift + клик по «Дропсов получено»'),
        control: toggle('setting-developer-mode', get('developerMode'))
      })
    ].join('');

    const bodies = {
      'set-farming': farmingHtml,
      'set-notify': notifyHtml,
      'set-perf': perfHtml,
      'set-window': windowHtml,
      'set-shutdown': shutdownHtml,
      'set-look': lookHtml,
      'set-data': dataHtml,
      'set-about': aboutHtml
    };

    // Заголовок без значка и подзаголовка: где ты, говорит меню слева
    container.innerHTML = `
      <div class="settings-page">
        <div class="page-header settings-header">
          <h1 class="page-title">${tr('Настройки')}</h1>
          <div class="page-actions">
            <div class="search-field settings-search" role="search">
              ${I('search', 16)}
              <input type="search" class="input-field" id="settings-search" autocomplete="off" spellcheck="false"
                     placeholder="${tr('Поиск по настройкам')}" aria-label="${tr('Поиск по настройкам')}"
                     title="Ctrl+F">
              <button type="button" class="btn btn-ghost btn-icon btn-sm settings-search-clear" id="settings-search-clear"
                      hidden title="${tr('Очистить')}" aria-label="${tr('Очистить поиск')}">${I('close', 14)}</button>
            </div>
          </div>
        </div>

        <div class="settings-layout">
          <nav class="settings-nav" aria-label="${tr('Разделы настроек')}">
            ${sections.map((s, index) => `
              <a href="#${s.id}" data-section="${s.id}" class="${index === 0 ? 'active' : ''}"${index === 0 ? ' aria-current="true"' : ''}>
                ${navIcon(s.icon)}<span>${s.title}</span>
              </a>`).join('')}
          </nav>

          <div class="settings-container">
            ${sections.map(s => section(s.id, titleOf(s.id), bodies[s.id])).join('')}

            <div class="empty-state settings-empty" id="settings-empty" hidden>
              ${I('search', 40)}
              <h3>${tr('Ничего не нашлось')}</h3>
              <p>${tr('Попробуйте другое слово — например, «звук», «трей» или «качество»')}</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const settings = window.settings;
    const i18n = window.i18n;
    if (!settings || !document.querySelector('.settings-page')) return;

    // Звук. Сразу проигрываем тот самый сигнал: понять, что включаешь,
    // проще на слух, чем по названию
    const soundToggle = document.getElementById('setting-sound');
    if (soundToggle) {
      soundToggle.addEventListener('change', (e) => {
        settings.set('soundEnabled', e.target.checked);
        if (e.target.checked) this.previewSound('drop');
      });
    }

    // Громкость: число рядом меняется сразу, в настройки значение уходит по
    // отпусканию (set() пишет на диск и в main), там же — пробный сигнал
    const volumeRange = document.getElementById('setting-sound-volume');
    const volumeValue = document.getElementById('setting-sound-volume-value');
    if (volumeRange) {
      const paintVolume = () => {
        const value = Math.min(1, Math.max(0, Number(volumeRange.value) || 0));
        volumeRange.style.setProperty('--fill', (value * 100).toFixed(1) + '%');
        if (volumeValue) volumeValue.textContent = `${Math.round(value * 100)}%`;
        return value;
      };
      paintVolume();
      volumeRange.addEventListener('input', paintVolume);
      volumeRange.addEventListener('change', () => {
        settings.set('soundVolume', paintVolume());
        this.previewSound('drop');
      });
    }

    // События звука: у каждого свой ключ (soundDrop, soundChest…) и своя
    // кнопка «прослушать». Прослушивание играет всегда — это явное действие
    document.querySelectorAll('.settings-page input[data-sound-key]').forEach(input => {
      input.addEventListener('change', () => {
        settings.set(input.dataset.soundKey, input.checked);
      });
    });
    document.querySelectorAll('.settings-page [data-preview]').forEach(btn => {
      btn.addEventListener('click', () => this.previewSound(btn.dataset.preview));
    });

    const soundInGame = document.getElementById('setting-sound-in-game');
    if (soundInGame) {
      soundInGame.addEventListener('change', (e) => {
        settings.set('soundInGame', e.target.checked);
      });
    }

    // Всплывающие сообщения в окне
    const toastToggle = document.getElementById('setting-toast');
    if (toastToggle) {
      toastToggle.addEventListener('change', (e) => {
        settings.set('toastNotifications', e.target.checked);
      });
    }

    // Уведомления Windows. Ключей два: main-процесс и notifyFarmingEvent
    // читают notifications, окно о награде в фарминге — systemNotifications.
    // Меняем оба, чтобы выключатель глушил всё сразу
    const systemNotificationsToggle = document.getElementById('setting-system-notifications');
    if (systemNotificationsToggle) {
      systemNotificationsToggle.addEventListener('change', (e) => {
        settings.update({
          systemNotifications: e.target.checked,
          notifications: e.target.checked
        });
      }, { signal: this._abort.signal });
    }

    // Пробное уведомление показывается и при выключенных уведомлениях:
    // это проверка, а не событие. Пока в app.js нет готовой проверки
    // (window.utils.testDropNotification), зовём окно награды напрямую
    const testNotificationBtn = document.getElementById('test-notification-btn');
    if (testNotificationBtn) {
      testNotificationBtn.addEventListener('click', () => {
        if (typeof window.utils?.testDropNotification === 'function') {
          window.utils.testDropNotification();
          return;
        }
        window.electronAPI?.showDropNotification?.(
          tr('Проверка уведомления'), 'WatchTwitch', '', { kind: 'test' });
        if (settings.get('notifications') === false) {
          window.utils.showToast(tr('Уведомления Windows сейчас выключены — окно не появится'), 'info');
        }
      }, { signal: this._abort.signal });
    }

    // Сворачивать в трей. Говорим прямо, что теперь сделает крестик:
    // «Сворачивать в трей» на оба положения ничего не объясняло
    const minimizeTrayToggle = document.getElementById('setting-minimize-tray');
    if (minimizeTrayToggle) {
      minimizeTrayToggle.addEventListener('change', async (e) => {
        settings.set('minimizeToTray', e.target.checked);
        window.utils.showToast(
          e.target.checked ? tr('Крестик будет сворачивать в трей') : tr('Крестик закрывает приложение'),
          'info'
        );
      });
    }

    // Автоматическое получение
    const autoClaimToggle = document.getElementById('setting-auto-claim');
    if (autoClaimToggle) {
      autoClaimToggle.addEventListener('change', (e) => {
        settings.set('autoClaimDrops', e.target.checked);
      });
    }

    const chatToggle = document.getElementById('setting-background-chat');
    if (chatToggle) {
      chatToggle.addEventListener('change', (e) => {
        settings.set('backgroundChat', e.target.checked);
        if (!e.target.checked) {
          window.chatManager?.unload();
          window.utils.showToast(tr('Фоновый чат выключен, сундуки собираются запросом'), 'info');
        } else {
          const login = window.farmingPage?.currentStream?.login;
          if (login) {
            window.farmingPage?.startBonusAutoCollector?.();
            window.chatManager?.load(login);
          }
          window.utils.showToast(tr('Фоновый чат включён'), 'info');
        }
      });
    }

    // Экономный режим графики. Аппаратное ускорение отключается только до
    // готовности приложения, поэтому меняется оно лишь при следующем запуске.
    // В тосте и положение, и срок: одно «Вступит в силу…» на оба
    // положения не говорило, что именно вступит
    const lowGraphicsToggle = document.getElementById('setting-low-graphics');
    if (lowGraphicsToggle) {
      lowGraphicsToggle.addEventListener('change', (e) => {
        settings.set('lowGraphics', e.target.checked);
        window.utils.showToast(tr(e.target.checked
          ? 'Экономный режим графики: включено. Вступит в силу после перезапуска приложения'
          : 'Экономный режим графики: выключено. Вступит в силу после перезапуска приложения'), 'info');
      });
    }

    // Игровой режим
    const gameToggle = document.getElementById('setting-game-mode');
    if (gameToggle) {
      gameToggle.addEventListener('change', (e) => {
        settings.set('gameMode', e.target.checked);
        window.utils.showToast(tr(e.target.checked
          ? 'Игровой режим включён: игра замечается в течение 20 секунд'
          : 'Игровой режим выключен'), 'info');
      });
    }
    const gameProcesses = document.getElementById('setting-game-processes');
    const gameProcessesNote = document.getElementById('game-processes-note');

    // Показываем, как строка разобрана на самом деле. В поле вписывали
    // название игры («Warhammer 40,000 Space Marine 2») — оно режется по
    // запятой на «warhammer 40.exe» и «000 space marine 2.exe», игровой
    // режим не включается, а пользователь уверен, что всё настроил
    const разобратьИгры = (text) => {
      const names = window.GameMode?.parseExtra ? window.GameMode.parseExtra(text) : [];
      // Пробел в имени без .exe — почти всегда признак того, что вписано
      // название игры, а не имя файла. У части игр пробел в имени .exe
      // есть, поэтому это предупреждение, а не отказ
      const подозрительные = String(text || '')
        .split(/[,;\n]+/)
        .map(part => part.trim())
        .filter(part => part && /\s/.test(part) && !/\.exe$/i.test(part));
      return { names, подозрительные };
    };

    const обновитьИгры = () => {
      if (!gameProcessesNote) return;
      const { names } = разобратьИгры(settings.get('gameModeProcesses'));
      gameProcessesNote.textContent = '';
      if (names.length) gameProcessesNote.textContent = tr('Отслеживаются: {list}', { list: names.join(', ') });
    };
    обновитьИгры();

    if (gameProcesses) {
      gameProcesses.addEventListener('change', (e) => {
        const text = e.target.value.trim();
        settings.set('gameModeProcesses', text);
        обновитьИгры();

        const { names, подозрительные } = разобратьИгры(text);
        if (names.length === 0) {
          window.utils.showToast(tr('Список своих игр очищен'), 'info');
        } else if (подозрительные.length > 0) {
          window.utils.showToast(
            tr('Похоже на название игры, а не на имя процесса: {list}. Нужно имя файла .exe — его видно в Диспетчере задач, вкладка «Подробности»',
              { list: подозрительные.join(', ') }),
            'warning');
        } else {
          window.utils.showToast(tr('Будут отслеживаться: {list}', { list: names.join(', ') }), 'success');
        }
      });
    }

    // Потолок скорости загрузки стрима
    const limitToggle = document.getElementById('setting-limit-speed');
    const limitNote = document.getElementById('limit-note');

    const обновитьПотолок = () => {
      if (!limitNote) return;
      if (settings.get('limitStreamSpeed') === false) {
        limitNote.textContent = tr('Выключено — стрим качается на полной скорости');
        return;
      }
      limitNote.textContent = window.NetworkLimit?.describe(
        settings.get('preferredStreamQuality'), settings.get('streamSpeedHeadroom')) || '';
    };
    обновитьПотолок();

    if (limitToggle) {
      limitToggle.addEventListener('change', (e) => {
        settings.set('limitStreamSpeed', e.target.checked);
        обновитьПотолок();
        // Настройка зеркалится в главный процесс не мгновенно, поэтому
        // просим переприменить потолок явно
        setTimeout(() => window.electronAPI?.refreshStreamLimit?.(), 300);
      });
    }

    // Тихие часы
    const quietToggle = document.getElementById('setting-quiet');
    const quietFrom = document.getElementById('setting-quiet-from');
    const quietTo = document.getElementById('setting-quiet-to');
    const quietNote = document.getElementById('quiet-note');

    const обновитьПодпись = () => {
      if (!quietNote) return;
      const включено = settings.get('quietHours') !== false;
      quietNote.textContent = включено
        ? window.QuietHours.describe(settings.get('quietFrom'), settings.get('quietTo'))
        : tr('Выключено');
    };
    обновитьПодпись();

    if (quietToggle) {
      quietToggle.addEventListener('change', (e) => {
        settings.set('quietHours', e.target.checked);
        обновитьПодпись();
      });
    }

    // Пустое или неразобранное время не сохраняем: иначе тишина
    // выключилась бы молча, а пользователь думал бы, что она работает
    const сохранитьВремя = (input, key) => {
      if (!input) return;
      input.addEventListener('change', () => {
        if (window.QuietHours.toMinutes(input.value) === null) {
          input.value = settings.get(key);
          window.utils.showToast(tr('Время указано неверно'), 'warning');
          return;
        }
        settings.set(key, input.value);
        обновитьПодпись();
      });
    };
    сохранитьВремя(quietFrom, 'quietFrom');
    сохранитьВремя(quietTo, 'quietTo');

    // Подсказки о выгодных категориях
    const suggestToggle = document.getElementById('setting-suggest');
    if (suggestToggle) {
      suggestToggle.addEventListener('change', (e) => {
        settings.set('suggestCategories', e.target.checked);
      });
    }

    // Горячие клавиши перехватываются у всей системы, поэтому их
    // включение и выключение выполняет главный процесс
    const shortcutsToggle = document.getElementById('setting-shortcuts');
    const shortcutsNote = document.getElementById('shortcuts-note');

    // Сочетание, занятое другой программой, Electron молча не регистрирует:
    // переключатель стоял включённым, нажатие ничего не делало, и причину
    // было не узнать. Список неудач отдаёт главный процесс; пока он этого
    // не умеет, подпись просто остаётся пустой
    const обновитьКлавиши = async () => {
      if (!shortcutsNote) return;
      let failed = [];
      try {
        const status = await window.electronAPI?.getShortcutStatus?.();
        failed = Array.isArray(status?.failed) ? status.failed : [];
      } catch (error) {
        console.warn('[Настройки] Не удалось узнать состояние горячих клавиш:', error?.message);
      }
      if (settings.get('globalShortcuts') === false) failed = [];

      shortcutsNote.textContent = failed
        .map(item => String(item?.accelerator ?? item)
          .replace(/^(CommandOrControl|CmdOrCtrl|Control)\+/i, 'Ctrl+'))
        .map(key => tr('{key} занято другой программой', { key }))
        .join('; ');
    };
    обновитьКлавиши();

    if (shortcutsToggle) {
      shortcutsToggle.addEventListener('change', (e) => {
        settings.set('globalShortcuts', e.target.checked);
        window.electronAPI?.setGlobalShortcuts?.(e.target.checked);
        // Команда в главный процесс уходит без ответа — даём ему время
        // перерегистрировать сочетания и только потом спрашиваем итог
        setTimeout(обновитьКлавиши, 300);
      });
    }

    // Уведомление о выходе избранного канала
    const favouriteLiveToggle = document.getElementById('setting-favourite-live');
    if (favouriteLiveToggle) {
      favouriteLiveToggle.addEventListener('change', (e) => {
        settings.set('notifyFavouriteLive', e.target.checked);
        if (e.target.checked) window.favouritesWatch?.start();
        else window.favouritesWatch?.stop();
      });
    }

    // Выбор категории по выгоде
    const smartSwitchToggle = document.getElementById('setting-smart-switch');
    if (smartSwitchToggle) {
      smartSwitchToggle.addEventListener('change', (e) => {
        settings.set('smartCategorySwitch', e.target.checked);
      });
    }

    // Уведомления о получении дропсов
    const notifyDropToggle = document.getElementById('setting-notify-drop');
    if (notifyDropToggle) {
      notifyDropToggle.addEventListener('change', (e) => {
        settings.set('notifyOnDropClaimed', e.target.checked);
      });
    }

    // Автозапуск вместе с системой
    const autostartToggle = document.getElementById('setting-autostart');
    if (autostartToggle) {
      // Переключатель показывает, что на самом деле записано в Windows, а не
      // сохранённый флаг: раньше они расходились, и автозапуск пропадал
      window.electronAPI?.getAutostart?.().then(enabled => {
        autostartToggle.checked = !!enabled;
        settings.settings.autostart = !!enabled;
      }).catch(() => {});

      autostartToggle.addEventListener('change', (e) => {
        settings.set('autostart', e.target.checked);
        // Реальный автозапуск включает main-процесс через системный API
        window.electronAPI?.setAutostart?.(e.target.checked);
        window.utils?.showToast(tr(e.target.checked
          ? 'Приложение будет запускаться вместе с Windows'
          : 'Автозапуск выключен'), 'info');
      }, { signal: this._abort.signal });
    }

    // Качество стрима: напрямую влияет на расход трафика
    const qualitySelect = document.getElementById('setting-quality');
    if (qualitySelect) {
      qualitySelect.addEventListener('change', (e) => {
        settings.set('preferredStreamQuality', e.target.value);
        обновитьПотолок();
        setTimeout(() => window.electronAPI?.refreshStreamLimit?.(), 300);
        window.utils.showToast(tr('Качество применится при следующем запуске стрима'), 'info');
      }, { signal: this._abort.signal });
    }

    // Автовыключение. Сводка «что и когда произойдёт» стоит подписью под
    // самим переключателем: пока он выключен — что он делает вообще
    const shutdownToggle = document.getElementById('setting-shutdown');
    const refreshSummary = () => {
      const box = document.getElementById('shutdown-summary');
      if (!box) return;
      box.textContent = settings.get('enableShutdown') && window.shutdownManager
        ? window.shutdownManager.describeSchedule()
        : (box.dataset.idle || '');
    };

    if (shutdownToggle) {
      shutdownToggle.addEventListener('change', (e) => {
        settings.set('enableShutdown', e.target.checked);
        refreshSummary();

        window.utils.showToast(
          e.target.checked ? tr('Автовыключение включено') : tr('Автовыключение выключено'),
          e.target.checked ? 'warning' : 'info'
        );
      }, { signal: this._abort.signal });
    }

    const shutdownSelects = [
      ['setting-shutdown-action', 'shutdownAction'],
      ['setting-shutdown-trigger', 'shutdownTrigger'],
      ['setting-shutdown-delay', 'shutdownDelayMinutes'],
      ['setting-shutdown-timer', 'shutdownTimerHours']
    ];
    shutdownSelects.forEach(([elementId, settingKey]) => {
      const select = document.getElementById(elementId);
      if (!select) return;
      select.addEventListener('change', (e) => {
        const numeric = settingKey === 'shutdownDelayMinutes' || settingKey === 'shutdownTimerHours';
        settings.set(settingKey, numeric ? Number(e.target.value) : e.target.value);
        refreshSummary();
      }, { signal: this._abort.signal });
    });

    // Автопереключение
    const autoSwitchToggle = document.getElementById('setting-auto-switch');
    if (autoSwitchToggle) {
      autoSwitchToggle.addEventListener('change', (e) => {
        settings.set('autoSwitchStreams', e.target.checked);
      });
    }

    // Компактный режим
    const compactToggle = document.getElementById('setting-compact');
    if (compactToggle) {
      compactToggle.addEventListener('change', (e) => {
        settings.set('compactMode', e.target.checked);
        document.body.classList.toggle('compact-mode', e.target.checked);
      });
    }

    // «Показывать завершённые кампании» переехала в календарь: там она
    // видна рядом со списком, который меняет. Ключ остался прежним

    // Анимации
    const animationsToggle = document.getElementById('setting-animations');
    if (animationsToggle) {
      animationsToggle.addEventListener('change', (e) => {
        settings.set('animationsEnabled', e.target.checked);
        document.body.classList.toggle('no-animations', !e.target.checked);
      });
    }

    // Режим разработчика
    const developerModeToggle = document.getElementById('setting-developer-mode');
    if (developerModeToggle) {
      developerModeToggle.addEventListener('change', (e) => {
        settings.set('developerMode', e.target.checked);
      });
    }

    // Тема, оформление и язык — сегменты: два варианта видны сразу, и выбор
    // делается одним нажатием вместо раскрытия списка
    this.bindSegmented('theme-select', (value) => {
      // set() сам меняет класс темы через applyAll; присваивание className
      // здесь стирало компактный и экономный режимы до перезапуска
      settings.set('theme', value);
    });

    // Оформление применяется сразу через set(), без тоста: смену вида и так
    // видно, а сообщение поверх перестроившегося интерфейса ничего не добавляет
    this.bindSegmented('ui-style-select', (value) => {
      // Отметка ставится до смены вида: set() сразу применяет настройки и
      // сохраняет их вместе с ней
      settings.settings.uiStyleChosen = true;
      settings.set('uiStyle', value === 'ios27' ? 'ios27' : 'classic');
    });

    // Язык только сохраняется: строки переводятся в момент отрисовки, и
    // смена на лету оставила бы половину экранов на прежнем языке.
    // Перезапуск предлагаем сразу, а отказавшемуся напоминает подпись
    this.bindSegmented('language-select', (value) => {
      if (!i18n?.setLanguage?.(value)) return;
      const note = document.getElementById('language-note');
      if (note) note.textContent = this.languageNote(value);
      // Вернули действующий язык — перезапускать незачем
      if (value === i18n.currentLang) return;
      this.askRestartForLanguage(value);
    });

    // Прозрачность стекла. Пока ползунок тянут, меняется только переменная
    // на <html> — стекло откликается мгновенно. В настройки значение
    // уходит через set() по отпусканию: set() пишет на диск и в
    // main-процесс, а событие input приходит десятки раз в секунду
    const glassRange = document.getElementById('setting-glass-opacity');
    if (glassRange) {
      const clamp = settings.constructor.clampGlassOpacity;
      // Дорожка залита акцентом до ручки — как у ползунков iOS
      const paint = () => {
        const min = Number(glassRange.min);
        const max = Number(glassRange.max);
        const value = clamp(glassRange.value);
        glassRange.style.setProperty('--fill', ((value - min) / (max - min) * 100).toFixed(1) + '%');
        return value;
      };
      paint();

      glassRange.addEventListener('input', () => {
        document.documentElement.style.setProperty('--glass-alpha', String(paint()));
      });
      glassRange.addEventListener('change', () => {
        settings.set('glassOpacity', paint());
      });
    }

    // Что нового
    const whatsNewBtn = document.getElementById('whats-new-btn');
    if (whatsNewBtn) {
      whatsNewBtn.addEventListener('click', () => {
        window.whatsNew?.show();
      }, { signal: this._abort.signal });
    }

    // Журнал событий живёт в панели из заголовка окна; отсюда — короткий путь к нему
    const journalBtn = document.getElementById('journal-open-btn');
    if (journalBtn) {
      journalBtn.addEventListener('click', () => {
        if (typeof window.eventLogUI?.open === 'function') window.eventLogUI.open('all');
        else document.getElementById('journal-btn')?.click();
      }, { signal: this._abort.signal });
    }

    const clearStatsBtn = document.getElementById('clear-statistics-btn');
    if (clearStatsBtn) {
      clearStatsBtn.addEventListener('click', async () => {
        const ok = await this.confirmDanger(
          tr('Очистить статистику?'),
          window.escapeHtml(tr('Вся накопленная статистика удалится. Вернуть её будет нельзя')),
          tr('Очистить'));
        if (!ok) return;

        try {
          await Storage.clearStatistics();
          // Страница статистики слушает это событие и перерисуется сама
          window.dispatchEvent(new CustomEvent('statistics-updated'));
          window.utils.showToast(tr('Статистика очищена'), 'success');
        } catch (error) {
          console.error('[Settings] Не удалось очистить статистику:', error);
          window.utils.showToast(tr('Не удалось очистить статистику'), 'error');
        }
      }, { signal: this._abort.signal });
    }

    // Сброс настроек
    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const ok = await this.confirmDanger(
          tr('Сбросить все настройки?'),
          window.escapeHtml(tr('Категории, аккаунты и статистика не затрагиваются')),
          tr('Сбросить'));
        if (!ok) return;

        settings.reset();

        // Часть настроек живёт и в main-процессе: просим его применить
        // значения по умолчанию сразу, как это делают сами переключатели
        window.electronAPI?.setGlobalShortcuts?.(settings.get('globalShortcuts') !== false);
        setTimeout(() => window.electronAPI?.refreshStreamLimit?.(), 300);
        if (settings.get('backgroundChat') !== true) window.chatManager?.unload?.();
        // Слежка за избранными включается по умолчанию, но сама не стартует:
        // без этого после сброса переключатель стоял бы включённым, а
        // уведомления не приходили бы до перезапуска
        if (settings.get('notifyFavouriteLive') !== false) window.favouritesWatch?.start?.();

        if (!this._abort.signal.aborted) {
          this.render();
          this.setupEventListeners();
          this.loadAppVersion();
        }
        window.utils.showToast(tr('Настройки сброшены к стандартным'), 'success');
      }, { signal: this._abort.signal });
    }

    // Имя файла по местной дате: toISOString даёт дату по UTC, и файл,
    // сохранённый ночью до трёх часов по Москве, получал вчерашнее число
    const местнаяДата = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };

    const сохранитьФайл = (содержимое, тип, имя) => {
      const blob = new Blob([содержимое], { type: тип });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = имя;
      a.click();
      // Загрузка стартует уже после click(), а окно «Сохранить как» может
      // висеть долго — ссылку освобождаем с запасом, а не сразу
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    // Полная копия: категории, подписки, статистика, настройки
    const backupExportBtn = document.getElementById('backup-export-btn');
    if (backupExportBtn) {
      backupExportBtn.addEventListener('click', async () => {
        try {
          const data = await window.Backup.collect(new Date().toISOString());

          сохранитьФайл(JSON.stringify(data, null, 2), 'application/json',
            `watchtwitch-backup-${местнаяДата()}.json`);

          // Узнать, сохранил ли человек файл или закрыл окно, отсюда нельзя:
          // «Копия сохранена» в момент клика была бы неправдой
          window.utils.showToast(
            tr('Выберите, куда сохранить копию. В ней {contents}', { contents: window.Backup.describe(data) }), 'info');
        } catch (error) {
          console.error('[Копия] Не удалось сохранить:', error);
          window.utils.showToast(tr('Не удалось сохранить копию'), 'error');
        }
      });
    }

    // Сроки кампаний для обычного календаря — отдельной кнопкой и только
    // по играм из списка категорий. Раньше файл уходил вместе с копией и
    // ставил напоминание о каждой кампании Twitch, которую видело
    // приложение: календарь засыпало десятками чужих игр, а сохранять
    // приходилось два файла подряд
    const icsExportBtn = document.getElementById('ics-export-btn');
    if (icsExportBtn) {
      icsExportBtn.addEventListener('click', async () => {
        try {
          const категории = (await Storage.getCategories().catch(() => [])) || [];
          if (категории.length === 0) {
            window.utils.showToast(tr('Сначала добавьте категории: в календарь попадают только их кампании'), 'warning');
            return;
          }

          // Игра та же, что решает фарминг: по id Twitch или точному
          // названию. Мягкое сравнение по началу названия тянуло бы сюда
          // «World of Tanks Console» при категории «World of Tanks» — снова
          // напоминания о чужих кампаниях
          const SP = window.StreamPicker;
          const своя = (campaign) => {
            const game = campaign?.game?.displayName || campaign?.game?.name || '';
            if (!game) return false;
            return категории.some(cat => {
              if (SP?.isExactGame) return SP.isExactGame(cat?.name, game, cat?.id, campaign?.game?.id);
              if (SP?.isSameGame) return SP.isSameGame(cat?.name, game);
              return String(cat?.name || '').trim().toLowerCase() === game.trim().toLowerCase();
            });
          };

          const известные = await window.CampaignHistory.loadKnown();
          const календарь = window.IcsExport.build(известные.filter(своя));

          if (календарь.events === 0) {
            window.utils.showToast(
              tr('По играм из ваших категорий идущих кампаний пока нет. Откройте «Календарь», чтобы обновить сроки'), 'info');
            return;
          }

          сохранитьФайл(календарь.text, 'text/calendar', `watchtwitch-drops-${местнаяДата()}.ics`);
          window.utils.showToast(
            tr('Выберите, куда сохранить файл календаря. Кампаний в нём: {count}', { count: календарь.events }), 'info');
        } catch (error) {
          console.error('[Календарь] Не удалось сохранить сроки:', error);
          window.utils.showToast(tr('Не удалось сохранить сроки кампаний'), 'error');
        }
      });
    }

    const logsBtn = document.getElementById('open-logs-btn');
    if (logsBtn) {
      logsBtn.addEventListener('click', async () => {
        const result = await window.electronAPI.openLogsFolder?.();
        if (result && !result.success) {
          window.utils.showToast(tr('Не удалось открыть папку логов: {error}', { error: result.error || '' }), 'error');
        }
      });
    }

    const backupImportBtn = document.getElementById('backup-import-btn');
    const backupInput = document.getElementById('backup-file-input');
    if (backupImportBtn && backupInput) {
      backupImportBtn.addEventListener('click', () => backupInput.click());

      backupInput.addEventListener('change', async () => {
        const file = backupInput.files?.[0];
        if (!file) return;

        const битыйФайл = tr('Файл повреждён или это не копия WatchTwitch');

        try {
          let data;
          try {
            data = JSON.parse(await file.text());
          } catch (error) {
            // Технический текст разбора JSON пользователю ничего не скажет
            console.warn('[Копия] Файл не разобран:', error?.message);
            window.utils.showToast(битыйФайл, 'error');
            return;
          }

          const check = window.Backup.validate(data);
          if (!check.ok) {
            window.utils.showToast(check.error, 'error');
            return;
          }

          // Показываем то, что реально встанет на место, а не сырой файл
          const clean = window.Backup.sanitize(data);
          // Пустоту проверяем по данным: подпись describe() зависит от языка
          if (window.Backup.isEmpty(clean)) {
            window.utils.showToast(битыйФайл, 'error');
            return;
          }
          const заменится = window.Backup.describe(clean);

          // Без проверки битая дата превращалась в «Invalid Date»
          const создана = new Date(data.createdAt);
          const заголовок = data.createdAt && Number.isFinite(создана.getTime())
            ? tr('Восстановить копию от {date}?', { date: создана.toLocaleString(tr.locale()) })
            : tr('Восстановить копию?');
          const отброшено = window.Backup.describeDropped(clean.dropped);

          // Восстановление затирает текущий список, поэтому спрашиваем.
          // Строки экранируем по одной, а переносы ставим сами
          const сообщение = [
            tr('Будет заменено: {list}.', { list: заменится }),
            отброшено && tr('Повреждённые записи пропущены — {list}.', { list: отброшено }),
            tr('Текущие данные перезапишутся, прежние сохранятся отдельно.')
          ].filter(Boolean).map(строка => window.escapeHtml(строка)).join('<br>');
          const ok = await this.confirmDanger(
            заголовок, сообщение, tr('Восстановить'));
          if (!ok) return;

          const applied = await window.Backup.restore(data);

          // Настройки из копии уже применены — перерисовываем страницу,
          // иначе переключатели показывали бы прежние значения. Если за
          // время восстановления ушли на другую страницу, её не трогаем
          if (!this._abort.signal.aborted) {
            this.render();
            this.setupEventListeners();
            this.loadAppVersion();
          }

          window.utils.showToast(tr('Восстановлено: {list}. Перезапустите приложение', { list: applied.join(', ') }), 'success');
        } catch (error) {
          console.error('[Копия] Не удалось восстановить:', error);
          // Свои ошибки Backup пишет для пользователя и помечает userMessage,
          // а технический текст (сбой записи в хранилище) остаётся в журнале.
          // По кириллице свои ошибки узнавались, пока интерфейс был только русским
          const msg = String(error?.message || '');
          const своя = error?.userMessage || (tr.lang() !== 'en' && /[а-яё]/i.test(msg) ? msg : '');
          window.utils.showToast(своя || tr('Не удалось восстановить копию'), 'error');
        } finally {
          backupInput.value = '';
        }
      });
    }

    const exportBtn = document.getElementById('export-settings-btn');
    if (exportBtn) {
      // Настройки уходят в буфер обмена. Тост раньше повторял название
      // кнопки и показывался, даже если запись в буфер не удалась
      exportBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(settings.export());
          window.utils.showToast(tr('Настройки скопированы в буфер обмена'), 'success');
        } catch (error) {
          console.warn('[Настройки] Не удалось записать в буфер обмена:', error?.message);
          window.utils.showToast(tr('Не удалось скопировать настройки'), 'error');
        }
      });
    }

    // Проверка обновлений
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', () => {
        if (!window.electronAPI?.checkForUpdates) {
          window.utils.showToast(tr('В режиме разработки обновления недоступны'), 'warning');
          return;
        }

        // Ручная проверка идёт через UpdateManager: у него защита от
        // повторных нажатий, тост «Проверяю обновления…» и сообщение, если
        // нет связи. Он объявлен в updater.js глобальной const, а не
        // свойством window, поэтому проверяем через typeof
        if (typeof updateManager !== 'undefined' && updateManager?.checkForUpdates) {
          updateManager.checkForUpdates({ manual: true });
          return;
        }

        window.electronAPI.checkForUpdates();
        window.utils.showToast(tr('Проверяю обновления…'), 'info');
      }, { signal: this._abort.signal });
    }

    // Внешние ссылки
    const openLink = (url) => {
      if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
      else window.open(url, '_blank');
    };
    document.getElementById('github-link-btn')?.addEventListener('click', () => openLink('https://github.com/Agrysif/WatchTwitch'));
    document.getElementById('telegram-link-btn')?.addEventListener('click', () => openLink('https://t.me/ebalashovv'));
    document.getElementById('boosty-link-btn')?.addEventListener('click', () => openLink('https://boosty.to/agrysif'));

    this.setupDependents();
    this.setupNavigation();
    this.setupSearch();
    this.setupDiagnostics();
  }

  /**
   * Подпись под выбором языка: пока выбранный язык ждёт перезапуска.
   * На выбранном языке — человек выбрал его, потому что читает на нём.
   */
  languageNote(pending) {
    const current = window.i18n?.currentLang || tr.lang();
    if (!pending || pending === current) return '';
    return pending === 'en'
      ? 'English will turn on after a restart'
      : 'Русский включится после перезапуска'; // i18n-ignore — на выбранном языке, а не на текущем
  }

  /**
   * Предложение перезапуститься после смены языка — на выбранном языке.
   * Отказ ничего не отменяет: выбор сохранён и сработает при следующем
   * запуске, об этом напоминает подпись под переключателем.
   */
  async askRestartForLanguage(target) {
    const en = target === 'en';
    // Фарминг при выходе сохраняет сессию (stopFarming с preserveSession),
    // и после запуска страница фарминга продолжает её на том же канале
    const farming = !!(window.sessionState?.isActive?.() || window.farmingPage?.sessionStartTime);
    const text = en ? {
      title: 'Restart WatchTwitch to switch the language',
      farming: 'Farming will stop for a moment and continue after the restart',
      restart: 'Restart now',
      later: 'Later',
      manual: 'Close WatchTwitch and open it again to switch the language'
    } : {
      title: 'Перезапустите WatchTwitch, чтобы сменить язык', // i18n-ignore — на выбранном языке
      farming: 'Фарминг ненадолго остановится и продолжится после перезапуска', // i18n-ignore
      restart: 'Перезапустить', // i18n-ignore
      later: 'Позже', // i18n-ignore
      manual: 'Закройте WatchTwitch и откройте снова, чтобы сменить язык' // i18n-ignore
    };

    const ok = await window.utils?.showConfirmation?.(text.title, farming ? text.farming : '', {
      confirmText: text.restart,
      cancelText: text.later
    });
    // Пока окно было открыто, выбор могли вернуть обратно
    if (!ok || window.i18n?.pendingLang === window.i18n?.currentLang) return;

    // Без relaunchApp (старый preload) перезапустить отсюда нечем —
    // говорим, как сделать это руками
    let restarting = false;
    try {
      if (typeof window.electronAPI?.relaunchApp === 'function') {
        await window.electronAPI.relaunchApp();
        restarting = true;
      }
    } catch (error) {
      console.warn('[Язык] Перезапуск не удался:', error?.message);
    }
    if (!restarting) window.utils?.showToast(text.manual, 'warning');
  }

  /** Пробный сигнал: chime.preview играет всегда, это явное действие. */
  previewSound(id) {
    const chime = window.chime;
    if (typeof chime?.preview === 'function') {
      chime.preview(id);
      return;
    }
    // Старый chime.js без событий: умеет только два сигнала
    if (id === 'attention') chime?.failed?.();
    else chime?.dropClaimed?.();
  }

  /**
   * Сегменты (тема, оформление, язык). Значение хранится в data-value
   * группы — по нему зависимые строки (прозрачность стекла) узнают, видны ли.
   */
  bindSegmented(id, onSelect) {
    const group = document.getElementById(id);
    if (!group) return;
    group.querySelectorAll('button[data-value]').forEach(button => {
      button.addEventListener('click', () => {
        const value = button.dataset.value;
        if (group.dataset.value === value) return;
        group.dataset.value = value;
        group.querySelectorAll('button[data-value]').forEach(b => {
          const on = b === button;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        onSelect(value, button);
        this.syncDependents();
      });
    });
  }

  /**
   * Зависимые строки: «О полученных наградах» зависит от «Уведомлений
   * Windows», громкость — от «Звуков», часы таймера — от условия
   * «По таймеру». Скрытые строки не мешают читать раздел, приглушённые
   * (data-mode="dim") остаются под рукой, но видно, что сейчас не действуют.
   */
  setupDependents() {
    const root = document.querySelector('.settings-page');
    if (!root) return;
    root.addEventListener('change', () => this.syncDependents());
    // Поиск здесь ещё не восстановлен после перерисовки — его применит setupSearch
    this.syncDependents({ search: false });
  }

  syncDependents({ search = true } = {}) {
    const root = document.querySelector('.settings-page');
    if (!root) return;

    root.querySelectorAll('[data-parent], [data-parent-value]').forEach(row => {
      let on = true;
      if (row.dataset.parent) {
        const parent = document.getElementById(row.dataset.parent);
        if (parent && !parent.checked) on = false;
      }
      if (on && row.dataset.parentValue) {
        const [id, value] = row.dataset.parentValue.split(':');
        const el = document.getElementById(id);
        const current = el?.dataset.value ?? el?.value;
        if (current !== value) on = false;
      }

      if (row.dataset.mode === 'dim') {
        row.classList.toggle('is-disabled', !on);
      } else {
        row.hidden = !on;
      }
    });

    // Поиск учитывает видимость: включили «Звуки» во время поиска —
    // новые строки проходят тот же фильтр
    if (search && this._searchQuery) this.applySearch();
  }

  /**
   * Навигация по разделам: щелчок прокручивает к разделу, при прокрутке
   * подсвечивается тот, что сейчас наверху. Короткие последние разделы до
   * верха не докручиваются, поэтому выбранный щелчком пункт держится, пока
   * прокрутка не закончится, а внизу страницы активен последний раздел.
   */
  setupNavigation() {
    const root = document.querySelector('.settings-page');
    const scroller = root?.closest('.content');
    if (!root || !scroller) return;
    const signal = this._renderAbort.signal;

    const links = [...root.querySelectorAll('.settings-nav a[data-section]')];
    const sections = links.map(a => document.getElementById(a.dataset.section)).filter(Boolean);

    const setActive = (id) => {
      links.forEach(a => {
        const on = a.dataset.section === id;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };

    this._navLock = null;
    const spy = () => {
      if (this._navLock || !root.isConnected) return;
      const visible = sections.filter(s => !s.classList.contains('is-filtered'));
      if (visible.length === 0) {
        setActive(null);
        return;
      }

      const line = scroller.getBoundingClientRect().top + 96;
      let current = visible[0].id;
      for (const s of visible) {
        if (s.getBoundingClientRect().top <= line) current = s.id;
      }
      const atBottom = scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (atBottom) current = visible[visible.length - 1].id;
      setActive(current);
    };
    this._spy = spy;

    let frame = 0;
    scroller.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; spy(); });
    }, { passive: true, signal });
    scroller.addEventListener('scrollend', () => { this._navLock = null; }, { signal });

    const reduceMotion = () => document.body.classList.contains('no-animations') ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(link.dataset.section);
        if (!target || target.classList.contains('is-filtered')) return;
        this._navLock = link.dataset.section;
        setActive(this._navLock);
        target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        // Фокус — на заголовок раздела: с клавиатуры дальше идёт Tab по
        // его пунктам, а не обратно по меню
        target.querySelector('.settings-section-title')?.focus({ preventScroll: true });
        // Если прокручивать некуда, scrollend не придёт — снимаем сами
        clearTimeout(this._navLockTimer);
        this._navLockTimer = setTimeout(() => { this._navLock = null; }, 1200);
      }, { signal });
    });

    spy();
  }

  /**
   * Поиск по подписи, описанию и ключевым словам строки. Регистр и «ё/е»
   * не важны. Разделы без совпадений прячутся, пункты меню к ним гаснут.
   */
  setupSearch() {
    const input = document.getElementById('settings-search');
    const clear = document.getElementById('settings-search-clear');
    if (!input) return;
    const signal = this._renderAbort.signal;

    // После перерисовки (смена языка, сброс) запрос сохраняется
    if (this._searchQuery) input.value = this._searchQuery;

    input.addEventListener('input', () => this.applySearch());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        this.applySearch();
      }
    });
    clear?.addEventListener('click', () => {
      input.value = '';
      this.applySearch();
      input.focus();
    });

    // Ctrl+F — как в браузере. По коду клавиши: в русской раскладке
    // e.key здесь «а»
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
        if (!document.body.contains(input)) return;
        e.preventDefault();
        input.focus();
        input.select();
      }
    }, { signal });

    this.applySearch();
  }

  applySearch() {
    const root = document.querySelector('.settings-page');
    const input = document.getElementById('settings-search');
    if (!root || !input) return;

    const norm = (text) => String(text || '').toLowerCase().replace(/ё/g, 'е'); // i18n-ignore — нормализация поиска
    const query = norm(input.value.trim());
    this._searchQuery = input.value.trim();

    const clear = document.getElementById('settings-search-clear');
    if (clear) clear.hidden = !query;
    root.classList.toggle('is-searching', !!query);

    // Подсветка — только в неизменных текстах. Живые подписи (сводка
    // автовыключения, потолок скорости) пишутся кодом, и сохранённый
    // оригинал вернул бы устаревший текст
    const esc = window.escapeHtml;
    const highlight = (el) => {
      if (!el || el.hasAttribute('data-live')) return;
      if (el.dataset.orig === undefined) {
        if (el.children.length > 0) return;
        el.dataset.orig = el.textContent;
      }
      const text = el.dataset.orig;
      const at = query ? norm(text).indexOf(query) : -1;
      if (at < 0) {
        el.textContent = text;
        return;
      }
      el.innerHTML = esc(text.slice(0, at)) +
        `<mark class="settings-hit">${esc(text.slice(at, at + query.length))}</mark>` +
        esc(text.slice(at + query.length));
    };

    const rows = [...root.querySelectorAll('.settings-section .settings-item, .settings-section .settings-block')];
    const textOf = (row) => norm([
      row.querySelector('.settings-item-label')?.textContent,
      row.querySelector('.settings-item-description')?.textContent,
      row.dataset.keywords
    ].join(' '));

    const sections = [...root.querySelectorAll('.settings-section')];

    const matched = new Set();
    rows.forEach(row => {
      if (!query || textOf(row).includes(query)) matched.add(row);
    });

    // Совпало название раздела («оформление»), а строки — нет: показываем
    // раздел целиком. Если же в разделе нашлись строки, только их — иначе
    // «звук» открывал бы все уведомления подряд
    if (query) {
      sections.forEach(section => {
        if (!norm(section.querySelector('.settings-section-title')?.textContent).includes(query)) return;
        const own = rows.filter(row => row.closest('.settings-section') === section);
        if (!own.some(row => matched.has(row))) own.forEach(row => matched.add(row));
      });
    }

    // Совпала скрытая зависимая строка (громкость при выключенных звуках) —
    // показываем её «родителя»: включив его, человек увидит и саму строку
    rows.forEach(row => {
      if (!query || !row.hidden || !matched.has(row) || !row.dataset.parent) return;
      const parentRow = document.getElementById(row.dataset.parent)?.closest('.settings-item');
      if (parentRow) matched.add(parentRow);
    });

    rows.forEach(row => {
      row.classList.toggle('is-filtered', !!query && !matched.has(row));
      row.querySelectorAll('.settings-item-label, .settings-item-description').forEach(highlight);
    });

    let anyVisible = false;
    sections.forEach(section => {
      const has = !query || rows.some(row => row.closest('.settings-section') === section &&
        !row.hidden && !row.classList.contains('is-filtered'));
      section.classList.toggle('is-filtered', !has);
      if (has) anyVisible = true;
      const danger = section.querySelector('.settings-danger');
      if (danger) {
        danger.classList.toggle('is-filtered', !!query &&
          ![...danger.querySelectorAll('.settings-item')].some(row => !row.classList.contains('is-filtered')));
      }
      const link = root.querySelector(`.settings-nav a[data-section="${section.id}"]`);
      link?.classList.toggle('is-empty', !has);
    });

    const empty = document.getElementById('settings-empty');
    if (empty) empty.hidden = anyVisible;

    // Новый запрос — к началу результатов, иначе первое совпадение могло
    // оказаться выше видимой области
    const scroller = root.closest('.content');
    if (query && this._lastQuery !== query && scroller) scroller.scrollTop = 0;
    this._lastQuery = query;
    this._spy?.();
  }

  /**
   * Подтверждение опасного действия своим окном. Нативный confirm()
   * показывал английские OK/Cancel и чужой стиль как раз там, где
   * ошибиться дороже всего: очистка статистики, сброс, восстановление.
   *
   * title — обычная строка, textHtml — уже экранированная разметка.
   */
  confirmDanger(title, textHtml, confirmText) {
    const i18n = window.i18n;
    const esc = window.escapeHtml;
    const html = `
      <div class="settings-confirm">
        <h3 class="settings-confirm-title">${esc(title)}</h3>
        ${textHtml ? `<p class="settings-confirm-text">${textHtml}</p>` : ''}
      </div>
    `;
    return window.utils.showCustomConfirmation(html, {
      confirmText: esc(confirmText),
      cancelText: esc(tr('Отмена')),
      confirmClass: 'btn-danger'
    });
  }

  /**
   * Процессы приложения. Список свёрнут и опрашивается только при
   * раскрытии — и по кнопке «Обновить».
   */
  setupDiagnostics() {
    const details = document.getElementById('processes-details');
    const refreshBtn = document.getElementById('refresh-processes-btn');
    const list = document.getElementById('processes-list');
    if (!details || !refreshBtn || !list) return;

    if (!window.electronAPI?.getProcessMetrics) {
      details.closest('.settings-block')?.setAttribute('hidden', '');
      return;
    }

    details.addEventListener('toggle', () => {
      if (details.open) this.renderProcessMetrics();
    });
    refreshBtn.addEventListener('click', () => this.renderProcessMetrics());
  }

  async renderProcessMetrics() {
    const list = document.getElementById('processes-list');
    if (!list) return;
    const esc = window.escapeHtml;

    if (!list.children.length) {
      list.innerHTML = window.DOMHelpers?.skeletonRows ? window.DOMHelpers.skeletonRows(3) : '';
    }

    try {
      const metrics = await window.electronAPI.getProcessMetrics();
      if (!list.isConnected) return;
      if (!metrics || metrics.length === 0) {
        list.innerHTML = `<div class="settings-note">${tr('Нет данных')}</div>`;
        return;
      }

      // Единицы по-русски и с запятой: «118,6 МБ», как везде в приложении;
      // в английском — точка: «118.6 MB»
      const decimal = (value) => (tr.lang() === 'en' ? value.toFixed(1) : value.toFixed(1).replace('.', ','));
      const mb = (kb) => typeof kb === 'number'
        ? tr('{value} МБ', { value: decimal(kb / 1024) })
        : '—';
      const cpu = (value) => typeof value === 'number'
        ? `${decimal(value)} %`
        : '—';

      const totalKb = metrics.reduce((sum, m) => sum + (Number(m.memory?.workingSetSize) || 0), 0);
      const summary = document.getElementById('processes-summary');
      if (summary && totalKb > 0) {
        summary.textContent = tr('Всего {memory} памяти · процессов: {count}', { memory: mb(totalKb), count: metrics.length });
      }

      list.innerHTML = `
        <div class="process-row process-head" aria-hidden="true">
          <span>${tr('Процесс')}</span><span>CPU</span><span>${tr('Память')}</span>
        </div>
        ${metrics.map(metric => `
          <div class="process-row">
            <span class="process-name">
              <span class="truncate">${esc(String(metric.label || metric.type || 'process'))}</span>
              <span class="process-meta">pid ${esc(String(metric.pid || '—'))} · ${esc(String(metric.type || '—'))}</span>
            </span>
            <span class="process-num num">${cpu(metric.cpu?.percentCPUUsage)}</span>
            <span class="process-num num">${mb(metric.memory?.workingSetSize)}</span>
          </div>`).join('')}`;
    } catch (error) {
      console.error('[Diagnostics] Failed to load process metrics:', error);
      list.innerHTML = `<div class="settings-note tone-error">${tr('Не удалось получить данные')}</div>`;
    }
  }

  async loadAppVersion() {
    const versionEl = document.getElementById('setting-app-version');
    if (!versionEl) return;
    try {
      if (window.electronAPI?.getAppVersion) {
        const version = await window.electronAPI.getAppVersion();
        versionEl.textContent = `v${version}`;
      }
    } catch (e) {
      versionEl.textContent = '—';
    }
  }
}

window.SettingsPage = SettingsPage;
