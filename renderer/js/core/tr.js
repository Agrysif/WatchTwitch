// Перевод интерфейса.
//
// Строки интерфейса написаны в коде по-русски, а tr() отдаёт их на языке
// приложения: в русском режиме — как есть, в английском — из словаря
// js/locales/en/*.js, где ключ — русский исходник. Подстановки — {имя}:
//
//   tr('Осталось {time}', { time })
//
// Словарь ищется по шаблону до подстановки, поэтому порядок слов в
// переводе свободный. Склеивать переведённые куски нельзя: в английском
// другой порядок слов.
//
// Язык выбирается один раз при запуске и до перезапуска не меняется.
// Поэтому tr() можно звать где угодно, хоть при загрузке скрипта, — нужно
// только, чтобы словари были подключены раньше (index.html: сразу после
// этого файла).
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const has = Object.prototype.hasOwnProperty;
  const CYRILLIC = /[А-Яа-яЁё]/;

  // Русский интерфейс — для тех, у кого Windows на русском, украинском,
  // белорусском или казахском: остальным понятнее английский
  const RU_FAMILY = /^(ru|uk|be|kk)\b/i;

  function detectLanguage() {
    try {
      const saved = localStorage.getItem('appLanguage');
      if (saved === 'ru' || saved === 'en') return saved;
      // Установка, которой уже пользовались, остаётся русской: до 1.2.0
      // интерфейс был только русским, и менять язык без спроса нельзя.
      // Признак — любые данные приложения в localStorage
      const existing = localStorage.length > 0;
      const system = String((navigator.languages && navigator.languages[0]) || navigator.language || '');
      const lang = existing || RU_FAMILY.test(system) ? 'ru' : 'en';
      localStorage.setItem('appLanguage', lang);
      return lang;
    } catch (error) {
      return 'ru';
    }
  }

  const lang = detectLanguage();
  root.WT_LANG = lang;
  try {
    if (root.document && root.document.documentElement) root.document.documentElement.lang = lang;
  } catch (error) { /* нет документа — тесты */ }

  // Строки без перевода — для проверки покрытия (tests/i18n-*.cjs)
  const missing = new Set();

  function lookup(ru) {
    if (root.WT_LANG !== 'en') return ru;
    const dict = root.I18N_EN;
    if (dict && has.call(dict, ru) && typeof dict[ru] === 'string') return dict[ru];
    if (CYRILLIC.test(ru)) missing.add(ru);
    return ru;
  }

  function fill(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, key) => (has.call(params, key) ? String(params[key]) : match));
  }

  function tr(ru, params) {
    if (typeof ru !== 'string') return ru;
    return fill(lookup(ru), params);
  }

  /**
   * Форма слова по числу: tr.plural(21, 'категория', 'категории', 'категорий').
   * В русском — прежнее правило (дробное число — вторая форма), в
   * английском — единственное число только для 1, переводы форм берутся
   * из словаря: нужны ключи для первой и третьей формы.
   */
  tr.plural = function plural(n, one, few, many) {
    const value = Number(n) || 0;
    if (root.WT_LANG === 'en') return tr(Math.abs(value) === 1 ? one : many);
    if (!Number.isInteger(value)) return few;
    const tens = Math.abs(value) % 100;
    const units = tens % 10;
    if (tens > 10 && tens < 20) return many;
    if (units === 1) return one;
    if (units >= 2 && units <= 4) return few;
    return many;
  };

  tr.lang = () => root.WT_LANG;
  /** Локаль для toLocaleString / Intl. */
  tr.locale = () => (root.WT_LANG === 'en' ? 'en-US' : 'ru-RU');
  tr.missing = () => Array.from(missing);

  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tooltip', 'alt'];
  const normalize = (text) => text.replace(/\s+/g, ' ').trim();

  function strict(key) {
    const dict = root.I18N_EN;
    if (dict && has.call(dict, key) && typeof dict[key] === 'string') return dict[key];
    missing.add(key);
    return null;
  }

  /**
   * Перевод готовой разметки (страницы из pages/*.html, index.html).
   * Текстовый узел переводится целиком, по тексту без лишних пробелов.
   * Абзац с вложенной разметкой (<b>, <a>) помечается data-tr: тогда ключ —
   * его innerHTML без лишних пробелов, а перевод — тоже разметка.
   * data-no-tr — не трогать (имена, пользовательские данные).
   */
  tr.dom = function translateDom(node) {
    if (root.WT_LANG !== 'en' || !node || !root.document) return;
    const doc = root.document;
    const skip = (el) => !!(el && el.closest && el.closest('[data-no-tr]'));

    const blocks = node.querySelectorAll ? Array.from(node.querySelectorAll('[data-tr]')) : [];
    if (node.matches && node.matches('[data-tr]')) blocks.unshift(node);
    for (const el of blocks) {
      if (skip(el) || el.dataset.trDone === '1') continue;
      const en = strict(normalize(el.innerHTML));
      if (en != null) el.innerHTML = en;
      el.dataset.trDone = '1';
    }

    // Узел может быть из чужого документа: router переводит страницу,
    // разобранную DOMParser, до вставки
    const walker = (node.ownerDocument || doc).createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const raw = text.nodeValue;
      if (!raw || !CYRILLIC.test(raw)) continue;
      const parent = text.parentNode;
      if (!parent || parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE') continue;
      if (skip(parent) || (parent.closest && parent.closest('[data-tr]'))) continue;
      const key = normalize(raw);
      const en = strict(key);
      if (en != null) {
        const lead = raw.match(/^\s*/)[0];
        const tail = raw.match(/\s*$/)[0];
        text.nodeValue = lead + en + tail;
      }
    }

    const elements = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
    if (node.getAttribute) elements.unshift(node);
    for (const el of elements) {
      if (skip(el)) continue;
      for (const attr of ATTRS) {
        const value = el.getAttribute(attr);
        if (!value || !CYRILLIC.test(value)) continue;
        const en = strict(normalize(value));
        if (en != null) el.setAttribute(attr, en);
      }
    }
  };

  root.tr = tr;
  if (typeof globalThis !== 'undefined') globalThis.tr = tr;
})();
