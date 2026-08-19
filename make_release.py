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
    (f"{OUT}/LunarCore Claw一键安装.command", "LunarCore-Claw-0.11.0-mac-arm64-install.command"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.tar.xz", "LunarCore-Claw-0.11.0-mac-arm64.tar.xz"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.7z", "LunarCore-Claw-0.11.0-mac-arm64.7z"),
]

BODY = """LunarCore Claw v0.11.0 · macOS Apple Silicon (darwin-arm64)

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
install.command: 832b6b3de54b24ebc0a408966369e30cf78d019e922e07dff9b97c2e6a14e50e
tar.xz:          d86058652e24e063c94b3dd356f1bd5f253550119a5049e08f4a1de1658a9e06
7z:              9583918d39186b5489cad580a8a366a1c53cc0aec05a286838e18f72aaf3ea77
```

## 本版变更（v0.11.0 · Vibe-Trading 融合一）

- 数据源链式降级升级：先验顺序（低封禁风险在前）+ 健康度自适应重排，连续失败自动降权、恢复自动回升
- 新增「数据链路」面板：三条链的顺序 / 健康分 / 成功率 / 耗时 / 最近错误，支持主动探测与一键清空
- 新增「影子账户·行为诊断」：交易日志 FIFO 配对闭合回合，胜率 / 盈亏比 / 处置效应 / 报复性交易 / 过度交易，0-100 行为纪律分
- 追涨杀跌扫描：买卖时点的近 20 日区间分位，识别追高买入与恐慌割肉
- 思路来源：HKUDS/Vibe-Trading（MIT）23 源降级链与 Shadow Account
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
    print("→ 创建 Release v0.11.0…")
    rel = req("POST", f"{API}/repos/{REPO}/releases", {
        "tag_name": "v0.11.0",
        "target_commitish": "main",
        "name": "LunarCore Claw v0.11.0",
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
    print(f"  https://github.com/{REPO}/releases/tag/v0.11.0")


if __name__ == "__main__":
    main()
