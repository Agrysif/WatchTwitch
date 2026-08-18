$ErrorActionPreference = "Stop"

$owner = "Agrysif"
$repo = "WatchTwitch"
$distFolder = "c:\Users\egor1\Desktop\old app\WatchTwitch\dist"
$version = "1.0.13"

function Create-Release {
  param(
    [string]$version,
    [string]$token
  )
    
  $tagName = "v$version"
  $releaseName = "Release $version"
  $body = @"
WatchTwitch v$version

## Improvements
- Added tooltip on progress bar hover showing drop images
- Fixed event listener duplication bug (triple-click modal issue)
- Improved subscription channel auto-loading
- Fixed manual categories priority sorting
- Enhanced UI stability

## Fixed Issues
- Modal buttons now respond to single clicks (fixed duplicate event listeners)
- Manually added categories now farm in correct priority order
- Subscribed channels with drops auto-load on Farming page
- Progress bar now displays tooltip with drop images on hover

## Installation
Simply run the installer: WatchTwitch Setup $version.exe

Auto-updater will notify existing users to update.
"@
    
  Write-Host "Creating release for version $version..." -ForegroundColor Green
    
  $uri = "https://api.github.com/repos/$owner/$repo/releases"
  $headers = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github.v3+json"
    "User-Agent"    = "PowerShell"
  }
    
  $bodyJson = @{
    tag_name         = $tagName
    target_commitish = "main"
    name             = $releaseName
    body             = $body
    draft            = $false
    prerelease       = $false
  } | ConvertTo-Json
    
  try {
    $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $bodyJson -ContentType "application/json"
    $releaseId = $response.id
    Write-Host "✓ Release created with ID: $releaseId" -ForegroundColor Green
        
    Upload-Assets -version $version -releaseId $releaseId -token $token
    return $true
  }
  catch {
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
    "WatchTwitch Setup $version.exe.blockmap"
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
      "Content-Type"  = "application/octet-stream"
      "User-Agent"    = "PowerShell"
    }
        
    try {
      $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
      $fileSize = [math]::Round($fileBytes.Length / 1MB, 2)
            
      $response = Invoke-RestMethod -Uri $uploadUri -Method Post -Headers $headers -Body $fileBytes
      Write-Host "  ✓ Uploaded: $fileName ($fileSize MB)" -ForegroundColor Green
    }
    catch {
      Write-Host "  ✗ Error uploading $fileName : $_" -ForegroundColor Red
    }
  }
}

# Main execution
$token = $env:GITHUB_TOKEN
if (-not $token) {
  Write-Host "ERROR: GITHUB_TOKEN environment variable is not set!" -ForegroundColor Red
  Write-Host "Usage (in PowerShell):" -ForegroundColor Yellow
  Write-Host '$env:GITHUB_TOKEN = "your_personal_access_token"' -ForegroundColor Cyan
  Write-Host ".\publish-v1.0.13.ps1" -ForegroundColor Cyan
  exit 1
}

Write-Host "GitHub Release Publisher for WatchTwitch v$version" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

if (Create-Release -version $version -token $token) {
  Write-Host ""
  Write-Host "===================================================" -ForegroundColor Cyan
  Write-Host "✓ Release v$version published successfully!" -ForegroundColor Green
  Write-Host "View at: https://github.com/$owner/$repo/releases/tag/v$version" -ForegroundColor Cyan
}
else {
  Write-Host ""
  Write-Host "===================================================" -ForegroundColor Cyan
  Write-Host "✗ Failed to publish release" -ForegroundColor Red
}
