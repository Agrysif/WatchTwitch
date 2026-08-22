## 🇷🇺 Исправлено

- **Приложение больше не падало с ошибкой JavaScript.** Картинка для уведомления о награде загружается в фоне, а само окно уведомления живёт несколько секунд. Если ответ приходил после его закрытия, падал весь главный процесс — приложение закрывалось целиком
- **Категории перестали пропадать.** Полный список кампаний Twitch отдаёт только после запуска стрима; до этого приложение видело лишь начатые кампании — полтора десятка вместо сотни с лишним — и вычищало все остальные категории как «без дропсов». Именно так исчезали разом десятки только что добавленных. Теперь при неполных данных не удаляется ничего, а категория уходит только после трёх проверок подряд
- **«Начать фарминг» работает, когда первая категория пуста.** Раньше проверялась ровно одна категория, и если у неё не было живых стримов, запуск молча заканчивался. С закреплённой категорией это ломало фарминг совсем: закреплённая идёт первой, и когда дропсы в ней кончались, кнопка переставала делать что-либо
- **После остановки не остаётся мусора.** Прогресс дропсов и полоска в сайдбаре продолжали обновляться при выключенном фарминге; вдобавок оттуда же могла сама смениться категория
- **Компактный режим наконец работает.** Переключатель был, но правила оформления под него целились в элементы, которых в приложении давно нет, а после перезапуска режим молча слетал
- **Показ завершённых кампаний тоже заработал.** Twitch выбрасывает закончившиеся кампании из ответа, поэтому приложение теперь помнит их само и показывает отдельной группой в конце календаря
- Окна «Что нового» и просмотра дропса больше не оставляют после себя обработчики: раньше каждое открытие добавляло по одному навсегда
- **Приложение перестало тяжелеть со временем.** При каждом переключении категории оставался работать лишний секундный таймер, остановить который было уже нечем: за ночь их набирался десяток, и каждый дёргал обновление сессии
- Убрано двести строк кода, который не выполнялся, но выглядел рабочей логикой переключения категорий
- **Кнопка «Начать фарминг» больше не может залипнуть навсегда.** Защёлка от двойного запуска снималась только по завершении поиска: если сетевой запрос зависал, кнопка молча переставала работать до перезапуска приложения. Теперь у защёлки есть срок, каждый запрос ограничен по времени, а сама кнопка на время поиска показывает «Ищем стрим…», а не молчит
- Подсказка о следующей награде больше не прячется под мини-плеером в сайдбаре
- В окне «что нового» важные пункты стали жирными — раньше вокруг них просто висели две звёздочки
- Кнопка «Установить и перезагрузить» больше не вылезает за край окна, и на ней не пропадает значок

## ✨ Что нового

- **Календарь кампаний — новая вкладка.** Сверху лента времени: каждая кампания полосой от начала до конца, с делениями по дням и меткой «сейчас», окно на 7, 14 или 30 дней. Ниже те же кампании разложены по срокам: что заканчивается сегодня, что завтра, что на этой неделе и что только начнётся. Видно, сколько наград осталось и сколько берётся за час; категорию можно добавить в работу прямо оттуда. Раньше эти сроки приложение знало, но нигде не показывало
- **Подсказка о выгодной категории.** На странице фарминга появляется игра с дропсами, которой нет в вашем списке: «Genshin Impact — 2 награды за час». Одним нажатием добавляется, крестиком убирается насовсем
- **Горячие клавиши поверх других окон.** Ctrl+Alt+F — запуск и остановка, Ctrl+Alt+N — другой стрим, Ctrl+Alt+W — показать или скрыть окно. Отключаются в настройках
- **Звук при получении награды.** Настройка «Звуковые уведомления» была в приложении всегда, но за ней не стояло ни одного звука — теперь она работает. При включении сигнал сразу проигрывается
- **Резервная копия всего.** Категории с порядком и закреплениями, подписки, статистика и настройки — в один файл, чтобы перенести на другой компьютер. Аккаунты и токены в копию не попадают намеренно
- **Прогноз окончания.** В панели дропсов видно, сколько ещё смотреть и к какому времени всё соберётся: «Все награды через 4ч 12м — к 06:13». Недостижимые награды в расчёт не идут, чтобы прогноз не обещал невозможного
- **План к автовыключению.** Если заведён таймер, рядом сказано, что из задуманного успеется: «До выключения в 03:01 успеется 1 из 2»
- **Значок в трее показывает состояние.** По наведению — категория, процент и время до следующей награды; прогресс идёт полосой прямо на кнопке панели задач. Разворачивать окно ради этого больше не нужно
- **Сообщение о выходе избранного канала.** Приложение раз в несколько минут проверяет избранные подписки и говорит, когда стример начал трансляцию, отдельно отмечая, если по его игре идут дропсы. Про один эфир — один раз. Отключается в настройках
- **Сэкономленный трафик** в разделе «Аналитика»: во что обошёлся бы тот же просмотр в 720p60. Оценка приблизительная — битрейт у Twitch плавает

- **Шкала дропсов в сайдбаре стала подробнее.** Чёрточки отмечают рубежи выдачи наград: видно, где следующая и сколько их впереди; полученные отмечены зелёным. При наведении всплывает окно со значком следующей награды, её названием и временем до неё
- Заполнение шкалы теперь считается по времени просмотра, а не по среднему проценту наград. Прогресс внутри кампании общий, поэтому среднее ни на что не указывало — а на шкале времени чёрточка встаёт ровно туда, где награду дадут
- **Кнопка «Переключить на автофарм»** над кнопкой остановки. Категорию, запущенную вручную кнопкой Play, приложение намеренно не переключает само — но узнать об этом было неоткуда, и выглядело как поломка. Теперь это видно, и вернуться к автоматике можно не прерывая сессию

## 🇬🇧 Fixed

- **The app no longer crashed with a JavaScript error.** The reward notification's image loads in the background while the notification window lives only a few seconds. If the response arrived after it closed, the whole main process died and the app shut down
- **Categories stopped disappearing.** Twitch returns the full campaign list only after a stream has been started; before that the app saw just the campaigns already in progress — a dozen or so instead of well over a hundred — and wiped every other category as having no drops. That is how dozens of freshly added ones vanished at once. Now nothing is removed while the data is incomplete, and a category only goes after three consecutive checks
- **"Start farming" works when the first category is empty.** Only one category used to be tried, and if it had no live streams the launch silently ended. With a pinned category this broke farming entirely: a pinned one always comes first, so once its drops ran out the button stopped doing anything
- **Stopping leaves nothing behind.** The drops panel and the sidebar bar kept refreshing while farming was off, and the category could even switch on its own
- **Compact mode finally does something.** The toggle existed, but its styling targeted elements the app no longer has, and the mode silently reset on restart
- **Showing finished campaigns works too.** Twitch drops expired campaigns from its response, so the app now remembers them itself and lists them as a separate group at the end of the calendar
- The "What's new" and drop detail windows no longer leave listeners behind — each opening used to add one permanently
- **The app no longer gets heavier over time.** Every category switch left behind an extra one-second timer that could no longer be stopped; a dozen would pile up overnight, each firing a session refresh
- Two hundred lines of code that never ran — but looked like the category-switching logic — have been removed
- **The "Start farming" button can no longer stick forever.** The double-start guard was released only once the search finished: a hung network request left the button silently dead until the app restarted. The guard now expires, each request is time-limited, and the button shows "Ищем стрим…" while searching instead of staying silent
- The next-reward tooltip no longer hides behind the sidebar mini player
- Important lines in the "What's new" window are bold now — previously two asterisks just sat around them
- The "Install and restart" button no longer overflows its window, and keeps its icon

## ✨ What's new

- **A campaign calendar — a new tab.** A timeline on top: every campaign as a bar from start to end, with day ticks and a "now" marker, over a 7, 14 or 30 day window. Below, the same campaigns grouped by deadline: ending today, tomorrow, this week, and not started yet. Rewards left and rewards per hour are visible, and a category can be added to work straight from there. The app knew these dates before but showed them nowhere
- **A suggestion for a worthwhile category.** The farming page now surfaces a game with drops that is missing from your list. One click adds it, the cross dismisses it for good
- **Global hotkeys.** Ctrl+Alt+F starts and stops, Ctrl+Alt+N switches stream, Ctrl+Alt+W shows or hides the window. Can be turned off in Settings
- **A sound when a reward is claimed.** The "Sound notifications" setting had always existed with no sound behind it — it works now, and previews itself when switched on
- **A full backup.** Categories with their order and pins, subscriptions, statistics and settings in a single file to carry to another computer. Accounts and tokens are deliberately left out
- **A finish forecast.** The drops panel now shows how much longer to watch and when everything will be collected: "Все награды через 4ч 12м — к 06:13". Unreachable rewards are left out so the forecast never promises the impossible
- **A plan for the shutdown timer.** When one is set, the panel says what will actually be collected before it fires
- **The tray icon shows the state.** Hovering gives the category, the percentage, and the time to the next reward; progress also runs along the taskbar button. No need to open the window for that any more
- **Favourite channels going live are announced.** Every few minutes the app checks favourite subscriptions and says when a streamer starts broadcasting, pointing out when their game has drops. Once per broadcast. Can be turned off in Settings
- **Traffic saved** in the Analytics section: what the same watching would have cost at 720p60. This is an estimate — Twitch bitrates vary

- **The sidebar drops bar shows more.** Tick marks show where each reward is handed out, so the next one and everything ahead are visible at a glance; collected ones are green. Hovering brings up a card with the next reward's icon, its name, and the time left to it
- The bar now fills by watch time rather than by the average reward percentage. Progress inside a campaign is shared, so that average pointed at nothing — on a time scale each tick sits exactly where the reward lands
- **A "Switch to auto-farming" button** above the stop button. A category started by hand with Play is deliberately never switched automatically — but there was no way to know that, so it looked broken. Now it is visible, and you can return to automatic mode without interrupting the session
