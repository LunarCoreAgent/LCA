// 研究剧本 Playbooks —— Vibe-Trading 的定时研究工作流思想
// 把「盘前瞭望 / 收盘复盘 / 持仓体检 / 因子巡检」固化为可重复执行的研究流程：
// 采集数据（自适应数据链）→ 组装上下文 → LLM 成稿或模板成稿 → 存档 + 审计链
import { fetchLiveQuotes, fetchDailyKline, loadWatchList, DEFAULT_WATCH } from './marketApi'
import { loadTrades, derivePositions, fmtMoney } from './trading'
import { f, forwardReturns } from './quantlib'
import { resolveModel, callOnce } from './ensemble'
import { appendRecord } from './auditLedger'
import { useStore } from './store'

export interface PlaybookReport {
  id: string
  playbookId: string
  title: string
  content: string
  model: string        // 成稿模型或「模板」
  createdAt: string
}

export interface Playbook {
  id: string
  name: string
  desc: string
  schedule: string                       // 建议 cron 表达式
  useLlm: boolean
  gather: () => Promise<string>          // 采集数据上下文
  prompt: (ctx: string) => string        // LLM 提示词
}

const REPORT_KEY = 'agentcore-playbook-reports-v1'

export function loadReports(): PlaybookReport[] {
  try {
    const raw = localStorage.getItem(REPORT_KEY)
    return raw ? (JSON.parse(raw) as PlaybookReport[]) : []
  } catch { return [] }
}

function saveReport(r: PlaybookReport) {
  const list = [r, ...loadReports()].slice(0, 30) // 只留最近 30 份
  try { localStorage.setItem(REPORT_KEY, JSON.stringify(list)) } catch { /* 满则忽略 */ }
}

export function deleteReport(id: string) {
  const list = loadReports().filter((r) => r.id !== id)
  localStorage.setItem(REPORT_KEY, JSON.stringify(list))
}

const quotesCtx = async (): Promise<string> => {
  const watch = loadWatchList(DEFAULT_WATCH)
  if (watch.length === 0) return '自选股为空。'
  const { quotes, failed } = await fetchLiveQuotes(watch.map((w) => w.code), () => 'manual')
  const lines = quotes.map((q) =>
    `${q.name}(${q.code}) 收 ${q.close} 涨跌 ${(q.pctChg * 100).toFixed(2)}% 换手 ${q.turnover.toFixed(2)}% 额 ${q.amountYi.toFixed(1)}亿`
  )
  return `【自选股行情 ${new Date().toISOString().slice(0, 10)}】\n${lines.join('\n')}${failed.length ? `\n(未能获取：${failed.join('、')})` : ''}`
}

const positionsCtx = async (): Promise<string> => {
  const trades = loadTrades()
  const pos = derivePositions(trades).filter((p) => p.netQty > 0)
  if (pos.length === 0) return '当前无实盘持仓记录。'
  const { quotes } = await fetchLiveQuotes(pos.map((p) => p.code), () => 'manual')
  const totalNet = pos.reduce((s, p) => s + p.netInvest, 0)
  const lines = pos.map((p) => {
    const q = quotes.find((x) => x.code === p.code)
    const mkt = q ? q.close * p.netQty : NaN
    const pnl = q ? (q.close - p.cost) * p.netQty : NaN
    const w = q && totalNet > 0 ? ((mkt / (quotes.reduce((s, x) => s + x.close * (pos.find((pp) => pp.code === x.code)?.netQty || 0), 0))) * 100) : NaN
    return `${p.name}(${p.code}) 持有 ${p.netQty} 股 摊薄成本 ${p.cost.toFixed(2)} 现价 ${q ? q.close : '—'} 浮动盈亏 ${Number.isNaN(pnl) ? '—' : fmtMoney(pnl)} 市值占比 ${Number.isNaN(w) ? '—' : w.toFixed(1) + '%'}`
  })
  return `【实盘持仓体检】净投入合计 ${fmtMoney(totalNet)}\n${lines.join('\n')}`
}

const factorCtx = async (): Promise<string> => {
  const watch = loadWatchList(DEFAULT_WATCH).slice(0, 10) // 控制请求量
  const out: string[] = []
  for (const w of watch) {
    try {
      const ks = await fetchDailyKline(w.code, 120)
      if (ks.length < 40) { out.push(`${w.name}(${w.code}) K线不足`); continue }
      const c = ks.map((k) => k.close)
      const last = (xs: number[]) => { const x = [...xs].reverse().find((n) => !Number.isNaN(n)); return x ?? NaN }
      const ma20 = f.sma(c, 20)
      const mom20 = last(f.roc(c, 20))
      const rsi = last(f.rsi(c, 14))
      const bias = Number.isNaN(last(ma20)) ? NaN : c[c.length - 1] / last(ma20) - 1
      const fwd = forwardReturns(c, 5)
      const validFwd = fwd.filter((x) => !Number.isNaN(x))
      const mdd = f.maxDrawdown(c.slice(-60)).mdd
      out.push(
        `${w.name}(${w.code}) 收 ${c[c.length - 1]} | 20日动量 ${(mom20 * 100).toFixed(1)}% | RSI ${rsi.toFixed(0)} | 乖离率 ${(bias * 100).toFixed(1)}% | 60日最大回撤 ${(mdd * 100).toFixed(1)}% | 近5日波动 ${(f.stdev(validFwd.slice(-5)) * 100).toFixed(2)}%`
      )
    } catch {
      out.push(`${w.name}(${w.code}) 行情拉取失败`)
    }
  }
  return `【因子巡检 ${new Date().toISOString().slice(0, 10)}】\n${out.join('\n')}`
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'pre-market', name: '盘前瞭望', desc: '每个交易日开盘前扫描自选股隔夜定位与量价状态，生成当日关注清单', schedule: '30 8 * * 1-5', useLlm: true,
    gather: quotesCtx,
    prompt: (ctx) => `${ctx}\n\n你是盘前研究助理。基于以上自选股最新行情，输出盘前瞭望简报（Markdown，不超过 400 字）：1) 隔夜异动标的（涨跌幅绝对值最大两只，说明可能驱动）；2) 今日重点关注（结合换手率与成交额）；3) 风险提示一条。只陈述数据可支持的内容，不编造新闻。`,
  },
  {
    id: 'close-review', name: '收盘复盘', desc: '收盘后汇总自选股表现，对照持仓生成当日复盘', schedule: '30 15 * * 1-5', useLlm: true,
    gather: async () => `${await quotesCtx()}\n\n${await positionsCtx()}`,
    prompt: (ctx) => `${ctx}\n\n你是复盘助理。基于以上行情与持仓，输出收盘复盘（Markdown，不超过 500 字）：1) 今日涨跌分布与领涨/领跌；2) 持仓盈亏变化归因（哪只贡献最大）；3) 处置效应自查：今天有没有想割亏损单/急着止盈盈利单的冲动，纪律建议一句。只基于给定数据，不编造。`,
  },
  {
    id: 'watch-health', name: '持仓体检', desc: '每周末检查实盘持仓的集中度、成本与浮动盈亏结构', schedule: '0 20 * * 5', useLlm: true,
    gather: positionsCtx,
    prompt: (ctx) => `${ctx}\n\n你是风控助理。基于以上持仓体检数据，输出报告（Markdown，不超过 400 字）：1) 集中度评价（单一标的市值占比 >30% 需点名）；2) 浮亏最深持仓的应对选项（不替用户做决定，列利弊）；3) 整体风险等级一句话。只基于给定数据。`,
  },
  {
    id: 'factor-scan', name: '因子巡检', desc: '每周一对自选股跑 quantlib 因子速览（动量/RSI/乖离率/回撤/波动）', schedule: '0 9 * * 1', useLlm: true,
    gather: factorCtx,
    prompt: (ctx) => `${ctx}\n\n你是量化研究助理。基于以上自选股因子速览（公式来自本地 quantlib），输出因子巡检（Markdown，不超过 500 字）：1) 动量最强/最弱各一只；2) RSI 超买(>70)或超卖(<30)标的；3) 乖离率极端标的（|乖离|>8% 提示回归风险）；4) 本周观察清单一句。只基于给定数据，不编造。`,
  },
]

/** 选择默认成稿模型：优先第一个 API 模型，否则第一个本地模型 */
function pickModel() {
  const s = useStore.getState()
  const api = s.apiModels[0]
  if (api) return resolveModel(api.id)
  const lm = s.localModels[0]
  if (lm) return resolveModel(lm.id)
  return null
}

export async function runPlaybook(pb: Playbook): Promise<PlaybookReport> {
  const ctx = await pb.gather()
  let content: string
  let modelLabel = '模板'
  const m = pb.useLlm ? pickModel() : null
  if (m) {
    content = await callOnce(m, pb.prompt(ctx))
    modelLabel = m.label
    if (!content.trim()) throw new Error('模型返回为空')
  } else {
    // 无可用模型时降级为数据直出，保证剧本始终可用
    content = `> 未配置可用模型，以下为原始数据直出（配置模型后可获得 AI 成稿）\n\n${ctx}`
  }
  const report: PlaybookReport = {
    id: `r${Date.now()}`,
    playbookId: pb.id,
    title: `${pb.name} · ${new Date().toLocaleString('zh-CN')}`,
    content,
    model: modelLabel,
    createdAt: new Date().toISOString(),
  }
  saveReport(report)
  appendRecord('audit', 'playbook.run', { playbook: pb.id, model: modelLabel, chars: content.length })
  return report
}
