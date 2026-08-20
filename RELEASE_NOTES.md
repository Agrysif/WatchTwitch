## 🇷🇺 Исправлено

- **Награда снова забирается из приложения.** Кнопка «Получить» отвечала «Не удалось получить награду» на любую попытку: запрос уходил под токеном OAuth-приложения, а Twitch принимает его только от своего веб-клиента и возвращал отказ. Теперь используется тот же токен, на котором работает список дропсов, — и кнопка, и автосбор наград
- Отказ теперь называет причину: истёкшую авторизацию, устаревший список наград или ответ Twitch. Раньше на всё была одна фраза
- Награда, забранная ранее на сайте, больше не считается ошибкой
- Кнопка «Получить все» перестала молча пропускать награды — в ней лежал устаревший запрос

## ✨ Что нового

- Когда все дропсы категории собраны, приложение сразу предлагает перейти к следующей категории с дропсами. Раньше следующую нужно было искать руками

## 🇬🇧 Fixed

- **Claiming rewards from the app works again.** The "Claim" button answered "could not claim the reward" on every attempt: the request went out under the OAuth application token, which Twitch accepts only from its own web client and rejected. It now uses the same token the drops list already works on — both for the button and for automatic claiming
- Failures now name the cause: expired authorization, a stale rewards list, or Twitch's own error. Previously everything shared one message
- A reward already claimed on the website no longer counts as an error
- "Claim all" stopped silently skipping rewards — it carried a stale request

## ✨ What's new

- When every drop in a category is collected, the app offers to move straight to the next category with drops. Previously the next one had to be found by hand
