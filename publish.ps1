# Публикация релиза на GitHub.
#
# Скрипт сам достаёт токен из fix-release.ps1 (файл в .gitignore и в
# репозиторий не попадает), кладёт его в переменную окружения только на
# время запуска и передаёт сборщику. Токен нигде не печатается.
#
# Запуск: правый клик по файлу -> "Выполнить с помощью PowerShell",
# либо в терминале из папки проекта:   .\publish.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Публикация WatchTwitch" -ForegroundColor Cyan
Write-Host "  ----------------------" -ForegroundColor DarkGray
Write-Host ""

# --- Версия из package.json ---
$pkg = Get-Content (Join-Path $PSScriptRoot "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version
Write-Host "  Версия для выпуска: $version" -ForegroundColor White

# --- Заметки о выпуске ---
$notesPath = Join-Path $PSScriptRoot "RELEASE_NOTES.md"
if (-not (Test-Path $notesPath)) {
  Write-Host "  ! RELEASE_NOTES.md не найден — релиз уйдёт без описания." -ForegroundColor Yellow
}
else {
  Write-Host "  Описание изменений: RELEASE_NOTES.md" -ForegroundColor White
}

# --- Токен ---
$token = $null
$tokenFile = Join-Path $PSScriptRoot "fix-release.ps1"

if (Test-Path $tokenFile) {
  $found = Select-String -Path $tokenFile -Pattern '\$token\s*=\s*"([^"]+)"' | Select-Object -First 1
  if ($found) {
    $token = $found.Matches[0].Groups[1].Value
    Write-Host "  Токен: взят из fix-release.ps1" -ForegroundColor White
  }
}

if (-not $token) {
  Write-Host ""
  Write-Host "  Токен в файлах не найден." -ForegroundColor Yellow
  Write-Host "  Создать новый: https://github.com/settings/tokens (права: repo)" -ForegroundColor DarkGray
  Write-Host ""
  $secure = Read-Host "  Вставьте токен" -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

if (-not $token) {
  Write-Host "  Без токена публикация невозможна." -ForegroundColor Red
  exit 1
}

# --- Сборка и загрузка ---
Write-Host ""
Write-Host "  Собираю и загружаю. Это займёт несколько минут..." -ForegroundColor Cyan
Write-Host ""

$env:GH_TOKEN = $token

try {
  npm run release
  $code = $LASTEXITCODE
}
finally {
  # Не оставляем токен в переменных окружения этой сессии
  Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue
  $token = $null
}

Write-Host ""

if ($code -ne 0) {
  Write-Host "  Публикация не удалась (код $code)." -ForegroundColor Red
  Write-Host "  Частые причины: истёк токен, нет права repo, пропала сеть." -ForegroundColor DarkGray
  exit $code
}

Write-Host "  Готово. Релиз создан ЧЕРНОВИКОМ." -ForegroundColor Green
Write-Host ""
Write-Host "  Осталось одно действие:" -ForegroundColor White
Write-Host "  1. Откройте https://github.com/Agrysif/WatchTwitch/releases" -ForegroundColor Gray
Write-Host "  2. Убедитесь, что в черновике v$version три файла:" -ForegroundColor Gray
Write-Host "     WatchTwitch-Setup-$version.exe" -ForegroundColor DarkGray
Write-Host "     WatchTwitch-Setup-$version.exe.blockmap" -ForegroundColor DarkGray
Write-Host "     latest.yml" -ForegroundColor DarkGray
Write-Host "  3. Нажмите Publish release" -ForegroundColor Gray
Write-Host ""
Write-Host "  Пока релиз в черновиках, установленные копии его не видят." -ForegroundColor DarkGray
Write-Host ""
