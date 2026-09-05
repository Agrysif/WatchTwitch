## 🇷🇺 Сеть и нагрузка

- **В 40 раз меньше запросов к Twitch.** Замер показал около 1000 запросов в минуту и до 266 одновременных соединений: инвентарь слал отдельный запрос на каждую из 130 кампаний ради числа, которое никто не читал, а список кампаний пять разных мест запрашивали независимо. Теперь ответы Twitch кэшируются в одном месте — инвентарь не чаще раза в минуту, список кампаний раз в десять минут, — и все, кто спрашивает, получают один и тот же ответ. Стало 28 запросов в минуту, одновременных соединений не больше 12. Это же снимает скачки пинга в играх
- **Список кампаний снова полный.** Запрос, которым пользовалась страница фарминга, молча отдавал пустоту, и приложение считало, что список неполный: проверяло каждую категорию отдельным запросом и никогда не убирало авто-категории без дропсов. Теперь источник один, и старая логика удаления авто-категорий без активной кампании заработала — при первом запуске список сократится (проверено: все игры с живой кампанией остались на месте)
- **Таймаут у каждого сетевого запроса.** Из 33 запросов срок ожидания был у двух; остальные при обрыве связи висели до перезапуска. Теперь 20 секунд тишины — и запрос обрывается штатно
- **Лог без тонн мусора.** Инвентарь печатался в консоль целиком три раза за запрос: 4 МБ за пять минут. Убрано
- **Экономный режим графики теперь экономит и в интерфейсе.** Без ускорения размытие, тени и вечные анимации рисовал процессор; в этом режиме они отключены, спиннеры загрузки остались
- **Реклама в чате заблокирована.** Чат Twitch подтягивал рекламные iframe, которые никто не видел, но которые крутились в фоне
- **Сундуки собираются без интервала в секунду.** Раньше наблюдатель без задержки и таймер в 1 с вместе гоняли поиск кнопок по всему чату на каждое сообщение. Теперь одна проверка через 300 мс после последнего изменения и страховочная раз в минуту
- **Файл настроек не переписывается каждые полминуты.** Статистика хранит 100 последних сессий вместо всех (было 240), график скорости только у десяти последних; память кампаний пишется раз в десять минут и только если что-то изменилось
- **Сайдбар не пересобирается целиком.** Список из сотни категорий перерисовывался через innerHTML каждые полминуты — теперь заменяются только изменившиеся карточки, остальные остаются на месте вместе с обработчиками. Заодно убрана утечка: обработчик перетаскивания добавлялся при каждой перерисовке
- **Один сторож плеера вместо двух.** Проверка стрима на странице фарминга (каждые 10 с) спорила со сторожем плеера (каждые 30 с): перезагрузка плеера одним читалась другим как «стрим умер». Остался один, с лестницей «нажать → перезагрузить → переустановить адрес → сменить канал» и отдельным распознаванием «канал не в эфире»

## 🇷🇺 Надёжность

- **Подписки снова обновляются.** Список шёл через Helix с давно протухшим OAuth-токеном: Twitch отвечал 401, и страница молча показывала сохранённое. Теперь тот же GraphQL с cookie-токеном, что и всё остальное — 62 канала загружаются за один запрос, аватарки приходят сразу
- **Лог в файл.** Всё, что приложение писало в невидимую консоль, теперь дублируется в `logs/app.log` рядом с настройками (2 МБ, старый уходит в `app.log.1`). Кнопка «Папка логов» — в настройках, рядом с копией. Ночные падения больше не пропадают без следа
- **Один экземпляр приложения.** Второй запуск открывал второе окно с тем же файлом настроек; теперь он лишь поднимает окно первого
- **Экран может гаснуть.** Блокировка сна ставилась при старте и держалась всегда, даже без фарминга. Теперь она включается вместе с плеером и снимается, когда стрим остановлен; система не уснёт, а экран — пожалуйста: минуты просмотра идут по сети, не по картинке
- **Политика безопасности у окна.** Скрипты и стили только свои, картинки и запросы только по https; предупреждение Electron исчезло. Ради этого загрузчик страниц перестал пользоваться eval
- **Вычищен мёртвый код:** пять неиспользуемых модулей, три давно не вызываемых обработчика, дублирующаяся разметка окна обновления с теми же id (из-за неё уже ловили переполнение кнопки), внешний скрипт embed.twitch.tv, который никто не использовал. Из зависимостей убраны playwright и puppeteer — 21 МБ, на которые не было ни одной ссылки
- Опрос входа в модалке аккаунтов останавливается, если уйти со страницы, не закрыв окно
- Страница календаря освобождается при уходе (в прошлом выпуске это было заявлено, но не попало в код)

## 🇷🇺 Дропсы: проверка зачёта

- **Список разрешённых каналов кампании учитывается.** Почти половина кампаний (49 из 117 на замере) засчитывается только у конкретных стримеров — просмотр остальных не даёт ничего. Теперь выбор стрима фильтрует выдачу по этому списку, а если никто из разрешённых не попал в выдачу, спрашивает их напрямую. Категория, у которой разрешённые каналы не в эфире, пропускается, а не выключается
- **Стримы без тега «Drops» больше не повод отвечать «Нет стримов».** Открытая кампания засчитывается на любом канале категории; помеченные тегом идут первыми, остальные — в запас
- **Индикатор зачёта под шкалой дропсов.** Зелёный — Twitch подтверждает зачёт на этом канале или растут минуты в инвентаре; жёлтый — ждём; красный — канал не засчитывает, и стрим меняется. Приговор выносится только по двум признакам разом: пустая сессия зачёта после четырёх минут прогрева и минуты, не растущие пять проверок подряд — замер показал, что один запрос о сессии у Twitch ненадёжен

## 🇷🇺 Чат больше не нужен

- **Сундуки собираются запросом к Twitch, без webview чата.** Раньше ради одной кнопки раз в четверть часа в фоне жил целый чат Twitch — около 190 МБ памяти и заметный процессор — плюс скрипт, перебиравший его DOM. Теперь опрос баллов заодно получает готовый сундук и забирает его мутацией. Замер: память приложения 1032 → 622 МБ, процессор 53 → 46 % ядра. Client-Integrity, нужный для запросов кампаний, плеер даёт сам
- Фоновый чат остался как настройка «Фоновый чат Twitch» (выключена по умолчанию) — на случай, если сундуки перестанут собираться

## 🇷🇺 Новое: игровой режим

- **Запущена игра — стрим не мешает.** Приложение раз в двадцать секунд смотрит список процессов и, увидев игру (Overwatch, Apex, CS2, VALORANT, Dota 2, Fortnite и ещё полсотни известных; свои можно дописать в настройках), переводит плеер на 160p с потолком скорости впритык к битрейту. Куски видео перестают подбрасывать пинг. Игра закрыта — качество и потолок возвращаются. В сайдбаре на это время висит значок «Игровой режим». Включено по умолчанию, выключается в настройках

## 🇬🇧 Network and load

- **40× fewer requests to Twitch.** Measured ~1000 requests per minute with up to 266 concurrent connections: the inventory fetch issued one request per campaign (130 of them) for a number nobody read, and five places asked for the campaign list independently. Twitch responses are now cached in one place — inventory at most once a minute, campaign list every ten minutes. Now 28 requests per minute, at most 12 concurrent. This also removes ping spikes in games
- **The campaign list is complete again.** The request the farming page used silently returned nothing, so the app treated the list as partial: it probed every category separately and never removed auto-categories without drops. There is now a single source, and the existing cleanup finally works — the list shrinks on first launch (verified: every game with a live campaign stays)
- **Every network request has a timeout.** 2 of 33 had one; the rest hung until restart on a dropped connection
- **No more log spam**, light graphics mode also lightens the UI, chat ads are blocked, chest auto-claim runs on a debounced observer instead of a 1-second timer, the settings file is no longer rewritten every 30 s, the sidebar replaces only changed cards, and one player watchdog replaces two that fought each other

## 🇬🇧 Reliability

- **Subscriptions refresh again** — GraphQL with the cookie token instead of Helix with an expired OAuth token (which returned 401 forever)
- **File log** in `logs/app.log` next to the settings, 2 MB with one rotation; "Logs folder" button in Settings
- **Single instance**: a second launch focuses the first window instead of opening a second one on the same settings file
- **The screen may sleep**: the power-save blocker now follows the player instead of running from startup, and it blocks system sleep only
- **Content Security Policy** on the main window; the page loader no longer uses eval
- **Dead code removed**: five unused modules, three dead IPC handlers, a duplicate update overlay with clashing ids, the unused embed.twitch.tv script; playwright and puppeteer (21 MB, zero references) dropped from dependencies
- The login modal's polling stops when you leave the page; the calendar page is released on leave

## 🇬🇧 Drops: credit check

- **Campaign channel allow-lists are respected.** Nearly half of campaigns (49 of 117 measured) only count on specific streamers. Stream selection now filters by that list and queries the allowed channels directly when none is in the category listing; a category whose allowed channels are offline is skipped, not disabled
- **Streams without the “Drops” tag are no longer a dead end** — tagged streams first, the rest as fallback
- **Credit indicator under the drops bar:** green when Twitch confirms credit or inventory minutes grow, yellow while waiting, red when the channel does not count and the stream gets switched. A red verdict needs both signals: an empty drop session after a 4-minute warm-up and minutes flat for five checks

## 🇬🇧 No chat needed

- **Chests are claimed via a Twitch request, without the chat webview.** A whole Twitch chat used to live in the background for one button every fifteen minutes (~190 MB and noticeable CPU). The points poll now returns the ready chest and claims it with a mutation. Measured: 1032 → 622 MB, 53 → 46 % CPU. Client-Integrity comes from the player itself
- Background chat remains as an opt-in setting


## 🇬🇧 New: game mode

- **A running game gets priority.** Every twenty seconds the app checks the process list; when it sees a game (Overwatch, Apex, CS2, VALORANT, Dota 2, Fortnite and ~50 more; add your own in Settings) the player drops to 160p with a bandwidth cap right at the bitrate, so video chunks stop spiking your ping. Close the game and everything is restored. A sidebar badge shows while it is active. On by default
