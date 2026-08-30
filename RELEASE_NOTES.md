## 🇷🇺 Исправлено

- **Календарь наполняется без запущенного стрима.** Twitch отдаёт список кампаний только после того, как в приложении заиграет стрим, и до этого календарь оставался пустым — хотя приложение помнило сотню с лишним кампаний из прошлых запусков. Теперь живые данные дополняются этой памятью, а сколько записей пришло из неё, сказано прямо в сводке. Замер: без стрима было 34 кампании, стало 149

- **Полоски ленты календаря больше не тянутся вниз через всё приложение.** Деления должны проходить через строки ленты, но ограничить их было нечем

- **Вкладка «Дропсы» снова открывается.** Она показывала «Требуется авторизация» даже при выполненном входе: признак входа брался из запроса, который возвращает пусто, — теперь берётся из сохранённого аккаунта
- **Счётчик подписок больше не показывает ноль** при полном списке на экране
- **Падежи по числу.** Было «1 недель назад», «1 месяцев назад» и «62 подписок» — теперь «1 неделю», «1 месяц», «62 подписки»
- **Раскладка «Аналитики» не наезжает сама на себя.** Сетка была рассчитана ровно на одну строку, и пятый показатель ломал её
- Убран скрытый webview, на который не ссылалась ни одна строка кода, но который поднимал отдельный процесс
- Обновление статистики стрима больше не падает при уходе со страницы

## 🇬🇧 Fixed

- **The Drops tab opens again.** It showed "authorization required" even when signed in: the sign-in check relied on a request that returns nothing, and now uses the saved account
- **The subscriptions counter no longer reads zero** while the full list is on screen
- **Russian plurals.** "1 недель назад" and "62 подписок" are now declined correctly
- **The Analytics grid no longer overlaps itself.** It was laid out for exactly one row, and the fifth metric broke it
- Removed a hidden webview that no code referenced but which spawned its own process
- Stream stats updates no longer throw when you leave the page
- **The calendar's timeline gridlines no longer stretch down across the whole app.** They are meant to run through the timeline rows, but nothing was clipping them
- **The calendar fills up without a running stream.** Twitch only returns the campaign list once a stream is playing inside the app, so until then the calendar stayed empty — even though the app remembered well over a hundred campaigns from earlier runs. Live data is now topped up from that memory, and the summary says how many entries came from it. Measured: 34 campaigns without a stream before, 149 now
