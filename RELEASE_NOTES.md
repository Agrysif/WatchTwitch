## 🇷🇺 Исправлено

- **Календарь наполняется без запущенного стрима.** Twitch отдаёт список кампаний только после того, как в приложении заиграет стрим, и до этого календарь оставался пустым — хотя приложение помнило сотню с лишним кампаний из прошлых запусков. Теперь живые данные дополняются этой памятью, а сколько записей пришло из неё, сказано прямо в сводке. Замер: без стрима было 34 кампании, стало 149

- **Полоски ленты календаря больше не тянутся вниз через всё приложение.** Деления должны проходить через строки ленты, но ограничить их было нечем

## 🇬🇧 Fixed

- **The calendar's timeline gridlines no longer stretch down across the whole app.** They are meant to run through the timeline rows, but nothing was clipping them
- **The calendar fills up without a running stream.** Twitch only returns the campaign list once a stream is playing inside the app, so until then the calendar stayed empty — even though the app remembered well over a hundred campaigns from earlier runs. Live data is now topped up from that memory, and the summary says how many entries came from it. Measured: 34 campaigns without a stream before, 149 now
