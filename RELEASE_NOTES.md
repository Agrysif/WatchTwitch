## 🇷🇺 Исправления

- Ночной фарм больше не зависает на «Жду зачёт». Если минуты в инвентаре не растут 10 минут, приложение считает, что канал не засчитывает, и переключает стрим — даже когда Twitch не отвечает на проверку просмотра
- Награды, которые выдаются не за просмотр (за подписку или подарок саба), больше не держат категорию. На плитке написано «Не за просмотр», а категория, где остались только такие награды, считается собранной — фарм идёт дальше
- Если три канала подряд в одной категории не засчитывают дропсы, категория откладывается на 2 часа и фарм переходит к следующей (если есть куда; категорию, запущенную кнопкой, приложение само не меняет, а предлагает перейти). Раньше приложение могло всю ночь прыгать между двумя каналами
- Автофарм запускается сразу после старта. Пока Twitch не отдал полный список кампаний, приложение могло не запустить ни один стрим — ни автофармом, ни кнопкой категории. Теперь оно запускает стрим сразу, а когда придёт полный список, проверка зачёта сама поправит канал
- Пока список кампаний неполный, на главном экране об этом написано, и понятно, что фарм можно запускать
- Уведомление о награде больше не повторяется каждые полминуты, а журнал не задваивает одну и ту же награду
- У мини-плеера в сайдбаре снова скруглённые углы

## 🇬🇧 Fixes

- Overnight farming no longer gets stuck on "Waiting for credit". If inventory minutes stay flat for 10 minutes, the app treats the channel as not counting and switches the stream — even when Twitch doesn't answer the watch-session check
- Rewards that aren't earned by watching (subscriptions or gifted subs) no longer hold a category. Their tile now says so, and a category with only such rewards left counts as done, so farming moves on
- If three channels in a row in one category give no credit, the category is paused for 2 hours and farming moves to the next one (if there is one; a category started with its button is never switched automatically, the app offers to switch instead). Before, the app could bounce between two channels all night
- Auto-farm starts right after launch. Until Twitch returned the full campaign list, the app could start nothing — neither auto-farm nor the category button. It now starts a stream right away, and the credit check fixes the channel once the full list arrives
- While the campaign list is incomplete, the main screen says so and makes clear you can start farming
- The reward notification no longer repeats every 30 seconds, and the journal no longer duplicates the same reward
- The sidebar mini-player has rounded corners again
