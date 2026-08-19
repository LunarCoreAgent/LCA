#!/usr/bin/env python3
"""创建 GitHub Release 并上传安装包资产。
用法: GITHUB_TOKEN=<token> python3 make_release.py
"""
import json
import os
import sys
import urllib.request

REPO = "LunarCoreAgent/LCA"
API = "https://api.github.com"
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
if not TOKEN:
    sys.exit("缺少 GITHUB_TOKEN")

OUT = "/mnt/agents/output"
ASSETS = [
    (f"{OUT}/LunarCore Claw一键安装.command", "LunarCore-Claw-0.13.0-mac-arm64-install.command"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.tar.xz", "LunarCore-Claw-0.13.0-mac-arm64.tar.xz"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.7z", "LunarCore-Claw-0.13.0-mac-arm64.7z"),
]

BODY = """LunarCore Claw v0.13.0 · macOS Apple Silicon (darwin-arm64)

多模型智能体平台：本地优先 · 投资研究一体化 · SHA-256 审计链。

## 安装（三选一）

| 文件 | 说明 |
|---|---|
| `install.command` | **推荐**：下载后双击（或右键→打开），自动完成解压/安装/本机签名/启动 |
| `.tar.xz` | 手动解压，把 LunarCore Claw.app 拖入「应用程序」 |
| `.7z` | 同上，需 Keka / The Unarchiver 解压 |

首次打开如遇安全提示：右键 → 打开。分发给他人请用 `scripts/notarize.sh` 做 Developer ID 公证。

## 完整性校验（SHA-256）

```
install.command: aa307c909875963121cef32792082603f1203305d643b7a8715e8c84ce9a1e55
tar.xz:          fcc9a8da05b8a19eafc13801c256ab2ba6b31c13ef9338945094d107e4f54e44
7z:              83459f49d0e5451e7ac560ffdd699abe4bedec5e36b351954047d39eca110190
```

## 本版变更（v0.13.0 · Vibe-Trading 融合三）

- 本地 TypeScript 量化函数库 quantlib：收益/风险/统计/均线/动量约 30 个纯函数，页面与 Agent 共用同一套公式
- 公式自检：12 项已知输入断言，因子工场页面实时展示自检状态，未过自检的公式不上页面
- 新增「因子工场」：任意标的日 K × 9 个经典因子，与前瞻 5 日收益对账 IC / 秩 IC / ICIR / IC>0 占比，自动判读有效/反向/噪声
- 前两版：v0.11.0 数据源自适应链 + 影子账户行为诊断；v0.12.0 行为规则提取 + 影子回测
"""


def req(method, url, payload=None, raw=None, ctype=None):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "LunarCoreClaw-Release",
    }
    data = raw
    if payload is not None:
        data = json.dumps(payload).encode()
    if ctype:
        headers["Content-Type"] = ctype
    r = urllib.request.Request(url, method=method, headers=headers, data=data)
    with urllib.request.urlopen(r, timeout=600) as resp:
        body = resp.read()
        return json.loads(body) if body else {}


def main():
    print("→ 创建 Release v0.13.0…")
    rel = req("POST", f"{API}/repos/{REPO}/releases", {
        "tag_name": "v0.13.0",
        "target_commitish": "main",
        "name": "LunarCore Claw v0.13.0",
        "body": BODY,
        "draft": False,
        "prerelease": False,
    })
    rid = rel["id"]
    print(f"  release id: {rid}")

    for src, name in ASSETS:
        size = os.path.getsize(src)
        print(f"→ 上传 {name}（{size/1024/1024:.1f}MB）…")
        with open(src, "rb") as f:
            data = f.read()
        url = f"https://uploads.github.com/repos/{REPO}/releases/{rid}/assets?name={name}"
        req("POST", url, raw=data, ctype="application/octet-stream")
        print(f"  ✓ {name}")

    print()
    print("✓ Release 发布完成！")
    print(f"  https://github.com/{REPO}/releases/tag/v0.13.0")


if __name__ == "__main__":
    main()
