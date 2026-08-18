#!/bin/bash
# LunarCore Claw macOS 正式打包脚本
# 产物: release/LunarCore Claw-darwin-arm64/LunarCore Claw.app
# 用法: npm run pack:mac
set -euo pipefail

APP_NAME="LunarCore Claw"
BUNDLE_ID="com.lunarcore.claw"
VERSION="$(node -p "require('./package.json').version")"
# 输出目录（可用环境变量覆盖；注意 .app 打包需要支持符号链接的文件系统）
OUT_DIR="${OUT_DIR:-release}"
ICON="build/icon.icns"

# Electron 二进制下载镜像（可用环境变量覆盖）
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

echo "==> [1/4] 构建前端 (tsc + vite)"
npm run build

echo "==> [2/4] 准备暂存目录（仅打包运行必需文件，自动过滤源码与开发依赖）"
STAGE="$(mktemp -d)/stage"
mkdir -p "$STAGE"
cp -R dist "$STAGE/dist"
cp -R electron "$STAGE/electron"
cp package.json "$STAGE/package.json"

ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || true)"
if [ -z "$ELECTRON_VERSION" ]; then
  ELECTRON_VERSION="$(node -p "require('./package.json').devDependencies.electron" | tr -d '^~')"
fi

echo "==> [3/4] electron-packager 打包"
echo "    版本 v${VERSION} / Electron ${ELECTRON_VERSION} / darwin-arm64 / ASAR 开启"
npx electron-packager "$STAGE" "$APP_NAME" \
  --platform=darwin \
  --arch=arm64 \
  --electron-version="$ELECTRON_VERSION" \
  --icon="$ICON" \
  --app-bundle-id="$BUNDLE_ID" \
  --app-version="$VERSION" \
  --build-version="$VERSION" \
  --asar \
  --overwrite \
  --out="$OUT_DIR"

# Python 数据桥脚本拷入 Resources（asar 之外，供主进程 spawn 执行）
cp -R python "$OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app/Contents/Resources/python"
echo "    已附 Python 数据桥: Resources/python/ak_bridge.py"

# 自定义图标兜底植入（electron-packager 部分版本 --icon 静默回退默认 electron.icns）
if [ -f "$ICON" ]; then
  cp "$ICON" "$OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app/Contents/Resources/icon.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon.icns" "$OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string icon.icns" "$OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app/Contents/Info.plist" 2>/dev/null \
    || python3 -c "
import plistlib
f = '$OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app/Contents/Info.plist'
p = plistlib.load(open(f, 'rb'))
p['CFBundleIconFile'] = 'icon.icns'
plistlib.dump(p, open(f, 'wb'))
"
  echo "    已植入自定义图标: Resources/icon.icns"
fi

echo "==> [4/4] 清理暂存"
rm -rf "$(dirname "$STAGE")"

echo ""
echo "完成: $OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app"
echo "提示: 未签名包首次打开需 右键 -> 打开；分发请另行配置签名与公证。"
