## 🇷🇺 Исправлено

- **Один процент выполнения вместо трёх разных.** Панель под стримом показывала среднее по наградам, сайдбар — пройденный путь по времени, а список категорий считал по-своему: под одним названием «дропсы» выходили 63 % и 29 % одновременно. Оставлен счёт по времени просмотра — тот, что в сайдбаре
- **Кнопка «Проверить обновления» отвечает.** Раньше на свежей версии она не давала никакого отклика — событие «обновлений нет» до интерфейса не доходило, и кнопка казалась сломанной. Теперь сообщает «У вас последняя версия», а ошибка проверки больше не гаснет молча

- **Подписки больше не пропадают при возврате на вкладку.** Сохранённый список показывается сразу, а обновление идёт фоном — раньше сначала включался спиннер, прятавший список целиком, и всё собиралось заново вместе с аватарками. Если данные не изменились, список вообще не перерисовывается

## 🇬🇧 Fixed

- **One completion percentage instead of three different ones.** The panel under the stream showed an average across rewards, the sidebar showed watch-time progress, and the category list counted its own way — so "drops" meant 63% and 29% at the same time. The watch-time count, the one in the sidebar, is now used everywhere
- **Subscriptions no longer vanish when you return to the tab.** The saved list shows immediately and refreshes in the background — previously a spinner hid the whole list first and everything was rebuilt, avatars included. When nothing changed, the list is not re-rendered at all
- **The "Check for updates" button responds.** On an up-to-date version it gave no feedback at all — the "no updates" event never reached the interface, so the button looked broken. It now reports "you have the latest version", and check failures are no longer swallowed
