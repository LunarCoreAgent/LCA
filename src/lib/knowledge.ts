// ===== 知识库端点（双 provider）：LLM Wiki 本地部署模式 / AnythingLLM 服务器连接存储 =====
// LLM Wiki：127.0.0.1:19828 内置 API（health/projects/search/files，Bearer Token）
// AnythingLLM：服务器 /api/v1（auth/workspaces/vector-search，Bearer API Key）
// 请求经主进程 kb:request IPC（http 仅允许 localhost/私网段，https 任意），浏览器态 fetch 兜底
import type { KnowledgeEndpoint } from './types'
import { uid } from './store'

const KB_KEY = 'agentcore-kb-endpoints'

export const KB_DEFAULTS: KnowledgeEndpoint[] = [
  { id: 'kb-lw-local', name: 'LLM Wiki（本机）', type: 'llmwiki', baseUrl: 'http://127.0.0.1:19828', token: '', target: '' },
]

export function loadKbEndpoints(): KnowledgeEndpoint[] {
  try {
    const raw = localStorage.getItem(KB_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* 忽略损坏缓存 */ }
  return KB_DEFAULTS
}

export function saveKbEndpoints(eps: KnowledgeEndpoint[]): void {
  localStorage.setItem(KB_KEY, JSON.stringify(eps))
}

export function newKbEndpoint(type: KnowledgeEndpoint['type']): KnowledgeEndpoint {
  return {
    id: 'kb-' + uid(),
    name: type === 'llmwiki' ? 'LLM Wiki' : 'AnythingLLM',
    type,
    baseUrl: type === 'llmwiki' ? 'http://127.0.0.1:19828' : 'http://192.168.1.10:3001',
    token: '',
    target: '',
  }
}

// ===== 统一检索结果 =====
export interface KnowledgeHit {
  title: string    // 页面标题 / 文档名
  text: string     // 命中片段
  source: string   // 来源标识（wiki 路径 / 文档名）
  score: number
}

export interface KbProbeResult {
  online: boolean
  detail: string         // 「3 个项目」/「工作区：研报库」/ 错误原因
  targets: { id: string; name: string }[]  // 可选项目/工作区
}

// ===== 底层请求（IPC 优先，fetch 兜底）=====
async function kbRaw(ep: KnowledgeEndpoint, method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const url = ep.baseUrl.replace(/\/$/, '') + path
  const ipc = window.agentcore?.kb?.request
  if (ipc) {
    const r = await ipc({ method, url, token: ep.token, body: body ? JSON.stringify(body) : undefined })
    return JSON.parse(r)
  }
  const r = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ep.token ? { Authorization: `Bearer ${ep.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// LLM Wiki 前缀自动探测（不同版本可能在根路径或 /api/v1 下）
const lwPrefixCache = new Map<string, string>()
async function lwPrefix(ep: KnowledgeEndpoint): Promise<string> {
  const key = ep.baseUrl
  const hit = lwPrefixCache.get(key)
  if (hit != null) return hit
  for (const prefix of ['', '/api/v1']) {
    try {
      const r = await kbRaw({ ...ep, token: '' }, 'GET', `${prefix}/health`)
      if (r && (r.ok === true || r.status === 'ok' || typeof r === 'object')) {
        lwPrefixCache.set(key, prefix)
        return prefix
      }
    } catch { /* 继续试下一个 */ }
  }
  throw new Error('LLM Wiki 不可达')
}

// ===== 连通性探测 =====
export async function kbProbe(ep: KnowledgeEndpoint): Promise<KbProbeResult> {
  try {
    if (ep.type === 'llmwiki') {
      const prefix = await lwPrefix(ep)
      const j = await kbRaw(ep, 'GET', `${prefix}/projects`)
      const list: any[] = Array.isArray(j) ? j : j?.projects ?? j?.items ?? []
      const targets = list.map((p) => ({ id: String(p.id ?? p.slug ?? p.name ?? ''), name: String(p.name ?? p.title ?? p.id ?? '') })).filter((x) => x.id)
      return { online: true, detail: targets.length > 0 ? `${targets.length} 个项目` : '已连接（暂无项目）', targets }
    }
    // AnythingLLM
    await kbRaw(ep, 'GET', '/api/v1/auth')
    const j = await kbRaw(ep, 'GET', '/api/v1/workspaces')
    const list: any[] = j?.workspaces ?? []
    const targets = list.map((w) => ({ id: String(w.slug ?? ''), name: String(w.name ?? w.slug ?? '') })).filter((x) => x.id)
    return { online: true, detail: targets.length > 0 ? `${targets.length} 个工作区` : '已连接（暂无工作区）', targets }
  } catch (e) {
    return { online: false, detail: e instanceof Error ? e.message : '连接失败', targets: [] }
  }
}

// ===== 统一检索 =====
export async function kbSearch(ep: KnowledgeEndpoint, query: string, topK = 5): Promise<KnowledgeHit[]> {
  if (ep.type === 'llmwiki') {
    const prefix = await lwPrefix(ep)
    let pid = ep.target
    if (!pid) {
      const j = await kbRaw(ep, 'GET', `${prefix}/projects`)
      const list: any[] = Array.isArray(j) ? j : j?.projects ?? j?.items ?? []
      pid = String(list[0]?.id ?? list[0]?.slug ?? list[0]?.name ?? '')
    }
    if (!pid) throw new Error('LLM Wiki 暂无项目')
    const j = await kbRaw(ep, 'POST', `${prefix}/projects/${encodeURIComponent(pid)}/search`, { query, topK })
    const results: any[] = j?.results ?? j?.hits ?? (Array.isArray(j) ? j : [])
    return results.slice(0, topK).map((r) => ({
      title: String(r.title ?? r.file ?? r.path ?? '知识页'),
      text: String(r.text ?? r.content ?? r.snippet ?? '').slice(0, 800),
      source: String(r.path ?? r.file ?? r.title ?? ''),
      score: typeof r.score === 'number' ? r.score : 0,
    })).filter((h) => h.text)
  }
  // AnythingLLM：vector-search 只取知识片段（不经它的 LLM）
  let slug = ep.target
  if (!slug) {
    const j = await kbRaw(ep, 'GET', '/api/v1/workspaces')
    slug = String(j?.workspaces?.[0]?.slug ?? '')
  }
  if (!slug) throw new Error('AnythingLLM 暂无工作区')
  const j = await kbRaw(ep, 'POST', `/api/v1/workspace/${encodeURIComponent(slug)}/vector-search`, { query, topN: topK })
  const results: any[] = j?.results ?? (Array.isArray(j) ? j : [])
  return results.slice(0, topK).map((r) => ({
    title: String(r?.metadata?.title ?? r?.metadata?.source ?? r.title ?? '文档'),
    text: String(r.text ?? r.content ?? '').slice(0, 800),
    source: String(r?.metadata?.source ?? r?.metadata?.title ?? ''),
    score: typeof r.score === 'number' ? r.score : 0,
  })).filter((h) => h.text)
}
