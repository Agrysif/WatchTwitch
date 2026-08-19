/**
 * График зрителей для карточки текущего стрима.
 *
 * Чистая отрисовка на canvas: получает историю замеров и рисует. Ничего
 * из состояния страницы фарминга ей не нужно, поэтому вынесена отдельно —
 * 160 строк работы с координатами только мешали читать логику фарминга.
 */
window.drawViewersChart = function (ctx, history) {
  if (history.length < 2) return;
  
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;
  const outerPadding = 16;
  const topArea = 34;
  const bottomArea = 46;
  const chartLeft = outerPadding + 8;
  const chartRight = width - outerPadding - 8;
  const chartTop = outerPadding + topArea;
  const chartBottom = height - outerPadding - bottomArea;
  
  // Очищаем canvas
  ctx.clearRect(0, 0, width, height);
  
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
  
  // Создаем градиент для заливки
  const gradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
  gradient.addColorStop(0, 'rgba(124, 92, 255, 0.35)');
  gradient.addColorStop(0.6, 'rgba(124, 92, 255, 0.15)');
  gradient.addColorStop(1, 'rgba(124, 92, 255, 0.02)');
  
  // Сетка
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = chartTop + (i / 3) * (chartBottom - chartTop);
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
  }

  // Заливка под графиком с плавными кривыми
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom);
  
  // Первая точка
  const firstPoint = getPoint(0);
  ctx.lineTo(firstPoint.x, firstPoint.y);
  
  // Рисуем плавные кривые через все точки
  for (let i = 0; i < history.length - 1; i++) {
    const current = getPoint(i);
    const next = getPoint(i + 1);
    
    // Контрольные точки для сглаживания
    const cpX = current.x + (next.x - current.x) * 0.5;
    const cpY1 = current.y;
    const cpY2 = next.y;
    
    ctx.bezierCurveTo(cpX, cpY1, cpX, cpY2, next.x, next.y);
  }
  
  ctx.lineTo(chartRight, chartBottom);
  ctx.closePath();
  ctx.fill();
  
  // Рисуем плавную линию
  ctx.strokeStyle = '#7c5cff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(124, 92, 255, 0.5)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  
  const startPoint = getPoint(0);
  ctx.moveTo(startPoint.x, startPoint.y);
  
  // Рисуем плавные кривые
  for (let i = 0; i < history.length - 1; i++) {
    const current = getPoint(i);
    const next = getPoint(i + 1);
    
    const cpX = current.x + (next.x - current.x) * 0.5;
    const cpY1 = current.y;
    const cpY2 = next.y;
    
    ctx.bezierCurveTo(cpX, cpY1, cpX, cpY2, next.x, next.y);
  }
  
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  // Заголовок
  ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7c5cff';
  ctx.fillText('📊 Зрители', width / 2, outerPadding + 18);

  // Нижняя панель со значениями
  const barWidth = width - outerPadding * 2;
  const barHeight = 30;
  const barX = outerPadding;
  const barY = height - outerPadding - barHeight;
  const segment = barWidth / 3;

  const drawRoundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  drawRoundRect(barX, barY, barWidth, barHeight, 10);
  ctx.fillStyle = 'rgba(124, 92, 255, 0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(124, 92, 255, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(124, 92, 255, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(barX + segment, barY + 4);
  ctx.lineTo(barX + segment, barY + barHeight - 4);
  ctx.moveTo(barX + segment * 2, barY + 4);
  ctx.lineTo(barX + segment * 2, barY + barHeight - 4);
  ctx.stroke();

  const current = history[history.length - 1];
  const stats = [
    { label: 'Макс', value: max.toLocaleString(), color: '#848d9b' },
    { label: 'Мин', value: min.toLocaleString(), color: '#848d9b' },
    { label: 'Сейчас', value: current.count.toLocaleString(), color: '#35d08a' }
  ];

  stats.forEach((item, i) => {
    const cx = barX + segment * i + segment / 2;
    ctx.textAlign = 'center';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#8f9099';
    ctx.fillText(item.label, cx, barY + 12);
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = item.color;
    ctx.fillText(item.value, cx, barY + 26);
  });
};
