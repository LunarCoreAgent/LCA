// 影子账户·规则提取与影子回测 —— Vibe-Trading Shadow Account 的第二阶段思想
// 规则提取：从闭合回合 + 买卖时点的 20 日分位中挖掘可复现模式（IF-THEN）
// 影子回测：把规则机械地在历史 K 线上重放，对比「真人操作 vs 机械执行」的盈亏差距
import type { RoundTrip, ChaseItem } from './shadow'

export interface RuleFinding {
  id: string
  title: string        // 规则名（IF 条件）
  condition: string    // 条件的可读描述
  conclusion: string   // THEN 结论
  support: number      // 样本数
  winRate: number
  avgRet: number
  sumPnl: number
  profitable: boolean | null  // true=赚钱模式 false=亏钱模式 null=样本不足
}

export interface ShadowSim {
  id: string
  label: string        // 机械执行的规则
  detail: string       // 模拟口径
  affected: number     // 影响回合数
  deltaPnl: number     // 相对实际盈亏的变化（正 = 机械执行更好）
  note: string         // 解读
}

const MIN_SUPPORT = 3

function statOf(items: { win: boolean; ret: number; pnl: number }[]) {
  const n = items.length
  const wins = items.filter((t) => t.win)
  return {
    support: n,
    winRate: n ? wins.length / n : 0,
    avgRet: n ? items.reduce((s, t) => s + t.ret, 0) / n : 0,
    sumPnl: items.reduce((s, t) => s + t.pnl, 0),
  }
}

function finding(id: string, title: string, condition: string, items: { win: boolean; ret: number; pnl: number }[], restAvg: number): RuleFinding {
  const s = statOf(items)
  const enough = s.support >= MIN_SUPPORT
  const profitable = enough ? s.avgRet > 0 : null
  let conclusion: string
  if (!enough) conclusion = `样本 ${s.support} 条（<${MIN_SUPPORT}），不足以定性，继续记录交易。`
  else if (profitable) conclusion = `${s.support} 笔样本：胜率 ${(s.winRate * 100).toFixed(0)}%、平均收益 ${(s.avgRet * 100).toFixed(1)}% —— 这是你的赚钱模式，可以固化。`
  else conclusion = `${s.support} 笔样本：胜率 ${(s.winRate * 100).toFixed(0)}%、平均收益 ${(s.avgRet * 100).toFixed(1)}%${restAvg > s.avgRet ? '（明显跑输其余交易）' : ''} —— 这是亏钱模式，应设红线规避。`
  return { id, title, condition, conclusion, profitable, ...s }
}

/** 从追涨杀跌扫描结果提取行为规则（同步、无需行情） */
export function extractRules(items: ChaseItem[]): RuleFinding[] {
  const withPct = items.filter((i) => i.buyPct !== null)
  if (withPct.length < MIN_SUPPORT) return []
  const all = withPct.map((i) => i.trip)
  const avgAll = statOf(all).avgRet

  const chase = withPct.filter((i) => (i.buyPct ?? 0) >= 0.8).map((i) => i.trip)
  const dip = withPct.filter((i) => (i.buyPct ?? 1) <= 0.3).map((i) => i.trip)
  const panic = withPct.filter((i) => i.panic).map((i) => i.trip)
  const quickWin = all.filter((t) => t.win && t.holdDays <= 3)
  const bagHold = all.filter((t) => !t.win && t.holdDays >= 15)
  const quickStop = all.filter((t) => !t.win && t.holdDays <= 5)

  return [
    finding('chase-buy', '追高买入', 'IF 买入价在近 20 日区间 ≥80% 分位', chase, avgAll),
    finding('dip-buy', '低吸买入', 'IF 买入价在近 20 日区间 ≤30% 分位', dip, avgAll),
    finding('panic-sell', '恐慌割肉', 'IF 卖出价在近 20 日区间 ≤20% 分位且亏损', panic, avgAll),
    finding('quick-win', '快进止盈', 'IF 盈利且持有 ≤3 天', quickWin, avgAll),
    finding('bag-hold', '亏损扛单', 'IF 亏损且持有 ≥15 天', bagHold, avgAll),
    finding('quick-stop', '快速止损', 'IF 亏损且持有 ≤5 天', quickStop, avgAll),
  ].filter((r) => r.support > 0)
}

interface Bar { date: string; close: number }

/** 在 K 线上找日期对应的下标（>=date 的第一个交易日） */
function idxOf(bars: Bar[], date: string): number {
  return bars.findIndex((b) => b.date >= date)
}

/** 影子回测：把四条典型规则机械重放，量化「真人 vs 机械」差距 */
export async function shadowBacktest(
  items: ChaseItem[],
  klineFetcher: (code: string) => Promise<Bar[]>
): Promise<ShadowSim[]> {
  const sims: ShadowSim[] = []
  const cache = new Map<string, Bar[]>()
  const getBars = async (code: string): Promise<Bar[]> => {
    if (!cache.has(code)) cache.set(code, await klineFetcher(code))
    return cache.get(code) || []
  }
  const closeAt = async (trip: RoundTrip, date: string, offsetBars = 0): Promise<number | null> => {
    try {
      const bars = await getBars(trip.code)
      const i = idxOf(bars, date)
      const j = i + offsetBars
      if (i < 0 || j < 0 || j >= bars.length) return null
      return bars[j].close
    } catch { return null }
  }

  // S1 规避追高：这些追高回合如果直接不做，盈亏变化 = −(追高回合总盈亏)
  const chaseItems = items.filter((i) => (i.buyPct ?? 0) >= 0.8)
  if (chaseItems.length >= MIN_SUPPORT) {
    const sumPnl = chaseItems.reduce((s, i) => s + i.trip.pnl, 0)
    sims.push({
      id: 'skip-chase', label: '追高买入一律不做',
      detail: `${chaseItems.length} 笔买入分位 ≥80% 的回合直接从历史中剔除`,
      affected: chaseItems.length, deltaPnl: -sumPnl,
      note: sumPnl < 0 ? '机械规避能少亏钱 —— 追高是你的出血点。' : '追高样本总体仍盈利，暂不必一刀切，但需控制仓位。',
    })
  }

  // S2 恐慌多拿 10 个交易日：恐慌割肉回合改为卖出日后第 10 个交易日收盘卖出
  const panicItems = items.filter((i) => i.panic)
  if (panicItems.length > 0) {
    let delta = 0, n = 0
    for (const it of panicItems) {
      const sellClose = await closeAt(it.trip, it.trip.sellDate)
      const later = await closeAt(it.trip, it.trip.sellDate, 10)
      if (sellClose !== null && later !== null) { delta += (later - sellClose) * it.trip.qty; n++ }
    }
    if (n > 0) sims.push({
      id: 'panic-hold', label: '恐慌割肉改为再拿 10 个交易日',
      detail: `${n} 笔恐慌卖出改按卖出日后第 10 个交易日收盘价离场`,
      affected: n, deltaPnl: delta,
      note: delta > 0 ? '割在地板上的概率很高 —— 恐慌时刻的卖出纪律需要重写。' : '恐慌离场反而避开了后续下跌，割肉决策不算错。',
    })
  }

  // S3 盈利单多拿 7 个交易日：快进止盈回合延后离场
  const quickWins = items.map((i) => i.trip).filter((t) => t.win && t.holdDays <= 3)
  if (quickWins.length >= MIN_SUPPORT) {
    let delta = 0, n = 0
    for (const t of quickWins) {
      const sellClose = await closeAt(t, t.sellDate)
      const later = await closeAt(t, t.sellDate, 7)
      if (sellClose !== null && later !== null) { delta += (later - sellClose) * t.qty; n++ }
    }
    if (n > 0) sims.push({
      id: 'win-hold', label: '快进止盈改为再拿 7 个交易日',
      detail: `${n} 笔「盈利且 ≤3 天卖出」改按卖出日后第 7 个交易日收盘价离场`,
      affected: n, deltaPnl: delta,
      note: delta > 0 ? '利润被过早截断 —— 让盈利奔跑能显著增厚收益。' : '快进止盈是有效的，后续涨幅并不属于你。',
    })
  }

  // S4 扛单早割：亏损扛单回合改为买入后第 5 个交易日止损
  const bagHolds = items.map((i) => i.trip).filter((t) => !t.win && t.holdDays >= 15)
  if (bagHolds.length >= MIN_SUPPORT) {
    let delta = 0, n = 0
    for (const t of bagHolds) {
      const sellClose = await closeAt(t, t.sellDate)
      const early = await closeAt(t, t.buyDate, 5)
      if (sellClose !== null && early !== null) { delta += (early - sellClose) * t.qty; n++ }
    }
    if (n > 0) sims.push({
      id: 'loss-cut', label: '亏损扛单改为第 5 个交易日止损',
      detail: `${n} 笔「亏损且 ≥15 天」改按买入后第 5 个交易日收盘价离场`,
      affected: n, deltaPnl: delta,
      note: delta > 0 ? '扛单在放大亏损 —— 硬止损规则能止血。' : '扛回来的样本存在，但注意这是幸存者视角。',
    })
  }

  return sims
}
