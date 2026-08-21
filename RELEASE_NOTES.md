## 🇷🇺 Исправлено

- **Приложение больше не фармит впустую.** Если кампания заканчивается раньше, чем наберётся время на ближайшую награду, смысла смотреть нет — теперь приложение это понимает и уходит в другую категорию. Раньше переключение срабатывало только при условии «получены все награды», а при недостижимой награде оно не выполняется никогда: одна ночь ушла на кампанию, где вторая награда не бралась в принципе
- **Автопереключение категорий заработало вообще.** Проверка жила в функции, которую ничто не вызывало, поэтому не срабатывала ни разу — ни в этом случае, ни когда все награды собраны
- **Награда снова забирается из приложения.** Кнопка «Получить» отвечала «Не удалось получить награду» на любую попытку: запрос уходил под токеном OAuth-приложения, а Twitch принимает его только от своего веб-клиента. Теперь используется тот же токен, на котором работает список дропсов, — и кнопка, и автосбор
- Отказ в получении награды называет причину: истёкшую авторизацию, устаревший список наград или ответ Twitch. Раньше на всё была одна фраза
- Награда, забранная ранее на сайте, больше не считается ошибкой
- Кнопка «Получить все» перестала молча пропускать награды — в ней лежал устаревший запрос
- После остановки фарминга в сайдбаре не остаётся пустой чёрный прямоугольник
- Переведены две подписи, показывавшиеся как SETTINGS.ENABLED и SETTINGS.DISABLED

## ✨ Что нового

- **Выбор категории по выгоде.** Приложение считает, сколько наград реально возьмётся за час просмотра, и берётся за ту категорию, где их больше; при равной выгоде — за ту, что заканчивается раньше, потому что долгоиграющую можно догнать потом. Отключается в «Настройках»
- Категории, которые уже не успеть добить, опускаются в конец списка с пометкой «Не успеть» — награды в них есть, но времени на них не хватит
- Когда все дропсы категории собраны, приложение сразу предлагает перейти к следующей категории с дропсами

## 🇬🇧 Fixed

- **No more farming for nothing.** If a campaign ends sooner than the time needed for its nearest reward, watching is pointless — the app now recognises this and moves to another category. Previously switching required "all rewards claimed", which never becomes true when a reward is out of reach: one night went into a campaign whose second reward could not be earned at all
- **Automatic category switching works at all now.** The check lived in a function nothing ever called, so it never ran once — neither in this case nor when every reward was collected
- **Claiming rewards from the app works again.** The "Claim" button answered "could not claim the reward" on every attempt: the request went out under the OAuth application token, which Twitch accepts only from its own web client. It now uses the same token the drops list already works on — both for the button and for automatic claiming
- Claim failures name the cause: expired authorization, a stale rewards list, or Twitch's own error. Previously everything shared one message
- A reward already claimed on the website no longer counts as an error
- "Claim all" stopped silently skipping rewards — it carried a stale request
- Stopping farming no longer leaves an empty black rectangle in the sidebar
- Two labels that showed as SETTINGS.ENABLED and SETTINGS.DISABLED are now translated

## ✨ What's new

- **Categories are picked by value.** The app works out how many rewards a category will actually yield per hour of watching and takes the richer one; on a tie it prefers the campaign ending sooner, since a long-running one can be caught up later. Can be turned off in Settings
- Categories that can no longer be finished in time sink to the bottom of the list, marked "Не успеть" — they still have rewards, but there is no time left for them
- When every drop in a category is collected, the app offers to move straight to the next category with drops
