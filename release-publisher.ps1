$ErrorActionPreference = "Stop"

$owner = "Agrysif"
$repo = "WatchTwitch"
$distFolder = "c:\Users\egor1\Desktop\old app\WatchTwitch\dist"

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

# Main execution - используем токен из переменной окружения или параметра
$token = $env:GITHUB_TOKEN
if (-not $token) {
    Write-Host "ERROR: GITHUB_TOKEN environment variable is not set!" -ForegroundColor Red
    Write-Host "Usage: `$env:GITHUB_TOKEN = 'your_token'; .\create-releases-api.ps1" -ForegroundColor Yellow
    exit 1
}

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
Write-Host "Completed: $successCount/$($versions.Count) releases created!" -ForegroundColor Green
Write-Host "Check: https://github.com/$owner/$repo/releases" -ForegroundColor Cyan
