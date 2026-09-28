#!/bin/bash
# Build the macOS apps from Linux: package, ad-hoc sign the whole bundle, zip keeping symlinks.
set -e
cd "$(dirname "$0")/.."
node scripts/sync-app.js
V=$(node -p "require('./package.json').version")
for ARCH in arm64 x64; do
  npx electron-builder --mac dir --$ARCH --publish never
  D=dist/mac-$ARCH; [ "$ARCH" = "x64" ] && D=dist/mac
  rcodesign sign "$D/Corte Seco.app" > /dev/null
  (cd "$D" && rm -f "../Corte-Seco-$V-mac-$ARCH.zip" && zip -qry -y -9 "../Corte-Seco-$V-mac-$ARCH.zip" "Corte Seco.app")
  echo "ok $ARCH"
done
