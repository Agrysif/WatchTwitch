# WatchTwitch - Twitch Drops Farming Application

An automatic application for collecting drops on the Twitch platform.

<img width="1916" height="1033" alt="image" src="https://github.com/user-attachments/assets/5b882f2c-4ecc-4bc9-8f63-eb75d86279ac" /> <img width="1917" height="1028" alt="image" src="https://github.com/user-attachments/assets/bf8944b0-8b06-43d7-8b0f-2c3cb0e51227" />




## Features

- 🎮 Automatic farming of drops from Twitch
- 🔐 Two authorization methods (OAuth and Cookies)
- 📊 Detailed statistics of views and drops received
- 🎯 Category priority management with drag-and-drop
- 🌙 Dark and light theme in Twitch style
- 🔔 Notifications about receiving drops
- 🌍 Automatic computer shutdown after completion


## Install the application simply by downloading and installing the file Setup.exe the latest version

------

## Usage

###1. Adding an account

- Go to the "Accounts" section
- Select the login method:
- **OAuth**: Log in via Twitch directly
  - Next, log in to your account using your username and password
(the application works locally and does not transmit your data)

### 2. Choosing categories

- Go to the "Farming" section
- Click "Add Category"
- Choose games with active drops or with your favorite
- Drag and drop categories to change the priority

### 3. Start farming

- Click "Start Farming"
- The app automatically:
- Selects a streamer with drops
  - Opens the stream in the background
  - Tracks the progress of drops
  - Switches between categories

###4. Settings

- **Stream quality**: Minimal to save traffic
- **Verification interval**: How often to check the progress (default is 1 minute)
- **Stream language**: Priority for Russian or English streamers

## Technology

- **Electron** - A cross-platform framework
- **electron-store** - Storing data locally
- **HTML/CSS/JavaScript** - Interface
- **Native APIs** - System Integration

## Project structure

```
WatchTwitch/
├── main.js                 # Главный процесс Electron
├── preload.js             # Preload скрипт
├── package.json           # Зависимости
├── renderer/              # Интерфейс приложения
│   ├── index.html        # Главная страница
│   ├── styles/           # CSS стили
│   │   ├── main.css
│   │   ├── themes.css
│   │   └── animations.css
│   ├── js/               # JavaScript модули
│   │   ├── app.js
│   │   ├── auth.js
│   │   ├── drops.js
│   │   ├── streaming.js
│   │   ├── storage.js
│   │   ├── router.js
│   │   └── i18n.js
│   └── pages/            # HTML страницы
│       ├── farming.html
│       ├── accounts.html
│       ├── statistics.html
│       └── settings.html
└── assets/               # Ресурсы
    └── logo.svg
```

## Security

- Account data is stored locally
- There is no data transfer to third-party servers
- Cookies are encrypted with built-in Electron tools

## Support

When problems arise:

1. Enable logging in the settings
2. Check the DevTools console (Ctrl+Shift+I)
3. Create an issue on GitHub

## License

MIT License

## Author

Agrysif - Egor Balashov
Created with ❤️ for Twitch community
