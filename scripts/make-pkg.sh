#!/bin/bash
# 由已签名的 .app 生成 .pkg 安装包，并完成公证 + stapler 贴票
# 前提: 已执行 npm run dist:mac 产出签名版 .app，且钥匙串有 Developer ID Installer 证书
# 用法: bash scripts/make-pkg.sh [path/to/LunarCore Claw.app]
set -euo pipefail

VERSION="$(node -p "require('./package.json').version")"
APP_PATH="${1:-release/mac-arm64/LunarCore Claw.app}"
PKG_UNSIGNED="release/LunarCoreClaw-${VERSION}-unsigned.pkg"
PKG_FINAL="release/LunarCoreClaw-${VERSION}-arm64.pkg"
INSTALLER_SIGN_IDENTITY="${INSTALLER_SIGN_IDENTITY:-Developer ID Installer}"

[ -d "$APP_PATH" ] || { echo "找不到 $APP_PATH，请先执行 npm run dist:mac"; exit 1; }

echo "==> [1/4] pkgbuild 打包"
STAGE="$(mktemp -d)/pkgroot"
mkdir -p "$STAGE"
cp -R "$APP_PATH" "$STAGE/LunarCore Claw.app"
pkgbuild \
  --root "$STAGE" \
  --identifier "com.lunarcore.claw" \
  --version "$VERSION" \
  --install-location "/Applications" \
  "$PKG_UNSIGNED"

echo "==> [2/4] productsign 签名（$INSTALLER_SIGN_IDENTITY）"
productsign --sign "$INSTALLER_SIGN_IDENTITY" "$PKG_UNSIGNED" "$PKG_FINAL"
rm -f "$PKG_UNSIGNED"

echo "==> [3/4] notarytool 公证（通常 1~5 分钟）"
xcrun notarytool submit "$PKG_FINAL" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait

echo "==> [4/4] stapler 贴票"
xcrun stapler staple "$PKG_FINAL"

echo ""
echo "完成: $PKG_FINAL"
echo "验证: pkgutil --check-signature \"$PKG_FINAL\""
