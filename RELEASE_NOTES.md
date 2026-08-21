## 🇷🇺 Исправлено

- **Приложение больше не падало с ошибкой JavaScript.** Картинка для уведомления о награде загружается в фоне, а само окно уведомления живёт несколько секунд. Если ответ приходил после его закрытия, падал весь главный процесс — приложение закрывалось целиком
- **Категории перестали пропадать.** Полный список кампаний Twitch отдаёт только после запуска стрима; до этого приложение видело лишь начатые кампании — полтора десятка вместо сотни с лишним — и вычищало все остальные категории как «без дропсов». Именно так исчезали разом десятки только что добавленных. Теперь при неполных данных не удаляется ничего, а категория уходит только после трёх проверок подряд
- **«Начать фарминг» работает, когда первая категория пуста.** Раньше проверялась ровно одна категория, и если у неё не было живых стримов, запуск молча заканчивался. С закреплённой категорией это ломало фарминг совсем: закреплённая идёт первой, и когда дропсы в ней кончались, кнопка переставала делать что-либо
- **После остановки не остаётся мусора.** Прогресс дропсов и полоска в сайдбаре продолжали обновляться при выключенном фарминге; вдобавок оттуда же могла сама смениться категория
- В окне «что нового» важные пункты стали жирными — раньше вокруг них просто висели две звёздочки
- Кнопка «Установить и перезагрузить» больше не вылезает за край окна, и на ней не пропадает значок

## ✨ Что нового

- **Кнопка «Переключить на автофарм»** над кнопкой остановки. Категорию, запущенную вручную кнопкой Play, приложение намеренно не переключает само — но узнать об этом было неоткуда, и выглядело как поломка. Теперь это видно, и вернуться к автоматике можно не прерывая сессию

## 🇬🇧 Fixed

- **The app no longer crashed with a JavaScript error.** The reward notification's image loads in the background while the notification window lives only a few seconds. If the response arrived after it closed, the whole main process died and the app shut down
- **Categories stopped disappearing.** Twitch returns the full campaign list only after a stream has been started; before that the app saw just the campaigns already in progress — a dozen or so instead of well over a hundred — and wiped every other category as having no drops. That is how dozens of freshly added ones vanished at once. Now nothing is removed while the data is incomplete, and a category only goes after three consecutive checks
- **"Start farming" works when the first category is empty.** Only one category used to be tried, and if it had no live streams the launch silently ended. With a pinned category this broke farming entirely: a pinned one always comes first, so once its drops ran out the button stopped doing anything
- **Stopping leaves nothing behind.** The drops panel and the sidebar bar kept refreshing while farming was off, and the category could even switch on its own
- Important lines in the "What's new" window are bold now — previously two asterisks just sat around them
- The "Install and restart" button no longer overflows its window, and keeps its icon

## ✨ What's new

- **A "Switch to auto-farming" button** above the stop button. A category started by hand with Play is deliberately never switched automatically — but there was no way to know that, so it looked broken. Now it is visible, and you can return to automatic mode without interrupting the session
