// 影子账户·行为诊断 —— 灵感来自 Vibe-Trading Shadow Account（MIT © HKU Data Science Lab）
// 全部基于本机交易日志推导，纯函数、无网络。Vibe-Trading 思路：行为 → 规则 → 影子回测（回测在 v0.12.0）
import { loadTrades, type TradeRec } from './trading'

export interface RoundTrip {
  code: string
  name: string
  buyDate: string
  sellDate: string
  qty: number
  buyAmt: number       // 摊配到本次卖出的买入金额（含费）
  sellAmt: number      // 卖出到账（扣费）
  pnl: number
  ret: number          // 收益率
  holdDays: number
  win: boolean
}

export interface BehaviorReport {
  trips: RoundTrip[]
  closedPnl: number
  winRate: number
  profitFactor: number | null   // 总盈利/总亏损
  avgWinRet: number
  avgLossRet: number
  avgHoldWin: number            // 盈利单平均持有天数
  avgHoldLoss: number           // 亏损单平均持有天数
  disposition: number | null    // 处置效应强度 = avgHoldLoss - avgHoldWin（正=亏拿太久）
  tradesPerMonth: number
  revengeCount: number          // 亏损卖出后 5 个自然日内再次买入同票（报复性交易）
  monthly: { month: string; pnl: number }[]
  score: number                 // 0-100 行为分
  verdicts: { level: 'good' | 'warn' | 'bad'; text: string }[]
}

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000))

/** FIFO 配对成闭合回合：买队列按时间序，卖出从队首摊配 */
export function roundTrips(trades: TradeRec[]): RoundTrip[] {
  const byCode = new Map<string, TradeRec[]>()
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  for (const t of sorted) {
    const arr = byCode.get(t.code) || []
    arr.push(t)
    byCode.set(t.code, arr)
  }
  const trips: RoundTrip[] = []
  for (const [code, arr] of byCode) {
    const queue: { date: string; qty: number; unit: number }[] = [] // unit = 每股摊入成本(含费)
    for (const t of arr) {
      if (t.side === 'buy') {
        queue.push({ date: t.date, qty: t.qty, unit: (t.price * t.qty + t.fee) / Math.max(t.qty, 1e-9) })
      } else {
        let remain = t.qty
        let buyAmt = 0
        let buyDate = t.date
        while (remain > 1e-9 && queue.length > 0) {
          const head = queue[0]
          const use = Math.min(remain, head.qty)
          buyAmt += use * head.unit
          buyDate = head.date
          head.qty -= use
          remain -= use
          if (head.qty <= 1e-9) queue.shift()
        }
        if (buyAmt <= 0) continue // 无对应买入（历史持仓卖出），跳过
        const sellAmt = t.price * t.qty - t.fee
        const coveredRatio = (t.qty - remain) / Math.max(t.qty, 1e-9)
        const allocSell = sellAmt * coveredRatio
        const pnl = allocSell - buyAmt
        trips.push({
          code, name: t.name,
          buyDate, sellDate: t.date, qty: t.qty - remain,
          buyAmt, sellAmt: allocSell, pnl,
          ret: pnl / buyAmt,
          holdDays: daysBetween(buyDate, t.date),
          win: pnl > 0,
        })
      }
    }
  }
  return trips.sort((a, b) => b.sellDate.localeCompare(a.sellDate))
}

export function diagnose(trades: TradeRec[]): BehaviorReport {
  const trips = roundTrips(trades)
  const wins = trips.filter((t) => t.win)
  const losses = trips.filter((t) => !t.win)
  const closedPnl = trips.reduce((s, t) => s + t.pnl, 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  const avgHoldWin = avg(wins.map((t) => t.holdDays))
  const avgHoldLoss = avg(losses.map((t) => t.holdDays))
  const disposition = trips.length >= 4 ? avgHoldLoss - avgHoldWin : null

  // 交易频率
  const dates = trades.map((t) => t.date).sort()
  const spanDays = dates.length >= 2 ? Math.max(daysBetween(dates[0], dates[dates.length - 1]), 1) : 30
  const tradesPerMonth = trades.length / Math.max(spanDays / 30.44, 0.5)

  // 报复性交易：亏损卖出后 5 个自然日内买入同一只
  let revengeCount = 0
  for (const trip of losses) {
    const reBuy = trades.some(
      (t) => t.code === trip.code && t.side === 'buy' && t.date >= trip.sellDate && daysBetween(trip.sellDate, t.date) <= 5
    )
    if (reBuy) revengeCount++
  }

  // 月度盈亏
  const mm = new Map<string, number>()
  for (const t of trips) {
    const m = t.sellDate.slice(0, 7)
    mm.set(m, (mm.get(m) || 0) + t.pnl)
  }
  const monthly = [...mm.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, pnl]) => ({ month, pnl }))

  // 行为分 & 评语
  const verdicts: BehaviorReport['verdicts'] = []
  let score = 100
  if (trips.length === 0) {
    verdicts.push({ level: 'warn', text: '还没有闭合的买卖回合，先记几笔完整交易再来诊断。' })
    score = 60
  } else {
    const winRate = wins.length / trips.length
    if (winRate >= 0.55) verdicts.push({ level: 'good', text: `胜率 ${(winRate * 100).toFixed(0)}%，超过 55% —— 选股择时总体有效。` })
    else if (winRate < 0.4) { score -= 15; verdicts.push({ level: 'bad', text: `胜率仅 ${(winRate * 100).toFixed(0)}%，低于 40% —— 入场信号需要重新审视。` }) }
    const pf = grossLoss > 0 ? grossWin / grossLoss : null
    if (pf !== null && pf >= 1.8) verdicts.push({ level: 'good', text: `盈亏比 ${pf.toFixed(2)}，大赚小赔结构健康。` })
    else if (pf !== null && pf < 1) { score -= 15; verdicts.push({ level: 'bad', text: `盈亏比 ${pf.toFixed(2)} < 1，赢小亏大 —— 止盈太急或止损太晚。` }) }
    if (disposition !== null && disposition > 5) { score -= 20; verdicts.push({ level: 'bad', text: `处置效应明显：亏损单平均拿 ${avgHoldLoss.toFixed(0)} 天，盈利单只拿 ${avgHoldWin.toFixed(0)} 天 —— 截断亏损、让利润奔跑。` }) }
    else if (disposition !== null && disposition < -3) verdicts.push({ level: 'good', text: '亏损单离场快于盈利单，纪律性好。' })
    if (tradesPerMonth > 20) { score -= 15; verdicts.push({ level: 'bad', text: `月均 ${tradesPerMonth.toFixed(0)} 笔交易，过度交易倾向 —— 手续费与冲动成本在侵蚀收益。` }) }
    if (revengeCount > 0) { score -= 10 * Math.min(revengeCount, 3); verdicts.push({ level: 'warn', text: `检测到 ${revengeCount} 次"亏损后 5 日内买回同票"，疑似报复性交易。` }) }
    if (verdicts.length === 0) verdicts.push({ level: 'good', text: '样本内未发现显著行为偏差，继续保持。' })
  }
  score = Math.max(0, Math.min(100, score))

  return {
    trips, closedPnl,
    winRate: trips.length ? wins.length / trips.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWinRet: avg(wins.map((t) => t.ret)),
    avgLossRet: avg(losses.map((t) => t.ret)),
    avgHoldWin, avgHoldLoss, disposition,
    tradesPerMonth, revengeCount, monthly, score, verdicts,
  }
}

export function diagnoseFromStorage(): BehaviorReport {
  return diagnose(loadTrades())
}

/** 追涨杀跌检测：看买入/卖出日收盘在近 20 日区间的分位（需行情，异步） */
export interface ChaseItem { trip: RoundTrip; buyPct: number | null; sellPct: number | null; chase: boolean; panic: boolean }
export async function chasePanicAnalysis(
  trips: RoundTrip[],
  klineFetcher: (code: string) => Promise<{ date: string; close: number }[]>
): Promise<ChaseItem[]> {
  const out: ChaseItem[] = []
  const cache = new Map<string, { date: string; close: number }[]>()
  const recent = trips.slice(0, 20) // 只分析最近 20 个回合，控制请求量
  for (const trip of recent) {
    try {
      if (!cache.has(trip.code)) cache.set(trip.code, await klineFetcher(trip.code))
      const bars = cache.get(trip.code) || []
      const pctOf = (date: string): number | null => {
        const idx = bars.findIndex((b) => b.date >= date)
        if (idx < 0) return null
        const win = bars.slice(Math.max(0, idx - 19), idx + 1)
        const closes = win.map((b) => b.close)
        const lo = Math.min(...closes)
        const hi = Math.max(...closes)
        if (hi - lo < 1e-9) return 0.5
        return (bars[idx].close - lo) / (hi - lo)
      }
      const buyPct = pctOf(trip.buyDate)
      const sellPct = pctOf(trip.sellDate)
      out.push({
        trip, buyPct, sellPct,
        chase: buyPct !== null && buyPct > 0.8,   // 买在 20 日区间 80% 分位以上 = 追高
        panic: sellPct !== null && sellPct < 0.2 && !trip.win, // 割在 20% 分位以下 = 恐慌
      })
    } catch {
      out.push({ trip, buyPct: null, sellPct: null, chase: false, panic: false })
    }
  }
  return out
}
