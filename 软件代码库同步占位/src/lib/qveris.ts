// QVeris 能力路由网络客户端（https://qveris.ai）
// 协议：discover（POST /search 自然语言发现能力）→ inspect（POST /tools/by-ids 查看参数/延迟/成本）
//       → call（POST /tools/execute 执行并返回结构化 JSON）
// discover 与 inspect 免费，call 按 credits 计费；Key 仅存本机（可选进系统钥匙串）

export const QVERIS_BASE = 'https://qveris.ai/api/v1'
export const QVERIS_HOME = 'https://qveris.ai'
export const QVERIS_KEY_ID = 'qveris' // dataSources 注册表中的 id（Key 存 localStorage: agentcore-ds-key-qveris）

export interface QvToolParam { name: string; required?: boolean; type?: string; description?: string }
export interface QvTool {
  tool_id: string
  name?: string
  description?: string
  stats?: { success_rate?: number; avg_execution_time_ms?: number }
  params?: QvToolParam[]
  examples?: { sample_parameters?: Record<string, unknown> }
}
export interface QvDiscoverResult { search_id?: string; results?: QvTool[]; total?: number }
export interface QvCallResult {
  success?: boolean
  elapsed_time_ms?: number
  cost?: number
  result?: Record<string, unknown>
  error_message?: string
}

// 桌面版经主进程发起（免 CORS 困扰）；浏览器/预览环境直接 fetch（CSP 已放行 https:）
async function qvRequest(path: string, apiKey: string, body: unknown, query?: Record<string, string>, timeoutMs = 30000): Promise<any> {
  if (window.agentcore?.qveris?.request) {
    return window.agentcore.qveris.request(path, apiKey, body, query, timeoutMs)
  }
  const url = new URL(QVERIS_BASE + path)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new Error(`HTTP ${r.status}${text ? `：${text.slice(0, 160)}` : ''}`)
    }
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

// 发现能力：自然语言（英文能力描述效果最佳）→ 候选工具列表（免费）
export async function qvDiscover(apiKey: string, query: string, limit = 8): Promise<QvDiscoverResult> {
  return qvRequest('/search', apiKey, { query, limit })
}

// 检视工具：按 tool_id 查看参数、成功率、延迟与示例参数（免费）
export async function qvInspect(apiKey: string, toolIds: string[], searchId?: string): Promise<QvDiscoverResult> {
  const body: Record<string, unknown> = { tool_ids: toolIds }
  if (searchId) body.search_id = searchId
  return qvRequest('/tools/by-ids', apiKey, body)
}

// 调用工具：执行并返回结构化结果（按 credits 计费）
export async function qvCall(apiKey: string, toolId: string, searchId: string | undefined, parameters: Record<string, unknown>, maxResponseSize = 20480): Promise<QvCallResult> {
  return qvRequest('/tools/execute', apiKey, { search_id: searchId, parameters, max_response_size: maxResponseSize }, { tool_id: toolId }, 60000)
}

// 把 QVeris 调用结果压缩为可注入对话上下文的文本（截断防爆）
export function qvResultToText(toolName: string, r: QvCallResult, maxLen = 1800): string {
  if (!r.success) return `QVeris 工具 ${toolName} 调用失败：${r.error_message || '未知错误'}`
  let text = ''
  try { text = JSON.stringify(r.result ?? {}, null, 1) } catch { text = String(r.result) }
  if (text.length > maxLen) text = text.slice(0, maxLen) + '…（结果过长已截断）'
  return `QVeris 工具 ${toolName} 返回（耗时 ${r.elapsed_time_ms ?? '?'}ms，消耗 ${r.cost ?? 0} credits）：\n${text}`
}
