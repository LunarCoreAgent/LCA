#!/bin/bash
# LunarCore Claw 跨平台打包：Windows x64 / Linux x64 / macOS x64(Intel)
# macOS arm64 由 package-mac.sh 负责；本脚本覆盖其余三个目标。
# 产物（$OUT_DIR，默认 pack-out-cross）：
#   LunarCore Claw-windows-x64.zip        Windows 绿色版（解压即用）
#   LunarCore Claw-linux-x64.tar.xz       Linux 绿色版
#   LunarCore Claw-darwin-x64.tar.xz      macOS Intel 版
set -euo pipefail

APP_NAME="LunarCore Claw"
VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="${OUT_DIR:-pack-out-cross}"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || true)"
if [ -z "$ELECTRON_VERSION" ]; then
  ELECTRON_VERSION="$(node -p "require('./package.json').devDependencies.electron" | tr -d '^~')"
fi
echo "==> 版本 v${VERSION} / Electron ${ELECTRON_VERSION}"
echo "==> [1/3] 构建前端"
npm run build

STAGE="$(mktemp -d)/stage"
mkdir -p "$STAGE"
cp -R dist "$STAGE/dist"
cp -R electron "$STAGE/electron"
cp package.json "$STAGE/package.json"

mkdir -p "$OUT_DIR"

pack_one() {
  local platform="$1" arch="$2" icon="$3"
  echo "==> [2/3] electron-packager ${platform}/${arch}"
  npx electron-packager "$STAGE" "$APP_NAME" \
    --platform="$platform" --arch="$arch" \
    --electron-version="$ELECTRON_VERSION" \
    --icon="$icon" \
    --app-bundle-id="com.lunarcore.claw" \
    --app-version="$VERSION" --build-version="$VERSION" \
    --asar --overwrite --out="$OUT_DIR" --prune=true
  local dir="$OUT_DIR/$APP_NAME-$platform-$arch"
  # Python 数据桥：win/linux 在 resources/，darwin 在 Contents/Resources/
  if [ "$platform" = "darwin" ]; then
    cp -R python "$dir/$APP_NAME.app/Contents/Resources/python"
    if [ -f build/icon.icns ]; then
      cp build/icon.icns "$dir/$APP_NAME.app/Contents/Resources/icon.icns"
      python3 -c "
import plistlib
f = '$dir/$APP_NAME.app/Contents/Resources/../Info.plist'
p = plistlib.load(open(f, 'rb'))
p['CFBundleIconFile'] = 'icon.icns'
plistlib.dump(p, open(f, 'wb'))
"
    fi
  else
    cp -R python "$dir/resources/python"
  fi
}

pack_one linux x64 build/icon.png
pack_one darwin x64 build/icon.icns
pack_one win32 x64 build/icon.ico

rm -rf "$(dirname "$STAGE")"

echo "==> [3/3] 压缩打包"
cd "$OUT_DIR"
python3 - "$APP_NAME" << 'PYEOF'
import os, sys, zipfile
app = sys.argv[1]
src = f"{app}-win32-x64"
out = f"{app}-windows-x64.zip"
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(src):
        for fn in files:
            p = os.path.join(root, fn)
            z.write(p, os.path.relpath(p, src))
print(f"    {out}: {os.path.getsize(out)//1024//1024}MB")
PYEOF
tar -cJf "$APP_NAME-linux-x64.tar.xz" "$APP_NAME-linux-x64"
tar -cJf "$APP_NAME-darwin-x64.tar.xz" "$APP_NAME-darwin-x64"

echo ""
echo "完成："
ls -lh "$APP_NAME-windows-x64.zip" "$APP_NAME-linux-x64.tar.xz" "$APP_NAME-darwin-x64.tar.xz"
