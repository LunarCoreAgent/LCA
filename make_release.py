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
    (f"{OUT}/LunarCore Claw一键安装.command", "LunarCore-Claw-0.12.0-mac-arm64-install.command"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.tar.xz", "LunarCore-Claw-0.12.0-mac-arm64.tar.xz"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.7z", "LunarCore-Claw-0.12.0-mac-arm64.7z"),
]

BODY = """LunarCore Claw v0.12.0 · macOS Apple Silicon (darwin-arm64)

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
install.command: 5e5edc42cef60bd42d309865df6be119caf00ce613e429625d3b9017b2f9c52b
tar.xz:          582551b13beb056be763b18608667500b8267a491fa4c0c623f39be345b4007a
7z:              7311f175bfb8484862861e153f672fde461ede06260feb25f3e203a275d4db53
```

## 本版变更（v0.12.0 · Vibe-Trading 融合二）

- 行为规则提取：闭合回合 + 买卖时点 20 日分位 → 六类 IF-THEN 模式（追高买入/低吸买入/恐慌割肉/快进止盈/亏损扛单/快速止损），样本 ≥3 定性赚钱/亏钱模式
- 影子回测：规则在历史 K 线机械重放，量化真人操作 vs 机械执行的盈亏差距（规避追高 / 恐慌单多拿 10 日 / 盈利单多拿 7 日 / 扛单改第 5 日止损）
- 影子账户一键完成追涨杀跌扫描、规则卡片、回测对比三段分析
- 上一版 v0.11.0：数据源自适应链（先验 + 健康度重排）+ 数据链路面板 + 影子账户行为诊断
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
    print("→ 创建 Release v0.12.0…")
    rel = req("POST", f"{API}/repos/{REPO}/releases", {
        "tag_name": "v0.12.0",
        "target_commitish": "main",
        "name": "LunarCore Claw v0.12.0",
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
    print(f"  https://github.com/{REPO}/releases/tag/v0.12.0")


if __name__ == "__main__":
    main()
