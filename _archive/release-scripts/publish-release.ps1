$ErrorActionPreference = "Stop"

$owner = "Agrysif"
$repo = "WatchTwitch"
$distFolder = "c:\Users\egor1\Desktop\old app\WatchTwitch\dist"
$version = "1.0.13"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  WatchTwitch v$version - GitHub Release Publisher          ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Проверяем файлы
$files = @(
  "WatchTwitch Setup $version.exe",
  "WatchTwitch Setup $version.exe.blockmap"
)

Write-Host "📦 Checking build files..." -ForegroundColor Yellow
foreach ($file in $files) {
  $path = Join-Path $distFolder $file
  if (Test-Path $path) {
    $size = [math]::Round((Get-Item $path).Length / 1MB, 2)
    Write-Host "   ✓ $file ($size MB)" -ForegroundColor Green
  }
  else {
    Write-Host "   ✗ $file - NOT FOUND" -ForegroundColor Red
    exit 1
  }
}

Write-Host ""
Write-Host "🔑 GitHub Authentication Required" -ForegroundColor Yellow
Write-Host "   You need a GitHub Personal Access Token (PAT)" -ForegroundColor Gray
Write-Host ""

# Попытка получить токен из переменной окружения
$token = $env:GITHUB_TOKEN

if (-not $token) {
  Write-Host "How to create a Personal Access Token:" -ForegroundColor Cyan
  Write-Host "1. Go to: https://github.com/settings/tokens" -ForegroundColor Gray
  Write-Host "2. Click 'Generate new token (classic)'" -ForegroundColor Gray
  Write-Host "3. Select scopes: 'repo' and 'admin:repo_hook'" -ForegroundColor Gray
  Write-Host "4. Copy the token" -ForegroundColor Gray
  Write-Host ""
  
  $token = Read-Host "Paste your GitHub token"
  
  if (-not $token) {
    Write-Host "❌ Token is required!" -ForegroundColor Red
    exit 1
  }
}

Write-Host ""
Write-Host "📝 Creating release v$version..." -ForegroundColor Yellow
Write-Host ""

# Создаем релиз
$tagName = "v$version"
$releaseName = "Release $version"

$body = @"
# WatchTwitch v$version

## ✨ New Features
- 🎨 **Progress Bar Tooltips**: Hover over drop progress bar to see images of active drops
- 🔧 **Event System Improvements**: Fixed duplicate event listeners for better UI responsiveness

## 🐛 Bug Fixes
- ✅ Fixed modal buttons responding to triple-clicks (now single-click)
- ✅ Fixed manual categories not farming in correct priority
- ✅ Fixed subscribed channels not auto-loading to Farming page
- ✅ Improved event listener cleanup and registration

## 📊 Improvements
- Better priority sorting for farming categories
- Auto-detection of drops for subscription channels
- Enhanced visual feedback on hover effects
- Optimized event handling system

## 💾 Installation
Simply run the installer: **WatchTwitch Setup $version.exe**

Existing users will receive an automatic update notification.
"@

$uri = "https://api.github.com/repos/$owner/$repo/releases"
$headers = @{
  "Authorization" = "Bearer $token"
  "Accept"        = "application/vnd.github.v3+json"
  "User-Agent"    = "PowerShell-ReleasePublisher"
}

$bodyJson = @{
  tag_name         = $tagName
  target_commitish = "main"
  name             = $releaseName
  body             = $body
  draft            = $false
  prerelease       = $false
} | ConvertTo-Json -Depth 10

try {
  Write-Host "Creating release on GitHub..." -ForegroundColor Cyan
  $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $bodyJson -ContentType "application/json"
  $releaseId = $response.id
  Write-Host "✓ Release created! ID: $releaseId" -ForegroundColor Green
  Write-Host ""
  
  # Загружаем файлы
  Write-Host "📤 Uploading assets..." -ForegroundColor Yellow
  foreach ($fileName in $files) {
    $filePath = Join-Path $distFolder $fileName
    if (-not (Test-Path $filePath)) {
      Write-Host "   ⚠ Skipping: $fileName (not found)" -ForegroundColor Yellow
      continue
    }
    
    Write-Host "   Uploading: $fileName..." -ForegroundColor Cyan
    
    $uploadUri = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$([System.Web.HttpUtility]::UrlEncode($fileName))"
    
    $uploadHeaders = @{
      "Authorization" = "Bearer $token"
      "Content-Type"  = "application/octet-stream"
      "User-Agent"    = "PowerShell-ReleasePublisher"
    }
    
    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
    $fileSize = [math]::Round($fileBytes.Length / 1MB, 2)
    
    try {
      $uploadResponse = Invoke-RestMethod -Uri $uploadUri -Method Post -Headers $uploadHeaders -Body $fileBytes
      Write-Host "   ✓ Uploaded: $fileName ($fileSize MB)" -ForegroundColor Green
    }
    catch {
      Write-Host "   ✗ Failed to upload $fileName : $_" -ForegroundColor Red
    }
  }
  
  Write-Host ""
  Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
  Write-Host "║  ✅ Release v$version Published Successfully!              ║" -ForegroundColor Green
  Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
  Write-Host ""
  Write-Host "🔗 View Release:" -ForegroundColor Cyan
  Write-Host "   https://github.com/$owner/$repo/releases/tag/v$version" -ForegroundColor Green
  Write-Host ""
  Write-Host "📥 Downloads:" -ForegroundColor Cyan
  Write-Host "   https://github.com/$owner/$repo/releases" -ForegroundColor Green
  Write-Host ""
}
catch {
  Write-Host ""
  Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Red
  Write-Host "║  ❌ Failed to Publish Release                              ║" -ForegroundColor Red
  Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Red
  Write-Host ""
  Write-Host "Error Details:" -ForegroundColor Red
  Write-Host $_ -ForegroundColor Red
  Write-Host ""
  Write-Host "Troubleshooting:" -ForegroundColor Yellow
  Write-Host "• Make sure your token has 'repo' and 'admin:repo_hook' scopes" -ForegroundColor Gray
  Write-Host "• Check that the token hasn't expired" -ForegroundColor Gray
  Write-Host "• Verify you have permission to create releases on Agrysif/WatchTwitch" -ForegroundColor Gray
  exit 1
}
