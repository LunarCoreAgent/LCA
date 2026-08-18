// 数据中心数据层（出厂空数据：接入自选标的与数据源后按相同结构填充）
// 结构对齐 a-stock-data 十层架构端点，后端接入时按字段直换

// ===== 资金面 =====
export interface FundFlow {
  code: string
  name: string
  mainIn: number     // 主力净流入（万）
  superLarge: number // 超大单（万）
  large: number      // 大单（万）
  mid: number        // 中单（万）
  retail: number     // 散户（万）
  mainPct: number    // 主力净占比 %
}

export const FUND_FLOWS: FundFlow[] = []

export const MARGIN = { rzye: '—', rqye: '—', rzyeChg: '—', note: '两市融资融券余额（T-1），接入数据源后展示' }

export const LHB: { name: string; reason: string; buy: string; sell: string; net: string; seats: string }[] = []

export const HOLDER_CHANGES: { code: string; name: string; holders: string; chg: string; note: string }[] = []

// ===== 打板情绪 =====
export const LIMIT_STATS = { zt: 0, zb: 0, dt: 0, zbRate: '—', height: 0, yesterdayZtToday: '—' }

export const LADDER: { level: string; stocks: string[] }[] = []

export const LIMIT_POOL: { name: string; reason: string; count: string; firstTime: string; lastTime: string; fund: string }[] = []

// ===== 舆情互动 =====
export const IR_QA: { stock: string; q: string; a: string; date: string; hot: string }[] = []

export const POPULARITY: { rank: number; name: string; fans: string; chg: string }[] = []

export const CONCEPT_HITS: { name: string; concepts: string[]; hit: string }[] = []

// ===== 研报 =====
export const REPORTS: { title: string; org: string; rating: string; target: string; eps: string[]; date: string }[] = []

// ===== 新闻公告 =====
export const NEWS: { time: string; type: string; text: string }[] = []

// ===== 基本面 =====
export const FUNDAMENTALS: { code: string; name: string; pe: string; pb: string; roe: string; rev: string; profit: string; gross: string }[] = []

// ===== ETF 期权（希腊字母用交易所预算值） =====
export const OPTIONS: { contract: string; price: number; delta: number; gamma: number; theta: number; vega: number; iv: string }[] = []

// ===== 数据源治理（a-stock-data 防封实践移植，架构性描述） =====
export const SOURCE_GOVERNANCE = [
  { tier: '高频主力（实测不封IP）', sources: ['通达信 mootdx（TCP 7709）', '腾讯财经'], use: '行情快照、分钟K线、实时价', tone: 'green' as const },
  { tier: '结构化补充', sources: ['iFinD', 'Tushare MCP'], use: '技术指标、财务、复权因子、交易日历', tone: 'blue' as const },
  { tier: '风控严格（仅独有数据）', sources: ['东方财富'], use: '资金流、龙虎榜、打板池、人气榜——走统一限流入口', tone: 'amber' as const },
  { tier: '兜底轮换', sources: ['新浪财经', '巨潮资讯'], use: '源失效自动切换；公告 PDF', tone: 'default' as const },
]

export const LIMITER = { name: 'em_get() 统一限流入口', interval: '≥1s + 随机抖动', mode: '串行 + 会话复用', note: '所有东财请求必须经此入口，抄代码自带防封' }

export const PITFALLS = [
  'mootdx 返回的是不复权原始价，跨除权日必须自行复权，否则回测结论全错',
  '接口会静默失效（财联社快讯 404、百度 PAE 资金流已死），采集管道内置源健康检查与自动切换',
  '参数名错误可能被 **kwargs 静默吞掉导致永远返回日线，需校验返回数据的实际频率',
  '大陆住宅 IP 会被东财间歇风控（HTTP 000），对策：重试 + 降频 + 错峰',
  '北向资金历史数据本地自缓存，越跑越全，避免重复拉取触发风控',
]
