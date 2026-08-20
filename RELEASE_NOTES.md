## 🇷🇺 Что нового

- Дропсы теперь забираются автоматически. Настройка автосбора существовала, но не работала — приложение наматывало часы, а награду всё равно нужно было брать руками
- Награду можно забрать и вручную: в окне дропса появилась кнопка «Получить»
- Отписаться от канала можно прямо из приложения, без перехода на сайт
- Это окно: после обновления приложение показывает, что изменилось. Сведения берутся с GitHub, поэтому видны и предыдущие патчи. Открыть в любой момент — «Настройки → Что нового в обновлении»
- Раздел «Аналитика» в статистике: дропсов в час, сколько времени уходит на одну награду, расход трафика за час и за сутки, средняя длина сессии
- Категории можно закреплять — наведите на карточку и нажмите значок рядом с «Play». Закреплённые проверяются на дропсы первыми
- Выбор качества и звука прямо на плеере. Каждая новая сессия начинается с минимального качества, чтобы не тратить трафик незаметно
- Плеер уезжает в сайдбар, когда его прокручиваешь за край экрана, и возвращается обратно
- Автовыключение компьютера получило таймер и понятное описание того, когда именно оно сработает
- Когда все дропсы категории собраны, приложение сразу предлагает перейти к следующей категории с дропсами

## 🐛 Исправлено

- **Стрим больше не зависает.** Если у канала не было запрошенного качества, плеер молча стоял с чёрным экраном бесконечно. Теперь качество подбирается автоматически, а зависший плеер перезапускается сам
- **Стрим не прерывается** при переходе между вкладками и при переезде в сайдбар
- Сессия больше не показывается активной, когда стрим не запущен
- Категория снова берётся в работу, когда у игры начинается новая кампания дропсов — раньше она считалась отработанной навсегда
- Приоритет подписок наконец отключается: раньше избранные каналы применялись даже при выключенном переключателе
- Избранные каналы действительно смотрятся первыми — они проверяются напрямую, а не ищутся в списке популярных, куда небольшие каналы не попадают
- Рейтинг каналов считается по-настоящему: раньше у всех выходило одно и то же число, а оценка ниже 50 была невозможна
- Список подписок больше не стирается, если Twitch ответил пустым списком
- Обложки кампаний и картинки наград снова загружаются
- Приложение переживает обрывы связи: запросы повторяются вместо того, чтобы считать канал офлайн
- Прокрутка страницы работает, когда курсор над плеером
- Расход трафика считается точнее и создаёт меньше нагрузки

## 🇬🇧 What's new

- Drops are now claimed automatically. The auto-claim setting existed but never ran — the app accumulated watch time while rewards still had to be taken by hand
- Rewards can also be claimed manually: the drop window now has a "Claim" button
- Unfollowing a channel works from inside the app, without opening the website
- This window: after an update the app shows what changed. Notes come from GitHub, so previous patches are visible too. Open it any time via Settings → What's new
- An "Analytics" section in statistics: drops per hour, time spent per reward, traffic per hour and per day, average session length
- Categories can be pinned — hover a card and click the icon next to "Play". Pinned ones are checked for drops first
- Quality and sound controls on the player itself. Every new session starts at the lowest quality so bandwidth is not spent unnoticed
- The player moves to the sidebar when scrolled off screen and returns when scrolled back
- Computer shutdown gained a timer and a plain description of exactly when it will trigger
- When every drop in a category is collected, the app offers to move straight to the next category with drops

## 🐛 Fixed

- **The stream no longer freezes.** If a channel lacked the requested quality, the player silently sat on a black screen forever. Quality is now picked automatically and a stalled player restarts itself
- **Playback is not interrupted** when switching tabs or moving to the sidebar
- A session is no longer shown as active when no stream is playing
- A category returns to the queue when its game starts a new drops campaign — previously it counted as finished forever
- Subscription priority can finally be turned off: favourites applied even with the toggle disabled
- Favourite channels are really watched first — they are checked directly instead of being looked up among the most popular, where small channels never appear
- Channel rating actually works: every channel used to show the same number, and a score below 50 was impossible
- The subscriptions list is no longer wiped when Twitch returns an empty response
- Campaign art and reward images load again
- The app survives network drops: requests retry instead of treating a channel as offline
- Page scrolling works while the cursor is over the player
- Bandwidth is measured more accurately and with less overhead
