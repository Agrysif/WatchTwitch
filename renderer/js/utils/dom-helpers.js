/**
 * Заглушка для картинок наград и обложек.
 *
 * Раньше в коде стояли ссылки на via.placeholder.com — сервис отключён,
 * и вместо заглушки показывался значок сломанного изображения. Картинка
 * встроена прямо в код: она не зависит ни от сети, ни от чужого сервиса.
 * Цвета нейтральные: фиолетовая звезда на каждой награде без картинки
 * добавляла акцента там, где ничего не выбрано и ничего не происходит.
 */
(() => {
  // Тёмный квадрат на светлой теме выглядел дырой в списке — у каждой темы
  // своя заливка (цвет --surface-2) и своя звезда (--text-tertiary). Тему
  // смотрим в момент обращения: шаблоны берут заглушку при отрисовке, а
  // тесты грузят этот файл без document — там остаётся тёмный вариант
  const DARK = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%226%22%20fill%3D%22%231d1f23%22/%3E%3Cpath%20d%3D%22M32%2016l4.6%209.4%2010.4%201.5-7.5%207.3%201.8%2010.3L32%2039.6l-9.3%204.9%201.8-10.3-7.5-7.3%2010.4-1.5z%22%20fill%3D%22%23858a95%22%20opacity%3D%22.5%22/%3E%3C/svg%3E';
  const LIGHT = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%226%22%20fill%3D%22%23f0f1f4%22/%3E%3Cpath%20d%3D%22M32%2016l4.6%209.4%2010.4%201.5-7.5%207.3%201.8%2010.3L32%2039.6l-9.3%204.9%201.8-10.3-7.5-7.3%2010.4-1.5z%22%20fill%3D%22%236b717c%22%20opacity%3D%22.5%22/%3E%3C/svg%3E';
  Object.defineProperty(window, 'DROP_PLACEHOLDER', {
    configurable: true,
    enumerable: true,
    get() {
      const light = typeof document !== 'undefined' && document.body?.classList?.contains('theme-light');
      return light ? LIGHT : DARK;
    }
  });
})();

/**
 * Набор иконок интерфейса: window.Icons.get('play', 16) → строка <svg>.
 *
 * Раньше каждый шаблон рисовал свою иконку своей толщиной и своей
 * заливкой — рядом стояли залитые, контурные и эмодзи. Здесь один рисунок
 * на всё приложение: контур 1.75 в поле 24×24, цвет — currentColor, то
 * есть цвет текста кнопки или строки. Неизвестное имя — пустая строка,
 * чтобы опечатка не ломала шаблон. Глифа Twitch в наборе нет намеренно:
 * у приложения свой логотип (assets/logo.svg).
 *
 * В статической разметке (index.html, renderer/pages/*.html) JS не
 * выполняется — там инлайновый <svg> того же рисунка.
 */
window.Icons = (() => {
  // Внутри замыкания: имя на верхнем уровне скрипта занимало бы общее
  // пространство всех скриптов окна
  const ICON_PATHS = {
    play: '<path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    chest: '<path d="M4 10a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 12h6M14 12h6"/><rect x="10" y="10" width="4" height="5" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
    gamepad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.91l5.16-.75a2.12 2.12 0 0 0 1.6-1.16z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M3 6h.01M3 12h.01M3 18h.01"/><path d="M8 6h13M8 12h13M8 18h13"/>',
    swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
    journal: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    volume: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.41 7.59A1.4 1.4 0 0 1 5.42 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.42a1.4 1.4 0 0 1 .99.41l3.39 3.39a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.36 18.36a9 9 0 0 0 0-12.73"/>',
    'volume-off': '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.41 7.59A1.4 1.4 0 0 1 5.42 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.42a1.4 1.4 0 0 1 .99.41l3.39 3.39a.7.7 0 0 0 1.2-.5z"/><path d="m22 9-6 6M16 9l6 6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 8l5 5M22 8l-5 5"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/><path d="M10 7.75v4.5a.5.5 0 0 0 .76.43l3.6-2.25a.5.5 0 0 0 0-.86l-3.6-2.25a.5.5 0 0 0-.76.43z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>'
  };

  return {
    /** Имена всех иконок набора — для проверок и отладки */
    names: Object.keys(ICON_PATHS),

    /**
     * Строка <svg> нужного размера. Иконка декоративная (aria-hidden):
     * смысл кнопке даёт её подпись, title или aria-label.
     */
    get(name, size = 16) {
      const body = Object.prototype.hasOwnProperty.call(ICON_PATHS, name) ? ICON_PATHS[name] : '';
      if (!body) return '';
      const s = Math.max(8, Math.round(Number(size) || 16));
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }
  };
})();

// DOM helpers - утилиты для работы с DOM
const DOMHelpers = {
  /**
   * Создать элемент с классами и атрибутами
   */
  createElement(tag, options = {}) {
    const element = document.createElement(tag);

    if (options.classes) {
      element.className = Array.isArray(options.classes)
        ? options.classes.join(' ')
        : options.classes;
    }

    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        element.setAttribute(key, value);
      });
    }

    if (options.style) {
      Object.assign(element.style, options.style);
    }

    if (options.innerHTML) {
      element.innerHTML = options.innerHTML;
    }

    if (options.textContent) {
      element.textContent = options.textContent;
    }

    if (options.children) {
      options.children.forEach(child => {
        element.appendChild(child);
      });
    }

    return element;
  },

  /**
   * Очистить контейнер
   */
  clearContainer(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  },

  /**
   * Показать/скрыть элемент
   */
  toggleElement(element, show) {
    if (!element) return;
    element.style.display = show ? 'block' : 'none';
  },

  /**
   * Добавить CSS класс с анимацией
   */
  addClassWithAnimation(element, className, duration = 300) {
    if (!element) return;

    element.classList.add(className);

    return new Promise(resolve => {
      setTimeout(() => resolve(), duration);
    });
  },

  /**
   * Удалить CSS класс с анимацией
   */
  removeClassWithAnimation(element, className, duration = 300) {
    if (!element) return;

    element.classList.remove(className);

    return new Promise(resolve => {
      setTimeout(() => resolve(), duration);
    });
  },

  /**
   * Кольцо загрузки (.spinner из main.css). Размер — по имени; цвета —
   * из темы, а не #7c5cff на белой дорожке, как было
   */
  createSpinner(size = 'medium') {
    const sizes = {
      small: '16px',
      medium: '32px',
      large: '48px'
    };

    return this.createElement('div', {
      classes: 'spinner',
      attributes: { role: 'status', 'aria-label': tr('Загрузка') },
      style: {
        width: sizes[size] || sizes.medium,
        height: sizes[size] || sizes.medium,
        margin: '20px auto'
      }
    });
  },

  /**
   * Пустое состояние строкой HTML: контурная иконка, заголовок, одно
   * предложение и (необязательно) одна кнопка.
   *
   *   DOMHelpers.emptyState({ icon: 'list', title: 'Очередь пуста',
   *     text: 'Добавьте игру…', actionHtml: '<button class="btn btn-primary">…</button>' })
   *
   * title и text экранируются; actionHtml вставляется как есть — его
   * собирает вызывающий из своих данных.
   */
  emptyState({ icon = 'info', title = '', text = '', actionHtml = '' } = {}) {
    const esc = window.escapeHtml;
    const svg = icon ? (window.Icons.get(icon, 40) || '') : '';
    return `<div class="empty-state">${svg}`
      + (title ? `<h3>${esc(title)}</h3>` : '')
      + (text ? `<p>${esc(text)}</p>` : '')
      + (actionHtml || '')
      + '</div>';
  },

  /**
   * Скелетон списка: n серых строк высотой в строку списка вместо надписи
   * «Загрузка…» — место под содержимое занято сразу, и страница не прыгает,
   * когда данные приходят.
   */
  skeletonRows(n = 5) {
    const count = Math.max(1, Math.min(20, Math.round(Number(n) || 5)));
    return `<div class="skeleton-list" aria-busy="true" aria-label="${tr('Загрузка')}">`
      + '<div class="skeleton skeleton-row" aria-hidden="true"></div>'.repeat(count)
      + '</div>';
  },

  /**
   * Показать сообщение об ошибке
   */
  showError(container, message) {
    if (!container) return;
    this.clearContainer(container);
    container.innerHTML = this.emptyState({ icon: 'warning', title: message });
  },

  /**
   * Показать пустое состояние. Третий аргумент — имя иконки из набора;
   * прежние вызовы передавали эмодзи — оно игнорируется в пользу «info»
   */
  showEmptyState(container, message, icon = 'info') {
    if (!container) return;
    this.clearContainer(container);
    const name = window.Icons.names.includes(icon) ? icon : 'info';
    container.innerHTML = this.emptyState({ icon: name, title: message });
  },

  /**
   * Дебаунс функции
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Троттлинг функции
   */
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  /**
   * Escape HTML для безопасного вывода
   */
  escapeHtml(text) {
    return window.escapeHtml(text);
  },

  /**
   * Форма слова по числу: plural(21, 'категория', 'категории', 'категорий')
   * → 'категория'. Возвращает только слово, число подставляет вызывающий.
   *
   * Раньше по коду стояли самодельные варианты вроде «n < 5 ? … : …»,
   * и выходило «21 категорий» и «Упущено 21 наград». Русскому нужны три
   * формы, и решают последние две цифры: 11–14 всегда «много».
   */
  plural(n, one, few, many) {
    // В английском режиме — английское правило и переводы форм
    if (typeof window.tr?.plural === 'function') return window.tr.plural(n, one, few, many);
    const число = Number(n) || 0;
    // Дробное число всегда во второй форме: «1,5 часа», «2,5 категории»
    if (!Number.isInteger(число)) return few;
    const десятки = Math.abs(число) % 100;
    const единицы = десятки % 10;
    if (десятки > 10 && десятки < 20) return many;
    if (единицы === 1) return one;
    if (единицы >= 2 && единицы <= 4) return few;
    return many;
  },

  /**
   * Анимация fade in
   */
  fadeIn(element, duration = 300) {
    if (!element) return;

    element.style.opacity = '0';
    element.style.display = 'block';

    let start = null;

    function animate(timestamp) {
      if (!start) start = timestamp;
      const progress = timestamp - start;

      element.style.opacity = Math.min(progress / duration, 1);

      if (progress < duration) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  },

  /**
   * Анимация fade out
   */
  fadeOut(element, duration = 300) {
    if (!element) return;

    let start = null;
    const initialOpacity = parseFloat(window.getComputedStyle(element).opacity) || 1;

    function animate(timestamp) {
      if (!start) start = timestamp;
      const progress = timestamp - start;

      element.style.opacity = initialOpacity * (1 - Math.min(progress / duration, 1));

      if (progress < duration) {
        requestAnimationFrame(animate);
      } else {
        element.style.display = 'none';
      }
    }

    requestAnimationFrame(animate);
  }
};

window.DOMHelpers = DOMHelpers;

/**
 * Экранирование для вставки в HTML — и в текст, и в значения атрибутов.
 *
 * Прежний вариант через textContent/innerHTML не трогал кавычки, поэтому
 * в атрибутах (title="…", alt="…") строка от Twitch могла закрыть
 * кавычку и дописать свой атрибут. Одна функция на всё приложение.
 *
 * Объявлена через присваивание, а не «function escapeHtml»: объявление
 * функции в общем пространстве скриптов запретило бы любому другому
 * файлу написать у себя «const escapeHtml = …» — браузер счёл бы это
 * повторным объявлением, и весь тот файл не загрузился бы.
 */
window.escapeHtml = function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
};
