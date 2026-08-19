// quantlib —— 本地 TypeScript 量化函数库（Vibe-Trading 思想：公式必须来自经过测试的库，而不是散落在提示词里）
// 约定：暖窗期不足的位置填 NaN；所有函数纯计算、无副作用；配 quantlibSelfTest 内置自检
export const f = {
  // ===== 收益与风险 =====
  returns: (c: number[]): number[] => c.map((v, i) => (i === 0 ? NaN : v / c[i - 1] - 1)),
  logReturns: (c: number[]): number[] => c.map((v, i) => (i === 0 ? NaN : Math.log(v / c[i - 1]))),
  cumReturn: (c: number[]): number => (c.length < 2 ? NaN : c[c.length - 1] / c[0] - 1),
  annReturn: (c: number[], ppy = 252): number => {
    const r = f.cumReturn(c)
    if (Number.isNaN(r) || r <= -1) return NaN
    return Math.pow(1 + r, ppy / (c.length - 1)) - 1
  },
  annVol: (c: number[], ppy = 252): number => f.stdev(f.returns(c).filter((x) => !Number.isNaN(x))) * Math.sqrt(ppy),
  sharpe: (c: number[], rf = 0, ppy = 252): number => {
    const r = f.returns(c).filter((x) => !Number.isNaN(x))
    const sd = f.stdev(r)
    if (!sd) return NaN
    return ((f.mean(r) - rf / ppy) / sd) * Math.sqrt(ppy)
  },
  maxDrawdown: (c: number[]): { mdd: number; peak: number; trough: number } => {
    let peak = -Infinity, mdd = 0, pi = 0, ti = 0, curPeak = 0
    c.forEach((v, i) => {
      if (v > peak) { peak = v; curPeak = i }
      const dd = peak > 0 ? v / peak - 1 : 0
      if (dd < mdd) { mdd = dd; pi = curPeak; ti = i }
    })
    return { mdd, peak: pi, trough: ti }
  },
  calmar: (c: number[], ppy = 252): number => {
    const ar = f.annReturn(c, ppy)
    const { mdd } = f.maxDrawdown(c)
    return mdd === 0 ? NaN : ar / Math.abs(mdd)
  },

  // ===== 统计 =====
  mean: (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN),
  stdev: (xs: number[]): number => {
    const n = xs.length
    if (n < 2) return NaN
    const m = f.mean(xs)
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1))
  },
  covariance: (x: number[], y: number[]): number => {
    const n = Math.min(x.length, y.length)
    if (n < 2) return NaN
    const mx = f.mean(x.slice(0, n)), my = f.mean(y.slice(0, n))
    let s = 0
    for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my)
    return s / (n - 1)
  },
  correlation: (x: number[], y: number[]): number => {
    const sx = f.stdev(x), sy = f.stdev(y)
    if (!sx || !sy) return NaN
    return f.covariance(x, y) / (sx * sy)
  },
  /** 秩次（平均秩处理并列），1-based */
  rank: (xs: number[]): number[] => {
    const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0])
    const r = new Array(xs.length).fill(NaN)
    let i = 0
    while (i < idx.length) {
      let j = i
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg
      i = j + 1
    }
    return r
  },
  /** 皮尔逊 IC（因子值 vs 未来收益） */
  ic: (factor: number[], fwdRet: number[]): number => {
    const pairs = factor.map((v, i) => [v, fwdRet[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b))
    if (pairs.length < 3) return NaN
    return f.correlation(pairs.map((p) => p[0]), pairs.map((p) => p[1]))
  },
  /** 斯皮尔曼秩 IC */
  rankIC: (factor: number[], fwdRet: number[]): number => {
    const pairs = factor.map((v, i) => [v, fwdRet[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b))
    if (pairs.length < 3) return NaN
    return f.correlation(f.rank(pairs.map((p) => p[0])), f.rank(pairs.map((p) => p[1])))
  },
  linreg: (x: number[], y: number[]): { slope: number; intercept: number; r2: number } => {
    const n = Math.min(x.length, y.length)
    if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN }
    const xs = x.slice(0, n), ys = y.slice(0, n)
    const mx = f.mean(xs), my = f.mean(ys)
    let sxy = 0, sxx = 0
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2 }
    const slope = sxx === 0 ? NaN : sxy / sxx
    const intercept = my - slope * mx
    const r = f.correlation(xs, ys)
    return { slope, intercept, r2: r * r }
  },
  zscore: (xs: number[], n: number): number[] =>
    xs.map((_, i) => {
      if (i < n - 1) return NaN
      const w = xs.slice(i - n + 1, i + 1)
      const m = f.mean(w), sd = f.stdev(w)
      return sd ? (xs[i] - m) / sd : NaN
    }),

  // ===== 均线与趋势 =====
  sma: (xs: number[], n: number): number[] => xs.map((_, i) => (i < n - 1 ? NaN : f.mean(xs.slice(i - n + 1, i + 1)))),
  ema: (xs: number[], n: number): number[] => {
    const a = 2 / (n + 1)
    const out: number[] = []
    xs.forEach((v, i) => out.push(i === 0 ? v : a * v + (1 - a) * out[i - 1]))
    return out
  },
  wma: (xs: number[], n: number): number[] =>
    xs.map((_, i) => {
      if (i < n - 1) return NaN
      let s = 0, w = 0
      for (let k = 0; k < n; k++) { s += xs[i - k] * (n - k); w += n - k }
      return s / w
    }),
  macd: (c: number[], fast = 12, slow = 26, sig = 9): { dif: number[]; dea: number[]; hist: number[] } => {
    const ef = f.ema(c, fast), es = f.ema(c, slow)
    const dif = c.map((_, i) => ef[i] - es[i])
    const dea = f.ema(dif, sig)
    return { dif, dea, hist: dif.map((v, i) => 2 * (v - dea[i])) } // 国内软件惯例 ×2
  },
  rsi: (c: number[], n = 14): number[] => {
    const out: number[] = new Array(c.length).fill(NaN)
    let up = 0, dn = 0
    for (let i = 1; i < c.length; i++) {
      const ch = c[i] - c[i - 1]
      const u = Math.max(ch, 0), d = Math.max(-ch, 0)
      if (i <= n) {
        up += u; dn += d
        if (i === n) { up /= n; dn /= n; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn) }
      } else {
        up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + d) / n // Wilder 平滑
        out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn)
      }
    }
    return out
  },
  boll: (c: number[], n = 20, k = 2): { mid: number[]; up: number[]; dn: number[] } => {
    const mid = f.sma(c, n)
    const up: number[] = [], dn: number[] = []
    c.forEach((_, i) => {
      if (i < n - 1) { up.push(NaN); dn.push(NaN); return }
      const sd = f.stdev(c.slice(i - n + 1, i + 1))
      up.push(mid[i] + k * sd); dn.push(mid[i] - k * sd)
    })
    return { mid, up, dn }
  },
  kdj: (h: number[], l: number[], c: number[], n = 9): { k: number[]; d: number[]; j: number[] } => {
    const K: number[] = [], D: number[] = []
    c.forEach((_, i) => {
      if (i < n - 1) { K.push(NaN); D.push(NaN); return }
      const hh = Math.max(...h.slice(i - n + 1, i + 1))
      const ll = Math.min(...l.slice(i - n + 1, i + 1))
      const rsv = hh === ll ? 50 : ((c[i] - ll) / (hh - ll)) * 100
      const k = i === n - 1 ? (2 / 3) * 50 + (1 / 3) * rsv : (2 / 3) * K[i - 1] + (1 / 3) * rsv
      const d = i === n - 1 ? (2 / 3) * 50 + (1 / 3) * k : (2 / 3) * D[i - 1] + (1 / 3) * k
      K.push(k); D.push(d)
    })
    return { k: K, d: D, j: K.map((v, i) => 3 * v - 2 * D[i]) }
  },
  atr: (h: number[], l: number[], c: number[], n = 14): number[] => {
    const tr: number[] = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))))
    const out: number[] = new Array(c.length).fill(NaN)
    let a = 0
    for (let i = 0; i < tr.length; i++) {
      if (i < n) { a += tr[i]; if (i === n - 1) { a /= n; out[i] = a } }
      else { a = (a * (n - 1) + tr[i]) / n; out[i] = a }
    }
    return out
  },

  // ===== 动量 =====
  roc: (c: number[], n: number): number[] => c.map((v, i) => (i < n ? NaN : v / c[i - n] - 1)),
  momentum: (c: number[], n: number): number[] => c.map((v, i) => (i < n ? NaN : v - c[i - n])),

  // ===== 扩充：下行风险与相对表现 =====
  /** 下行波动率（只统计负收益） */
  downsideVol: (c: number[], ppy = 252): number => {
    const dn = f.returns(c).filter((x) => !Number.isNaN(x) && x < 0)
    return f.stdev(dn) * Math.sqrt(ppy)
  },
  sortino: (c: number[], rf = 0, ppy = 252): number => {
    const dv = f.downsideVol(c, ppy)
    if (!dv) return NaN
    return (f.annReturn(c, ppy) - rf) / dv
  },
  /** 对基准的 beta 与 alpha（日化 alpha 年化后返回） */
  betaAlpha: (c: number[], bench: number[], ppy = 252): { beta: number; alpha: number } => {
    const rc = f.returns(c), rb = f.returns(bench)
    const pairs = rc.map((v, i) => [v, rb[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b))
    if (pairs.length < 5) return { beta: NaN, alpha: NaN }
    const xs = pairs.map((p) => p[1]), ys = pairs.map((p) => p[0])
    const { slope, intercept } = f.linreg(xs, ys)
    return { beta: slope, alpha: intercept * ppy }
  },

  // ===== 扩充：通达信式序列工具 =====
  hhv: (xs: number[], n: number): number[] => xs.map((_, i) => (i < n - 1 ? NaN : Math.max(...xs.slice(i - n + 1, i + 1)))),
  llv: (xs: number[], n: number): number[] => xs.map((_, i) => (i < n - 1 ? NaN : Math.min(...xs.slice(i - n + 1, i + 1)))),
  ref: (xs: number[], n: number): number[] => xs.map((_, i) => (i < n ? NaN : xs[i - n])),
  /** 上穿：a 从下方穿越 b（同长序列） */
  crossUp: (a: number[], b: number[]): boolean[] => a.map((v, i) => i > 0 && !Number.isNaN(v) && !Number.isNaN(b[i]) && a[i - 1] <= b[i - 1] && v > b[i]),
  crossDown: (a: number[], b: number[]): boolean[] => a.map((v, i) => i > 0 && !Number.isNaN(v) && !Number.isNaN(b[i]) && a[i - 1] >= b[i - 1] && v < b[i]),
  /** 最近 n 日内条件成立次数 */
  count: (conds: boolean[], n: number): number[] => conds.map((_, i) => (i < n - 1 ? NaN : conds.slice(i - n + 1, i + 1).filter(Boolean).length)),
  /** 距上次条件成立的周期数（从未成立为 NaN） */
  barsSince: (conds: boolean[]): number[] => {
    let last = -1
    return conds.map((c, i) => { if (c) last = i; return last < 0 ? NaN : i - last })
  },
}

/** 前瞻收益：t 日因子值 vs t+horizon 收益（末端 horizon 个为 NaN） */
export function forwardReturns(c: number[], horizon: number): number[] {
  return c.map((_, i) => (i + horizon >= c.length ? NaN : c[i + horizon] / c[i] - 1))
}

/** IC bench：因子序列 vs 前瞻收益，滚动逐日 IC 后汇总 */
export interface ICStats { ic: number; rankIC: number; icir: number; positiveRate: number; days: number }
export function icBench(factor: number[], closes: number[], horizon = 5): ICStats {
  const fwd = forwardReturns(closes, horizon)
  // 逐日横截面不适用单标的——改用时间序列 IC：因子 t 值与未来收益的滚动相关窗口
  const pairs = factor.map((v, i) => [v, fwd[i]] as [number, number]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b))
  if (pairs.length < 30) return { ic: NaN, rankIC: NaN, icir: NaN, positiveRate: NaN, days: pairs.length }
  const fv = pairs.map((p) => p[0]), rv = pairs.map((p) => p[1])
  const ic = f.ic(fv, rv)
  const rankIC = f.rankIC(fv, rv)
  // 滚动 20 日 IC 序列估 ICIR 与胜率
  const win = 20
  const roll: number[] = []
  for (let i = win; i <= pairs.length; i++) {
    const segF = fv.slice(i - win, i), segR = rv.slice(i - win, i)
    const r = f.rankIC(segF, segR)
    if (!Number.isNaN(r)) roll.push(r)
  }
  const m = f.mean(roll), sd = f.stdev(roll)
  return {
    ic, rankIC,
    icir: sd ? m / sd : NaN,
    positiveRate: roll.length ? roll.filter((x) => x > 0).length / roll.length : NaN,
    days: pairs.length,
  }
}

/** 横截面 IC bench：每个交易日用全部标的的因子值 vs 前瞻收益算秩 IC，汇总序列统计（462 动物园口径） */
export function crossSectionalIC(
  factorByCode: Record<string, number[]>,
  closeByCode: Record<string, number[]>,
  horizon = 5
): ICStats & { series: number[] } {
  const codes = Object.keys(factorByCode).filter((c) => closeByCode[c])
  if (codes.length < 3) return { ic: NaN, rankIC: NaN, icir: NaN, positiveRate: NaN, days: 0, series: [] }
  const len = Math.min(...codes.map((c) => factorByCode[c].length))
  const fwdByCode: Record<string, number[]> = {}
  for (const c of codes) fwdByCode[c] = forwardReturns(closeByCode[c], horizon)
  const series: number[] = []
  for (let t = 0; t < len; t++) {
    const fv: number[] = [], rv: number[] = []
    for (const c of codes) {
      const a = factorByCode[c][t], b = fwdByCode[c][t]
      if (!Number.isNaN(a) && !Number.isNaN(b)) { fv.push(a); rv.push(b) }
    }
    if (fv.length >= 3) {
      const r = f.rankIC(fv, rv)
      if (!Number.isNaN(r)) series.push(r)
    }
  }
  if (series.length < 10) return { ic: NaN, rankIC: NaN, icir: NaN, positiveRate: NaN, days: series.length, series }
  const m = f.mean(series), sd = f.stdev(series)
  return {
    ic: m, rankIC: m, icir: sd ? m / sd : NaN,
    positiveRate: series.filter((x) => x > 0).length / series.length,
    days: series.length, series,
  }
}

/** 内置自检：已知输入验证关键公式，页面可直接展示「公式库可信」 */
export function quantlibSelfTest(): { name: string; pass: boolean }[] {
  const eq = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
  const tests: { name: string; pass: boolean }[] = []
  const t = (name: string, pass: boolean) => tests.push({ name, pass })

  t('returns 收益率', eq(f.returns([100, 110, 99])[1], 0.1) && eq(f.returns([100, 110, 99])[2], -0.1))
  t('cumReturn 累计收益', eq(f.cumReturn([100, 121]), 0.21))
  t('sma 简单均线', eq(f.sma([1, 2, 3, 4], 2)[3], 3.5) && Number.isNaN(f.sma([1, 2, 3, 4], 2)[0]))
  t('ema 指数均线', eq(f.ema([5, 5, 5], 3)[2], 5))
  const md = f.maxDrawdown([100, 120, 60, 130, 65])
  t('maxDrawdown 最大回撤', eq(md.mdd, -0.5) && md.peak === 1 && md.trough === 2)
  t('correlation 相关', eq(f.correlation([1, 2, 3], [2, 4, 6]), 1))
  t('rank 秩次', JSON.stringify(f.rank([30, 10, 20])) === '[3,1,2]')
  t('rankIC 单调正相关', eq(f.rankIC([1, 2, 3, 4, 5], [0.01, 0.02, 0.03, 0.04, 0.05]), 1))
  const up = Array.from({ length: 30 }, (_, i) => 100 + i) // 单边上涨
  t('rsi 单边上涨→100', eq(f.rsi(up, 14)[29], 100))
  const mc = f.macd([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  t('macd 多头排列 dif>0', mc.dif[9] > 0 && mc.dif.length === 10)
  const b = f.boll([5, 5, 5, 5, 5], 3, 2)
  t('boll 零波动带宽=0', eq(b.up[4], 5) && eq(b.dn[4], 5))
  t('sharpe 常数序列→NaN', Number.isNaN(f.sharpe([100, 100, 100])))
  t('hhv/llv 区间极值', eq(f.hhv([1, 3, 2], 2)[2], 3) && eq(f.llv([1, 3, 2], 2)[2], 2))
  t('crossUp 上穿', JSON.stringify(f.crossUp([1, 3], [2, 2])) === '[false,true]')
  t('barsSince 周期计数', eq(f.barsSince([false, true, false, false])[3], 2))
  // 横截面自检：因子排序 A<B<C 恒定，收益排序 A<B<C 恒定 → 每日秩 IC=1
  const mk = (r: number) => Array.from({ length: 12 }, (_, i) => 10 * Math.pow(1 + r, i))
  const cs = crossSectionalIC(
    { A: new Array(12).fill(1), B: new Array(12).fill(2), C: new Array(12).fill(3) },
    { A: mk(0.01), B: mk(0.02), C: mk(0.03) },
    1
  )
  t('横截面 IC 完美单调→1', eq(cs.rankIC, 1) && cs.days === 11)
  return tests
}
