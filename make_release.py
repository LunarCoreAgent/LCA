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
    (f"{OUT}/LunarCore Claw一键安装.command", "LunarCore-Claw-0.10.2-mac-arm64-install.command"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.tar.xz", "LunarCore-Claw-0.10.2-mac-arm64.tar.xz"),
    (f"{OUT}/LunarCore Claw-macOS-arm64.7z", "LunarCore-Claw-0.10.2-mac-arm64.7z"),
]

BODY = """LunarCore Claw v0.10.2 · macOS Apple Silicon (darwin-arm64)

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
install.command: 5b6d45aa5681d0b7245a2f69c23db4e86df408c5288fa5f6889598f772ddd48f
tar.xz:          9f30ce7f3190828ce96ea77a4593d9b2bb66390b1908a340fa39b53b246e7f15
7z:              13625f29906199db1711985efe50d9f4115c6a89eab1e332a39d0726d29464da
```

## 本版变更

- 实盘网关页面隐藏（代码保留，可恢复）；观察期标准与模拟盘数据不受影响
- 品牌更名 LunarCore Agent → LunarCore Claw，含数据目录自动迁移
- v0.10.0 模拟盘 · 风险中心 · 决策中心 ensemble · 实盘网关观察级
- v0.9.0 投资核心链路：持仓 / 日志 / 复盘 / 推演 / 基准 / 审计链
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
    print("→ 创建 Release v0.10.2…")
    rel = req("POST", f"{API}/repos/{REPO}/releases", {
        "tag_name": "v0.10.2",
        "target_commitish": "main",
        "name": "LunarCore Claw v0.10.2",
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
    print(f"  https://github.com/{REPO}/releases/tag/v0.10.2")


if __name__ == "__main__":
    main()
