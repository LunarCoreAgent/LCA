// Ollama 多端点适配层（局域网模型集群）
// Electron 桌面版经主进程代理（免跨域），浏览器开发模式直连（需服务端 OLLAMA_ORIGINS 放行）

export interface OllamaTag {
  name: string
  size: number
  modified_at: string
  details?: { parameter_size?: string; quantization_level?: string }
}

export interface OllamaEndpoint {
  id: string
  label: string        // 展示名，如「主推理模型」
  base: string         // 如 http://127.0.0.1:11434（支持局域网端点）
  role: 'primary' | 'backup'
}

const EP_KEY = 'agentcore-ollama-endpoints'

// 默认端点：本机 Ollama；局域网/远端端点请在「模型管理」中添加
export const DEFAULT_ENDPOINTS: OllamaEndpoint[] = [
  { id: 'ep-main', label: '本地 Ollama', base: 'http://127.0.0.1:11434', role: 'primary' },
]

export function loadEndpoints(): OllamaEndpoint[] {
  try {
    const raw = localStorage.getItem(EP_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* 忽略损坏缓存 */ }
  return DEFAULT_ENDPOINTS
}

export function saveEndpoints(eps: OllamaEndpoint[]): void {
  localStorage.setItem(EP_KEY, JSON.stringify(eps))
}

export interface ChatMsg { role: 'user' | 'assistant' | 'system'; content: string; images?: string[] }

export interface ChatOptions { numPredict?: number; think?: boolean }

/** 探测单个端点，返回模型列表（null = 不在线） */
export async function ollamaAlive(base: string): Promise<OllamaTag[] | null> {
  try {
    if (window.agentcore?.ollama) {
      const j = (await window.agentcore.ollama.tags(base)) as { models?: OllamaTag[] }
      return (j?.models ?? []) as OllamaTag[]
    }
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    const j = await r.json()
    return (j.models ?? []) as OllamaTag[]
  } catch {
    return null
  }
}

/** 探测全部端点 */
export async function probeAll(eps: OllamaEndpoint[]): Promise<Map<string, OllamaTag[] | null>> {
  const out = new Map<string, OllamaTag[] | null>()
  await Promise.all(eps.map(async (ep) => { out.set(ep.id, await ollamaAlive(ep.base)) }))
  return out
}

/** 流式对话：onToken 回调累计文本；opts 控制输出长度与思考模式；返回完整回复 */
export async function ollamaChat(base: string, model: string, messages: ChatMsg[], onToken: (full: string) => void, opts?: ChatOptions): Promise<string> {
  const options: Record<string, unknown> = {}
  if (opts?.numPredict) options.num_predict = opts.numPredict
  if (opts?.think !== undefined) options.think = opts.think
  // Electron：走主进程代理（无跨域限制）
  if (window.agentcore?.ollama) {
    const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36)
    let full = ''
    const off = window.agentcore.ollama.onChunk((id, piece) => {
      if (id === reqId) { full += piece; onToken(full) }
    })
    try {
      await window.agentcore.ollama.chat(reqId, base, model, messages, Object.keys(options).length ? options : undefined)
      return full
    } finally {
      off()
    }
  }
  // 浏览器直连
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, ...(Object.keys(options).length ? { options } : {}) }),
  })
  if (!r.ok || !r.body) throw new Error(`Ollama 响应异常：HTTP ${r.status}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let full = ''
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const j = JSON.parse(line)
        if (j.message?.content) { full += j.message.content; onToken(full) }
      } catch { /* 忽略半行 */ }
    }
  }
  return full
}
