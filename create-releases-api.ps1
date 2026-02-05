$ErrorActionPreference = "Stop"

$owner = "Agrysif"
$repo = "WatchTwitch"
$distFolder = "c:\Users\egor1\Desktop\old app\WatchTwitch\dist"

# Используем встроенные токены GitHub через git
# Сначала получим текущего пользователя из git config
$gitUser = & git config --global user.name
Write-Host "Git user: $gitUser" -ForegroundColor Yellow

# Проверим есть ли credentials helper настроена
Write-Host "Проверяем доступ к GitHub через git..." -ForegroundColor Cyan

# Попробуем проверить доступ
$testRepoUrl = "https://github.com/$owner/$repo.git"
$testAccess = & git ls-remote $testRepoUrl 2>&1 | Select-Object -First 1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Доступ к GitHub работает!" -ForegroundColor Green
} else {
    Write-Host "✗ Нет доступа к GitHub" -ForegroundColor Red
    Write-Host "Пожалуйста, авторизуйтесь в GitHub используя:" -ForegroundColor Yellow
    Write-Host "  git credential fill" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "Заметка: Для создания releases через API нужен Personal Access Token (PAT)" -ForegroundColor Yellow
Write-Host "Токены создаются на https://github.com/settings/tokens" -ForegroundColor Yellow
Write-Host ""

$token = Read-Host "Введите GitHub PAT токен (или пусто для отмены)"
if (-not $token) {
    Write-Host "Отменено пользователем" -ForegroundColor Red
    exit 1
}

# Версии
$versions = @("1.0.10", "1.0.11")

function Create-Release {
    param(
        [string]$version,
        [string]$token
    )
    
    $tagName = "v$version"
    $releaseName = "Release $version"
    $body = @"
WatchTwitch v$version - Auto Update Release

This is an automated release build for testing the auto-update system.

## Changes
- Fixed update download and progress tracking
- Added error handling for failed downloads
- Improved update UI responsiveness

## Installation
Simply run the installer: WatchTwitch Setup $version.exe

## Files
- **WatchTwitch Setup $version.exe** - Main installer (run this)
- **WatchTwitch Setup $version.exe.blockmap** - Delta update metadata
- **latest-$version.yml** - Update configuration file
"@
    
    Write-Host "Creating release for version $version..." -ForegroundColor Green
    
    $uri = "https://api.github.com/repos/$owner/$repo/releases"
    $headers = @{
        "Authorization" = "token $token"
        "Accept" = "application/vnd.github.v3+json"
        "User-Agent" = "PowerShell"
    }
    
    $bodyJson = @{
        tag_name = $tagName
        target_commitish = "main"
        name = $releaseName
        body = $body
        draft = $false
        prerelease = $false
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $bodyJson -ContentType "application/json"
        $releaseId = $response.id
        Write-Host "✓ Release created with ID: $releaseId" -ForegroundColor Green
        
        Upload-Assets -version $version -releaseId $releaseId -token $token
        return $true
    } catch {
        Write-Host "✗ Error creating release: $_" -ForegroundColor Red
        return $false
    }
}

function Upload-Assets {
    param(
        [string]$version,
        [int]$releaseId,
        [string]$token
    )
    
    $files = @(
        "WatchTwitch Setup $version.exe",
        "WatchTwitch Setup $version.exe.blockmap",
        "latest-$version.yml"
    )
    
    foreach ($fileName in $files) {
        $filePath = Join-Path $distFolder $fileName
        
        if (-not (Test-Path $filePath)) {
            Write-Host "  ✗ File not found: $fileName" -ForegroundColor Red
            continue
        }
        
        Write-Host "  Uploading: $fileName..." -ForegroundColor Yellow
        
        $uploadUri = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$([System.Web.HttpUtility]::UrlEncode($fileName))"
        
        $headers = @{
            "Authorization" = "token $token"
            "Content-Type" = "application/octet-stream"
            "User-Agent" = "PowerShell"
        }
        
        try {
            $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
            $fileSize = [math]::Round($fileBytes.Length / 1MB, 2)
            
            $response = Invoke-RestMethod -Uri $uploadUri -Method Post -Headers $headers -Body $fileBytes
            Write-Host "  ✓ Uploaded: $fileName ($fileSize MB)" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ Error uploading $fileName : $_" -ForegroundColor Red
        }
    }
}

# Main
Write-Host ""
Write-Host "GitHub Release Creator for WatchTwitch" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

$successCount = 0
foreach ($version in $versions) {
    if (Create-Release -version $version -token $token) {
        $successCount++
    }
    Write-Host ""
    Start-Sleep -Seconds 2
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Completed: $successCount/$($versions.Count) releases created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Check: https://github.com/$owner/$repo/releases" -ForegroundColor Cyan
