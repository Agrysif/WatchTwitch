# Script to create GitHub releases for versions 1.0.10 and 1.0.11
# This script creates releases and uploads the built executable files

$owner = "Agrysif"
$repo = "WatchTwitch"
$distFolder = "c:\Users\egor1\Desktop\old app\WatchTwitch\dist"

# Versions to release
$versions = @("1.0.10", "1.0.11")

# Function to create a release via GitHub API
function Create-Release {
    param(
        [string]$version,
        [string]$token
    )
    
    $tagName = "v$version"
    $releaseName = "Release $version"
    $body = "WatchTwitch v$version - Auto Update Release`n`nThis is an automated release build for testing the auto-update system."
    
    Write-Host "Creating release for version $version..." -ForegroundColor Green
    
    # Create the release via API
    $uri = "https://api.github.com/repos/$owner/$repo/releases"
    $headers = @{
        "Authorization" = "token $token"
        "Accept" = "application/vnd.github.v3+json"
    }
    
    $body_json = @{
        tag_name = $tagName
        target_commitish = "main"
        name = $releaseName
        body = $body
        draft = $false
        prerelease = $false
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body_json -ContentType "application/json"
        $releaseId = $response.id
        Write-Host "Release created with ID: $releaseId" -ForegroundColor Green
        
        # Upload assets
        Upload-Assets -version $version -releaseId $releaseId -token $token
    } catch {
        Write-Host "Error creating release: $_" -ForegroundColor Red
    }
}

# Function to upload assets
function Upload-Assets {
    param(
        [string]$version,
        [int]$releaseId,
        [string]$token
    )
    
    $exeFile = Join-Path $distFolder "WatchTwitch Setup $version.exe"
    $blockmapFile = Join-Path $distFolder "WatchTwitch Setup $version.exe.blockmap"
    $ymlFile = Join-Path $distFolder "latest-$version.yml"
    
    $files = @($exeFile, $blockmapFile, $ymlFile)
    
    foreach ($file in $files) {
        if (Test-Path $file) {
            Write-Host "Uploading: $(Split-Path $file -Leaf)" -ForegroundColor Yellow
            
            $fileName = Split-Path $file -Leaf
            $uploadUri = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$fileName"
            
            $headers = @{
                "Authorization" = "token $token"
                "Content-Type" = "application/octet-stream"
            }
            
            try {
                $fileBytes = [System.IO.File]::ReadAllBytes($file)
                Invoke-RestMethod -Uri $uploadUri -Method Post -Headers $headers -Body $fileBytes | Out-Null
                Write-Host "Uploaded: $fileName" -ForegroundColor Green
            } catch {
                Write-Host "Error uploading $fileName : $_" -ForegroundColor Red
            }
        } else {
            Write-Host "File not found: $file" -ForegroundColor Red
        }
    }
}

# Main execution
Write-Host "GitHub Release Creator for WatchTwitch" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Get token from environment or ask user
$token = $env:GITHUB_TOKEN
if (-not $token) {
    Write-Host "GITHUB_TOKEN environment variable not set" -ForegroundColor Yellow
    $token = Read-Host "Enter your GitHub token"
}

if (-not $token) {
    Write-Host "No token provided. Exiting." -ForegroundColor Red
    exit 1
}

# Create releases for each version
foreach ($version in $versions) {
    Create-Release -version $version -token $token
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "All releases created successfully!" -ForegroundColor Green
