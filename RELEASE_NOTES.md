## 🇷🇺 Исправлено

- **Фарминг больше не сбивается при переходе между вкладками.** Вернувшись на «Фарминг», приложение «забывало», что смотрит: сообщало, что дропсов у категории нет, и переключалось на другую. Причина — восстановление сессии стояло в очереди после загрузки подписанных каналов, а это десятки запросов к Twitch. Теперь сессия восстанавливается первым делом, за пару секунд
- **Категория, запущенная вручную, остаётся запущенной.** Отметка ручного запуска жила только на странице, а та пересоздаётся при каждом переходе: достаточно было уйти и вернуться, чтобы приложение снова начало переключать категорию само
- **Кнопка чата убрана** — она открывала окно, почти всегда сообщавшее «нет активного стрима». Сам чат работает фоном и по-прежнему собирает бонусные сундуки
- **Один процент выполнения вместо трёх разных.** Панель под стримом показывала среднее по наградам, сайдбар — пройденный путь по времени, а список категорий считал по-своему: под одним названием «дропсы» выходили 63 % и 29 % одновременно. Оставлен счёт по времени просмотра — тот, что в сайдбаре
- **Кнопка «Проверить обновления» отвечает.** Раньше на свежей версии она не давала никакого отклика — событие «обновлений нет» до интерфейса не доходило, и кнопка казалась сломанной. Теперь сообщает «У вас последняя версия», а ошибка проверки больше не гаснет молча

- **Подписки больше не пропадают при возврате на вкладку.** Сохранённый список показывается сразу, а обновление идёт фоном — раньше сначала включался спиннер, прятавший список целиком, и всё собиралось заново вместе с аватарками. Если данные не изменились, список вообще не перерисовывается

## 🇬🇧 Fixed

- **Farming no longer breaks when you switch tabs.** Coming back to Farming, the app "forgot" what it was watching: it reported the category had no drops and switched away. Session restore was queued behind loading subscribed channels — dozens of Twitch requests. It now happens first, within a couple of seconds
- **A manually started category stays started.** The manual-start marker lived only on the page, and the page is recreated on every navigation
- **The chat button is gone** — it opened a window that almost always said there was no active stream. Chat still runs in the background and collects bonus chests
- **One completion percentage instead of three different ones.** The panel under the stream showed an average across rewards, the sidebar showed watch-time progress, and the category list counted its own way — so "drops" meant 63% and 29% at the same time. The watch-time count, the one in the sidebar, is now used everywhere
- **Subscriptions no longer vanish when you return to the tab.** The saved list shows immediately and refreshes in the background — previously a spinner hid the whole list first and everything was rebuilt, avatars included. When nothing changed, the list is not re-rendered at all
- **The "Check for updates" button responds.** On an up-to-date version it gave no feedback at all — the "no updates" event never reached the interface, so the button looked broken. It now reports "you have the latest version", and check failures are no longer swallowed
