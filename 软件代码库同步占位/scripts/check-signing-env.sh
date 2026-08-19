#!/bin/bash
# 签名环境预检：在 Mac 上出正式包之前先跑一遍
# 用法: bash scripts/check-signing-env.sh
set -uo pipefail

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
hint() { echo "    → $1"; }

echo "=========================================="
echo "  LunarCore Claw 签名环境预检"
echo "=========================================="

echo ""
echo "[1] 基础工具"
if [ "$(uname -s)" = "Darwin" ]; then ok "macOS $(sw_vers -productVersion)"; else bad "当前不是 macOS（签名打包必须在 Mac 上进行）"; fi
if xcode-select -p >/dev/null 2>&1; then ok "Xcode 命令行工具已安装"; else bad "缺少 Xcode CLT"; hint "xcode-select --install"; fi
if command -v node >/dev/null 2>&1; then ok "Node $(node -v)"; else bad "未安装 Node"; fi

echo ""
echo "[2] 签名证书（钥匙串）"
APP_CERT=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1)
if [ -n "$APP_CERT" ]; then
  ok "找到应用签名证书: $(echo "$APP_CERT" | sed 's/.*"\(.*\)"/\1/')"
else
  bad "未找到 Developer ID Application 证书"
  hint "开发者账号审批通过后, 到 developer.apple.com/account/resources/certificates 创建并下载"
fi
INS_CERT=$(security find-identity -v -p basic 2>/dev/null | grep "Developer ID Installer" | head -1)
if [ -n "$INS_CERT" ]; then
  ok "找到安装包签名证书（.pkg 用）"
else
  echo "  - 暂无 Developer ID Installer 证书（只出 DMG 可不要，出 .pkg 才需要）"
fi

echo ""
echo "[3] 公证凭据（notarytool）"
[ -n "${APPLE_ID:-}" ]                  && ok "APPLE_ID 已设置"                  || { bad "未设置 APPLE_ID（你的 Apple ID 邮箱）"; hint "export APPLE_ID=you@example.com"; }
[ -n "${APPLE_TEAM_ID:-}" ]             && ok "APPLE_TEAM_ID 已设置"             || { bad "未设置 APPLE_TEAM_ID（10 位团队 ID）"; hint "在 developer.apple.com/account 的 Membership 页面查看"; }
[ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && ok "APPLE_APP_SPECIFIC_PASSWORD 已设置" || { bad "未设置 APP 专用密码"; hint "到 appleid.apple.com → 登录与安全 → App 专用密码 生成"; }

echo ""
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
  echo "  全部就绪，可以执行: npm run dist:mac"
else
  echo "  有 $FAIL 项待处理，按上面提示补齐后再打包"
fi
echo "=========================================="
exit 0
