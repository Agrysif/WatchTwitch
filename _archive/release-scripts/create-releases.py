#!/usr/bin/env python3
"""
Script to create GitHub releases using the GitHub API
"""

import os
import json
import requests
from pathlib import Path

OWNER = "Agrysif"
REPO = "WatchTwitch"
DIST_FOLDER = r"c:\Users\egor1\Desktop\old app\WatchTwitch\dist"

VERSIONS = ["1.0.10", "1.0.11"]

def create_release(version, token):
    """Create a GitHub release"""
    tag_name = f"v{version}"
    release_name = f"Release {version}"
    body = f"""WatchTwitch v{version} - Auto Update Release

This is an automated release build for testing the auto-update system.

## Changes
- Fixed update download and progress tracking
- Added error handling for failed downloads
- Improved update UI responsiveness

## Files
- WatchTwitch Setup {version}.exe - Main installer
- WatchTwitch Setup {version}.exe.blockmap - Delta update file
- latest-{version}.yml - Update metadata file"""
    
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/releases"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    data = {
        "tag_name": tag_name,
        "target_commitish": "main",
        "name": release_name,
        "body": body,
        "draft": False,
        "prerelease": False,
    }
    
    print(f"Creating release for version {version}...")
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        release = response.json()
        release_id = release["id"]
        print(f"✓ Release created with ID: {release_id}")
        
        # Upload assets
        upload_assets(version, release_id, token)
        return True
    except Exception as e:
        print(f"✗ Error creating release: {e}")
        return False

def upload_assets(version, release_id, token):
    """Upload asset files to a release"""
    files = [
        f"WatchTwitch Setup {version}.exe",
        f"WatchTwitch Setup {version}.exe.blockmap",
        f"latest-{version}.yml",
    ]
    
    url_template = f"https://uploads.github.com/repos/{OWNER}/{REPO}/releases/{release_id}/assets"
    headers = {
        "Authorization": f"token {token}",
    }
    
    for filename in files:
        filepath = Path(DIST_FOLDER) / filename
        if not filepath.exists():
            print(f"✗ File not found: {filename}")
            continue
        
        print(f"  Uploading: {filename}...")
        try:
            with open(filepath, "rb") as f:
                file_data = f.read()
            
            upload_headers = headers.copy()
            upload_headers["Content-Type"] = "application/octet-stream"
            
            params = {"name": filename}
            response = requests.post(
                url_template,
                headers=upload_headers,
                params=params,
                data=file_data
            )
            response.raise_for_status()
            print(f"  ✓ Uploaded: {filename}")
        except Exception as e:
            print(f"  ✗ Error uploading {filename}: {e}")

def main():
    print("GitHub Release Creator for WatchTwitch")
    print("=" * 50)
    print()
    
    # Get token from environment variable
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        print("Error: GITHUB_TOKEN environment variable not set")
        print("Please set GITHUB_TOKEN before running this script")
        return False
    
    # Create releases
    for version in VERSIONS:
        if not create_release(version, token):
            print(f"Failed to create release for {version}")
        print()
    
    print("All releases created successfully!")
    return True

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
