# Публикация релиза на GitHub.
#
# Использует GitHub CLI (tools\gh\bin\gh.exe), который уже авторизован под
# вашим аккаунтом — токен лежит в хранилище Windows, вводить его не нужно.
#
# Запуск: правый клик по файлу -> "Выполнить с помощью PowerShell".
# Окно не закроется само: в конце всегда ждёт нажатия клавиши, поэтому
# сообщение об ошибке можно прочитать.

$ErrorActionPreference = "Stop"

function Pause-AndExit([int]$code) {
  Write-Host ""
  Write-Host "  Нажмите любую клавишу, чтобы закрыть окно..." -ForegroundColor DarkGray
  try { $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") } catch { Start-Sleep -Seconds 30 }
  exit $code
}

try {
  $root = Split-Path -Parent $MyInvocation.MyCommand.Path
  Set-Location $root

  Write-Host ""
  Write-Host "  Публикация WatchTwitch" -ForegroundColor Cyan
  Write-Host "  ----------------------" -ForegroundColor DarkGray
  Write-Host ""

  # --- Что выпускаем ---
  $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
  $version = $pkg.version
  $tag = "v$version"
  Write-Host "  Версия: $version" -ForegroundColor White

  $notes = Join-Path $root "RELEASE_NOTES.md"
  if (-not (Test-Path $notes)) {
    Write-Host "  Нет файла RELEASE_NOTES.md — описание обязательно." -ForegroundColor Red
    Pause-AndExit 1
  }

  # --- GitHub CLI ---
  $gh = Join-Path $root "tools\gh\bin\gh.exe"
  if (-not (Test-Path $gh)) {
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($cmd) { $gh = $cmd.Source }
    else {
      Write-Host "  GitHub CLI не найден (ожидался tools\gh\bin\gh.exe)." -ForegroundColor Red
      Pause-AndExit 1
    }
  }

  & $gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  GitHub CLI не авторизован. Выполните: gh auth login" -ForegroundColor Red
    Pause-AndExit 1
  }
  Write-Host "  GitHub CLI: авторизован" -ForegroundColor White

  # --- Сборка ---
  Write-Host ""
  Write-Host "  Собираю установщик. Это несколько минут..." -ForegroundColor Cyan
  Write-Host ""

  & npm run build:win
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Сборка не удалась." -ForegroundColor Red
    Pause-AndExit $LASTEXITCODE
  }

  # --- Проверка файлов перед загрузкой ---
  $exe = Join-Path $root "dist\WatchTwitch-Setup-$version.exe"
  $map = "$exe.blockmap"
  $yml = Join-Path $root "dist\latest.yml"

  foreach ($f in @($exe, $map, $yml)) {
    if (-not (Test-Path $f)) {
      Write-Host "  Не найден файл сборки: $f" -ForegroundColor Red
      Pause-AndExit 1
    }
  }

  # Имя внутри latest.yml обязано совпадать с именем файла — из-за
  # расхождения здесь обновления ломались раньше
  $ymlName = (Select-String -Path $yml -Pattern 'url:\s*(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value
  if ($ymlName -ne "WatchTwitch-Setup-$version.exe") {
    Write-Host "  latest.yml ссылается на '$ymlName', а файл называется иначе." -ForegroundColor Red
    Write-Host "  Публикация остановлена: обновление не нашлось бы у пользователей." -ForegroundColor Red
    Pause-AndExit 1
  }
  Write-Host "  Проверка latest.yml: имя совпадает" -ForegroundColor Green

  # --- Загрузка ---
  Write-Host ""
  Write-Host "  Создаю черновик релиза и загружаю файлы..." -ForegroundColor Cyan

  & $gh release create $tag --draft --target main --title "WatchTwitch $version" --notes-file $notes $exe $map $yml
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Не удалось создать релиз. Возможно, тег $tag уже существует." -ForegroundColor Red
    Pause-AndExit $LASTEXITCODE
  }

  Write-Host ""
  Write-Host "  Готово. Релиз создан ЧЕРНОВИКОМ." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Осталось одно действие:" -ForegroundColor White
  Write-Host "  1. Откройте https://github.com/Agrysif/WatchTwitch/releases" -ForegroundColor Gray
  Write-Host "  2. Откройте черновик $tag" -ForegroundColor Gray
  Write-Host "  3. Нажмите Publish release" -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Пока релиз в черновиках, установленные копии его не видят." -ForegroundColor DarkGray

  Pause-AndExit 0
}
catch {
  Write-Host ""
  Write-Host "  Ошибка: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  $($_.InvocationInfo.PositionMessage)" -ForegroundColor DarkGray
  Pause-AndExit 1
}
