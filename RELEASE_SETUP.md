## Создание GitHub Release версий 1.0.10 и 1.0.11

Я подготовил всё для выложивания релизов на GitHub. Вот что нужно сделать:

### Шаг 1: Создать Personal Access Token (PAT)

1. Откройте https://github.com/settings/tokens/new
2. Или зайдите в GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
3. Нажмите "Generate new token (classic)"
4. **Скопируйте token** (он появится только один раз!)

### Шаг 2: Запустить PowerShell скрипт

Откройте PowerShell в папке приложения и выполните:

```powershell
cd "c:\Users\egor1\Desktop\old app\WatchTwitch"

# Установите переменную окружения с вашим токеном
$env:GITHUB_TOKEN = "github_pat_xxxxxxxxxxxxx"

# Запустите скрипт
.\release-publisher.ps1
```

**Или всё в одну команду:**

```powershell
cd "c:\Users\egor1\Desktop\old app\WatchTwitch" ; $env:GITHUB_TOKEN = "github_pat_xxxxxxxxxxxxx" ; .\release-publisher.ps1
```

Замените `github_pat_xxxxxxxxxxxxx` на ваш токен!

### Шаг 3: Проверить результат

После выполнения скрипта откройте:
https://github.com/Agrysif/WatchTwitch/releases

Вы должны увидеть две новые версии:
- v1.0.10
- v1.0.11

Каждая с тремя файлами:
- WatchTwitch Setup X.X.X.exe (88 MB)
- WatchTwitch Setup X.X.X.exe.blockmap (98 KB)
- latest-X.X.X.yml (конфиг)

---

## Требуемые права токена

Если при создании токена спрашивает права:
- ✓ repo (полный доступ к репозиториям)
- ✓ public_repo (если выбираете конкретные)

Минимально нужны:
- repo (или хотя бы write:packages и read:packages)

---

## Готово!

После этого приложение будет проверять обновления и находить версии 1.0.10 и 1.0.11 на GitHub.

**Файлы уже собраны и находятся в `dist/`:**
- ✓ WatchTwitch Setup 1.0.10.exe
- ✓ WatchTwitch Setup 1.0.11.exe
- ✓ latest-1.0.10.yml
- ✓ latest-1.0.11.yml
- ✓ blockmap файлы
