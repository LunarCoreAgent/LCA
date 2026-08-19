// 审计链台账：五条 append-only SHA-256 哈希链（纯前端持久化于 localStorage）
// 每条记录 = 前序哈希 + 载荷 + 时间 → 哈希，篡改任一历史记录会导致其后全部校验失败
// 链规划（对齐 v3.1.0 蓝图）：推演预测 / 审计台账 / 实盘网关 / 模拟交易 / 基准复盘
import { sha256Hex, SHA256_SELFTEST_OK } from './sha256'

export type ChainId = 'prediction' | 'audit' | 'live' | 'paper' | 'benchmark'

export const CHAIN_DEFS: { id: ChainId; name: string; desc: string }[] = [
  { id: 'prediction', name: '推演预测', desc: '方向性推演的创建与判定记录' },
  { id: 'audit', name: '审计台账', desc: '交易日志增删、复盘报告生成等关键操作' },
  { id: 'live', name: '实盘网关', desc: '实盘下单网关操作（观察级，暂未开放）' },
  { id: 'paper', name: '模拟交易', desc: '模拟盘信号与成交（后续版本接入）' },
  { id: 'benchmark', name: '基准复盘', desc: '预测命中率对账与校准记录' },
]

export interface AuditRecord {
  seq: number          // 链内序号（从 1 开始）
  chain: ChainId
  time: string         // 本地时间戳
  type: string         // 事件类型，如 prediction.create / journal.add
  payload: string      // 业务内容（JSON 字符串）
  prevHash: string     // 前序记录哈希；首条为 'GENESIS'
  hash: string         // 本条哈希 = sha256(chain|seq|time|type|payload|prevHash)
}

const STORE_KEY = 'agentcore-audit-chains-v1'
const MAX_PER_CHAIN = 2000 // 每链容量上限，超出滚动裁剪（裁剪会破坏链完整性，故裁剪时保留校验锚点说明）

type Chains = Record<ChainId, AuditRecord[]>

const emptyChains = (): Chains => ({ prediction: [], audit: [], live: [], paper: [], benchmark: [] })

export function loadChains(): Chains {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return emptyChains()
    const obj = JSON.parse(raw) as Partial<Chains>
    const base = emptyChains()
    for (const c of CHAIN_DEFS) {
      const arr = obj[c.id]
      if (Array.isArray(arr)) base[c.id] = arr.filter((r) => r && typeof r.hash === 'string')
    }
    return base
  } catch {
    return emptyChains()
  }
}

function saveChains(chains: Chains) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(chains))
  } catch {
    /* 存储超限等异常静默失败：链数据不阻断业务 */
  }
}

const hashOf = (chain: ChainId, seq: number, time: string, type: string, payload: string, prevHash: string) =>
  sha256Hex([chain, seq, time, type, payload, prevHash].join('|'))

/** 追加一条记录到指定链，返回该记录（含哈希） */
export function appendRecord(chain: ChainId, type: string, payload: unknown): AuditRecord {
  const chains = loadChains()
  const list = chains[chain]
  const seq = list.length + 1
  const prevHash = list.length ? list[list.length - 1].hash : 'GENESIS'
  const time = new Date().toLocaleString('zh-CN', { hour12: false })
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null)
  const rec: AuditRecord = { seq, chain, time, type, payload: body, prevHash, hash: hashOf(chain, seq, time, type, body, prevHash) }
  chains[chain] = [...list, rec].slice(-MAX_PER_CHAIN)
  saveChains(chains)
  return rec
}

export interface ChainVerifyResult {
  ok: boolean
  total: number
  brokenAt?: number // 第一条校验失败的 seq
  reason?: string
}

/** 全链重算校验：任一记录哈希或前序衔接不符即失败 */
export function verifyChain(chain: ChainId): ChainVerifyResult {
  if (!SHA256_SELFTEST_OK) return { ok: false, total: 0, reason: 'SHA-256 自检未通过' }
  const list = loadChains()[chain]
  let prev = 'GENESIS'
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (r.prevHash !== prev) return { ok: false, total: list.length, brokenAt: r.seq, reason: `第 ${r.seq} 条前序哈希断裂` }
    const expect = hashOf(r.chain, r.seq, r.time, r.type, r.payload, r.prevHash)
    if (expect !== r.hash) return { ok: false, total: list.length, brokenAt: r.seq, reason: `第 ${r.seq} 条哈希不匹配（记录被改动？）` }
    prev = r.hash
  }
  return { ok: true, total: list.length }
}

/** 链头哈希（最新一条），空链返回 '-' */
export function chainHead(chain: ChainId): string {
  const list = loadChains()[chain]
  return list.length ? list[list.length - 1].hash : '-'
}

export function chainLength(chain: ChainId): number {
  return loadChains()[chain].length
}

export function chainRecords(chain: ChainId, limit = 50): AuditRecord[] {
  return loadChains()[chain].slice(-limit).reverse()
}

export const shortHash = (h: string) => (h && h !== '-' ? `${h.slice(0, 10)}…${h.slice(-6)}` : '-')
