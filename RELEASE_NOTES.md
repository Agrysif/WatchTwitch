## 🇷🇺 Что нового

- **Автозапуск с Windows снова держится.** Приложение при каждом старте само переписывало автозапуск по сохранённому флагу, а синхронизация настроек из окна затирала этот флаг значением по умолчанию — запись в реестре пропадала сама. Теперь автозапуск меняет только переключатель в настройках, переключатель показывает то, что реально записано в Windows, а запись под старым именем переносится автоматически. Если автозапуск у вас пропал — включите его один раз в настройках
- **Сессия больше не переживает закрытие приложения.** Закрыл вечером, открыл утром — таймер продолжал считать от вчерашнего старта, и в статистику попадала вся ночь (в одной из записей набежало 10 суток). Теперь, если приложение не работало дольше 10 минут, прошлая сессия закрывается с настоящей длительностью, а новая начинается на том же канале. Переход между вкладками и перезапуск после обновления по-прежнему продолжают сессию
- **Лог стал в пять раз тише.** Рутинные строки каждые 30 секунд заполняли 2 МБ за три дня, и полезное в нём терялось

## 🇬🇧 What's new

- **Windows autostart sticks again.** The app rewrote the login item from a stored flag on every start, and settings sync overwrote that flag with its default, silently removing the registry entry. Only the Settings toggle changes autostart now, the toggle reflects the real Windows state, and entries under the old name are migrated. If autostart disappeared for you, turn it on once in Settings
- **A session no longer survives closing the app.** If the app was not running for more than 10 minutes, the previous session is closed with its real duration and a new one starts on the same channel, so overnight downtime no longer inflates statistics
- **The log is five times quieter**
