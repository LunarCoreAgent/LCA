// 量化回测引擎：10 个经典策略模型 + 日频回测（T+1 开盘价成交，含手续费与印花税）
// 策略覆盖：趋势（双均线/海龟/多头排列）、均值回归（布林/RSI/CCI）、动量、多因子打分
import type { KPoint } from './marketApi'

export interface Strategy {
  id: string
  name: string
  desc: string
  hold: (ks: KPoint[]) => boolean[] // 逐日持仓信号（与 ks 等长，true=当日收盘后持有）
}

// ===== 指标序列 =====
const closes = (ks: KPoint[]) => ks.map((k) => k.close)

function maSeries(xs: number[], n: number): (number | null)[] {
  return xs.map((_, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let j = i - n + 1; j <= i; j++) sum += xs[j]
    return sum / n
  })
}

function emaSeries(xs: number[], n: number): number[] {
  const a = 2 / (n + 1)
  const out: number[] = []
  let prev = 0
  xs.forEach((x, i) => { prev = i === 0 ? x : a * x + (1 - a) * prev; out.push(prev) })
  return out
}

function smaCn(xs: number[], n: number, m = 1): number[] {
  const out: number[] = []
  let prev = 0
  xs.forEach((x, i) => { prev = i === 0 ? x : (x * m + prev * (n - m)) / n; out.push(prev) })
  return out
}

function rsiSeries(cs: number[], n: number): number[] {
  const up = cs.map((c, i) => (i === 0 ? 0 : Math.max(c - cs[i - 1], 0)))
  const ab = cs.map((c, i) => (i === 0 ? 0 : Math.abs(c - cs[i - 1])))
  const su = smaCn(up, n, 1)
  const sa = smaCn(ab, n, 1)
  return cs.map((_, i) => (sa[i] === 0 ? 50 : (su[i] / sa[i]) * 100))
}

function macdSeries(cs: number[]): { dif: number[]; dea: number[] } {
  const e12 = emaSeries(cs, 12)
  const e26 = emaSeries(cs, 26)
  const dif = e12.map((v, i) => v - e26[i])
  return { dif, dea: emaSeries(dif, 9) }
}

function kdjSeries(ks: KPoint[]): { k: number[]; d: number[] } {
  const rsv = ks.map((x, i) => {
    const from = Math.max(0, i - 8)
    let hh = -Infinity, ll = Infinity
    for (let j = from; j <= i; j++) { hh = Math.max(hh, ks[j].high); ll = Math.min(ll, ks[j].low) }
    return hh === ll ? 50 : ((x.close - ll) / (hh - ll)) * 100
  })
  const k = smaCn(rsv, 3, 1)
  return { k, d: smaCn(k, 3, 1) }
}

function bollSeries(cs: number[], n = 20, mult = 2): { mid: (number | null)[]; up: (number | null)[]; dn: (number | null)[] } {
  const mid = maSeries(cs, n)
  return {
    mid,
    up: mid.map((m, i) => {
      if (m == null) return null
      let v = 0
      for (let j = i - n + 1; j <= i; j++) v += (cs[j] - m) ** 2
      return m + mult * Math.sqrt(v / n)
    }),
    dn: mid.map((m, i) => {
      if (m == null) return null
      let v = 0
      for (let j = i - n + 1; j <= i; j++) v += (cs[j] - m) ** 2
      return m - mult * Math.sqrt(v / n)
    }),
  }
}

function cciSeries(ks: KPoint[], n = 14): (number | null)[] {
  const tp = ks.map((x) => (x.high + x.low + x.close) / 3)
  return tp.map((_, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let j = i - n + 1; j <= i; j++) sum += tp[j]
    const m = sum / n
    let md = 0
    for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m)
    md /= n
    return md === 0 ? 0 : (tp[i] - m) / (0.015 * md)
  })
}

function rollingMax(xs: number[], n: number): (number | null)[] {
  return xs.map((_, i) => {
    if (i < n) return null
    let m = -Infinity
    for (let j = i - n; j < i; j++) m = Math.max(m, xs[j]) // 前 n 日（不含当日）
    return m
  })
}
function rollingMin(xs: number[], n: number): (number | null)[] {
  return xs.map((_, i) => {
    if (i < n) return null
    let m = Infinity
    for (let j = i - n; j < i; j++) m = Math.min(m, xs[j])
    return m
  })
}

// 状态机：enter 置仓、exit 平仓、否则延续前一日
function stateful(ks: KPoint[], enter: (i: number) => boolean, exit: (i: number) => boolean): boolean[] {
  const out: boolean[] = []
  let cur = false
  for (let i = 0; i < ks.length; i++) {
    if (enter(i)) cur = true
    else if (exit(i)) cur = false
    out.push(cur)
  }
  return out
}

// ===== 10 个策略模型 =====
export const STRATEGIES: Strategy[] = [
  {
    id: 'ma-cross', name: '双均线交叉', desc: 'MA5 上穿 MA20 买入、下穿卖出（趋势跟踪，附件策略 1）',
    hold: (ks) => {
      const c = closes(ks); const m5 = maSeries(c, 5); const m20 = maSeries(c, 20)
      return ks.map((_, i) => m5[i] != null && m20[i] != null && (m5[i] as number) > (m20[i] as number))
    },
  },
  {
    id: 'boll-revert', name: '布林带回归', desc: '跌破下轨买入、回到中轨上方卖出（均值回归，附件策略 2）',
    hold: (ks) => {
      const c = closes(ks); const b = bollSeries(c)
      return stateful(ks,
        (i) => b.dn[i] != null && c[i] < (b.dn[i] as number),
        (i) => b.mid[i] != null && c[i] > (b.mid[i] as number))
    },
  },
  {
    id: 'momentum-20', name: '动量择时', desc: '20 日动量为正持有、转负离场（相对强弱，附件策略 3 单标的版）',
    hold: (ks) => {
      const c = closes(ks)
      return ks.map((_, i) => i >= 20 && c[i] > c[i - 20])
    },
  },
  {
    id: 'turtle', name: '海龟突破', desc: '突破 20 日高点入场、跌破 10 日低点离场（附件策略 4）',
    hold: (ks) => {
      const c = closes(ks); const hh = rollingMax(c, 20); const ll = rollingMin(c, 10)
      return stateful(ks,
        (i) => hh[i] != null && c[i] > (hh[i] as number),
        (i) => ll[i] != null && c[i] < (ll[i] as number))
    },
  },
  {
    id: 'multi-factor', name: '多因子打分', desc: '动量+趋势+低波动代理因子综合打分 > 0.5 持有（附件策略 5 行情代理版；PE/PB/ROE 财务因子需接入财务数据源）',
    hold: (ks) => {
      const c = closes(ks); const m20 = maSeries(c, 20)
      return ks.map((_, i) => {
        if (i < 60) return false
        const mom = (c[i] - c[i - 20]) / c[i - 20] // 20 日动量
        const trend = m20[i] != null && c[i] > (m20[i] as number) ? 1 : 0 // 站上 20 日线
        let v = 0
        for (let j = i - 19; j <= i; j++) v += Math.abs((c[j] - c[j - 1]) / c[j - 1])
        const lowVol = 1 - Math.min(1, (v / 20) / 0.03) // 低波动得分
        const composite = (mom > 0 ? 0.4 : 0) + trend * 0.3 + lowVol * 0.3
        return composite > 0.5
      })
    },
  },
  {
    id: 'macd-cross', name: 'MACD 金叉', desc: 'DIF 上穿 DEA 持有、下穿卖出（趋势确认）',
    hold: (ks) => {
      const { dif, dea } = macdSeries(closes(ks))
      return ks.map((_, i) => i > 0 && dif[i] > dea[i])
    },
  },
  {
    id: 'rsi-revert', name: 'RSI 超卖反弹', desc: 'RSI14 < 30 买入、> 55 止盈（超卖反弹）',
    hold: (ks) => {
      const r = rsiSeries(closes(ks), 14)
      return stateful(ks, (i) => r[i] < 30, (i) => r[i] > 55)
    },
  },
  {
    id: 'kdj-cross', name: 'KDJ 金叉', desc: 'K 线上穿 D 线持有、下穿卖出（摆动指标）',
    hold: (ks) => {
      const { k, d } = kdjSeries(ks)
      return ks.map((_, i) => k[i] > d[i])
    },
  },
  {
    id: 'cci-break', name: 'CCI 突破', desc: 'CCI 上穿 -100 买入、下穿 +100 卖出（顺势突破）',
    hold: (ks) => {
      const cci = cciSeries(ks)
      return stateful(ks,
        (i) => cci[i] != null && i > 0 && (cci[i - 1] ?? -Infinity) < -100 && (cci[i] as number) >= -100,
        (i) => cci[i] != null && i > 0 && (cci[i - 1] ?? Infinity) > 100 && (cci[i] as number) <= 100)
    },
  },
  {
    id: 'ma-bull', name: '均线多头排列', desc: 'MA5>MA10>MA20 多头排列持有、破坏卖出（趋势强化）',
    hold: (ks) => {
      const c = closes(ks); const m5 = maSeries(c, 5); const m10 = maSeries(c, 10); const m20 = maSeries(c, 20)
      return ks.map((_, i) => m5[i] != null && m10[i] != null && m20[i] != null && (m5[i] as number) > (m10[i] as number) && (m10[i] as number) > (m20[i] as number))
    },
  },
]

// ===== 回测引擎 =====
export interface Trade {
  buyDate: string; buyPrice: number
  sellDate: string; sellPrice: number
  ret: number // 单笔收益率（含费用）
  days: number
}

export interface BacktestResult {
  equity: { date: string; strategy: number; bench: number }[]
  trades: Trade[]
  totalRet: number   // 总收益率 %
  annualRet: number  // 年化 %（250 交易日）
  mdd: number        // 最大回撤 %
  sharpe: number
  winRate: number    // %
  profitFactor: number
  exposure: number   // 持仓时间占比 %
}

const FEE = 0.00025   // 佣金万 2.5（双边）
const STAMP = 0.0005  // 印花税 0.05%（卖出）

export function runBacktest(ks: KPoint[], strategy: Strategy): BacktestResult | null {
  if (ks.length < 40) return null
  const hold = strategy.hold(ks)
  const eq: BacktestResult['equity'] = []
  const trades: Trade[] = []
  let nav = 1
  let bench = 1
  let holding = false
  let buyPrice = 0
  let buyDate = ''
  let buyIdx = 0
  const rets: number[] = []
  let prevNav = 1

  for (let i = 1; i < ks.length; i++) {
    // 昨日信号 → 今日开盘成交
    if (hold[i - 1] && !holding) {
      holding = true; buyPrice = ks[i].open; buyDate = ks[i].date; buyIdx = i
      nav *= 1 - FEE
    } else if (!hold[i - 1] && holding) {
      holding = false
      const sellPrice = ks[i].open
      nav *= (sellPrice / buyPrice) * (1 - FEE - STAMP)
      trades.push({ buyDate, buyPrice: +buyPrice.toFixed(2), sellDate: ks[i].date, sellPrice: +sellPrice.toFixed(2), ret: +(((sellPrice / buyPrice) * (1 - FEE - STAMP) / (1 - FEE) - 1) * 100).toFixed(2), days: i - buyIdx })
    }
    if (holding) nav *= ks[i].close / ks[i - 1].close
    bench *= ks[i].close / ks[i - 1].close
    rets.push(nav / prevNav - 1)
    prevNav = nav
    eq.push({ date: ks[i].date, strategy: +(nav * 100).toFixed(2), bench: +(bench * 100).toFixed(2) })
  }
  // 期末仍持仓：按最后收盘价平仓记账（仅统计用）
  if (holding) {
    const sellPrice = ks[ks.length - 1].close
    trades.push({ buyDate, buyPrice: +buyPrice.toFixed(2), sellDate: ks[ks.length - 1].date, sellPrice: +sellPrice.toFixed(2), ret: +(((sellPrice / buyPrice) - 1) * 100).toFixed(2), days: ks.length - 1 - buyIdx })
  }

  const totalRet = (nav - 1) * 100
  const years = ks.length / 250
  const annualRet = years > 0 ? (Math.pow(nav, 1 / years) - 1) * 100 : 0
  let peak = 1, mdd = 0
  for (const p of eq) { peak = Math.max(peak, p.strategy); mdd = Math.min(mdd, (p.strategy / peak - 1) * 100) }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length)
  const sharpe = sd > 0 ? +((mean / sd) * Math.sqrt(250)).toFixed(2) : 0
  const wins = trades.filter((t) => t.ret > 0)
  const grossWin = wins.reduce((a, t) => a + t.ret, 0)
  const grossLoss = Math.abs(trades.filter((t) => t.ret <= 0).reduce((a, t) => a + t.ret, 0))
  const exposure = (hold.filter(Boolean).length / hold.length) * 100

  return {
    equity: eq, trades,
    totalRet: +totalRet.toFixed(2), annualRet: +annualRet.toFixed(2),
    mdd: +mdd.toFixed(2), sharpe,
    winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    exposure: +exposure.toFixed(1),
  }
}

// ===== 量化报告生成（Markdown，推送对话页 / 可复制）=====
export function buildReport(opts: {
  name: string; code: string; strategy: Strategy; r: BacktestResult
  start: string; end: string; days: number
}): string {
  const { name, code, strategy, r, start, end, days } = opts
  const lines = [
    `## 量化回测报告 · ${name}（${code}）`,
    ``,
    `- 策略模型：**${strategy.name}** —— ${strategy.desc}`,
    `- 回测区间：${start} ~ ${end}（${days} 个交易日，前复权日 K）`,
    `- 成交假设：信号次日开盘价成交，佣金万 2.5 双边 + 印花税 0.05%，单向做多`,
    ``,
    `### 绩效指标`,
    `| 指标 | 策略 | 基准（买入持有） |`,
    `|---|---|---|`,
    `| 总收益率 | **${r.totalRet >= 0 ? '+' : ''}${r.totalRet}%** | ${((r.equity[r.equity.length - 1]?.bench ?? 100) - 100).toFixed(2)}% |`,
    `| 年化收益率 | ${r.annualRet >= 0 ? '+' : ''}${r.annualRet}% | — |`,
    `| 最大回撤 | ${r.mdd}% | — |`,
    `| 夏普比率 | ${r.sharpe} | — |`,
    `| 胜率 | ${r.winRate}%（${r.trades.length} 笔） | — |`,
    `| 盈亏比 | ${r.profitFactor} | — |`,
    `| 持仓时间占比 | ${r.exposure}% | — |`,
    ``,
  ]
  if (r.trades.length > 0) {
    lines.push(`### 交易明细（最近 ${Math.min(10, r.trades.length)} 笔）`)
    lines.push(`| 买入 | 卖出 | 收益率 | 持有天数 |`)
    lines.push(`|---|---|---|---|`)
    for (const t of r.trades.slice(-10)) {
      lines.push(`| ${t.buyDate} @ ${t.buyPrice} | ${t.sellDate} @ ${t.sellPrice} | ${t.ret >= 0 ? '+' : ''}${t.ret}% | ${t.days} |`)
    }
    lines.push(``)
  }
  lines.push(`### 风险提示`)
  lines.push(`历史回测不代表未来收益。该策略在${r.mdd < -15 ? '回撤较深，需严格控制仓位' : '回撤可控'}；建议结合基本面与大盘环境使用，实盘前先小资金验证。`)
  return lines.join('\n')
}
