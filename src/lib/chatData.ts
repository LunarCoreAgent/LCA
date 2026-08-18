// 对话数据调用层：发送消息时实时采集「行情采集 / 数据中心 / 量化回测 / QVeris」数据注入模型上下文
// - 勾选的域每次必带；未勾选的域按消息关键词智能触发
// - 任一域采集失败自动跳过，绝不阻塞对话

import { fetchDailyKline } from '@/lib/marketApi'
import {
  fetchAnnouncements, fetchFinNews, fetchMetals, fetchLimitOverview,
  fetchFundamentals, fetchOptionChain, fetchReports, fetchLhb, fetchMargin,
} from '@/lib/dataCenterApi'
import { STRATEGIES, runBacktest } from '@/lib/backtest'
import { qvDiscover, qvCall, qvResultToText, QVERIS_KEY_ID } from '@/lib/qveris'
import { getDsKey } from '@/lib/dataSources'

// ===== 可调用数据域 =====
export const DATA_DOMAINS = [
  { id: 'announce', label: '新闻公告', desc: '政策/出口管制/矿产/国际', kw: ['新闻', '公告', '政策', '出口管制', '矿产', '时事'] },
  { id: 'finnews', label: '金融新闻', desc: '国内国际财经+金银价格', kw: ['金价', '银价', '黄金', '白银', '财经新闻', '国际新闻', '外盘'] },
  { id: 'fund', label: '资金面', desc: '两融余额+龙虎榜', kw: ['两融', '融资', '融券', '龙虎榜', '杠杆资金'] },
  { id: 'basic', label: '基本面', desc: '自选股估值与财务', kw: ['估值', '基本面', '市盈率', '市净率', 'PE', 'PB', 'ROE', '财报', '毛利'] },
  { id: 'limit', label: '打板情绪', desc: '涨停池/连板梯队/炸板率', kw: ['涨停', '跌停', '打板', '连板', '炸板', '情绪', '龙头'] },
  { id: 'option', label: 'ETF期权', desc: '期权链希腊字母+IV', kw: ['期权', '认购', '认沽', '隐含波动率', 'IV', '希腊字母', '50ETF', '300ETF'] },
  { id: 'report', label: '研报', desc: '近30日券商研报', kw: ['研报', '评级', '目标价', '券商观点', 'EPS'] },
  { id: 'backtest', label: '回测策略', desc: '对提及标的跑策略回测', kw: ['回测', '策略', '夏普', '胜率', '最大回撤', '双均线', '布林', '动量'] },
  { id: 'qveris', label: 'QVeris', desc: '万级能力路由（按次计费）', kw: [] },
] as const
export type DataDomainId = (typeof DATA_DOMAINS)[number]['id']

export interface DataCallOpts {
  userText: string              // 用户消息原文（智能触发与 QVeris discover 用）
  domains: DataDomainId[]       // 用户勾选的必带域
  strategyId: string            // 回测策略 id
  codes: string[]               // 提及/自选标的（回测用，已归一化）
  qverisKey?: string            // QVeris Key（未传则自动从本机读取）
}

const DC_KEY = 'agentcore-chat-data-call'

export function loadDataCallCfg(): { domains: DataDomainId[]; strategyId: string } {
  try {
    const raw = localStorage.getItem(DC_KEY)
    if (raw) {
      const j = JSON.parse(raw)
      return { domains: Array.isArray(j.domains) ? j.domains : [], strategyId: j.strategyId || STRATEGIES[0].id }
    }
  } catch { /* 损坏配置回退默认 */ }
  return { domains: [], strategyId: STRATEGIES[0].id }
}
export function saveDataCallCfg(domains: DataDomainId[], strategyId: string): void {
  try { localStorage.setItem(DC_KEY, JSON.stringify({ domains, strategyId })) } catch { /* ignore */ }
}

// 关键词智能触发：返回消息命中但未被勾选的域
export function autoDomains(userText: string, selected: DataDomainId[]): DataDomainId[] {
  const hit: DataDomainId[] = []
  for (const d of DATA_DOMAINS) {
    if ((selected as string[]).includes(d.id) || d.kw.length === 0) continue
    if (d.kw.some((k) => userText.includes(k))) hit.push(d.id)
  }
  return hit
}

const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)

// ===== 各域采集与格式化（返回 null 表示无数据/失败，自动跳过）=====
async function domainText(id: DataDomainId, opts: DataCallOpts): Promise<string | null> {
  const now = new Date().toLocaleString('zh-CN', { hour12: false })
  switch (id) {
    case 'announce': {
      const g = await fetchAnnouncements()
      const pick = (arr: { title: string; time: string; source: string }[], n: number) => arr.slice(0, n).map((x) => `· ${x.title}（${x.source} ${x.time}）`).join('\n')
      const parts: string[] = []
      if (g.policy.length) parts.push('政策：\n' + pick(g.policy, 4))
      if (g.exportCtrl.length) parts.push('出口管制：\n' + pick(g.exportCtrl, 3))
      if (g.mineral.length) parts.push('矿产：\n' + pick(g.mineral, 3))
      if (g.intl.length) parts.push('国际：\n' + pick(g.intl, 4))
      return parts.length ? `【新闻公告 · ${now}】\n${cut(parts.join('\n'), 1400)}` : null
    }
    case 'finnews': {
      const [nw, metals] = await Promise.all([fetchFinNews(), fetchMetals().catch(() => [])])
      const parts: string[] = []
      if (metals.length) parts.push('金银实时：' + metals.map((m) => `${m.name} ${m.price}${m.unit}（${m.pct >= 0 ? '+' : ''}${m.pct}%）`).join('；'))
      if (nw.cn.length) parts.push('国内财经：\n' + nw.cn.slice(0, 4).map((x) => `· ${x.title}（${x.time}）`).join('\n'))
      if (nw.intl.length) parts.push('国际财经：\n' + nw.intl.slice(0, 4).map((x) => `· ${x.title}（${x.time}）`).join('\n'))
      return parts.length ? `【金融新闻 · ${now}】\n${cut(parts.join('\n'), 1200)}` : null
    }
    case 'fund': {
      const [mg, lhb] = await Promise.all([fetchMargin().catch(() => null), fetchLhb().catch(() => [])])
      const parts: string[] = []
      if (mg) parts.push(`两融（${mg.date}）：融资余额 ${mg.rzyeYi.toFixed(0)} 亿（日净买 ${mg.rzmreYi >= 0 ? '+' : ''}${mg.rzmreYi.toFixed(1)} 亿），融券余额 ${mg.rqyeYi.toFixed(1)} 亿`)
      if (lhb.length) parts.push('龙虎榜近5日净买额前列：\n' + lhb.slice(0, 6).map((x) => `· ${x.name}(${x.code}) 净买 ${x.netYi >= 0 ? '+' : ''}${x.netYi.toFixed(2)} 亿（${x.reason}，${x.date}）`).join('\n'))
      return parts.length ? `【资金面 · ${now}】\n${parts.join('\n')}` : null
    }
    case 'basic': {
      const rows = await fetchFundamentals()
      if (!rows.length) return null
      const body = rows.slice(0, 10).map((r) => `· ${r.name}(${r.code}) PE ${r.pe} PB ${r.pb} PS ${r.ps} 股息率 ${r.dv} ROE ${r.roe} 营收增速 ${r.rev} 净利增速 ${r.profit}（${r.reportDate}）`).join('\n')
      return `【基本面·自选股估值与财务 · ${now}】\n${cut(body, 1400)}`
    }
    case 'limit': {
      const o = await fetchLimitOverview()
      if (!o) return null
      const parts = [`${o.date} 涨停 ${o.zt} 家 / 跌停 ${o.dt} 家 / 炸板 ${o.zb} 家（炸板率 ${o.zbRate}%）/ 最高 ${o.height} 连板；昨涨停今均涨 ${o.yzAvg}%，晋级率 ${o.yzPromote}%`]
      if (o.ladder.length) parts.push('连板梯队：' + o.ladder.map((l) => `${l.level}（${l.stocks.join('、')}）`).join('；'))
      if (o.pool.length) parts.push('涨停池前列：\n' + o.pool.slice(0, 8).map((x) => `· ${x.name}(${x.code}) ${x.lbc > 1 ? `${x.lbc}连板` : '首板'} 封单${x.fundYi.toFixed(1)}亿 ${x.industry}`).join('\n'))
      return `【打板情绪 · ${now}】\n${cut(parts.join('\n'), 1000)}`
    }
    case 'option': {
      const rows = await fetchOptionChain('510050')
      if (!rows.length) return null
      const body = rows.slice(0, 8).map((o) => `· ${o.name}(${o.code}) ${o.cp} 最新 ${o.last}（${o.pct >= 0 ? '+' : ''}${o.pct}%）Delta ${o.delta ?? '-'} IV ${o.iv != null ? o.iv + '%' : '-'} 持仓 ${o.oi}`).join('\n')
      return `【ETF期权·50ETF主力合约 · ${now}】\n${cut(body, 1000)}`
    }
    case 'report': {
      const rows = await fetchReports()
      if (!rows.length) return null
      const body = rows.slice(0, 8).map((r) => `· 《${r.title}》${r.org} ${r.rating}${r.target ? ` 目标价${r.target}` : ''}（${r.date}）`).join('\n')
      return `【券商研报·近30日 · ${now}】\n${cut(body, 1200)}`
    }
    case 'backtest': {
      const strategy = STRATEGIES.find((x) => x.id === opts.strategyId) ?? STRATEGIES[0]
      const codes = opts.codes.slice(0, 3)
      if (!codes.length) return null
      const lines: string[] = []
      for (const code of codes) {
        try {
          const ks = await fetchDailyKline(code, 250)
          const r = runBacktest(ks, strategy)
          if (r) {
            const bench = ((r.equity[r.equity.length - 1]?.bench ?? 100) - 100).toFixed(2)
            lines.push(`· ${code}（近${ks.length}交易日）：策略收益 ${r.totalRet >= 0 ? '+' : ''}${r.totalRet}%（基准 ${bench}%），年化 ${r.annualRet >= 0 ? '+' : ''}${r.annualRet}%，最大回撤 ${r.mdd}%，夏普 ${r.sharpe}，胜率 ${r.winRate}%（${r.trades.length}笔），盈亏比 ${r.profitFactor}`)
          } else {
            lines.push(`· ${code}：K线数据不足，无法回测`)
          }
        } catch { lines.push(`· ${code}：回测数据拉取失败`) }
      }
      return lines.length ? `【量化回测 · 策略「${strategy.name}」· 信号次日开盘成交·含费用 · ${now}】\n${lines.join('\n')}\n（历史回测不代表未来收益）` : null
    }
    case 'qveris': {
      const key = opts.qverisKey ?? getDsKey(QVERIS_KEY_ID)
      if (!key) return null
      // 用用户问题发现最相关能力，取其示例参数直接调用（失败即跳过）
      const disc = await qvDiscover(key, opts.userText, 3)
      const tool = disc.results?.[0]
      if (!tool?.tool_id) return null
      const params = tool.examples?.sample_parameters ?? {}
      const r = await qvCall(key, tool.tool_id, disc.search_id, params)
      return `【QVeris 能力调用 · ${now}】\n${qvResultToText(tool.name || tool.tool_id, r)}`
    }
    default:
      return null
  }
}

// ===== 主入口：组装数据调用上下文 =====
export async function buildDataCallContext(opts: DataCallOpts): Promise<{ text: string; used: string[] }> {
  const auto = autoDomains(opts.userText, opts.domains)
  const all = [...opts.domains, ...auto]
  if (all.length === 0) return { text: '', used: [] }
  const settled = await Promise.allSettled(all.map(async (id) => ({ id, text: await domainText(id, opts) })))
  const blocks: string[] = []
  const used: string[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value.text) {
      blocks.push(r.value.text)
      const d = DATA_DOMAINS.find((x) => x.id === r.value.id)
      used.push(`${d?.label ?? r.value.id}${auto.includes(r.value.id) ? '·自动' : ''}`)
    }
  }
  return { text: blocks.join('\n\n'), used }
}
