// 数据源健康度与自适应降级链（融合 Vibe-Trading 的 ban-risk 链式降级思想）
// 设计：
//   1. 每个源的调用结果（成功/失败/耗时）持久化到 localStorage
//   2. 链顺序 = 先验顺序（低封禁风险在前）+ 健康度自适应重排
//   3. 连续失败自动降权，恢复后随成功样本回升
export type SrcKind = 'quotes' | 'kline' | 'fundflow'

export interface SrcHealth {
  ok: number
  fail: number
  totalMs: number
  lastOkAt: string
  lastErr: string
  lastErrAt: string
}

type HealthStore = Record<string, Record<string, SrcHealth>> // kind -> source -> health

const KEY = 'agentcore-source-health-v1'

function load(): HealthStore {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HealthStore) : {}
  } catch {
    return {}
  }
}

function save(s: HealthStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存储满则忽略 */ }
}

/** 记录一次源调用结果（ok/耗时/错误信息） */
export function recordResult(kind: SrcKind, source: string, ok: boolean, ms: number, err?: string) {
  const s = load()
  const k = (s[kind] ??= {})
  const h = (k[source] ??= { ok: 0, fail: 0, totalMs: 0, lastOkAt: '', lastErr: '', lastErrAt: '' })
  if (ok) { h.ok += 1; h.totalMs += ms; h.lastOkAt = new Date().toLocaleString('zh-CN', { hour12: false }) }
  else { h.fail += 1; h.lastErr = (err ?? '未知错误').slice(0, 120); h.lastErrAt = new Date().toLocaleString('zh-CN', { hour12: false }) }
  // 样本封顶：超 500 次按比例缩半，避免陈旧样本压制近期表现
  if (h.ok + h.fail > 500) { h.ok >>= 1; h.fail >>= 1; h.totalMs >>= 1 }
  save(s)
}

/** 源评分：拉普拉斯平滑成功率 − 延迟罚分（0~1） */
export function score(kind: SrcKind, source: string): number {
  const h = load()[kind]?.[source]
  if (!h) return 0.5 // 无数据按中性的先验分
  const rate = (h.ok + 1) / (h.ok + h.fail + 2)
  const avgMs = h.ok > 0 ? h.totalMs / h.ok : 3000
  const latPenalty = Math.min(0.2, avgMs / 15000)
  return +(rate - latPenalty).toFixed(4)
}

/** 自适应链顺序：按评分降序，平分保持先验顺序（先验 = 低封禁风险在前） */
export function orderedSources(kind: SrcKind, prior: string[]): string[] {
  const s = load()
  const k = s[kind] ?? {}
  // 无健康数据时直接返回先验
  if (Object.keys(k).length === 0) return prior
  return [...prior].sort((a, b) => {
    const sa = scoreOne(k[a])
    const sb = scoreOne(k[b])
    return sb - sa
  })
}

function scoreOne(h: SrcHealth | undefined): number {
  if (!h) return 0.5
  const rate = (h.ok + 1) / (h.ok + h.fail + 2)
  const avgMs = h.ok > 0 ? h.totalMs / h.ok : 3000
  return rate - Math.min(0.2, avgMs / 15000)
}

/** 全量健康报告（供面板展示） */
export function healthReport(): HealthStore {
  return load()
}

export function resetHealth() {
  localStorage.removeItem(KEY)
}

/** 带计时的源调用包装：成功/失败自动落健康记录 */
export async function timedCall<T>(kind: SrcKind, source: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    const r = await fn()
    recordResult(kind, source, true, Date.now() - t0)
    return r
  } catch (e) {
    recordResult(kind, source, false, Date.now() - t0, e instanceof Error ? e.message : String(e))
    throw e
  }
}
