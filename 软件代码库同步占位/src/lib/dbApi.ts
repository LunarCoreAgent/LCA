import { PY_BRIDGE } from './marketApi'
import { loadSecret, saveSecret, maskSecret } from './secrets'

// ===== 数据库连接配置（密码不落盘：保存进系统钥匙串，配置里只留脱敏串）=====
export type DbEngine = 'sqlite' | 'postgres' | 'mysql'

export interface DbProfile {
  engine: DbEngine
  sqlitePath: string
  pg: { host: string; port: number; dbname: string; user: string; password: string }
  my: { host: string; port: number; db: string; user: string; password: string }
}

const KEY = 'agentcore-db-profile'

export const DB_DEFAULTS: DbProfile = {
  engine: 'sqlite',
  sqlitePath: 'lunarcore.db',
  pg: { host: '127.0.0.1', port: 5432, dbname: 'lunarcore', user: 'postgres', password: '' },
  my: { host: '127.0.0.1', port: 3306, db: 'lunarcore', user: 'root', password: '' },
}

export function loadDbProfile(): DbProfile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DB_DEFAULTS
    const p = JSON.parse(raw) as Partial<DbProfile>
    return { ...DB_DEFAULTS, ...p, pg: { ...DB_DEFAULTS.pg, ...(p.pg ?? {}) }, my: { ...DB_DEFAULTS.my, ...(p.my ?? {}) } }
  } catch {
    return DB_DEFAULTS
  }
}

/** 持久化配置（密码写钥匙串后从配置中剥离） */
export async function saveDbProfile(p: DbProfile): Promise<DbProfile> {
  const next = { ...p, pg: { ...p.pg }, my: { ...p.my } }
  if (next.pg.password && !next.pg.password.startsWith('•')) {
    await saveSecret('db:pg-password', next.pg.password)
    next.pg.password = maskSecret(next.pg.password)
  }
  if (next.my.password && !next.my.password.startsWith('•')) {
    await saveSecret('db:mysql-password', next.my.password)
    next.my.password = maskSecret(next.my.password)
  }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

/** 组装桥端连接参数（还原真实密码） */
export async function cfgOf(p: DbProfile): Promise<Record<string, unknown>> {
  if (p.engine === 'sqlite') return { path: p.sqlitePath.trim() || 'lunarcore.db' }
  if (p.engine === 'postgres') {
    const password = p.pg.password.startsWith('•') ? await loadSecret('db:pg-password') : p.pg.password
    return { host: p.pg.host, port: p.pg.port, dbname: p.pg.dbname, user: p.pg.user, password }
  }
  const password = p.my.password.startsWith('•') ? await loadSecret('db:mysql-password') : p.my.password
  return { host: p.my.host, port: p.my.port, db: p.my.db, user: p.my.user, password }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${PY_BRIDGE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (j?.error === 'missing_dep') throw new Error(`桥端缺少依赖：pip install ${j.pip}（数据中心 → Python 数据桥可安装）`)
    throw new Error(j?.detail || j?.error || `HTTP ${r.status}`)
  }
  if (j?.error) throw new Error(j.detail || j.error)
  return j as T
}

export interface DbEngineInfo { id: DbEngine; name: string; available: boolean; pip: string | null; note?: string }
export interface DbTestResult { ok: boolean; version: string }
export interface DbInstallResult { ok: boolean; schema_version: number; created: string[]; existing: string[]; tables: string[] }
export interface DbTableInfo { name: string; columns: number; rows: number | null }
export interface DbTablesResult { ok: boolean; schema_version: number | null; tables: DbTableInfo[] }
export interface DbDdlResult { engine: DbEngine; schema_version: number; tables: string[]; sql: string }

export async function dbEngines(): Promise<DbEngineInfo[]> {
  const r = await fetch(`${PY_BRIDGE}/db/engines`, { signal: AbortSignal.timeout(3000) })
  const j = await r.json()
  return j.engines as DbEngineInfo[]
}

export async function dbDdl(engine: DbEngine): Promise<DbDdlResult> {
  const r = await fetch(`${PY_BRIDGE}/db/ddl?engine=${engine}`, { signal: AbortSignal.timeout(5000) })
  return (await r.json()) as DbDdlResult
}

export const dbTest = (p: DbProfile, cfg: Record<string, unknown>) =>
  post<DbTestResult>('/db/test', { engine: p.engine, cfg })
export const dbInstall = (p: DbProfile, cfg: Record<string, unknown>) =>
  post<DbInstallResult>('/db/install', { engine: p.engine, cfg })
export const dbTables = (p: DbProfile, cfg: Record<string, unknown>) =>
  post<DbTablesResult>('/db/tables', { engine: p.engine, cfg })

// ===== 结构设计文档（与桥端 DB_TABLES 对应，用于页面展示）=====
export const DB_DESIGN: { name: string; comment: string; cols: string }[] = [
  { name: 'lc_meta', comment: '结构版本与安装信息', cols: 'key, value' },
  { name: 'lc_conversations', comment: '对话会话', cols: 'id, title, model, created_at, updated_at' },
  { name: 'lc_messages', comment: '对话消息（含知识库来源与路由轨迹）', cols: 'id, conversation_id, role, content, model, tokens, kb_sources, route_trace, created_at' },
  { name: 'lc_memories', comment: '长期记忆', cols: 'id, kind, title, content, hits, created_at, updated_at' },
  { name: 'lc_kb_endpoints', comment: '知识库端点（token_ref 存钥匙串键名，不落明文）', cols: 'id, name, type, base_url, target, token_ref, created_at' },
  { name: 'lc_kb_hits', comment: '知识库检索记录', cols: 'id, endpoint_id, query, hit_title, score, created_at' },
  { name: 'lc_models', comment: '模型配置（本地 / API / 聚合池）', cols: 'id, kind, name, config, status, created_at, updated_at' },
  { name: 'lc_watchlist', comment: '自选监控', cols: 'id, code, name, market, note, sort, created_at' },
  { name: 'lc_activity_logs', comment: '活动日志', cols: 'id, kind, text, created_at' },
  { name: 'lc_evolution_runs', comment: '自我进化记录', cols: 'id, summary, detail, created_at' },
  { name: 'lc_channels', comment: '手机渠道（飞书 / 微信 / LINE）', cols: 'id, kind, name, config, enabled, created_at, updated_at' },
]
