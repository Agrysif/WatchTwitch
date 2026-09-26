## 🇷🇺 Что нового

- Исправлено зависание уведомления «Дроп получен», когда несколько наград приходят подряд. Закрытие по клику снова работает; резервный таймер закрывает окно даже при сбое интерфейса уведомления.
- Фарминг продолжает проверять дропы и переключать недоступные стримы, пока открыты настройки, статистика и другие вкладки. Возврат на страницу не создаёт повторные обработчики и таймеры.
- Запоздавшие ответы Twitch больше не возвращают канал из предыдущей категории и не подменяют статистику текущего стрима. Остановка отменяет незавершённый поиск.
- Избранные и подписанные каналы выбираются с учётом списка стримеров, разрешённых кампанией. Автопереключение после смены игры использует тот же фильтр и соблюдает настройку отключения автопереключения.
- Уточнено сравнение категорий: название одной игры внутри названия другой больше не считается совпадением при проверке текущего стрима.
- Сохранены совместимость настроек и прежний канал автообновлений. Обновление не требует повторной настройки приложения.

## 🇬🇧 What's new

- Fixed stuck drop notifications when rewards arrive close together. Click-to-close works reliably; a main-process timer also closes the window if its renderer fails.
- Farming keeps checking drops and switching unavailable streams while Settings, Statistics, or other tabs are open. Returning to Farming does not duplicate its handlers or timers.
- Delayed Twitch responses no longer restore a previous category's stream or overwrite current stream statistics. Stopping farming cancels pending stream searches.
- Favorite and followed channels respect campaign channel restrictions. Game-change switching uses the same channel filter and honors the automatic switching setting.
- Stream category checks no longer treat a game name contained in another game's name as an exact match.
- Existing settings and the update feed remain compatible; no application reconfiguration is required.
