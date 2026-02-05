# ИНСТРУКЦИЯ: Выложить версии 1.0.10 и 1.0.11 на GitHub

## Шаг 1: Авторизация GitHub CLI

Откройте PowerShell и выполните:
```powershell
# Скачайте GitHub CLI с https://github.com/cli/cli/releases
# Или используйте scoop: scoop install gh

gh auth login
# Выберите: GitHub.com
# Выберите: HTTPS
# Введите пароль для аутентификации через браузер
```

Если GitHub CLI не установлен, скачайте отсюда:
https://github.com/cli/cli/releases/download/v2.51.0/gh_2.51.0_windows_amd64.msi

## Шаг 2: Проверьте что релизы собраны

Проверьте что файлы есть в `dist/`:
```
WatchTwitch Setup 1.0.10.exe
WatchTwitch Setup 1.0.10.exe.blockmap
latest-1.0.10.yml

WatchTwitch Setup 1.0.11.exe
WatchTwitch Setup 1.0.11.exe.blockmap
latest-1.0.11.yml
```

## Шаг 3: Создайте релизы

В папке проекта выполните (после авторизации gh):

### Релиз 1.0.10:
```powershell
gh release create v1.0.10 `
  -t "Release 1.0.10" `
  -n "WatchTwitch v1.0.10 - Auto Update Release

This is an automated release build for testing the auto-update system.

## Changes
- Fixed update download and progress tracking
- Added error handling for failed downloads
- Improved update UI responsiveness" `
  dist/"WatchTwitch Setup 1.0.10.exe" `
  dist/"WatchTwitch Setup 1.0.10.exe.blockmap" `
  dist/"latest-1.0.10.yml"
```

### Релиз 1.0.11:
```powershell
gh release create v1.0.11 `
  -t "Release 1.0.11" `
  -n "WatchTwitch v1.0.11 - Auto Update Release

This is an automated release build for testing the auto-update system.

## Changes
- Fixed update download and progress tracking
- Added error handling for failed downloads
- Improved update UI responsiveness" `
  dist/"WatchTwitch Setup 1.0.11.exe" `
  dist/"WatchTwitch Setup 1.0.11.exe.blockmap" `
  dist/"latest-1.0.11.yml"
```

## Шаг 4: Проверьте на GitHub

Откройте: https://github.com/Agrysif/WatchTwitch/releases

Вы должны увидеть v1.0.10 и v1.0.11 с файлами.

## Шаг 5: Тестирование

1. Запустите текущее приложение (оно будет v1.0.11)
2. Оно должно проверить обновления и увидеть v1.0.11
3. Если всё работает - скачивается и устанавливается
4. Потом удалите релиз v1.0.11 (он был для теста)

---

## Альтернатива: Через веб-интерфейс GitHub

Если GitHub CLI не сработает:

1. Перейдите на https://github.com/Agrysif/WatchTwitch/releases/new
2. Создайте Release:
   - Tag: v1.0.10
   - Title: Release 1.0.10
   - Description: (скопируйте из шага 3)
   - Загрузите файлы:
     * dist/WatchTwitch Setup 1.0.10.exe
     * dist/WatchTwitch Setup 1.0.10.exe.blockmap
     * dist/latest-1.0.10.yml
3. Повторите для v1.0.11
