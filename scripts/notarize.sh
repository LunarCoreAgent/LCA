#!/bin/bash
# LunarCore Claw · Apple Developer ID 签名 + 公证 + 装订票据
# 前置条件（一次性）：
#   1. Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application
#   2. appleid.apple.com 生成「App 专用密码」
#   3. 终端执行一次：xcrun notarytool store-credentials "LunarCoreNotary" --apple-id 你的邮箱 --team-id 你的团队ID
set -euo pipefail
clear
echo "=========================================="
echo "  LunarCore Claw · Developer ID 签名公证"
echo "=========================================="
echo ""

APP="${1:-/Applications/LunarCore Claw.app}"
PROFILE="LunarCoreNotary"

if [ ! -d "$APP" ]; then
  echo "✗ 找不到应用：$APP"
  echo "  用法：把 LunarCore Claw.app 拖到此脚本窗口，或先运行一键安装器"
  exit 1
fi
echo "目标应用: $APP"

echo "→ [1/6] 检查 Developer ID 证书..."
IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed -E 's/.*"(Developer ID Application: [^"]+)".*/\1/' || true)
if [ -z "${IDENTITY:-}" ]; then
  echo "✗ 未找到 Developer ID Application 证书"
  echo "  请打开 Xcode → Settings → Accounts → 选中你的账号 → Manage Certificates → 左下角 + → Developer ID Application"
  exit 1
fi
echo "    使用证书: $IDENTITY"

echo "→ [2/6] 检查公证凭证（keychain profile: $PROFILE）..."
if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "✗ 未配置公证凭证。请先在终端执行一次（会提示输入 App 专用密码）："
  echo ""
  echo "  xcrun notarytool store-credentials \"$PROFILE\" --apple-id 你的AppleID邮箱 --team-id 你的团队ID"
  echo ""
  echo "  团队ID 查看：developer.apple.com/account → Membership details → Team ID"
  echo "  App 专用密码：appleid.apple.com → 登录与安全 → App 专用密码"
  exit 1
fi
echo "    ✓ 凭证可用"

echo "→ [3/6] 生成强化运行时 entitlements..."
ENT=$(mktemp -t entitlements).plist
cat > "$ENT" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
</dict>
</plist>
EOF

echo "→ [4/6] 由内向外签名（框架 → 助手 → 主程序，hardened runtime + 时间戳）..."
find "$APP/Contents" -depth \( -name "*.dylib" -o -name "*.framework" \) | while read -r item; do
  codesign --force --sign "$IDENTITY" --options runtime --timestamp "$item" >/dev/null 2>&1 || true
done
find "$APP/Contents" -depth -name "*.app" | while read -r helper; do
  codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENT" "$helper"
done
codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENT" "$APP"
echo "    ✓ 签名完成，正在本地校验..."
codesign --verify --deep --strict --verbose=1 "$APP" 2>&1 | head -3

echo "→ [5/6] 上传 Apple 公证（通常 1-5 分钟，请耐心等待）..."
TMPD=$(mktemp -d)
ditto -c -k --keepParent "$APP" "$TMPD/notarize.zip"
xcrun notarytool submit "$TMPD/notarize.zip" --keychain-profile "$PROFILE" --wait

echo "→ [6/6] 装订公证票据 + Gatekeeper 终验..."
xcrun stapler staple "$APP"
spctl -a -vv "$APP"
rm -rf "$TMPD" "$ENT"

echo ""
echo "=========================================="
echo "✓ 全部完成！应用已获 Apple 官方公证："
echo "  · 任何 Mac 双击即开，无任何警告"
echo "  · 可自由分发给他人使用"
echo "=========================================="
