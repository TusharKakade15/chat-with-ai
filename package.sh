#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DIST_DIR="$SCRIPT_DIR/dist"
ZIP_NAME="prism-v1.0.0.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

echo "=== Building PRISM Production Package for Chrome Web Store ==="

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

# Create clean zip excluding OS junk, git, demo, and markdown files
zip -r -q "$ZIP_PATH" \
  manifest.json \
  background.js \
  chat.html \
  chat.css \
  chat.js \
  content/shared.js \
  content/chatgpt.js \
  content/claude.js \
  content/gemini.js \
  icons/icon16.png \
  icons/icon32.png \
  icons/icon48.png \
  icons/icon128.png \
  -x "*.DS_Store" -x "__MACOSX*"

echo "✓ Created: $ZIP_PATH"
echo "=== Archive Contents ==="
unzip -l "$ZIP_PATH"
echo "========================"
echo "Package size: $(ls -lh "$ZIP_PATH" | awk '{print $5}')"
echo "Ready to upload to Chrome Developer Dashboard!"
