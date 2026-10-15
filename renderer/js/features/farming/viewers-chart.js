/**
 * График зрителей для карточки текущего стрима.
 *
 * Чистая отрисовка на canvas: получает историю замеров и рисует. Ничего
 * из состояния страницы фарминга ей не нужно, поэтому вынесена отдельно —
 * работа с координатами только мешала читать логику фарминга.
 *
 * Цвета берутся из токенов оформления (--accent, --text-*, --border-color),
 * а не задаются здесь: раньше график был фиолетовым со свечением на любой
 * теме, а на светлой подписи терялись. Фон — у самого элемента canvas
 * (.viewers-chart-popover в page-farming.css).
 */
window.drawViewersChart = function (ctx, history) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // Токены читаем при каждой отрисовке: тему могли сменить на лету
  const styles = getComputedStyle(document.body);
  const token = (name, fallback) => (styles.getPropertyValue(name) || '').trim() || fallback;
  const accent = token('--accent', '#7c5cff');
  const textPrimary = token('--text-primary', '#ececf0');
  const textSecondary = token('--text-secondary', '#a3a7b1');
  const textTertiary = token('--text-tertiary', '#858a95');
  const border = token('--border-color', 'rgba(255, 255, 255, 0.08)');
  const font = (weight, size) => `${weight} ${size}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;

  // Цвет акцента с прозрачностью — для заливки под линией
  const withAlpha = (color, alpha) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
    if (rgb) {
      const [r, g, b] = rgb[1].split(',').map(part => part.trim());
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  };

  const padding = 16;

  // Заголовок — обычным текстом, как у карточек
  const drawTitle = () => {
    ctx.font = font(600, 13);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = textPrimary;
    ctx.fillText('Зрители', padding, padding + 12);
    ctx.font = font(400, 11);
    ctx.fillStyle = textTertiary;
    ctx.textAlign = 'right';
    ctx.fillText('за время просмотра', width - padding, padding + 12);
  };

  ctx.clearRect(0, 0, width, height);
  ctx.shadowBlur = 0;

  // Двух замеров ещё нет (стрим только сменился). Раньше функция просто
  // выходила, и на канвасе оставался график прошлого стрима — подсказка
  // показывала чужие цифры. Стираем и честно пишем, что данных мало.
  if (!Array.isArray(history) || history.length < 2) {
    drawTitle();
    ctx.font = font(400, 13);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textSecondary;
    ctx.fillText('Мало данных — замер раз в полминуты', width / 2, height / 2 + 6);
    ctx.textBaseline = 'alphabetic';
    return;
  }

  const topArea = 30;
  const bottomArea = 52;
  const chartLeft = padding;
  const chartRight = width - padding;
  const chartTop = padding + topArea;
  const chartBottom = height - bottomArea;

  // Находим мин/макс
  const values = history.map(h => h.count);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Функция для получения координат точки
  const getPoint = (i) => {
    const x = chartLeft + (i / (history.length - 1)) * (chartRight - chartLeft);
    const y = chartBottom - ((history[i].count - min) / range) * (chartBottom - chartTop);
    return { x, y };
  };

  // Плавная кривая через все точки
  const tracePath = () => {
    for (let i = 0; i < history.length - 1; i++) {
      const current = getPoint(i);
      const next = getPoint(i + 1);
      const cpX = current.x + (next.x - current.x) * 0.5;
      ctx.bezierCurveTo(cpX, current.y, cpX, next.y, next.x, next.y);
    }
  };

  drawTitle();

  // Сетка — три тонкие линии
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = Math.round(chartTop + (i / 2) * (chartBottom - chartTop)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
  }

  // Заливка под графиком — тот же акцент, почти прозрачный
  const gradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
  gradient.addColorStop(0, withAlpha(accent, 0.22));
  gradient.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom);
  const firstPoint = getPoint(0);
  ctx.lineTo(firstPoint.x, firstPoint.y);
  tracePath();
  ctx.lineTo(chartRight, chartBottom);
  ctx.closePath();
  ctx.fill();

  // Линия — 2px, без свечения
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(firstPoint.x, firstPoint.y);
  tracePath();
  ctx.stroke();

  // Последний замер — точкой
  const last = getPoint(history.length - 1);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fill();

  // Внизу — три числа через разделители, без рамки и цветной плашки
  const statsTop = height - bottomArea + 12;
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(padding, statsTop - 0.5);
  ctx.lineTo(width - padding, statsTop - 0.5);
  ctx.stroke();

  const current = history[history.length - 1];
  const format = (n) => Number(n).toLocaleString('ru-RU');
  const stats = [
    { label: 'Сейчас', value: format(current.count) },
    { label: 'Максимум', value: format(max) },
    { label: 'Минимум', value: format(min) }
  ];
  const segment = (width - padding * 2) / stats.length;

  stats.forEach((item, i) => {
    const x = padding + segment * i;
    ctx.textAlign = 'left';
    ctx.font = font(400, 11);
    ctx.fillStyle = textTertiary;
    ctx.fillText(item.label, x, statsTop + 16);
    ctx.font = font(600, 14);
    ctx.fillStyle = textPrimary;
    ctx.fillText(item.value, x, statsTop + 34);
  });
};
