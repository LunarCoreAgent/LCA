// 模拟交易引擎：策略绑定 → 日级信号扫描 → 虚拟成交 → 配对盈亏统计 → 权益曲线
// 定位：实盘前的「观察级模拟账本」。日级信号、不做高频；标的限正股/ETF 代码，不做衍生品
// 所有信号与成交写入审计链「模拟交易」(paper)，供实盘网关切换标准对账
import { uid } from './store'
import { STRATEGIES } from './backtest'
import { fetchDailyKline } from './marketApi'
import { appendRecord } from './auditLedger'

export interface PaperTrade {
  id: string
  date: string          // YYYY-MM-DD（信号日，按当日收盘价成交）
  time: string
  code: string
  name: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  fee: number
  assignId: string      // 来源策略绑定
  reason: string        // 信号说明
}

export interface PaperAssignment {
  id: string
  strategyId: string    // STRATEGIES id
  code: string
  name: string
  alloc: number         // 该绑定最大占用资金
  enabled: boolean
  lastSignal?: 'hold' | 'flat'
  lastScan?: string
}

export interface PaperAccount {
  initialCash: number
  cash: number
  feeRate: number       // 佣金率（默认万 2.5，最低 5 元）
  stampTax: number      // 印花税（卖出，默认万 5）
  trades: PaperTrade[]
  assignments: PaperAssignment[]
  createdAt: string
}

const PAPER_KEY = 'agentcore-paper-v1'
const EQUITY_KEY = 'agentcore-paper-equity-v1'

export function defaultAccount(): PaperAccount {
  return {
    initialCash: 1000000, cash: 1000000,
    feeRate: 0.00025, stampTax: 0.0005,
    trades: [], assignments: [],
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
}

export function loadPaper(): PaperAccount {
  try {
    const raw = localStorage.getItem(PAPER_KEY)
    if (!raw) return defaultAccount()
    const acc = JSON.parse(raw) as PaperAccount
    return { ...defaultAccount(), ...acc, trades: acc.trades ?? [], assignments: acc.assignments ?? [] }
  } catch {
    return defaultAccount()
  }
}

export function savePaper(acc: PaperAccount) {
  localStorage.setItem(PAPER_KEY, JSON.stringify(acc))
}

/** 重置模拟盘（清空成交与绑定，资金回到初始） */
export function resetPaper(initialCash = 1000000) {
  const acc = { ...defaultAccount(), initialCash, cash: initialCash }
  savePaper(acc)
  localStorage.removeItem(EQUITY_KEY)
  appendRecord('paper', 'paper.reset', { initialCash })
  return acc
}

// ===== 持仓推导（按绑定隔离：同一标的不同策略各算各的仓位） =====
export interface PaperPosition {
  assignId: string
  code: string
  name: string
  qty: number
  avgCost: number     // 买入均价（含费摊入）
  invested: number    // 当前占用资金
}

export function paperPositions(acc: PaperAccount): PaperPosition[] {
  const map = new Map<string, PaperPosition>()
  for (const t of acc.trades) {
    let p = map.get(t.assignId)
    if (!p) {
      p = { assignId: t.assignId, code: t.code, name: t.name, qty: 0, avgCost: 0, invested: 0 }
      map.set(t.assignId, p)
    }
    if (t.side === 'buy') {
      const total = p.invested + t.price * t.qty + t.fee
      p.qty += t.qty
      p.invested = total
      p.avgCost = p.qty > 0 ? total / p.qty : 0
    } else {
      const ratio = p.qty > 0 ? t.qty / p.qty : 0
      p.invested = p.invested * (1 - ratio)
      p.qty -= t.qty
      if (p.qty <= 0) { p.qty = 0; p.invested = 0 }
    }
  }
  return [...map.values()].filter((p) => p.qty > 0)
}

// ===== 配对盈亏统计（FIFO 闭合回合） =====
export interface RoundTrip { code: string; name: string; qty: number; buyPrice: number; sellPrice: number; pnl: number; retPct: number; openDate: string; closeDate: string }

export function roundTrips(acc: PaperAccount): RoundTrip[] {
  const byCode = new Map<string, PaperTrade[]>()
  for (const t of [...acc.trades].sort((a, b) => a.time.localeCompare(b.time))) {
    const arr = byCode.get(t.code) ?? []
    arr.push(t)
    byCode.set(t.code, arr)
  }
  const trips: RoundTrip[] = []
  for (const [code, arr] of byCode) {
    const queue: PaperTrade[] = [] // 未闭合买入
    for (const t of arr) {
      if (t.side === 'buy') queue.push(t)
      else {
        let remain = t.qty
        while (remain > 0 && queue.length) {
          const b = queue[0]
          const take = Math.min(remain, b.qty)
          const pnl = (t.price - b.price) * take - b.fee * (take / b.qty) - t.fee * (take / t.qty)
          trips.push({
            code, name: t.name, qty: take, buyPrice: b.price, sellPrice: t.price,
            pnl: +pnl.toFixed(2), retPct: +(((t.price - b.price) / b.price) * 100).toFixed(2),
            openDate: b.date, closeDate: t.date,
          })
          remain -= take
          if (take >= b.qty) queue.shift()
          else queue[0] = { ...b, qty: b.qty - take }
        }
      }
    }
  }
  return trips
}

export interface PaperStats {
  closedTrades: number     // 已闭合回合数（切换标准的「笔数」口径）
  winRate: number | null   // %
  profitFactor: number | null // 盈亏比 = 平均盈利 / 平均亏损（绝对值）
  totalPnl: number
  firstTradeDate: string | null
  observedDays: number     // 观察天数（首笔至今）
  maxDrawdown: number | null // 权益曲线最大回撤 %
}

export function paperStats(acc: PaperAccount): PaperStats {
  const trips = roundTrips(acc)
  const wins = trips.filter((t) => t.pnl > 0)
  const losses = trips.filter((t) => t.pnl <= 0)
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0
  const eq = loadEquity()
  let maxDrawdown: number | null = null
  if (eq.length >= 2) {
    let peak = eq[0].total
    let mdd = 0
    for (const p of eq) {
      if (p.total > peak) peak = p.total
      const dd = ((peak - p.total) / peak) * 100
      if (dd > mdd) mdd = dd
    }
    maxDrawdown = +mdd.toFixed(2)
  }
  const first = acc.trades.length ? [...acc.trades].sort((a, b) => a.time.localeCompare(b.time))[0].date : null
  const observedDays = first ? Math.max(1, Math.round((Date.now() - new Date(first + 'T00:00:00').getTime()) / 86400000)) : 0
  return {
    closedTrades: trips.length,
    winRate: trips.length ? +((wins.length / trips.length) * 100).toFixed(1) : null,
    profitFactor: trips.length && avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : wins.length ? Infinity : null,
    totalPnl: +trips.reduce((a, t) => a + t.pnl, 0).toFixed(2),
    firstTradeDate: first,
    observedDays,
    maxDrawdown,
  }
}

// ===== 权益曲线（每次扫描追加快照） =====
export interface EquityPoint { date: string; cash: number; posValue: number; total: number }

export function loadEquity(): EquityPoint[] {
  try {
    return JSON.parse(localStorage.getItem(EQUITY_KEY) ?? '[]') as EquityPoint[]
  } catch {
    return []
  }
}

export function appendEquity(p: EquityPoint) {
  const list = loadEquity().filter((x) => x.date !== p.date)
  list.push(p)
  list.sort((a, b) => a.date.localeCompare(b.date))
  localStorage.setItem(EQUITY_KEY, JSON.stringify(list.slice(-250)))
}

// ===== 信号扫描与执行 =====
export interface ScanResult {
  assignId: string
  code: string
  name: string
  action: 'buy' | 'sell' | 'hold-skip' | 'flat-skip' | 'error'
  detail: string
  trade?: PaperTrade
}

const today = () => new Date().toISOString().slice(0, 10)

/** 运行一轮信号扫描：对每个启用的绑定取 250 日 K 线，按策略最新信号执行虚拟成交 */
export async function runPaperScan(acc: PaperAccount): Promise<{ acc: PaperAccount; results: ScanResult[] }> {
  const out: ScanResult[] = []
  const positions = paperPositions(acc)
  const posByAssign = new Map(positions.map((p) => [p.assignId, p]))
  let cash = acc.cash
  const newTrades: PaperTrade[] = []

  for (const a of acc.assignments.filter((x) => x.enabled)) {
    const strat = STRATEGIES.find((x) => x.id === a.strategyId)
    if (!strat) { out.push({ assignId: a.id, code: a.code, name: a.name, action: 'error', detail: '策略不存在' }); continue }
    try {
      const ks = await fetchDailyKline(a.code, 250)
      if (ks.length < 30) { out.push({ assignId: a.id, code: a.code, name: a.name, action: 'error', detail: 'K 线数据不足（<30 日）' }); continue }
      const holdArr = strat.hold(ks)
      const hold = holdArr[holdArr.length - 1]
      const last = ks[ks.length - 1]
      const pos = posByAssign.get(a.id)
      a.lastSignal = hold ? 'hold' : 'flat'
      a.lastScan = today()

      if (hold && !pos) {
        // 开仓：alloc 上限内按当前价折股（A股 100 股整手，其他市场按 1 股）
        const lot = /\.(SH|SZ|BJ)$/.test(a.code) ? 100 : 1
        let qty = Math.floor(Math.min(a.alloc, cash * 0.98) / last.close / lot) * lot
        if (qty <= 0) { out.push({ assignId: a.id, code: a.code, name: a.name, action: 'error', detail: `资金不足：可用 ¥${cash.toFixed(0)}，单价 ${last.close}` }); continue }
        const fee = Math.max(5, +(last.close * qty * acc.feeRate).toFixed(2))
        cash -= last.close * qty + fee
        const t: PaperTrade = {
          id: uid(), date: last.date, time: new Date().toLocaleString('zh-CN', { hour12: false }),
          code: a.code, name: a.name, side: 'buy', price: last.close, qty, fee,
          assignId: a.id, reason: `${strat.name} 信号转多（${last.date} 收盘 ${last.close}）`,
        }
        newTrades.push(t)
        appendRecord('paper', 'paper.buy', { code: a.code, strategy: strat.name, price: t.price, qty: t.qty, date: t.date })
        out.push({ assignId: a.id, code: a.code, name: a.name, action: 'buy', detail: `${t.reason}，买入 ${qty} 股`, trade: t })
      } else if (!hold && pos && pos.qty > 0) {
        const qty = pos.qty
        const fee = Math.max(5, +(last.close * qty * acc.feeRate).toFixed(2))
        const tax = +(last.close * qty * acc.stampTax).toFixed(2)
        cash += last.close * qty - fee - tax
        const t: PaperTrade = {
          id: uid(), date: last.date, time: new Date().toLocaleString('zh-CN', { hour12: false }),
          code: a.code, name: a.name, side: 'sell', price: last.close, qty, fee: +(fee + tax).toFixed(2),
          assignId: a.id, reason: `${strat.name} 信号转空（${last.date} 收盘 ${last.close}）`,
        }
        newTrades.push(t)
        appendRecord('paper', 'paper.sell', { code: a.code, strategy: strat.name, price: t.price, qty: t.qty, date: t.date })
        out.push({ assignId: a.id, code: a.code, name: a.name, action: 'sell', detail: `${t.reason}，卖出 ${qty} 股`, trade: t })
      } else {
        out.push({ assignId: a.id, code: a.code, name: a.name, action: hold ? 'hold-skip' : 'flat-skip', detail: `信号${hold ? '持有' : '空仓'}延续，无操作（${last.date} 收盘 ${last.close}）` })
      }
    } catch (e) {
      out.push({ assignId: a.id, code: a.code, name: a.name, action: 'error', detail: '行情获取失败：' + (e as Error).message })
    }
  }

  const next: PaperAccount = { ...acc, cash: +cash.toFixed(2), trades: [...acc.trades, ...newTrades] }
  savePaper(next)
  return { acc: next, results: out }
}
