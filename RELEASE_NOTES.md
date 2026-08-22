## 🇷🇺 Исправлено

- **Баллы канала снова считаются.** Запрос баллов падал с ошибкой прямо в коде — обработчик ссылался на переменную из совсем другого места. Ошибка гасилась внутрь ответа, наружу выходил просто ноль, и выглядело это как «баллы перестали начисляться». Ошибка жила в приложении с патча про отписку от каналов
- **Процент дропсов у категорий больше не ноль.** Считалась доля полностью полученных наград: посмотрев 45 минут из 60 и ничего не забрав, категория показывала 0 вплоть до самого получения. Хуже того, панель под стримом писала туда настоящий прогресс, а обновление списка затирало его нулём каждые полминуты. Теперь оба места считают одинаково — по набранному времени
- **Качество перестало само уползать на «Источник».** Если у канала не оказывалось запрошенной дорожки, приложение поднималось на ступень выше и **запоминало это навсегда** — а категории за ночь переключаются помногу раз, так что в итоге всё шло в исходном качестве и съедало трафик. Теперь вынужденный подъём действует только на текущем канале, выбор на панели плеера — до конца сессии, а настройка остаётся вашей
- **Прогресс дропсов под стримом больше не пропадает.** Панель пряталась от одного неудачного ответа Twitch; теперь — только если кампаний нет три проверки подряд

## 🇬🇧 Fixed

- **Channel points are counted again.** The points request failed on a coding error — the handler referenced a variable belonging to an entirely different one. The failure was swallowed into the response and a plain zero came out, which looked like points no longer accruing. The bug had been in the app since the channel-unfollow patch
- **Category drop progress is no longer stuck at zero.** It counted fully claimed rewards only: watch 45 minutes out of 60 and claim nothing, and the category showed 0 right up to the moment of claiming. Worse, the panel under the stream wrote real progress into the same field and the list refresh overwrote it with zero every half minute. Both now agree, counting watch time
- **Quality no longer creeps up to Source on its own.** When a channel lacked the requested rendition, the app stepped up and **remembered that permanently** — and categories switch many times over a night, so everything ended up running at source and burning bandwidth. The forced step now applies to the current channel only, the player-bar choice lasts for the session, and your setting stays yours
- **The drops panel under the stream stops disappearing.** It used to hide on a single bad response from Twitch; now only after three empty checks in a row
