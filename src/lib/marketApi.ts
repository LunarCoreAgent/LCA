// 实时行情接入层：东方财富 Push2（免费行情源，真实数据）
// 双通道：Electron 内走主进程 IPC（无跨域限制），浏览器开发时直连（该源支持 CORS）
import type { Quote, TechRow } from './stockData'
import { getDsKey } from './dataSources'
// window.agentcore 类型统一声明于 src/types/agentcore.d.ts

export interface KPoint {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
}

// 监控列表本地存储键（与行情采集页共用）
export const WATCH_KEY = 'agentcore-watchlist'

// 出厂预置 10 只标的：沪深京/港/美覆盖，用户可自由增删
export const DEFAULT_WATCH: { code: string; name: string }[] = [
  { code: '600519.SH', name: '贵州茅台' },
  { code: '000858.SZ', name: '五粮液' },
  { code: '601318.SH', name: '中国平安' },
  { code: '300750.SZ', name: '宁德时代' },
  { code: '002594.SZ', name: '比亚迪' },
  { code: '600036.SH', name: '招商银行' },
  { code: '00700.HK', name: '腾讯控股' },
  { code: '09988.HK', name: '阿里巴巴-W' },
  { code: 'AAPL.US', name: '苹果' },
  { code: 'NVDA.US', name: '英伟达' },
]

export function loadWatchCodes(fallback: string[] = []): string[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (raw) return (JSON.parse(raw) as { code: string }[]).map((x) => x.code)
  } catch { /* 忽略损坏缓存 */ }
  return fallback
}

export function loadWatchList(fallback: { code: string; name: string }[] = []): { code: string; name: string }[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (raw) return (JSON.parse(raw) as { code: string; name: string }[]).map((x) => ({ code: x.code, name: x.name }))
  } catch { /* 忽略损坏缓存 */ }
  return fallback
}

// 智能代码识别：只输数字（或字母）即可，自动判断市场，返回标准完整代码
// 600519 → 600519.SH｜000858 → 000858.SZ｜830799 → 830799.BJ｜00700 → 00700.HK｜AAPL → AAPL.US
export function normalizeCode(input: string): string | null {
  const s = input.trim().toUpperCase()
  if (!s) return null
  // 已是完整代码
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(s)) return s
  if (/^\d{1,5}\.HK$/.test(s)) return s.split('.')[0].padStart(5, '0') + '.HK'
  if (/^[A-Z]{1,5}\.US$/.test(s)) return s
  // 6 位数字：A股按号段判市场
  if (/^\d{6}$/.test(s)) {
    if (/^(43|83|87|88|92)/.test(s)) return `${s}.BJ`
    if (/^(60|68|90|5)/.test(s)) return `${s}.SH`
    if (/^(00|30|20|12)/.test(s)) return `${s}.SZ`
    return `${s}.SH` // 未识别号段默认沪市，拉取失败会在调用侧提示
  }
  // 1~5 位数字：港股
  if (/^\d{1,5}$/.test(s)) return `${s.padStart(5, '0')}.HK`
  // 字母：美股
  if (/^[A-Z]{1,5}$/.test(s)) return `${s}.US`
  return null
}

// 代码 → 东财 secid：沪 1. 深 0. 京 0. 港 116. 美 105.（纽交所自动回退 106.）
export function toSecid(code: string, usMkt = 105): string {
  const [num, mkt] = code.split('.')
  switch ((mkt ?? '').toUpperCase()) {
    case 'SH': return `1.${num}`
    case 'SZ': return `0.${num}`
    case 'BJ': return `0.${num}`
    case 'HK': return `116.${num.padStart(5, '0')}`
    case 'US': return `${usMkt}.${num.toUpperCase()}`
    default: return `1.${num}`
  }
}

const QFIELDS = 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18'
const quotesUrl = (secids: string) =>
  `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=${QFIELDS}`
const klineUrl = (secid: string, lmt: number) =>
  `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&lmt=${lmt}&end=20500101`

async function getJson(url: string, viaIpc?: 'quotes' | 'kline', arg?: string, lmt?: number): Promise<any> {
  if (viaIpc && window.agentcore?.market) {
    return viaIpc === 'quotes' ? window.agentcore.market.quotes(arg!) : window.agentcore.market.kline(arg!, lmt!)
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`行情接口 HTTP ${r.status}`)
  return r.json()
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function mapQuote(f: Record<string, unknown>, freq: string): Quote | null {
  const close = num(f.f2)
  if (close == null || close === 0) return null // 停牌或无数据
  return {
    code: String(f.f12 ?? ''),
    name: String(f.f14 ?? f.f12 ?? ''),
    close,
    pctChg: num(f.f3) ?? 0,
    preClose: num(f.f18) ?? close,
    open: num(f.f17) ?? close,
    high: num(f.f15) ?? close,
    low: num(f.f16) ?? close,
    volumeWan: +(((num(f.f5) ?? 0) / 100).toFixed(0)), // 手 → 万股（A股口径）
    amountYi: +(((num(f.f6) ?? 0) / 1e8).toFixed(2)),
    turnover: num(f.f8) ?? 0,
    freq,
    points: 0,
    collecting: true,
  }
}

// 分批请求（每批 15 只），单批失败不影响其他批次 —— 解决大批量轮询时一次抖动全部离线的稳定性问题
const BATCH = 15

// 批量拉取实时快照；返回 { quotes, failed }，failed 为拉不到数据的代码
export async function fetchLiveQuotes(codes: string[], freqOf: (c: string) => string): Promise<{ quotes: Quote[]; failed: string[] }> {
  const uniq = [...new Set(codes)]
  const quotes: Quote[] = []
  const failed: string[] = []
  // 分批拉取，某一批异常仅该批进入 failed
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH)
    const secids = batch.map((c) => toSecid(c)).join(',')
    try {
      const json = await getJson(quotesUrl(secids), 'quotes', secids)
      const diff: Record<string, unknown>[] = json?.data?.diff ?? []
      const byRaw = new Map(diff.map((f) => [String(f.f12), f]))
      for (const code of batch) {
        const f = byRaw.get(code.split('.')[0].toUpperCase())
        const q = f ? mapQuote(f, freqOf(code)) : null
        if (q) { q.code = code; quotes.push(q) } else failed.push(code)
      }
    } catch {
      failed.push(...batch)
    }
  }
  // 美股回退：105（纳斯达克）查不到时试 106（纽交所）
  const usFailed = failed.filter((c) => c.endsWith('.US'))
  if (usFailed.length > 0) {
    const secids = usFailed.map((c) => toSecid(c, 106)).join(',')
    try {
      const j2 = await getJson(quotesUrl(secids), 'quotes', secids)
      const diff2: Record<string, unknown>[] = j2?.data?.diff ?? []
      const byRaw2 = new Map(diff2.map((f) => [String(f.f12), f]))
      for (const code of usFailed) {
        const f = byRaw2.get(code.split('.')[0].toUpperCase())
        const q = f ? mapQuote(f, freqOf(code)) : null
        if (q) {
          q.code = code
          quotes.push(q)
          failed.splice(failed.indexOf(code), 1)
        }
      }
    } catch { /* 回退失败保持原状 */ }
  }
  // 备用源链：腾讯 → 新浪（A股）→ Yahoo（港/美国际）
  const sources: string[] = quotes.length > 0 ? ['东方财富'] : []
  if (failed.length > 0) {
    try {
      const qq = await fetchQQQuotes(failed, freqOf)
      for (const q of qq) { quotes.push(q); failed.splice(failed.indexOf(q.code), 1) }
      if (qq.length > 0) sources.push('腾讯')
    } catch { /* 腾讯源不可达 */ }
  }
  if (failed.length > 0) {
    try {
      const sina = await fetchSinaQuotes(failed, freqOf)
      for (const q of sina) { quotes.push(q); failed.splice(failed.indexOf(q.code), 1) }
      if (sina.length > 0) sources.push('新浪')
    } catch { /* 新浪源不可达 */ }
  }
  // 国际兜底：港/美标的前序源均失败时走 Yahoo Finance
  const intlFailed = failed.filter((c) => c.endsWith('.US') || c.endsWith('.HK'))
  for (const code of intlFailed) {
    try {
      const q = await fetchYahooQuote(code, freqOf(code))
      if (q) {
        quotes.push(q)
        failed.splice(failed.indexOf(code), 1)
        if (!sources.includes('Yahoo')) sources.push('Yahoo')
      }
    } catch { /* 单只失败保持 failed */ }
  }
  // Python 数据桥（AkShare）：桥在线时作为 A股 强力备源
  if (failed.some((c) => /\.(SH|SZ|BJ)$/.test(c))) {
    const pb = await probePyBridge()
    if (pb.online && pb.akshare) {
      const bq = await fetchBridgeQuotes(failed, freqOf)
      for (const q of bq) { quotes.push(q); failed.splice(failed.indexOf(q.code), 1) }
      if (bq.length > 0) sources.push('Python桥·AkShare')
    }
  }
  // 可选 Key 源（数据中心「数据源」页配置后自动启用）：A股 智兔→聚合；美股 AV→Finnhub→TwelveData→Polygon
  if (failed.length > 0 && getDsKey('zhitu')) {
    try {
      const zt = await fetchZhiTuQuotes(failed, freqOf)
      for (const q of zt) { quotes.push(q); failed.splice(failed.indexOf(q.code), 1) }
      if (zt.length > 0) sources.push('智兔数服')
    } catch { /* 智兔不可达 */ }
  }
  if (failed.length > 0 && getDsKey('juhe')) {
    try {
      const jh = await fetchJuheQuotes(failed, freqOf)
      for (const q of jh) { quotes.push(q); failed.splice(failed.indexOf(q.code), 1) }
      if (jh.length > 0) sources.push('聚合数据')
    } catch { /* 聚合不可达 */ }
  }
  for (const code of failed.filter((c) => c.endsWith('.US'))) {
    const got = await fetchUsKeyQuote(code, freqOf(code))
    if (got) {
      quotes.push(got.q)
      failed.splice(failed.indexOf(code), 1)
      if (!sources.includes(got.src)) sources.push(got.src)
    }
  }
  if (sources.length === 0 && quotes.length > 0) sources.push('东方财富')
  sourceStatus.quotes = sources.join(' + ') || '全部不可达'
  sourceStatus.detail = failed.length > 0 ? `${failed.length} 只标的未取到` : ''
  return { quotes, failed }
}

// 拉取日 K 线（前复权，最近 lmt 个交易日）
export async function fetchDailyKline(code: string, lmt = 90): Promise<KPoint[]> {
  const fetchBy = async (secid: string): Promise<KPoint[]> => {
    try {
      const json = await getJson(klineUrl(secid, lmt), 'kline', secid, lmt)
      const lines: string[] = json?.data?.klines ?? []
      return lines.map((ln) => {
        const [date, o, c, h, l, v, a] = ln.split(',')
        return { date, open: +o, close: +c, high: +h, low: +l, volume: +v, amount: +a } as KPoint
      })
    } catch { return [] } // 东财不可达时返回空，交由腾讯/Yahoo 备用源接力
  }
  let ks = await fetchBy(toSecid(code))
  if (ks.length === 0 && code.endsWith('.US')) ks = await fetchBy(toSecid(code, 106))
  if (ks.length > 0) { sourceStatus.kline = '东方财富'; return ks }
  // 备用源：腾讯日 K（前复权，A股/港股）
  const qqSym = toQQSymbol(code)
  if (qqSym) {
    try {
      ks = await fetchQQKline(qqSym, lmt)
      if (ks.length > 0) { sourceStatus.kline = '腾讯（东财不可达，已切换）'; return ks }
    } catch { /* 继续 */ }
  }
  // Python 数据桥（BaoStock）：A股 K 线强力备源
  if (ks.length === 0 && /\.(SH|SZ|BJ)$/.test(code)) {
    const pb = await probePyBridge()
    if (pb.online && pb.baostock) {
      ks = await fetchBridgeKline(code, lmt)
      if (ks.length > 0) { sourceStatus.kline = 'Python桥·BaoStock'; return ks }
    }
  }
  // 国际标的回退 Yahoo Finance
  if (code.endsWith('.US') || code.endsWith('.HK')) {
    try {
      ks = await fetchYahooKline(code, lmt >= 200 ? '1y' : '6mo')
      if (ks.length > 0) { sourceStatus.kline = 'Yahoo（国际源）'; return ks }
    } catch { /* 保持空 */ }
  }
  // A股最终兜底：Tushare Pro（需 Token，数据中心配置）
  if (ks.length === 0 && /\.(SH|SZ|BJ)$/.test(code) && getDsKey('tushare')) {
    ks = await fetchTushareKline(code, lmt)
    if (ks.length > 0) { sourceStatus.kline = 'Tushare（前序源不可达，已切换）'; return ks }
  }
  sourceStatus.kline = '全部不可达'
  return ks
}

// 腾讯日 K：web.ifzq.gtimg.cn/appstock/app/fqkline/get（前复权 JSON）
async function fetchQQKline(qqSym: string, lmt: number): Promise<KPoint[]> {
  const n = Math.min(800, Math.max(60, lmt))
  const json = window.agentcore?.market
    ? JSON.parse(await window.agentcore.market.text(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${qqSym},day,,,${n},qfq`, 'utf8'))
    : await (await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${qqSym},day,,,${n},qfq`)).json()
  const node = (json as { data?: Record<string, { qfqday?: unknown[]; day?: unknown[] }> })?.data?.[qqSym]
  const rows = (node?.qfqday ?? node?.day ?? []) as [string, number, number, number, number, number][]
  // 腾讯格式：[date, open, close, high, low, volume(手)]
  return rows
    .filter((r) => Array.isArray(r) && typeof r[2] === 'number')
    .map((r) => ({ date: r[0], open: +r[1].toFixed(2), close: +r[2].toFixed(2), high: +r[3].toFixed(2), low: +r[4].toFixed(2), volume: (r[5] ?? 0) * 100, amount: 0 }))
    .slice(-lmt)
}

// ===== 数据源状态：供界面展示当前生效源与切换原因 =====
export const sourceStatus = {
  quotes: '东方财富',
  kline: '东方财富',
  fundflow: '东方财富',
  detail: '',
  news: '',      // 新闻公告
  finnews: '',   // 金融新闻
  metals: '',    // 金价银价
  limitPool: '', // 打板情绪
  basic: '',     // 基本面
  basicVal: '',  // 基本面估值源（理杏仁/Python桥/push2）
  option: '',    // ETF期权
  report: '',    // 研报
  lhb: '',       // 龙虎榜
  margin: '',    // 两融
}

// ===== 备用源 1：腾讯行情（qt.gtimg.cn，免费免 Key，A股/港股批量快照 + 日K）=====
function toQQSymbol(code: string): string | null {
  const [num, mkt] = code.split('.')
  switch ((mkt ?? '').toUpperCase()) {
    case 'SH': return `sh${num}`
    case 'SZ': return `sz${num}`
    case 'BJ': return `bj${num}`
    case 'HK': return `hk${num.padStart(5, '0')}`
    default: return null // 美股走 Yahoo 兜底
  }
}

export async function fetchText(url: string, encoding: 'utf8' | 'gbk' = 'utf8', referer?: string): Promise<string> {
  if (window.agentcore?.market) return window.agentcore.market.text(url, encoding, referer)
  const r = await fetch(url, referer ? { headers: { Referer: referer } } : undefined)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  if (encoding === 'gbk') return new TextDecoder('gbk').decode(await r.arrayBuffer())
  return r.text()
}

// 解析腾讯快照文本：v_sh600519="1~贵州茅台~600519~1322.97~...";（GBK）
function parseQQQuotes(text: string, codes: string[], freqOf: (c: string) => string): Quote[] {
  const out: Quote[] = []
  for (const code of codes) {
    const sym = toQQSymbol(code)
    if (!sym) continue
    const m = text.match(new RegExp(`v_${sym}="([^"]*)"`))
    if (!m) continue
    const f = m[1].split('~')
    const n = (i: number) => { const v = parseFloat(f[i]); return Number.isFinite(v) ? v : null }
    const isHK = code.endsWith('.HK')
    // A股：[1]名 [3]现价 [4]昨收 [5]今开 [32]涨跌% [33]高 [34]低 [36]量(手) [37]额(万) [38]换手
    // 港股：[1]名 [3]现价 [4]昨收 [5]今开 [6]高 [7]低 [10]涨跌% [12]量 [13]额(万)
    const close = n(3)
    if (close == null || close === 0) continue
    const preClose = n(4) ?? close
    out.push({
      code, name: f[1] ?? code,
      close,
      pctChg: n(isHK ? 10 : 32) ?? (preClose ? +(((close - preClose) / preClose) * 100).toFixed(2) : 0),
      preClose, open: n(5) ?? close,
      high: n(isHK ? 6 : 33) ?? close, low: n(isHK ? 7 : 34) ?? close,
      volumeWan: isHK ? +(((n(12) ?? 0) * 100 / 1e4).toFixed(0)) : +(((n(36) ?? 0) * 100 / 1e4).toFixed(0)), // 手→万股
      amountYi: isHK ? +(((n(13) ?? 0) / 1e4).toFixed(2)) : +(((n(37) ?? 0) / 1e4).toFixed(2)), // 万→亿
      turnover: n(isHK ? 99 : 38) ?? 0,
      freq: freqOf(code), points: 0, collecting: true,
    })
  }
  return out
}

async function fetchQQQuotes(codes: string[], freqOf: (c: string) => string): Promise<Quote[]> {
  const syms = codes.map(toQQSymbol).filter((x): x is string => !!x)
  if (syms.length === 0) return []
  const text = await fetchText(`https://qt.gtimg.cn/q=${syms.join(',')}`, 'gbk')
  return parseQQQuotes(text, codes, freqOf)
}

// ===== 备用源 2：新浪行情（hq.sinajs.cn，免费免 Key，需 Referer，GBK）=====
function toSinaSymbol(code: string): string | null {
  const [num, mkt] = code.split('.')
  switch ((mkt ?? '').toUpperCase()) {
    case 'SH': return `sh${num}`
    case 'SZ': return `sz${num}`
    case 'BJ': return `bj${num}`
    default: return null // 新浪源仅做 A 股兜底
  }
}

async function fetchSinaQuotes(codes: string[], freqOf: (c: string) => string): Promise<Quote[]> {
  const pairs = codes.map((c) => [c, toSinaSymbol(c)] as const).filter((x): x is [string, string] => !!x[1])
  if (pairs.length === 0) return []
  const text = await fetchText(`https://hq.sinajs.cn/list=${pairs.map((p) => p[1]).join(',')}`, 'gbk', 'https://finance.sina.com.cn')
  const out: Quote[] = []
  for (const [code, sym] of pairs) {
    const m = text.match(new RegExp(`hq_str_${sym}="([^"]*)"`))
    if (!m || !m[1]) continue
    const f = m[1].split(',')
    const n = (i: number) => { const v = parseFloat(f[i]); return Number.isFinite(v) ? v : null }
    const close = n(3) // [0]名 [1]今开 [2]昨收 [3]现价 [4]高 [5]低 [8]量(股) [9]额(元)
    if (close == null || close === 0) continue
    const preClose = n(2) ?? close
    out.push({
      code, name: f[0] ?? code, close,
      pctChg: preClose ? +(((close - preClose) / preClose) * 100).toFixed(2) : 0,
      preClose, open: n(1) ?? close, high: n(4) ?? close, low: n(5) ?? close,
      volumeWan: +(((n(8) ?? 0) / 1e4).toFixed(0)),
      amountYi: +(((n(9) ?? 0) / 1e8).toFixed(2)),
      turnover: 0,
      freq: freqOf(code), points: 0, collecting: true,
    })
  }
  return out
}

// ===== 主力资金流（东财，真实数据）=====
export interface FundFlow {
  code: string
  name: string
  mainInWan: number      // 主力净流入（万元）
  superLargeWan: number  // 超大单
  largeWan: number       // 大单
  midWan: number         // 中单
  retailWan: number      // 小单
  mainPct: number        // 主力净占比 %
}

// 腾讯财经资金流（qt.gtimg.cn/q=ff_，GBK）：东财不可达时的备用源
// 字段：[0]代码 [1]主力流入(万) [2]主力流出(万) [3]主力净流入(万) [4]主力净占比% [5]散户流入 [6]散户流出 [7]散户净流入 [8]散户净占比 [12]名称
async function fetchQQFundFlows(codes: string[]): Promise<FundFlow[]> {
  const pairs = codes.map((c) => ({ code: c, sym: toQQSymbol(c) })).filter((p): p is { code: string; sym: string } => !!p.sym)
  if (pairs.length === 0) return []
  try {
    const text = await fetchText(`https://qt.gtimg.cn/q=${pairs.map((p) => `ff_${p.sym}`).join(',')}`, 'gbk')
    const out: FundFlow[] = []
    for (const { code, sym } of pairs) {
      const m = text.match(new RegExp(`v_ff_${sym}="([^"]*)"`))
      if (!m) continue
      const f = m[1].split('~')
      const n = (i: number) => { const v = parseFloat(f[i]); return Number.isFinite(v) ? +v.toFixed(1) : 0 }
      if (f.length < 13 || (n(1) === 0 && n(2) === 0)) continue
      out.push({
        code, name: f[12] || code.split('.')[0],
        mainInWan: n(3), superLargeWan: 0, largeWan: 0,
        midWan: 0, retailWan: n(7),
        mainPct: typeof parseFloat(f[4]) === 'number' && Number.isFinite(parseFloat(f[4])) ? +parseFloat(f[4]).toFixed(2) : 0,
      })
    }
    return out
  } catch { return [] }
}

export async function fetchFundFlows(codes: string[]): Promise<FundFlow[]> {
  const uniq = [...new Set(codes)]
  const out: FundFlow[] = []
  const sources: string[] = []
  const wan = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? +(v / 1e4).toFixed(1) : 0)
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH)
    const secids = batch.map((c) => toSecid(c)).join(',')
    try {
      const json = window.agentcore?.market
        ? await window.agentcore.market.fundflow(secids)
        : await (await fetch(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=f12,f14,f62,f66,f72,f78,f84,f184`)).json()
      const diff: Record<string, unknown>[] = (json as { data?: { diff?: Record<string, unknown>[] } })?.data?.diff ?? []
      for (const f of diff) {
        const raw = String(f.f12 ?? '')
        const code = batch.find((c) => c.split('.')[0].toUpperCase() === raw.toUpperCase())
        if (!code) continue
        out.push({
          code, name: String(f.f14 ?? raw),
          mainInWan: wan(f.f62), superLargeWan: wan(f.f66), largeWan: wan(f.f72),
          midWan: wan(f.f78), retailWan: wan(f.f84),
          mainPct: typeof f.f184 === 'number' ? +f.f184.toFixed(2) : 0,
        })
      }
      if (diff.length > 0 && !sources.includes('东方财富')) sources.push('东方财富')
    } catch { /* 该批失败跳过，走腾讯兜底 */ }
  }
  // 东财未覆盖（失败/缺只）的标的 → 腾讯财经 ff_ 兜底
  const missing = uniq.filter((c) => !out.some((f) => f.code === c))
  if (missing.length > 0) {
    const qq = await fetchQQFundFlows(missing)
    if (qq.length > 0) {
      out.push(...qq)
      sources.push('腾讯财经')
    }
  }
  sourceStatus.fundflow = sources.join(' + ') || '全部不可达'
  return out
}

// ===== Python 本地数据桥（AkShare 快照 + BaoStock K线，数据中心一键启动后自动接入）=====
export const PY_BRIDGE = 'http://127.0.0.1:17895'
export const pyBridge = { online: false, akshare: false, baostock: false, checkedAt: 0 }

export async function probePyBridge(force = false): Promise<typeof pyBridge> {
  if (!force && Date.now() - pyBridge.checkedAt < 15000) return pyBridge
  try {
    const r = await fetch(`${PY_BRIDGE}/health`, { signal: AbortSignal.timeout(1500) })
    const j = await r.json()
    pyBridge.online = !!j?.ok
    pyBridge.akshare = !!j?.akshare
    pyBridge.baostock = !!j?.baostock
  } catch {
    pyBridge.online = false
    pyBridge.akshare = false
    pyBridge.baostock = false
  }
  pyBridge.checkedAt = Date.now()
  return pyBridge
}

async function fetchBridgeQuotes(codes: string[], freqOf: (c: string) => string): Promise<Quote[]> {
  const out: Quote[] = []
  for (const code of codes) {
    if (!/\.(SH|SZ|BJ)$/.test(code)) continue
    try {
      const r = await fetch(`${PY_BRIDGE}/quote?code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const j = await r.json()
      const p = Number(j?.price) || 0
      if (p <= 0) continue
      out.push({
        code, name: String(j?.name ?? code.split('.')[0]),
        preClose: Number(j?.preClose) || 0, open: Number(j?.open) || 0,
        high: Number(j?.high) || 0, low: Number(j?.low) || 0, close: p,
        pctChg: Number(j?.pctChg) || 0, volumeWan: +(Number(j?.volumeWan) || 0).toFixed(2),
        amountYi: +(Number(j?.amountYi) || 0).toFixed(2), turnover: Number(j?.turnover) || 0,
        freq: freqOf(code), points: 1, collecting: true,
      })
    } catch { /* 单只失败跳过 */ }
  }
  return out
}

async function fetchBridgeKline(code: string, lmt: number): Promise<KPoint[]> {
  try {
    const r = await fetch(`${PY_BRIDGE}/kline?code=${encodeURIComponent(code)}&n=${lmt}`, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return []
    const j = await r.json()
    const items: Record<string, number | string>[] = j?.items ?? []
    return items
      .map((it) => ({
        date: String(it.date ?? ''), open: Number(it.open) || 0, high: Number(it.high) || 0,
        low: Number(it.low) || 0, close: Number(it.close) || 0,
        volume: Number(it.volume) || 0, amount: Number(it.amount) || 0,
      }))
      .filter((k) => k.date && k.close > 0)
      .slice(-lmt)
  } catch { return [] }
}

// ===== 可选 Key 数据源（数据中心「数据源」页配置 Key 后自动加入冗余链）=====
const n0 = (v: unknown): number => num(v) ?? 0

function baseQuote(code: string, freq: string): Quote {
  return { code, name: code.split('.')[0], preClose: 0, open: 0, high: 0, low: 0, close: 0, pctChg: 0, volumeWan: 0, amountYi: 0, turnover: 0, freq, points: 1, collecting: true }
}

// 智兔数服：api.zhituapi.com/hs/real/ssjy/{6位码}?token=（A股实时快照，免费 Token）
async function fetchZhiTuQuotes(codes: string[], freqOf: (c: string) => string): Promise<Quote[]> {
  const token = getDsKey('zhitu')
  if (!token) return []
  const out: Quote[] = []
  for (const code of codes) {
    if (!/\.(SH|SZ|BJ)$/.test(code)) continue
    try {
      const j = await getJson(`https://api.zhituapi.com/hs/real/ssjy/${code.split('.')[0]}?token=${encodeURIComponent(token)}`, 'quotes')
      const p = n0(j?.p)
      if (!p) continue
      const yc = n0(j?.yc)
      out.push({
        ...baseQuote(code, freqOf(code)),
        preClose: yc, open: n0(j?.o), high: n0(j?.h), low: n0(j?.l), close: p,
        pctChg: n0(j?.pc) || (yc > 0 ? +(((p - yc) / yc) * 100).toFixed(2) : 0),
        volumeWan: +(n0(j?.v) / 1e4).toFixed(2),   // 量（手）→ 万手
        amountYi: +(n0(j?.cje) / 1e8).toFixed(2),  // 额（元）→ 亿
        turnover: n0(j?.hs),
      })
    } catch { /* 单只失败跳过 */ }
  }
  return out
}

// 聚合数据：web.juhe.cn:8080/finance/stock/hs?stock=sh600519&key=（A股快照，字段做容错解析）
async function fetchJuheQuotes(codes: string[], freqOf: (c: string) => string): Promise<Quote[]> {
  const key = getDsKey('juhe')
  if (!key) return []
  const out: Quote[] = []
  for (const code of codes) {
    const sym = toQQSymbol(code)
    if (!sym || sym.startsWith('bj')) continue // 聚合仅沪深
    try {
      const j = await getJson(`https://web.juhe.cn/finance/stock/hs?stock=${sym}&key=${encodeURIComponent(key)}`, 'quotes')
      const d = (j?.result?.[0]?.data ?? {}) as Record<string, unknown>
      const p = n0(d.nowPri)
      if (!p) continue
      const yc = n0(d.yesPrice ?? d.closePri ?? d.yesPclose)
      out.push({
        ...baseQuote(code, freqOf(code)),
        name: typeof d.name === 'string' ? d.name : code.split('.')[0],
        preClose: yc, open: n0(d.openPri), high: n0(d.highPrice), low: n0(d.lowPrice), close: p,
        pctChg: n0(d.increPer ?? d.increasePer) || (yc > 0 ? +(((p - yc) / yc) * 100).toFixed(2) : 0),
        volumeWan: +(n0(d.traNumber) / 1e4).toFixed(2),
        amountYi: +(n0(d.traAmount) / 1e8).toFixed(2),
        turnover: n0(d.turnover),
      })
    } catch { /* 单只失败跳过 */ }
  }
  return out
}

// 美股 Key 源依次尝试：Alpha Vantage → Finnhub → Twelve Data → Polygon（返回首个成功者及其源名）
async function fetchUsKeyQuote(code: string, freq: string): Promise<{ q: Quote; src: string } | null> {
  const sym = code.split('.')[0]
  const avKey = getDsKey('alphavantage')
  if (avKey) {
    try {
      const j = await getJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${encodeURIComponent(avKey)}`, 'quotes')
      const g = (j?.['Global Quote'] ?? {}) as Record<string, string>
      const p = n0(g['05. price'])
      if (p > 0) {
        const yc = n0(g['08. previous close'])
        return {
          src: 'AlphaVantage',
          q: { ...baseQuote(code, freq), preClose: yc, close: p, pctChg: n0(String(g['10. change percent'] ?? '').replace('%', '')) || (yc > 0 ? +(((p - yc) / yc) * 100).toFixed(2) : 0), volumeWan: +(n0(g['06. volume']) / 1e4).toFixed(2) },
        }
      }
    } catch { /* 下一源 */ }
  }
  const fhKey = getDsKey('finnhub')
  if (fhKey) {
    try {
      const j = await getJson(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${encodeURIComponent(fhKey)}`, 'quotes')
      const p = n0(j?.c)
      if (p > 0) {
        const yc = n0(j?.pc)
        return {
          src: 'Finnhub',
          q: { ...baseQuote(code, freq), preClose: yc, open: n0(j?.o), high: n0(j?.h), low: n0(j?.l), close: p, pctChg: yc > 0 ? +(((p - yc) / yc) * 100).toFixed(2) : 0 },
        }
      }
    } catch { /* 下一源 */ }
  }
  const tdKey = getDsKey('twelvedata')
  if (tdKey) {
    try {
      const j = await getJson(`https://api.twelvedata.com/quote?symbol=${sym}&apikey=${encodeURIComponent(tdKey)}`, 'quotes')
      const p = n0(j?.close)
      if (p > 0) {
        const yc = n0(j?.previous_close)
        return {
          src: 'TwelveData',
          q: { ...baseQuote(code, freq), name: typeof j?.name === 'string' ? j.name : sym, preClose: yc, open: n0(j?.open), high: n0(j?.high), low: n0(j?.low), close: p, pctChg: n0(j?.percent_change) || (yc > 0 ? +(((p - yc) / yc) * 100).toFixed(2) : 0), volumeWan: +(n0(j?.volume) / 1e4).toFixed(2) },
        }
      }
    } catch { /* 下一源 */ }
  }
  const pgKey = getDsKey('polygon')
  if (pgKey) {
    try {
      const j = await getJson(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${encodeURIComponent(pgKey)}`, 'quotes')
      const r = (j?.results?.[0] ?? {}) as Record<string, number>
      const p = n0(r?.c)
      if (p > 0) {
        const o = n0(r?.o)
        return {
          src: 'Polygon',
          q: { ...baseQuote(code, freq), open: o, high: n0(r?.h), low: n0(r?.l), close: p, preClose: o, pctChg: o > 0 ? +(((p - o) / o) * 100).toFixed(2) : 0, volumeWan: +(n0(r?.v) / 1e4).toFixed(2) },
        }
      }
    } catch { /* 无更多源 */ }
  }
  return null
}

// Tushare Pro 日 K（HTTP POST，积分制免费 Token；A股 K 线兜底）
async function fetchTushareKline(code: string, lmt: number): Promise<KPoint[]> {
  const token = getDsKey('tushare')
  if (!token || !/\.(SH|SZ|BJ)$/.test(code)) return []
  const tsCode = code.split('.')[0] + '.' + code.split('.')[1] // 600519.SH
  const end = new Date()
  const start = new Date(end.getTime() - Math.max(lmt * 2.2, 60) * 86400000)
  const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const body = JSON.stringify({ api_name: 'daily', token, params: { ts_code: tsCode, start_date: fmt(start), end_date: fmt(end) }, fields: 'trade_date,open,high,low,close,vol,amount' })
  try {
    const text = window.agentcore?.market
      ? await window.agentcore.market.post('https://api.tushare.pro', body)
      : await (await fetch('https://api.tushare.pro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).text()
    const j = JSON.parse(text)
    if (j?.code !== 0) return []
    const fields: string[] = j?.data?.fields ?? []
    const items: unknown[][] = j?.data?.items ?? []
    const idx = (n: string) => fields.indexOf(n)
    return items
      .map((it) => ({
        date: String(it[idx('trade_date')] ?? '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        open: Number(it[idx('open')]) || 0,
        high: Number(it[idx('high')]) || 0,
        low: Number(it[idx('low')]) || 0,
        close: Number(it[idx('close')]) || 0,
        volume: (Number(it[idx('vol')]) || 0) * 100,      // 手 → 股
        amount: (Number(it[idx('amount')]) || 0) * 1000,  // 千元 → 元
      }))
      .filter((k) => k.date && k.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-lmt)
  } catch { return [] }
}

// ===== 东方财富妙想（官方金融数据 AI 接口，mkapi2.dfcfs.com，需用户 API Key）=====
export const MX_KEY = 'agentcore-miaoxiang-key'

export async function queryMiaoxiang(apiKey: string, toolQuery: string): Promise<string> {
  if (window.agentcore?.market?.mxquery) {
    return window.agentcore.market.mxquery(apiKey, toolQuery)
  }
  const r = await fetch('https://mkapi2.dfcfs.com/finskillshub/api/claw/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ toolQuery }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  return typeof j === 'string' ? j : JSON.stringify(j, null, 2)
}

// 读取监控列表完整快照（含最近轮询价格）
export function loadWatchQuotes(): Quote[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (raw) return JSON.parse(raw) as Quote[]
  } catch { /* 忽略损坏缓存 */ }
  return []
}

// 识别消息中提及的标的：监控列表名称命中 + 显式代码（6位A股 / 0开头5位港股 / 全大写美股）
export function extractMentionedCodes(userText: string): string[] {
  const list = loadWatchQuotes()
  const mentioned = new Set<string>()
  for (const w of list) if (w.name && w.name.length >= 2 && userText.includes(w.name)) mentioned.add(w.code)
  const patterns = [/\b\d{6}\b/g, /\b0\d{4}\b/g, /\b[A-Z]{1,5}\b/g]
  const NOT_TICKER = new Set(['AI', 'OK', 'MACD', 'RSI', 'KDJ', 'CCI', 'BOLL', 'MA', 'EMA', 'PE', 'PB', 'ROE', 'ETF', 'LOF', 'IT', 'API', 'GDP', 'CPI', 'IPO', 'US', 'HK', 'SH', 'SZ', 'BJ'])
  for (const re of patterns) {
    for (const m of userText.matchAll(re)) {
      if (NOT_TICKER.has(m[0])) continue
      const c = normalizeCode(m[0])
      if (c) mentioned.add(c)
    }
  }
  return [...mentioned]
}

// ===== 对话行情上下文：把行情采集的实时数据注入模型推理 =====
// 让模型自动"看到"自选股快照 + 消息中提及标的的实时行情与主力资金流
export async function buildMarketContext(userText: string): Promise<string> {
  const list = loadWatchQuotes()
  const lines: string[] = []
  const now = new Date().toLocaleString('zh-CN', { hour12: false })

  // 1) 自选股实时快照（行情采集页 15 秒轮询维护，本地缓存即新鲜数据）
  const tracked = list.filter((w) => w.close > 0)
  if (tracked.length > 0) {
    lines.push(`【自选股实时快照 · ${now}】`)
    lines.push(tracked.map((w) => `${w.name}(${w.code}) ${w.close.toFixed(2)}元 ${w.pctChg >= 0 ? '+' : ''}${w.pctChg}%`).join('；'))
  }

  // 2) 识别消息中提及的标的
  const mentioned = new Set<string>(extractMentionedCodes(userText))
  if (mentioned.size === 0) return lines.join('\n')

  // 3) 提及但未监控的标的：实时拉取快照
  const extra = [...mentioned].filter((c) => !tracked.some((w) => w.code === c)).slice(0, 5)
  if (extra.length > 0) {
    try {
      const { quotes } = await fetchLiveQuotes(extra, () => '1min')
      if (quotes.length > 0) {
        lines.push(`【消息提及标的 · 实时拉取 · 源:${sourceStatus.quotes}】`)
        lines.push(quotes.map((q) => `${q.name}(${q.code}) ${q.close.toFixed(2)} ${q.pctChg >= 0 ? '+' : ''}${q.pctChg}% 开${q.open.toFixed(2)} 高${q.high.toFixed(2)} 低${q.low.toFixed(2)}${q.turnover ? ` 换手${q.turnover}%` : ''}`).join('；'))
      }
    } catch { /* 实时拉取失败不影响主流程 */ }
  }

  // 4) 提及标的的主力资金流（东财源，最多 5 只）
  const flowCodes = [...mentioned].slice(0, 5)
  if (flowCodes.length > 0) {
    try {
      const flows = await fetchFundFlows(flowCodes)
      if (flows.length > 0) {
        lines.push('【主力资金流·今日】' + flows.map((f) => `${f.name} 主力${f.mainInWan >= 0 ? '净流入' : '净流出'}${Math.abs(f.mainInWan / 10000).toFixed(2)}亿(净占比${f.mainPct}%)`).join('；'))
      }
    } catch { /* 资金流失败不影响 */ }
  }
  return lines.join('\n')
}

// ===== Yahoo Finance 国际接口（免费无 Key，美股/港股/全球兜底源）=====
interface YahooChart {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number
        regularMarketDayHigh?: number; regularMarketDayLow?: number; regularMarketVolume?: number
        longName?: string; shortName?: string; symbol?: string
      }
      timestamp?: number[]
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] }
    }[]
  }
}

async function yahooFetch(path: string, ipc: 'yquote' | 'ykline', symbol: string): Promise<YahooChart> {
  if (window.agentcore?.market) {
    return (ipc === 'yquote' ? window.agentcore.market.yquote(symbol) : window.agentcore.market.ykline(symbol, path)) as Promise<YahooChart>
  }
  const url = ipc === 'yquote'
    ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
    : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(path)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)
  return r.json()
}

// 代码 → Yahoo symbol：AAPL.US→AAPL；00700.HK→0700.HK
export function toYahooSymbol(code: string): string {
  const s = code.trim().toUpperCase()
  if (s.endsWith('.US')) return s.slice(0, -3)
  if (s.endsWith('.HK')) return s.slice(0, -3).replace(/^0+(?=\d)/, '').padStart(4, '0') + '.HK'
  return s
}

export async function fetchYahooQuote(code: string, freq: string): Promise<Quote | null> {
  const json = await yahooFetch('', 'yquote', toYahooSymbol(code))
  const res = json.chart?.result?.[0]
  const meta = res?.meta
  const closes = res?.indicators?.quote?.[0]?.close?.filter((x): x is number => typeof x === 'number') ?? []
  const close = meta?.regularMarketPrice ?? closes[closes.length - 1]
  if (close == null || !Number.isFinite(close)) return null
  const preClose = meta?.chartPreviousClose ?? meta?.previousClose ?? closes[closes.length - 2] ?? close
  const vol = meta?.regularMarketVolume ?? 0
  return {
    code, name: meta?.shortName ?? meta?.longName ?? toYahooSymbol(code),
    close: +close.toFixed(2),
    pctChg: preClose ? +(((close - preClose) / preClose) * 100).toFixed(2) : 0,
    preClose: +preClose.toFixed(2),
    open: close, // Yahoo 快照接口不含当日 open 时以最新价近似
    high: +(meta?.regularMarketDayHigh ?? close).toFixed(2),
    low: +(meta?.regularMarketDayLow ?? close).toFixed(2),
    volumeWan: +((vol / 1e4).toFixed(0)),
    amountYi: 0, // Yahoo 免费接口无成交额字段
    turnover: 0,
    freq, points: 0, collecting: true,
  }
}

export async function fetchYahooKline(code: string, range = '1y'): Promise<KPoint[]> {
  const json = await yahooFetch(range, 'ykline', toYahooSymbol(code))
  const res = json.chart?.result?.[0]
  const ts = res?.timestamp ?? []
  const q = res?.indicators?.quote?.[0]
  if (!q) return []
  const out: KPoint[] = []
  ts.forEach((t, i) => {
    const c = q.close?.[i]
    if (typeof c !== 'number') return
    out.push({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: +(q.open?.[i] ?? c).toFixed(2), close: +c.toFixed(2),
      high: +(q.high?.[i] ?? c).toFixed(2), low: +(q.low?.[i] ?? c).toFixed(2),
      volume: q.volume?.[i] ?? 0, amount: 0,
    })
  })
  return out
}

// ===== 技术指标计算（通达信/同花顺口径，日线级）=====
const last = <T,>(xs: T[]): T => xs[xs.length - 1]

function smaCn(xs: number[], n: number, m = 1): number[] {
  const out: number[] = []
  let prev = 0
  xs.forEach((x, i) => { prev = i === 0 ? x : (x * m + prev * (n - m)) / n; out.push(prev) })
  return out
}
function ema(xs: number[], n: number): number[] {
  const a = 2 / (n + 1)
  const out: number[] = []
  let prev = 0
  xs.forEach((x, i) => { prev = i === 0 ? x : a * x + (1 - a) * prev; out.push(prev) })
  return out
}
function ma(xs: number[], n: number): number {
  const seg = xs.slice(-n)
  return seg.reduce((a, b) => a + b, 0) / seg.length
}
function rsi(closes: number[], n: number): number {
  const up = closes.map((c, i) => (i === 0 ? 0 : Math.max(c - closes[i - 1], 0)))
  const ab = closes.map((c, i) => (i === 0 ? 0 : Math.abs(c - closes[i - 1])))
  const su = last(smaCn(up, n, 1))
  const sa = last(smaCn(ab, n, 1))
  return sa === 0 ? 50 : (su / sa) * 100
}

// 由真实日 K 计算全套指标，产出与 iFinD 种子同构的 TechRow
export function computeTech(code: string, name: string, ks: KPoint[]): TechRow | null {
  if (ks.length < 26) return null
  const closes = ks.map((k) => k.close)
  const highs = ks.map((k) => k.high)
  const lows = ks.map((k) => k.low)
  const close = last(closes)

  const ma5 = ma(closes, 5)
  const ma20 = ma(closes, 20)

  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const difSeries = e12.map((v, i) => v - e26[i])
  const deaSeries = ema(difSeries, 9)
  const dif = last(difSeries)
  const dea = last(deaSeries)
  const macd = 2 * (dif - dea)

  // KDJ(9,3,3)
  const rsv = closes.map((c, i) => {
    const from = Math.max(0, i - 8)
    const hh = Math.max(...highs.slice(from, i + 1))
    const ll = Math.min(...lows.slice(from, i + 1))
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100
  })
  const kSeries = smaCn(rsv, 3, 1)
  const dSeries = smaCn(kSeries, 3, 1)
  const k = last(kSeries)
  const d = last(dSeries)
  const j = 3 * k - 2 * d

  // BOLL(20,2)
  const seg = closes.slice(-20)
  const std = Math.sqrt(seg.reduce((a, x) => a + (x - ma20) ** 2, 0) / seg.length)

  // CCI(14)
  const tp = ks.map((x) => (x.high + x.low + x.close) / 3)
  const tpMa = ma(tp, 14)
  const md = tp.slice(-14).reduce((a, x) => a + Math.abs(x - tpMa), 0) / 14
  const cci = md === 0 ? 0 : (last(tp) - tpMa) / (0.015 * md)

  return {
    code, name,
    ma5: +ma5.toFixed(2), ma20: +ma20.toFixed(2),
    rsi6: +rsi(closes, 6).toFixed(1), rsi12: +rsi(closes, 12).toFixed(1),
    dif: +dif.toFixed(3), dea: +dea.toFixed(3), macd: +macd.toFixed(3),
    k: +k.toFixed(1), d: +d.toFixed(1), j: +j.toFixed(1),
    bollMid: +ma20.toFixed(2), bollUp: +(ma20 + 2 * std).toFixed(2), bollDn: +(ma20 - 2 * std).toFixed(2),
    cci: +cci.toFixed(1),
    close,
  }
}
