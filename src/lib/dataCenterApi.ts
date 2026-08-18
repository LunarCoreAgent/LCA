// ===== 数据中心真实采集层（全部免 Key 公开接口，经主进程 IPC market:text 抓取，浏览器态 fetch 兜底）=====
// 新闻公告：东财栏目资讯流按关键词分拣（政府政策/出口管制/矿产/国际）
// 金融新闻：东财国内财经 + 环球/海外 + 新浪滚动新闻；金价银价：新浪贵金属（纽约金银 + 沪金沪银）
// 打板情绪：东财 push2ex 涨停/跌停/炸板/昨涨停四池；基本面：东财 F10 主要指标 + push2 估值
// ETF期权：新浪 T 型报价 + 希腊字母（交易所预算值）；研报：东财 reportapi；资金面：龙虎榜 + 两融（东财 datacenter）
import { fetchText, loadWatchCodes, sourceStatus, toSecid, probePyBridge } from './marketApi'
import { getDsKey } from './dataSources'

export interface NewsItem { id: string; title: string; summary: string; time: string; source: string; url: string }
export interface MetalQuote { key: string; name: string; price: number; pct: number; high: number; low: number; date: string; unit: string }
export interface LimitPoolItem { code: string; name: string; price: number; pct: number; lbc: number; firstTime: string; fundYi: number; zbCount: number; industry: string }
export interface LimitOverview {
  date: string; zt: number; dt: number; zb: number; zbRate: string; height: number
  ladder: { level: string; stocks: string[] }[]; pool: LimitPoolItem[]
  yzAvg: string; yzPromote: string; yzCount: number
}
export interface BasicRow { code: string; name: string; pe: string; pb: string; ps: string; dv: string; roe: string; rev: string; profit: string; gross: string; reportDate: string; mktCapYi: string }
export interface OptionRow { code: string; name: string; cp: '认购' | '认沽'; last: number; pct: number; oi: number; strike: number; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; iv: number | null }
export interface ReportItem { id: string; title: string; stock: string; org: string; rating: string; date: string; eps: string[]; target: string; industry: string; url: string }
export interface LhbItem { code: string; name: string; reason: string; close: number; pct: number; netYi: number; buyYi: number; sellYi: number; date: string }
export interface MarginInfo { date: string; rzyeYi: number; rqyeYi: number; rzmreYi: number; rzjmeYi: number; chgYi: number }

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const EM_GAP = 420 // 东财系请求最小间隔（防风控）

async function emJson(url: string): Promise<any> {
  const txt = await fetchText(url, 'utf8')
  const t = txt.trim()
  const body = t.startsWith('{') || t.startsWith('[') ? t : t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))
  return JSON.parse(body)
}

// ===== 新闻公告 / 金融新闻：东财栏目资讯流（np-listapi，免 Key）=====
// 栏目：344 要闻 / 345 国内财经 / 346 环球 / 347 海外 / 348 产经商品
async function fetchEmColumn(column: number, pageSize: number): Promise<NewsItem[]> {
  const url = `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=${column}&order=1&needInteractData=0&page_index=1&page_size=${pageSize}&req_trace=${Date.now()}`
  const j = await emJson(url)
  const list: any[] = j?.data?.list ?? []
  return list.map((it) => ({
    id: String(it.code ?? it.realSort ?? Math.random()),
    title: String(it.title ?? ''),
    summary: String(it.summary ?? '').slice(0, 120),
    time: String(it.showTime ?? '').slice(5, 16),
    source: String(it.mediaName ?? '东方财富'),
    url: String(it.uniqueUrl ?? it.url ?? ''),
  })).filter((n) => n.title)
}

// 新浪滚动新闻（国内财经 lid=2516）
async function fetchSinaRoll(lid: number, num: number): Promise<NewsItem[]> {
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&k=&num=${num}&page=1`
  const j = await emJson(url)
  const list: any[] = j?.result?.data ?? []
  return list.map((it) => ({
    id: String(it.id ?? it.intime ?? Math.random()),
    title: String(it.title ?? ''),
    summary: '',
    time: it.ctime ? new Date(Number(it.ctime) * 1000).toLocaleString('zh-CN', { hour12: false }).slice(5, 16) : '',
    source: '新浪财经',
    url: String(it.url ?? ''),
  })).filter((n) => n.title)
}

const RE_POLICY = /国务院|中共中央|中央|央行|人民银行|财政部|发改委|工信部|证监会|商务部|外交部|国资委|监管|政策|会议|部署|批复|通知|条例|规划/
const RE_EXPORT = /出口管制|实体清单|管制|制裁|关税|禁运|两用物项|限制出口|出口限制|清单/
const RE_MINERAL = /矿|稀土|锂|钴|镍|铜|铝|锌|铀|钼|钨|锑|镓|锗|石墨|黄金|白银|贵金属|有色|开采|储量/

export interface AnnounceGroups { policy: NewsItem[]; exportCtrl: NewsItem[]; mineral: NewsItem[]; intl: NewsItem[] }

// 新闻公告：政府政策 / 出口管制 / 矿产信息 / 国际新闻
export async function fetchAnnouncements(): Promise<AnnounceGroups> {
  const out: AnnounceGroups = { policy: [], exportCtrl: [], mineral: [], intl: [] }
  try {
    const cols = [344, 346, 347, 348]
    const pools: NewsItem[][] = []
    for (const c of cols) {
      try { pools.push(await fetchEmColumn(c, 40)) } catch { pools.push([]) }
      await delay(EM_GAP)
    }
    const all = pools.flat()
    const seen = new Set<string>()
    const uniq = all.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    const [ywh, gjj, ow, cj] = pools
    for (const n of uniq) {
      const text = n.title + n.summary
      if (RE_EXPORT.test(text)) out.exportCtrl.push(n)
      else if (RE_MINERAL.test(text) && (cj.includes(n) || ywh.includes(n))) out.mineral.push(n)
      else if (RE_POLICY.test(text) && ywh.includes(n)) out.policy.push(n)
      else if (gjj.includes(n) || ow.includes(n)) out.intl.push(n)
      else if (RE_POLICY.test(text)) out.policy.push(n)
      else if (RE_MINERAL.test(text)) out.mineral.push(n)
    }
    out.policy = out.policy.slice(0, 8)
    out.exportCtrl = out.exportCtrl.slice(0, 8)
    out.mineral = out.mineral.slice(0, 8)
    out.intl = out.intl.slice(0, 8)
    const got = out.policy.length + out.exportCtrl.length + out.mineral.length + out.intl.length
    sourceStatus.news = got > 0 ? '东方财富资讯' : '不可达'
    if (got === 0) throw new Error('新闻公告源不可达')
  } catch (e) { sourceStatus.news = '不可达'; if (out.policy.length + out.exportCtrl.length + out.mineral.length + out.intl.length === 0) throw e }
  return out
}

// 金融新闻：国内金融 + 国际金融
export async function fetchFinNews(): Promise<{ cn: NewsItem[]; intl: NewsItem[] }> {
  const out = { cn: [] as NewsItem[], intl: [] as NewsItem[] }
  const sources = new Set<string>()
  try { out.cn = await fetchEmColumn(345, 20); sources.add('东方财富') } catch { /* */ }
  await delay(EM_GAP)
  try { out.intl = (await fetchEmColumn(346, 12)).concat(await fetchEmColumn(347, 10)); sources.add('东方财富') } catch { /* */ }
  if (out.cn.length === 0) {
    try { out.cn = await fetchSinaRoll(2516, 20); sources.add('新浪财经') } catch { /* */ }
  }
  // 国际去重截断
  const seen = new Set<string>()
  out.intl = out.intl.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).slice(0, 16)
  out.cn = out.cn.slice(0, 16)
  sourceStatus.finnews = out.cn.length + out.intl.length > 0 ? [...sources].join('+') : '不可达'
  if (out.cn.length + out.intl.length === 0) throw new Error('金融新闻源不可达')
  return out
}

// ===== 金价银价：新浪贵金属（纽约金/银 hf_，沪金/沪银连续 nf_，GBK 文本）=====
export async function fetchMetals(): Promise<MetalQuote[]> {
  try {
    const raw = await fetchText('https://hq.sinajs.cn/list=hf_GC,hf_SI,nf_AU0,nf_AG0', 'gbk', 'https://finance.sina.com.cn')
    const out: MetalQuote[] = []
    const parseHf = (key: string, body: string, unit: string) => {
      const f = body.split(',')
      const price = parseFloat(f[0]), pre = parseFloat(f[7])
      if (!Number.isFinite(price) || price <= 0) return
      out.push({
        key, name: f[13] ?? key, price,
        pct: Number.isFinite(pre) && pre > 0 ? +(((price - pre) / pre) * 100).toFixed(2) : 0,
        high: parseFloat(f[4]) || price, low: parseFloat(f[5]) || price,
        date: f[12] ?? '', unit,
      })
    }
    const parseNf = (key: string, body: string, unit: string) => {
      const f = body.split(',')
      const price = parseFloat(f[8]), pre = parseFloat(f[10])
      if (!Number.isFinite(price) || price <= 0) return
      out.push({
        key, name: f[0] ?? key, price,
        pct: Number.isFinite(pre) && pre > 0 ? +(((price - pre) / pre) * 100).toFixed(2) : 0,
        high: parseFloat(f[3]) || price, low: parseFloat(f[4]) || price,
        date: f[17] ?? '', unit,
      })
    }
    for (const m of raw.matchAll(/var hq_str_(\w+)="([^"]*)"/g)) {
      const [, sym, body] = m
      if (!body) continue
      if (sym.startsWith('hf_')) parseHf(sym, body, '美元/盎司')
      else if (sym.startsWith('nf_')) parseNf(sym, body, '元/克')
    }
    sourceStatus.metals = out.length > 0 ? '新浪财经' : '不可达'
    if (out.length === 0) throw new Error('贵金属源不可达')
    return out
  } catch (e) { sourceStatus.metals = '不可达'; throw e }
}

// ===== 打板情绪：东财 push2ex 涨停/跌停/炸板/昨涨停四池 =====
const ZT_UT = '7eea3edcaed734bea9cbfc24409ed989'
const fmtZtTime = (t: unknown) => { const s = String(t ?? '').padStart(6, '0'); return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}` }
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

async function fetchZtPool(endpoint: string, date: string, sort = 'fbt:asc'): Promise<any[]> {
  const url = `https://push2ex.eastmoney.com/${endpoint}?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=${encodeURIComponent(sort)}&date=${date}`
  const j = await emJson(url)
  return j?.data?.pool ?? []
}

export async function fetchLimitOverview(): Promise<LimitOverview | null> {
  try {
    // 最近交易日回退（非交易日池为空）
    let date = '', zt: any[] = []
    for (let i = 0; i < 8; i++) {
      const ds = ymd(new Date(Date.now() - i * 86400000))
      try { zt = await fetchZtPool('getTopicZTPool', ds) } catch { zt = [] }
      if (zt.length > 0) { date = ds; break }
      await delay(EM_GAP)
    }
    if (!date) { sourceStatus.limitPool = '不可达'; throw new Error('涨停池源不可达') }
    await delay(EM_GAP)
    const dt = await fetchZtPool('getTopicDTPool', date).catch(() => [] as any[])
    await delay(EM_GAP)
    const zb = await fetchZtPool('getTopicZBPool', date).catch(() => [] as any[])
    await delay(EM_GAP)
    const yz = await fetchZtPool('getYesterdayZTPool', date).catch(() => [] as any[])

    const pool: LimitPoolItem[] = zt.map((it) => ({
      code: String(it.c ?? ''), name: String(it.n ?? ''),
      price: typeof it.p === 'number' ? +(it.p / 1000).toFixed(2) : 0,
      pct: typeof it.zdp === 'number' ? +it.zdp.toFixed(2) : 0,
      lbc: Number(it.lbc ?? it?.zttj?.ct ?? 0),
      firstTime: fmtZtTime(it.fbt),
      fundYi: typeof it.fund === 'number' ? +(it.fund / 1e8).toFixed(2) : 0,
      zbCount: Number(it.zbc ?? 0),
      industry: String(it.hybk ?? ''),
    })).sort((a, b) => b.lbc - a.lbc || a.firstTime.localeCompare(b.firstTime))

    // 连板梯队
    const groups = new Map<number, string[]>()
    for (const p of pool) {
      if (p.lbc < 2) continue
      const arr = groups.get(p.lbc) ?? []
      if (arr.length < 6) arr.push(p.name)
      groups.set(p.lbc, arr)
    }
    const ladder = [...groups.entries()].sort((a, b) => b[0] - a[0]).slice(0, 6)
      .map(([lv, stocks]) => ({ level: `${lv} 板`, stocks }))

    // 昨涨停今表现
    let yzAvg = '—', yzPromote = '—'
    if (yz.length > 0) {
      const pcts = yz.map((it) => (typeof it.zdp === 'number' ? it.zdp : null)).filter((v): v is number => v != null)
      if (pcts.length > 0) yzAvg = `${(pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(2)}%`
      yzPromote = `${Math.round((pcts.filter((v) => v >= 9.8).length / pcts.length) * 100)}%`
    }

    const ztN = zt.length, dtN = dt.length, zbN = zb.length
    sourceStatus.limitPool = '东方财富'
    return {
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      zt: ztN, dt: dtN, zb: zbN,
      zbRate: ztN + zbN > 0 ? `${((zbN / (ztN + zbN)) * 100).toFixed(1)}%` : '—',
      height: pool.reduce((m, p) => Math.max(m, p.lbc), 0),
      ladder, pool: pool.slice(0, 30), yzAvg, yzPromote, yzCount: yz.length,
    }
  } catch (e) { sourceStatus.limitPool = '不可达'; throw e }
}

// ===== 基本面估值增强源 A：理杏仁开放平台（POST JSON，Token 存本机，一次请求覆盖全部标的）=====
async function postJson(url: string, body: unknown): Promise<any> {
  const ipc = window.agentcore?.market?.post
  if (ipc) return JSON.parse(await ipc(url, JSON.stringify(body)))
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function fetchLixingerVal(codes: string[]): Promise<Map<string, { pe?: number; pb?: number; ps?: number; dv?: number; mc?: number }>> {
  const token = getDsKey('lixinger')
  const map = new Map<string, { pe?: number; pb?: number; ps?: number; dv?: number; mc?: number }>()
  if (!token || codes.length === 0) return map
  const stockCodes = codes.map((c) => c.split('.')[0])
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const j = await postJson('https://open.lixinger.com/api/cn/company/fundamental/non_financial', {
    token,
    stock_codes: stockCodes,
    metrics_list: ['pe_ttm', 'pb', 'ps_ttm', 'dv_ratio', 'mc'],
    date,
  })
  if (j?.error) throw new Error(j.error.message ?? '理杏仁接口错误')
  for (const d of j?.data ?? []) {
    const code = codes.find((c) => c.split('.')[0] === String(d.stock_code ?? ''))
    if (!code) continue
    const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    map.set(code, { pe: f(d.pe_ttm), pb: f(d.pb), ps: f(d.ps_ttm), dv: f(d.dv_ratio), mc: f(d.mc) })
  }
  return map
}

// ===== 基本面估值增强源 B：Python 本地数据桥（AkShare 乐咕乐股估值指标，免 Key）=====
async function fetchBridgeVal(codes: string[]): Promise<Map<string, { pe?: number; pb?: number; ps?: number; dv?: number; mc?: number }>> {
  const map = new Map<string, { pe?: number; pb?: number; ps?: number; dv?: number; mc?: number }>()
  const bridge = await probePyBridge()
  if (!bridge.online || !bridge.akshare || codes.length === 0) return map
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 60000) // akshare 全历史拉取较慢，桥内有 6h 缓存
  try {
    const r = await fetch(`http://127.0.0.1:17895/fundamental?codes=${encodeURIComponent(codes.join(','))}`, { signal: ctl.signal })
    if (!r.ok) return map
    const j = await r.json()
    for (const d of j?.items ?? []) {
      const code = codes.find((c) => c === String(d.code ?? ''))
      if (!code) continue
      const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
      map.set(code, { pe: f(d.pe_ttm), pb: f(d.pb), ps: f(d.ps_ttm), dv: f(d.dv_ratio), mc: typeof d.total_mv_wan === 'number' ? d.total_mv_wan / 10000 : undefined })
    }
  } catch { /* 桥超时/离线 */ } finally { clearTimeout(timer) }
  return map
}

// ===== 基本面：push2 估值（PE/PB/市值）+ 东财 F10 主要指标（ROE/毛利率/营收净利同比）=====
export async function fetchFundamentals(): Promise<BasicRow[]> {
  const codes = loadWatchCodes().filter((c) => /\.(SH|SZ|BJ)$/.test(c))
  if (codes.length === 0) { sourceStatus.basic = '无 A 股监控标的'; return [] }
  const out: BasicRow[] = []
  // 估值增强链：理杏仁（已配置 Token）→ Python桥·AkShare（在线）→ push2 兜底
  let enhance = new Map<string, { pe?: number; pb?: number; ps?: number; dv?: number; mc?: number }>()
  let valSrc = ''
  if (getDsKey('lixinger')) {
    try { enhance = await fetchLixingerVal(codes); if (enhance.size > 0) valSrc = '理杏仁' } catch { /* token 无效/超时，降级 */ }
  }
  if (enhance.size === 0) {
    try { enhance = await fetchBridgeVal(codes); if (enhance.size > 0) valSrc = 'Python桥·AkShare' } catch { /* 桥离线 */ }
  }
  sourceStatus.basicVal = valSrc
  // 估值批取（push2 ulist）
  const valMap = new Map<string, { pe: string; pb: string; cap: string }>()
  try {
    const secids = codes.map((c) => toSecid(c)).join(',')
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=f9,f12,f14,f20,f23,f115`
    const j = await emJson(url)
    for (const f of j?.data?.diff ?? []) {
      const raw = String(f.f12 ?? '')
      const code = codes.find((c) => c.split('.')[0] === raw)
      if (!code) continue
      const peTtm = typeof f.f115 === 'number' ? f.f115.toFixed(1) : '—'
      valMap.set(code, {
        pe: peTtm,
        pb: typeof f.f23 === 'number' ? f.f23.toFixed(2) : '—',
        cap: typeof f.f20 === 'number' ? (f.f20 / 1e8).toFixed(0) : '—',
      })
    }
  } catch { /* 估值源失败继续 F10 */ }
  // F10 主要指标（串行限流）
  for (const code of codes) {
    const name = code.split('.')[0]
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=SECUCODE,SECURITY_NAME_ABBR,REPORT_DATE,ROEJQ,XSMLL,TOTALOPERATEREVETZ,PARENTNETPROFITTZ&filter=(SECUCODE%3D%22${encodeURIComponent(code)}%22)&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=REPORT_DATE&source=HSF10&client=PC`
      const j = await emJson(url)
      const d = j?.result?.data?.[0]
      const v = valMap.get(code)
      const e = enhance.get(code)
      out.push({
        code, name: String(d?.SECURITY_NAME_ABBR ?? name),
        pe: e?.pe != null ? e.pe.toFixed(1) : v?.pe ?? '—',
        pb: e?.pb != null ? e.pb.toFixed(2) : v?.pb ?? '—',
        ps: e?.ps != null ? e.ps.toFixed(1) : '—',
        dv: e?.dv != null ? `${e.dv.toFixed(2)}%` : '—',
        mktCapYi: e?.mc != null ? e.mc.toFixed(0) : v?.cap ?? '—',
        roe: typeof d?.ROEJQ === 'number' ? `${d.ROEJQ.toFixed(1)}%` : '—',
        rev: typeof d?.TOTALOPERATEREVETZ === 'number' ? `${d.TOTALOPERATEREVETZ >= 0 ? '+' : ''}${d.TOTALOPERATEREVETZ.toFixed(1)}%` : '—',
        profit: typeof d?.PARENTNETPROFITTZ === 'number' ? `${d.PARENTNETPROFITTZ >= 0 ? '+' : ''}${d.PARENTNETPROFITTZ.toFixed(1)}%` : '—',
        gross: typeof d?.XSMLL === 'number' ? `${d.XSMLL.toFixed(1)}%` : '—',
        reportDate: String(d?.REPORT_DATE ?? '').slice(0, 10),
      })
    } catch {
      const v = valMap.get(code)
      const e = enhance.get(code)
      out.push({
        code, name,
        pe: e?.pe != null ? e.pe.toFixed(1) : v?.pe ?? '—',
        pb: e?.pb != null ? e.pb.toFixed(2) : v?.pb ?? '—',
        ps: e?.ps != null ? e.ps.toFixed(1) : '—',
        dv: e?.dv != null ? `${e.dv.toFixed(2)}%` : '—',
        mktCapYi: e?.mc != null ? e.mc.toFixed(0) : v?.cap ?? '—',
        roe: '—', rev: '—', profit: '—', gross: '—', reportDate: '',
      })
    }
    await delay(EM_GAP)
  }
  const f10ok = out.some((r) => r.roe !== '—')
  sourceStatus.basic = [f10ok ? '东方财富 F10' : '', valSrc, f10ok || valSrc ? '' : (out.length > 0 ? '东方财富（估值）' : '')].filter(Boolean).join(' + ') || '不可达'
  if (out.length === 0 || out.every((r) => r.roe === '—' && r.pe === '—')) { sourceStatus.basic = '不可达'; throw new Error('基本面源不可达') }
  return out
}

// ===== ETF 期权：新浪 T 型报价 + 希腊字母（交易所预算值，免本地 BSM）=====
export const OPTION_UNDERLYINGS = [
  { id: '510050', name: '50ETF', cate: '50ETF' },
  { id: '510300', name: '300ETF', cate: '300ETF' },
  { id: '510500', name: '500ETF', cate: '500ETF' },
  { id: '588000', name: '科创50ETF', cate: '科创50' },
]
const SINA_REF = 'https://stock.finance.sina.com.cn/'

async function sinaHqList(param: string): Promise<string[]> {
  const raw = await fetchText(`https://hq.sinajs.cn/list=${param}`, 'gbk', SINA_REF)
  const m = raw.match(/"([^"]*)"/)
  return m ? m[1].split(',') : []
}

export async function fetchOptionChain(underlying = '510050'): Promise<OptionRow[]> {
  try {
    const u = OPTION_UNDERLYINGS.find((x) => x.id === underlying) ?? OPTION_UNDERLYINGS[0]
    const meta = await emJson(`https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName?exchange=null&cate=${encodeURIComponent(u.cate)}`)
    const months: string[] = meta?.result?.data?.contractMonth ?? []
    if (months.length < 2) { sourceStatus.option = '不可达'; throw new Error('期权月份源不可达') }
    const yyMM = months[1].replace('-', '').slice(2) // 近月
    await delay(400)
    const upRaw = await sinaHqList(`OP_UP_${u.id}${yyMM}`)
    const dnRaw = await sinaHqList(`OP_DOWN_${u.id}${yyMM}`)
    const ups = upRaw.filter((x) => x.startsWith('CON_OP_')).map((x) => x.replace('CON_OP_', ''))
    const dns = dnRaw.filter((x) => x.startsWith('CON_OP_')).map((x) => x.replace('CON_OP_', ''))
    const all = [...ups.map((c) => ({ c, cp: '认购' as const })), ...dns.map((c) => ({ cp: '认沽' as const, c }))]
    if (all.length === 0) { sourceStatus.option = '不可达'; throw new Error('期权合约源不可达') }
    await delay(400)
    // T 型报价批量（按持仓量选主力合约）
    const tqRaw = await fetchText(`https://hq.sinajs.cn/list=${all.map((x) => 'CON_OP_' + x.c).join(',')}`, 'gbk', SINA_REF)
    const rows: OptionRow[] = []
    for (const m of tqRaw.matchAll(/var hq_str_CON_OP_(\w+)="([^"]*)"/g)) {
      const code = m[1]
      const v = m[2].split(',')
      if (v.length < 43) continue
      rows.push({
        code, name: v[37] ?? code, cp: ups.includes(code) ? '认购' : '认沽',
        last: parseFloat(v[2]) || 0, pct: parseFloat(v[6]) || 0,
        oi: parseFloat(v[5]) || 0, strike: parseFloat(v[7]) || 0,
        delta: null, gamma: null, theta: null, vega: null, iv: null,
      })
    }
    // 取持仓量最大的 8 个合约查希腊字母
    rows.sort((a, b) => b.oi - a.oi)
    const top = rows.slice(0, 8)
    await delay(400)
    const soRaw = await fetchText(`https://hq.sinajs.cn/list=${top.map((x) => 'CON_SO_' + x.code).join(',')}`, 'gbk', SINA_REF)
    for (const m of soRaw.matchAll(/var hq_str_CON_SO_(\w+)="([^"]*)"/g)) {
      const row = top.find((r) => r.code === m[1])
      if (!row) continue
      const r = m[2].split(',')
      const v = [r[0], ...r.slice(4)] // r[1:4] 为空串，跳过
      const f = (x: string) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null }
      row.delta = f(v[2]); row.gamma = f(v[3]); row.theta = f(v[4]); row.vega = f(v[5]); row.iv = f(v[6])
    }
    top.sort((a, b) => a.cp.localeCompare(b.cp) || a.strike - b.strike)
    if (top.length === 0) { sourceStatus.option = '不可达'; throw new Error('期权行情源不可达') }
    sourceStatus.option = '新浪财经'
    return top
  } catch (e) { sourceStatus.option = '不可达'; throw e }
}

// ===== 研报：东财 reportapi（机构评级 + 三年 EPS 预测）=====
export async function fetchReports(): Promise<ReportItem[]> {
  try {
    const end = new Date()
    const begin = new Date(Date.now() - 30 * 86400000)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const url = `https://reportapi.eastmoney.com/report/list?pageSize=30&beginTime=${fmt(begin)}&endTime=${fmt(end)}&qType=0&pageNo=1`
    const j = await emJson(url)
    const list: any[] = j?.data ?? []
    const out = list.map((r) => ({
      id: String(r.infoCode ?? Math.random()),
      title: String(r.title ?? ''),
      stock: r.stockName ? `${r.stockName}${r.stockCode ? ` ${r.stockCode}` : ''}` : String(r.indvInduName ?? '行业'),
      org: String(r.orgSName ?? r.orgName ?? ''),
      rating: String(r.emRatingName ?? '—'),
      date: String(r.publishDate ?? '').slice(0, 10),
      eps: [r.predictThisYearEps, r.predictNextYearEps, r.predictNextTwoYearEps].map((x) => (x ? Number(x).toFixed(2) : '—')),
      target: r.indvAimPriceT ? `${r.indvAimPriceL ?? '—'} ~ ${r.indvAimPriceT}` : '—',
      industry: String(r.indvInduName ?? ''),
      url: r.encodeUrl ? `https://data.eastmoney.com/report/zw_stock.jshtml?encodeUrl=${encodeURIComponent(r.encodeUrl)}` : '',
    })).filter((r) => r.title)
    sourceStatus.report = out.length > 0 ? '东方财富' : '不可达'
    if (out.length === 0) throw new Error('研报源不可达')
    return out
  } catch (e) { sourceStatus.report = '不可达'; throw e }
}

// ===== 龙虎榜：东财 datacenter（近 5 日净买额榜）=====
export async function fetchLhb(): Promise<LhbItem[]> {
  try {
    const end = new Date()
    const begin = new Date(Date.now() - 5 * 86400000)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILS&columns=SECURITY_CODE,SECURITY_NAME_ABBR,EXPLAIN,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,TRADE_DATE&filter=(TRADE_DATE%3C%3D%27${fmt(end)}%27)(TRADE_DATE%3E%3D%27${fmt(begin)}%27)&pageNumber=1&pageSize=12&sortTypes=-1&sortColumns=BILLBOARD_NET_AMT&source=WEB&client=WEB`
    const j = await emJson(url)
    const list: any[] = j?.result?.data ?? []
    const out = list.map((r) => ({
      code: String(r.SECURITY_CODE ?? ''),
      name: String(r.SECURITY_NAME_ABBR ?? ''),
      reason: String(r.EXPLAIN ?? '').slice(0, 20),
      close: Number(r.CLOSE_PRICE ?? 0),
      pct: typeof r.CHANGE_RATE === 'number' ? +r.CHANGE_RATE.toFixed(2) : 0,
      netYi: +(Number(r.BILLBOARD_NET_AMT ?? 0) / 1e8).toFixed(2),
      buyYi: +(Number(r.BILLBOARD_BUY_AMT ?? 0) / 1e8).toFixed(2),
      sellYi: +(Number(r.BILLBOARD_SELL_AMT ?? 0) / 1e8).toFixed(2),
      date: String(r.TRADE_DATE ?? '').slice(5, 10),
    })).filter((r) => r.code)
    sourceStatus.lhb = out.length > 0 ? '东方财富' : '不可达'
    if (out.length === 0) throw new Error('龙虎榜源不可达')
    return out
  } catch (e) { sourceStatus.lhb = '不可达'; throw e }
}

// ===== 两融市场合计：东财 datacenter =====
export async function fetchMargin(): Promise<MarginInfo | null> {
  try {
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=ALL&pageNumber=1&pageSize=2&sortTypes=-1&sortColumns=dim_date&source=WEB&client=WEB'
    const j = await emJson(url)
    const list: any[] = j?.result?.data ?? []
    if (list.length === 0) { sourceStatus.margin = '不可达'; throw new Error('两融源不可达') }
    const cur = list[0], prev = list[1]
    const rzye = Number(cur.RZYE ?? 0)
    sourceStatus.margin = '东方财富'
    return {
      date: String(cur.DIM_DATE ?? '').slice(0, 10),
      rzyeYi: +(rzye / 1e8).toFixed(0),
      rqyeYi: +(Number(cur.RQYE ?? 0) / 1e8).toFixed(1),
      rzmreYi: +(Number(cur.RZMRE ?? 0) / 1e8).toFixed(0),
      rzjmeYi: +(Number(cur.RZJME ?? 0) / 1e8).toFixed(1),
      chgYi: prev ? +((rzye - Number(prev.RZYE ?? 0)) / 1e8).toFixed(0) : 0,
    }
  } catch (e) { sourceStatus.margin = '不可达'; throw e }
}
