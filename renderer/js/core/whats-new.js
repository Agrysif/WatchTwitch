/**
 * WhatsNew — окно «что нового» после обновления.
 *
 * Текст берётся с GitHub, а не хранится в приложении. Так установленная
 * версия может показать и свои изменения, и предыдущие патчи, а описание
 * не нужно дублировать в коде при каждом выпуске.
 *
 * Окно показывается один раз: после обновления запомненная версия не
 * совпадает с текущей. При первой установке не показывается вовсе —
 * рассказывать «что изменилось» тому, кто ещё ничего не видел, незачем.
 */
class WhatsNew {
  constructor() {
    this.releases = null;
  }

  static get() {
    if (!window._whatsNew) {
      window._whatsNew = new WhatsNew();
    }
    return window._whatsNew;
  }

  /** Проверка при запуске: обновились ли мы с прошлого раза. */
  async checkAfterUpdate() {
    if (!window.electronAPI?.getAppVersion) return;

    const version = await window.electronAPI.getAppVersion();
    if (!version) return;

    const seen = window.settings?.get('lastSeenVersion');

    // Первый запуск: запоминаем версию молча
    if (!seen) {
      window.settings?.set('lastSeenVersion', version);
      return;
    }

    if (seen === version) return;

    console.log('[Что нового] Обновление с', seen, 'на', version);
    window.settings?.set('lastSeenVersion', version);

    await this.show({ highlight: version, since: seen });
  }

  /**
   * Показывает окно.
   * @param {object} options
   * @param {string} options.highlight - версия, раскрытая по умолчанию
   * @param {string} options.since - версия, с которой обновились
   */
  async show(options = {}) {
    const existing = document.getElementById('whats-new-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'whats-new-overlay';
    overlay.className = 'whats-new-overlay';
    overlay.innerHTML = `
      <div class="whats-new" role="dialog" aria-label="Что нового">
        <div class="whats-new-head">
          <div>
            <div class="whats-new-eyebrow">${options.since ? 'Приложение обновлено' : 'Сведения об обновлениях'}</div>
            <h2 class="whats-new-title">Что нового</h2>
          </div>
          <button class="whats-new-close" id="whats-new-close" aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="whats-new-body" id="whats-new-body">
          <div class="whats-new-loading">Загружаю сведения с GitHub…</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#whats-new-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    await this.renderBody(options);
  }

  async renderBody(options) {
    const body = document.getElementById('whats-new-body');
    if (!body) return;

    if (!this.releases) {
      const result = await window.electronAPI?.fetchReleaseNotes?.(null);

      if (!result?.success || !result.releases?.length) {
        body.innerHTML = `
          <div class="whats-new-empty">
            Не удалось загрузить сведения${result?.error ? ': ' + this.escape(result.error) : ''}.
            <br>Попробуйте позже — список берётся с GitHub.
          </div>
        `;
        return;
      }

      this.releases = result.releases;
    }

    // Показываем всё, что вышло после версии, с которой обновились
    const relevant = options.since
      ? this.releases.filter(r => WhatsNew.compare(r.version, options.since) > 0)
      : this.releases;

    const list = relevant.length > 0 ? relevant : this.releases.slice(0, 1);

    body.innerHTML = list
      .map((release, index) => this.renderRelease(release, index === 0))
      .join('');

    body.querySelectorAll('.whats-new-release-head').forEach(head => {
      head.addEventListener('click', () => {
        head.parentElement.classList.toggle('open');
      });
    });
  }

  renderRelease(release, expanded) {
    const isRussian = (window.i18n?.currentLang || 'ru') === 'ru';
    const sections = this.parseSections(release.body, isRussian);

    const date = release.publishedAt
      ? new Date(release.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';

    const blocks = sections.map(section => `
      <div class="whats-new-section">
        <div class="whats-new-section-title">${this.escape(section.title)}</div>
        <ul>${section.items.map(i => `<li>${this.formatInline(i)}</li>`).join('')}</ul>
      </div>
    `).join('');

    return `
      <div class="whats-new-release ${expanded ? 'open' : ''}">
        <div class="whats-new-release-head">
          <span class="whats-new-version">${this.escape(release.version)}</span>
          ${date ? `<span class="whats-new-date">${date}</span>` : ''}
          <svg class="whats-new-chevron" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 15l-6-6h12z"/>
          </svg>
        </div>
        <div class="whats-new-release-body">
          ${blocks || '<div class="whats-new-empty">Описание не заполнено</div>'}
        </div>
      </div>
    `;
  }

  /**
   * Разбирает описание релиза на разделы.
   *
   * Заметки пишутся на двух языках с заголовками-флагами; берём только
   * раздел под язык интерфейса, иначе окно превращается в простыню.
   */
  parseSections(markdown, isRussian) {
    if (!markdown || !markdown.trim()) return [];

    const parts = markdown.split(/^##\s+/m).filter(p => p.trim());

    const wanted = parts.filter(part => {
      const head = part.split('\n')[0];
      const isEnglish = /🇬🇧|what's new|fixed/i.test(head) && !/🇷🇺/.test(head);
      const isRu = /🇷🇺|что нового|исправлено/i.test(head);

      if (isRussian) return isRu || (!isEnglish && !isRu);
      return isEnglish || (!isEnglish && !isRu);
    });

    const chosen = wanted.length > 0 ? wanted : parts;

    return chosen.map(part => {
      const lines = part.split('\n').map(l => l.trim()).filter(Boolean);
      const title = lines.shift() || '';
      const items = lines
        .filter(l => l.startsWith('-') || l.startsWith('*'))
        .map(l => l.replace(/^[-*]\s*/, ''));
      return { title, items };
    }).filter(section => section.items.length > 0);
  }

  /** Сравнение версий вида 1.0.15. Возвращает 1, -1 или 0. */
  static compare(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  /**
   * Готовит строку описания к вставке: экранирует, затем размечает.
   *
   * Порядок важен. Сначала экранирование — текст приходит с GitHub, и
   * вставлять его как разметку нельзя. Только после этого превращаем
   * **звёздочки** в жирный шрифт: раньше их никто не разбирал, и в окне
   * так и висели две звёздочки вокруг каждого важного пункта.
   */
  formatInline(text) {
    const safe = this.escape(text);

    return safe
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  /** Описание приходит извне, поэтому вставляем его только как текст. */
  escape(text) {
    return String(text).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
}

window.WhatsNew = WhatsNew;
window.whatsNew = WhatsNew.get();
