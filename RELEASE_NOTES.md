## 🇷🇺 Исправления

- Автофарм запускается сразу после старта приложения. Пока Twitch не отдал полный список кампаний, приложение решало, что Overwatch засчитывается только у двух каналов не в эфире, и не запускало ни один стрим — ни автофармом, ни кнопкой категории. Теперь оно сначала ищет каналы кампании, а если их нет в эфире, запускает обычный стрим; полный список приходит через несколько секунд, и проверка зачёта при необходимости сама переключит канал
- Пока список кампаний неполный, на главном экране об этом написано, и понятно, что фарминг можно запускать
- Уведомление о награде больше не повторяется каждые полминуты. Twitch ещё минуту-другую показывает выданную награду как «готовую к получению», и приложение объявляло её снова и снова — с тостом, звуком и записью в журнал
- Журнал не задваивает одну и ту же награду, даже если две награды чередуются
- У мини-плеера в сайдбаре снова скруглённые углы

## 🇬🇧 Fixes

- Auto-farm starts right after launch. Until Twitch returns the full campaign list, the app decided Overwatch only counted on two offline channels and started nothing. It now prefers the campaign's channels and otherwise starts a normal stream; the full list arrives within seconds and the credit check switches the channel if needed
- While the campaign list is incomplete, the main screen says so and makes clear you can start farming
- The reward notification no longer repeats every 30 seconds while Twitch still reports a claimed reward as claimable
- The journal no longer duplicates the same reward, even when two rewards alternate
- The sidebar mini-player has rounded corners again
