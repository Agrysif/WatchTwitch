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
- Страница календаря освобождается при уходе (в прошлом выпуске это было заявлено, но не попало в код)

## 🇬🇧 Network and load

- **40× fewer requests to Twitch.** Measured ~1000 requests per minute with up to 266 concurrent connections: the inventory fetch issued one request per campaign (130 of them) for a number nobody read, and five places asked for the campaign list independently. Twitch responses are now cached in one place — inventory at most once a minute, campaign list every ten minutes — and every caller shares the same answer. Now 28 requests per minute, at most 12 concurrent. This also removes ping spikes in games
- **The campaign list is complete again.** The request the farming page used silently returned nothing, so the app treated the list as partial: it probed every category separately and never removed auto-categories without drops. There is now a single source, and the existing cleanup of auto-categories without an active campaign finally works — the list shrinks on first launch (verified: every game with a live campaign stays)
- **Every network request has a timeout.** 2 of 33 had one; the rest hung until restart on a dropped connection. Now 20 s of silence aborts the request cleanly
- **No more log spam.** The full inventory was printed three times per request: 4 MB in five minutes
- **Light graphics mode now lightens the UI too.** Without acceleration, blur, shadows and endless animations were drawn on the CPU; they are off in this mode, loading spinners stay
- **Ads in the chat are blocked.** The Twitch chat pulled ad iframes nobody saw but which kept running in the background
- **Chest auto-claim without a 1-second timer.** A debounced observer (300 ms) plus a once-a-minute safety check replace the constant polling
- **The settings file is no longer rewritten every 30 s.** Statistics keep the last 100 sessions (was 240), bandwidth graphs only for the last ten; campaign memory is written every ten minutes and only when something changed
- **The sidebar no longer rebuilds wholesale.** Only changed category cards are replaced; the rest keep their nodes and handlers. Also fixed: the drag-and-drop handler was added on every re-render
- **One player watchdog instead of two.** The farming page's 10-second stream check fought the player's 30-second watchdog. One remains, with an escalation ladder and explicit offline detection
- The calendar page is released on leave (claimed in the previous release, but the code never landed)
