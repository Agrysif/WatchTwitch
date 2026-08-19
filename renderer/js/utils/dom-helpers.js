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
   * Создать загрузчик (spinner)
   */
  createSpinner(size = 'medium') {
    const sizes = {
      small: '16px',
      medium: '32px',
      large: '48px'
    };
    
    return this.createElement('div', {
      style: {
        width: sizes[size] || sizes.medium,
        height: sizes[size] || sizes.medium,
        border: '3px solid rgba(255, 255, 255, 0.1)',
        borderTop: '3px solid #7c5cff',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: '20px auto'
      }
    });
  },

  /**
   * Показать сообщение об ошибке
   */
  showError(container, message) {
    if (!container) return;
    
    this.clearContainer(container);
    
    const errorDiv = this.createElement('div', {
      style: {
        color: '#ff3b30',
        padding: '20px',
        textAlign: 'center',
        background: 'rgba(255, 59, 48, 0.1)',
        borderRadius: '8px',
        margin: '20px'
      },
      innerHTML: `
        <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
        <div style="font-size: 14px; font-weight: 600;">${message}</div>
      `
    });
    
    container.appendChild(errorDiv);
  },

  /**
   * Показать пустое состояние
   */
  showEmptyState(container, message, icon = '📭') {
    if (!container) return;
    
    this.clearContainer(container);
    
    const emptyDiv = this.createElement('div', {
      style: {
        color: 'rgba(255, 255, 255, 0.5)',
        padding: '40px',
        textAlign: 'center'
      },
      innerHTML: `
        <div style="font-size: 48px; margin-bottom: 15px;">${icon}</div>
        <div style="font-size: 16px;">${message}</div>
      `
    });
    
    container.appendChild(emptyDiv);
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
