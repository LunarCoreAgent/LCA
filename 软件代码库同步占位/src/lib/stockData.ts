// 行情数据类型与信号判定（出厂空数据，内容由真实行情源拉取/计算）
export interface Quote {
  code: string
  name: string
  preClose: number
  open: number
  high: number
  low: number
  close: number
  pctChg: number
  volumeWan: number   // 成交量（万手，由股数换算近似）
  amountYi: number    // 成交额（亿元）
  turnover: number    // 换手率 %
  freq: string        // 采集频率
  points: number      // 今日已采集数据点
  collecting: boolean
}

// 出厂空数据：监控列表由用户添加后从真实行情源拉取
export const QUOTES: Quote[] = []

// 实时技术指标（iFinD realtime_tech，2026-07-17 15:00，5min）
export interface TechRow {
  code: string
  name: string
  ma5: number
  ma20: number
  rsi6: number
  rsi12: number
  dif: number
  dea: number
  macd: number
  k: number
  d: number
  j: number
  bollMid: number
  bollUp: number
  bollDn: number
  cci: number
  close: number
}

// 出厂空数据：指标由真实日 K 实时计算
export const TECH: TechRow[] = []

// 由真实 OHLC 生成当日分时序列（5min，48 点）
export function intraday(q: Quote) {
  const pts: { t: string; price: number }[] = []
  let price = q.open
  let seed = q.code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
  const n = 48
  for (let i = 0; i < n; i++) {
    const remain = n - 1 - i
    const drift = remain > 0 ? (q.close - price) / remain : 0
    price = Math.min(q.high, Math.max(q.low, price + drift + (rand() - 0.5) * (q.high - q.low) * 0.12))
    const hh = 9 + Math.floor((i * 5 + 30) / 60)
    const mm = (i * 5 + 30) % 60
    pts.push({ t: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, price: +price.toFixed(2) })
  }
  pts[n - 1].price = q.close
  return pts
}

// 信号判定（基于真实指标）
export function signals(t: TechRow) {
  const out: { text: string; tone: 'green' | 'red' | 'amber' }[] = []
  if (t.rsi6 < 20) out.push({ text: 'RSI6 严重超卖', tone: 'green' })
  else if (t.rsi6 < 30) out.push({ text: 'RSI6 超卖', tone: 'green' })
  else if (t.rsi6 > 80) out.push({ text: 'RSI6 超买', tone: 'red' })
  if (t.close < t.bollDn) out.push({ text: '跌破布林下轨', tone: 'green' })
  else if (t.close > t.bollUp) out.push({ text: '突破布林上轨', tone: 'red' })
  if (t.dif > t.dea && t.macd < 0) out.push({ text: 'MACD 将金叉', tone: 'amber' })
  if (t.dif < t.dea && t.macd > 0) out.push({ text: 'MACD 将死叉', tone: 'amber' })
  if (t.j < 0) out.push({ text: 'KDJ-J 值触底', tone: 'green' })
  if (t.cci < -100) out.push({ text: 'CCI 深度负值', tone: 'green' })
  if (t.close > t.ma5 && t.ma5 > t.ma20) out.push({ text: '短期多头', tone: 'red' })
  if (out.length === 0) out.push({ text: '中性震荡', tone: 'amber' })
  return out
}
