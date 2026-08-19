## 🇷🇺 Что нового

- Стрим больше не перезапускается при переходах между вкладками — плеер один на всё приложение и продолжает играть, минуты просмотра для дропсов не сбрасываются
- Показываются все кампании дропсов игры, а не только первая; видны и те, к которым ещё не приступали
- Избранные каналы из подписок теперь действительно смотрятся первыми: они проверяются напрямую, а не ищутся в топ-20 выдачи Twitch, куда небольшие каналы не попадают
- Категории можно закреплять — наведите на карточку и нажмите значок рядом с «Play». Закреплённые идут первыми и первыми проверяются на дропсы
- Категория, запущенная вручную, больше не переключается сама: вместо этого приложение предлагает перейти и ждёт вашего решения
- Автосбор бонусных сундуков продолжает работать на любой вкладке, а не только на странице фарминга
- Автовыключение компьютера: выбор действия (выключение, сон, гибернация), события и задержки, с отменяемым отсчётом
- Новое оформление: чёткие границы, плотная сетка, шрифт IBM Plex Sans

## 🐛 Исправлено

- Настройки применялись только после перезапуска, а часть не работала вовсе: интерфейс хранил их отдельно от того, что читало приложение
- Счётчик трафика показывал завышенные цифры и почти всегда 0 КБ/с
- Баллы канала считались неверно: колонки не соответствовали подписям, сундуки не учитывались, а счёт шёл только при открытой странице фарминга
- Статистика записывала показатели одного стрима вместо всей сессии, а полученные дропсы не считались вовсе
- Запуск другой категории мог оборваться на середине: уведомление появлялось, но стрим продолжал играть
- Одинаковые уведомления больше не копятся стопкой
- Обложки категорий в статистике были размытыми, у плеера в сайдбаре пропадал звук и возникали паузы
- Окно категории показывало неверные счётчики и не загружало аватарки стримеров
- Устранены утечки памяти: обработчики и таймеры больше не накапливаются при переходах между вкладками

## 🇬🇧 What's new

- The stream no longer restarts when you switch tabs — one player for the whole app keeps playing, so watch time for drops is not reset
- All drop campaigns for a game are shown, not just the first one, including campaigns you have not started yet
- Favourite channels from your subscriptions are now really watched first: they are checked directly instead of being looked up in Twitch's top-20 list, where small channels never appear
- Categories can be pinned — hover a card and click the icon next to "Play". Pinned categories come first and are checked for drops first
- A category you started manually is no longer switched automatically: the app offers to switch and waits for your decision
- Bonus chest auto-collection keeps working on any tab, not only on the farming page
- Computer shutdown: choose the action (shutdown, sleep, hibernate), the trigger and the delay, with a countdown you can cancel
- New look: crisp borders, denser layout, IBM Plex Sans typeface

## 🐛 Fixed

- Settings only applied after a restart, and some did nothing at all: the interface stored them separately from what the app actually read
- The traffic counter reported inflated numbers and almost always showed 0 KB/s
- Channel points were counted incorrectly: columns did not match their labels, chests were ignored, and counting only ran while the farming page was open
- Statistics recorded a single stream instead of the whole session, and collected drops were never counted
- Starting another category could break halfway: the notification appeared while the stream kept playing
- Identical notifications no longer stack up
- Category art in statistics was blurry; the sidebar player lost sound and kept pausing
- The category window showed wrong counters and failed to load streamer avatars
- Memory leaks fixed: handlers and timers no longer accumulate when switching tabs
