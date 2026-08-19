/**
 * StreamingManager — флаг «идёт ли фарминг», доступный всему приложению.
 *
 * Раньше здесь лежала вторая, полноценная реализация фарминга: обход
 * категорий, ожидание завершения дропсов, выбор стримера, отслеживание
 * прогресса. Она не вызывалась ниоткуда — фармингом занимается
 * FarmingPage, — но выглядела рабочей и путала при чтении кода. Из всего
 * модуля снаружи использовались ровно четыре вещи, они и остались.
 *
 * Логика выключения компьютера переехала в ShutdownManager.
 */
class StreamingManager {
  constructor() {
    this.isFarming = false;
    this.currentChannel = null;
  }

  isFarmingActive() {
    return this.isFarming;
  }

  getCurrentChannel() {
    return this.currentChannel;
  }
}

window.streamingManager = new StreamingManager();
