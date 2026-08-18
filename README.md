# LunarCore Claw

多模型智能体平台 · 本地优先 · 投资研究一体化

LunarCore Claw 是一个**本地优先**的桌面智能体平台：统一接入本地 Ollama 模型集群与云端 API 模型，内置 A 股投资研究全链路（持仓、日志、复盘、推演、回测、模拟盘、风控），并用 SHA-256 审计链保证每一次关键操作可追溯、不可篡改。

## 核心特性

**多模型协作**
- 本地 Ollama 多端点 + OpenAI 兼容 API 模型统一管理
- 聚合池：多模型并行调用、结果聚合
- 决策中心：多模型 ensemble 投票——结构化 JSON 投票 + 置信度加权共识，共识一键转推演
- 知识库接入：LLM Wiki / AnythingLLM / 自定义 REST

**投资研究链路（A 股）**
- 投资组合 / 交易日志 / 每日复盘：摊薄成本口径，实时行情联动
- 推演预测 + 预测基准：方向性推演锚定入场价上链，到期自动判定，三维校准命中率
- 模拟交易：10 种内置策略 × 标的 × 资金上限，A 股交易规则（整手、佣金、印花税），FIFO 回合统计
- 风险中心：集中度 / 止损 / 回撤 / 波动率四路红线监控
- 数据中心：行情、基本面、打板情绪、ETF 期权、新闻资讯多源聚合

**可审计性**
- 纯 TypeScript 实现的 SHA-256 append-only 哈希链（推演 / 台账 / 模拟 / 基准五条链）
- 任一历史记录被篡改，全链校验即刻报出断裂位置

**隐私与安全**
- 所有数据仅存本机（localStorage / 本机数据库）
- API Key 经 Electron safeStorage 加密存储，不落盘明文
- 实盘交易默认**观察级**：达标前无任何下单入口；明确不做高频、不做衍生品、不做外挂式自动化

## 技术栈

React 19 · TypeScript · Vite（单文件构建）· Tailwind CSS · shadcn/ui · Zustand · Electron 41 · Python 数据桥（akshare，可选）

## 快速开始

```bash
npm install
npm run dev        # 浏览器开发模式
npm start          # Electron 桌面模式（需先 npm run build）
```

## 打包 macOS 应用

```bash
npm run pack:mac   # 产出 release/LunarCore Claw-darwin-arm64/
```

分发前建议签名公证（需 Apple 开发者账号）：

```bash
bash scripts/check-signing-env.sh   # 环境预检
bash scripts/notarize.sh            # Developer ID 签名 + Apple 公证 + 票据装订
```

## 目录结构

```
src/            前端（页面、组件、状态、数据层）
electron/       Electron 主进程与 preload（IPC 桥、网络代理、密钥保管）
python/         akshare 数据桥（可选增强）
scripts/        打包、pkg、签名环境预检脚本
```

## License

[MIT](LICENSE) © 2026 LunarCore
