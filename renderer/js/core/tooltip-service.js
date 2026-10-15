// Tooltip Service - система подсказок
class TooltipService {
  constructor() {
    this.tooltip = null;
    this.currentTarget = null;
    this.hideTimeout = null;
    this.init();
  }

  init() {
    // Вид подсказки — класс .tooltip в main.css (цвета темы); здесь
    // остаются только место и видимость. Раньше вид был прописан тут же
    // готовыми цветами, и на светлой теме подсказка оставалась чёрной
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(this.tooltip);

    // Обработчики для всех элементов с data-tooltip
    this.attachGlobalListeners();
  }

  attachGlobalListeners() {
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        this.show(target, target.dataset.tooltip);
      }
    });

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        this.hide();
      }
    });
  }

  show(element, text) {
    if (!text) return;

    clearTimeout(this.hideTimeout);
    this.currentTarget = element;
    this.tooltip.textContent = text;

    // Получаем позицию элемента
    const rect = element.getBoundingClientRect();
    
    // Позиционируем tooltip
    const tooltipRect = this.tooltip.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // Проверяем выход за границы экрана
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }

    // Если tooltip выходит за нижнюю границу, показываем сверху
    if (top + tooltipRect.height > window.innerHeight - 10) {
      top = rect.top - tooltipRect.height - 8;
    }

    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.opacity = '1';
  }

  hide() {
    this.hideTimeout = setTimeout(() => {
      this.tooltip.style.opacity = '0';
      this.currentTarget = null;
    }, 100);
  }

  /**
   * Показать кастомный tooltip в указанной позиции
   */
  showAt(x, y, text) {
    if (!text) return;

    clearTimeout(this.hideTimeout);
    this.tooltip.textContent = text;
    this.tooltip.style.top = `${y}px`;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.opacity = '1';

    return {
      hide: () => this.hide()
    };
  }

  /**
   * Добавить tooltip к элементу программно
   */
  attach(element, text) {
    if (!element || !text) return;
    element.setAttribute('data-tooltip', text);
  }

  /**
   * Удалить tooltip с элемента
   */
  detach(element) {
    if (!element) return;
    element.removeAttribute('data-tooltip');
  }

  /**
   * Обновить текст tooltip
   */
  update(element, text) {
    if (!element) return;
    element.setAttribute('data-tooltip', text);
    
    // Если это текущий активный tooltip, обновляем его
    if (this.currentTarget === element) {
      this.tooltip.textContent = text;
    }
  }
}

// Экспорт синглтона
window.TooltipService = window.TooltipService || new TooltipService();
