## 🇷🇺 Исправлено

- **Приложение больше не падает во время ночного фарминга.** Окно уведомления о награде закрывается само через несколько секунд, и если следующая награда приходила в этот момент, приложение обращалось к уже закрытому окну — главный процесс падал целиком, показывал окно с ошибкой JavaScript, и фарминг стоял до утра
- **Необработанная ошибка больше не останавливает приложение.** Раньше любая такая ошибка означала конец сессии; теперь она записывается в журнал, а работа продолжается
- **Кнопка «Начать фарминг» перестала залипать.** Если поиск стрима подвисал, кнопка навсегда оставалась серой с подписью «Ищем стрим…» и не нажималась — помогал только перезапуск. Теперь она возвращается в рабочий вид сама, а сам поиск ограничен по времени

## 🇬🇧 Fixed

- **The app no longer crashes during overnight farming.** The reward notification window closes itself after a few seconds, and if the next reward arrived at that moment the app reached into an already-closed window — the main process died outright, showed a JavaScript error dialog, and farming stood still until morning
- **An unhandled error no longer stops the app.** Any such error used to end the session; it is now logged and work continues
- **The "Start farming" button no longer sticks.** If the stream search hung, the button stayed greyed out reading "Ищем стрим…" and could not be pressed — only a restart helped. It now recovers on its own, and the search itself is time-limited
