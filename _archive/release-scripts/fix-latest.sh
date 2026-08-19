#!/bin/bash
# Скрипт для исправления latest.yml и загрузки на GitHub Release

# Переменные
TOKEN="$1"
REPO="Agrysif/WatchTwitch"
VERSION="1.0.12"
TAG="v${VERSION}"

if [ -z "$TOKEN" ]; then
  echo "Usage: ./fix-latest.sh <github-token>"
  exit 1
fi

echo "🔧 Fixing latest.yml for v${VERSION}..."

# 1. Прочитать текущий latest.yml
LATEST_FILE="dist/latest.yml"
if [ ! -f "$LATEST_FILE" ]; then
  echo "❌ Error: $LATEST_FILE not found"
  exit 1
fi

echo "📝 Current latest.yml:"
cat "$LATEST_FILE"
echo ""

# 2. Заменить относительные пути на абсолютные GitHub URL
# Читаем файл и заменяем строки
FIXED_CONTENT=$(cat "$LATEST_FILE" | \
  sed "s|url: WatchTwitch-Setup-${VERSION}.exe|url: https://github.com/${REPO}/releases/download/${TAG}/WatchTwitch%20Setup%20${VERSION}.exe|" | \
  sed "s|path: WatchTwitch-Setup-${VERSION}.exe|path: https://github.com/${REPO}/releases/download/${TAG}/WatchTwitch%20Setup%20${VERSION}.exe|")

# 3. Сохранить исправленный файл
echo "$FIXED_CONTENT" > "$LATEST_FILE"

echo "✅ Fixed latest.yml:"
cat "$LATEST_FILE"
echo ""

# 4. Получить Release ID
echo "🔍 Getting release ID for $TAG..."
RELEASE_ID=$(curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" | \
  grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')

if [ -z "$RELEASE_ID" ]; then
  echo "❌ Error: Could not get release ID"
  exit 1
fi

echo "✅ Release ID: $RELEASE_ID"

# 5. Удалить старый latest.yml с GitHub
echo "🗑️ Deleting old latest.yml..."
curl -s -X DELETE \
  -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/${REPO}/releases/assets" | head -1

sleep 2

# 6. Загрузить новый latest.yml
echo "⬆️ Uploading new latest.yml..."
curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$LATEST_FILE" \
  "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=latest.yml"

echo ""
echo "✅ Done! latest.yml uploaded to $TAG"
