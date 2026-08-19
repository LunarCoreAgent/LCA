// 投资核心链路数据层：交易日志 / 持仓推导 / 推演预测 / 每日复盘（localStorage 持久化）
// 口径（对齐 v3.1.0 蓝图）：
//   摊薄成本 = (总买入金额 - 总卖出金额) / 剩余股数；成本为负标注「已回本」
//   方向性推演：创建时记录入场价并写入审计链，到期按收盘价判定 命中/未命中
import { uid } from './store'

// ===== 交易日志 =====
export interface TradeRec {
  id: string
  date: string          // 交易日期 YYYY-MM-DD
  code: string          // 完整代码，如 600519.SH
  name: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  fee: number           // 手续费+印花税合计（元）
  note: string
  createdAt: string
}

const TRADE_KEY = 'agentcore-trades-v1'

export function loadTrades(): TradeRec[] {
  try {
    const raw = localStorage.getItem(TRADE_KEY)
    return raw ? (JSON.parse(raw) as TradeRec[]) : []
  } catch {
    return []
  }
}

export function saveTrades(list: TradeRec[]) {
  localStorage.setItem(TRADE_KEY, JSON.stringify(list))
}

export function addTrade(t: Omit<TradeRec, 'id' | 'createdAt'>): TradeRec {
  const rec: TradeRec = { ...t, id: uid(), createdAt: new Date().toLocaleString('zh-CN', { hour12: false }) }
  saveTrades([rec, ...loadTrades()])
  return rec
}

export function deleteTrade(id: string) {
  saveTrades(loadTrades().filter((t) => t.id !== id))
}

// ===== 持仓推导 =====
export interface Position {
  code: string
  name: string
  buyAmt: number    // 总买入金额（含费）
  sellAmt: number   // 总卖出金额（扣费）
  buyQty: number
  sellQty: number
  netQty: number    // 剩余股数
  cost: number      // 摊薄成本 = (总买入-总卖出)/剩余股数；netQty=0 时为 0
  recovered: boolean // 成本为负 → 已回本
  netInvest: number // 净投入 = 总买入 - 总卖出
  firstDate: string
  lastDate: string
}

/** 由交易记录推导持仓（按代码聚合，不依赖 FIFO） */
export function derivePositions(trades: TradeRec[]): Position[] {
  const map = new Map<string, Position>()
  for (const t of trades) {
    const amt = t.price * t.qty
    let p = map.get(t.code)
    if (!p) {
      p = {
        code: t.code, name: t.name, buyAmt: 0, sellAmt: 0, buyQty: 0, sellQty: 0,
        netQty: 0, cost: 0, recovered: false, netInvest: 0, firstDate: t.date, lastDate: t.date,
      }
      map.set(t.code, p)
    }
    if (t.side === 'buy') {
      p.buyAmt += amt + t.fee
      p.buyQty += t.qty
    } else {
      p.sellAmt += amt - t.fee
      p.sellQty += t.qty
    }
    p.name = t.name || p.name
    if (t.date < p.firstDate) p.firstDate = t.date
    if (t.date > p.lastDate) p.lastDate = t.date
  }
  const out: Position[] = []
  for (const p of map.values()) {
    p.netQty = p.buyQty - p.sellQty
    p.netInvest = p.buyAmt - p.sellAmt
    p.cost = p.netQty > 0 ? p.netInvest / p.netQty : 0
    p.recovered = p.netQty > 0 && p.cost < 0
    if (p.netQty > 0 || p.buyQty > 0) out.push(p) // 清仓过的也保留在历史？仅保留仍有持仓或曾有买入的；清仓（netQty=0）不列入当前持仓
  }
  return out.filter((p) => p.netQty > 0).sort((a, b) => b.netInvest - a.netInvest)
}

/** 千分位完整金额 */
export const fmtMoney = (n: number) =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ===== 推演预测 =====
export type Direction = 'up' | 'down' | 'flat'
export type PredStatus = 'open' | 'hit' | 'miss'

export interface Prediction {
  id: string
  createdAt: string
  code: string
  name: string
  direction: Direction
  horizon: number        // 交易日数：5 / 10 / 20
  confidence: number     // 1-5
  thesis: string         // 推演依据
  entryPrice: number
  entryDate: string      // YYYY-MM-DD
  dueDate: string        // 到期日（按交易日顺延估算的日历日）
  status: PredStatus
  exitPrice?: number
  exitDate?: string
  retPct?: number        // 到期收益率 %
  evaluatedAt?: string
  auditHash?: string     // 创建时写入审计链的哈希（前 16 位展示）
}

const PRED_KEY = 'agentcore-predictions-v1'

export function loadPredictions(): Prediction[] {
  try {
    const raw = localStorage.getItem(PRED_KEY)
    return raw ? (JSON.parse(raw) as Prediction[]) : []
  } catch {
    return []
  }
}

export function savePredictions(list: Prediction[]) {
  localStorage.setItem(PRED_KEY, JSON.stringify(list))
}

export const DIRECTION_LABEL: Record<Direction, string> = { up: '看涨', down: '看跌', flat: '震荡' }

/** 命中阈值：方向性判定 ±1.5%，震荡带 ±2%（页面内明示口径） */
export const HIT_THRESHOLD = 1.5
export const FLAT_BAND = 2.0

export function judgePrediction(p: Prediction, retPct: number): PredStatus {
  if (p.direction === 'up') return retPct >= HIT_THRESHOLD ? 'hit' : 'miss'
  if (p.direction === 'down') return retPct <= -HIT_THRESHOLD ? 'hit' : 'miss'
  return Math.abs(retPct) <= FLAT_BAND ? 'hit' : 'miss'
}

/** 到期日估算：按交易日 ×1.5 近似日历日顺延 */
export function estimateDueDate(from: string, horizon: number): string {
  const d = new Date(from + 'T00:00:00')
  d.setDate(d.getDate() + Math.ceil(horizon * 1.5))
  return d.toISOString().slice(0, 10)
}

// ===== 每日复盘 =====
export interface DailyReviewRec {
  id: string
  date: string          // 复盘日期 YYYY-MM-DD
  createdAt: string
  text: string          // 复盘正文（Markdown 风格纯文本）
  auditHash?: string
}

const REVIEW_KEY = 'agentcore-dailyreviews-v1'

export function loadReviews(): DailyReviewRec[] {
  try {
    const raw = localStorage.getItem(REVIEW_KEY)
    return raw ? (JSON.parse(raw) as DailyReviewRec[]) : []
  } catch {
    return []
  }
}

export function saveReviews(list: DailyReviewRec[]) {
  localStorage.setItem(REVIEW_KEY, JSON.stringify(list.slice(0, 120))) // 保留最近 120 篇
}

export function addReview(date: string, text: string, auditHash?: string): DailyReviewRec {
  const rec: DailyReviewRec = {
    id: uid(), date, createdAt: new Date().toLocaleString('zh-CN', { hour12: false }), text, auditHash,
  }
  // 同日覆盖
  saveReviews([rec, ...loadReviews().filter((r) => r.date !== date)])
  return rec
}

export function deleteReview(id: string) {
  saveReviews(loadReviews().filter((r) => r.id !== id))
}
