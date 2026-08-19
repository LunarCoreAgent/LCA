// 多模型 ensemble 决策：同一问题分发给多个模型，结构化投票汇总
// 复用现有模型资产：本地 Ollama（端点表）/ API 模型（OpenAI 兼容）/ 聚合池成员
import { useStore } from './store'
import { loadEndpoints, ollamaChat } from './ollama'
import { loadSecret } from './secrets'
import { appendRecord } from './auditLedger'

export interface EnsembleVote {
  modelId: string
  modelLabel: string
  ok: boolean
  direction?: 'up' | 'down' | 'flat'
  confidence?: number      // 1-5
  reason?: string
  raw?: string             // 原始回复（截断）
  error?: string
  latencyMs: number
}

export interface EnsembleResult {
  target: string           // 标的代码+名称
  votes: EnsembleVote[]
  consensus: 'up' | 'down' | 'flat' | null   // 置信度加权多数
  consensusWeight: number  // 胜方权重占比 %
  avgConfidence: number | null
  time: string
}

interface ResolvedModel { id: string; label: string; kind: 'local' | 'api'; base?: string; model: string; apiKey?: string; baseUrl?: string; secretKey?: string }

/** 把成员 id 解析为可调用模型（本地 → 端点；API → baseUrl+key） */
export function resolveModel(id: string): ResolvedModel | null {
  const s = useStore.getState()
  const lm = s.localModels.find((m) => m.id === id)
  if (lm) {
    const eps = loadEndpoints()
    const ep = eps.find((e) => e.id === lm.epId) ?? eps[0]
    if (!ep) return null
    return { id, label: `${lm.name}（本地）`, kind: 'local', base: ep.base, model: lm.name }
  }
  const am = s.apiModels.find((m) => m.id === id)
  if (am) {
    return { id, label: `${am.provider}/${am.model}`, kind: 'api', baseUrl: am.baseUrl, model: am.model, apiKey: undefined, secretKey: `apikey:${am.id}` }
  }
  return null
}

/** 一次性非流式调用（决策/投票场景，不污染对话消息流）；单模型 45s 超时，防止成员卡死拖住整轮 ensemble */
export async function callOnce(m: ResolvedModel, prompt: string): Promise<string> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('调用超时（45s）')), 45000))
  const call = (async () => {
    if (m.kind === 'local') {
      return await ollamaChat(m.base!, m.model, [{ role: 'user', content: prompt }], () => {}, { numPredict: 512 })
    }
    const key = m.secretKey ? await loadSecret(m.secretKey) : ''
    if (!key) throw new Error('未找到 API Key（请到「模型管理」重新添加该模型）')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 45000)
    try {
      const r = await fetch(`${m.baseUrl!.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: m.model, messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 512 }),
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}：${(await r.text().catch(() => '')).slice(0, 120)}`)
      const json = await r.json()
      return String(json?.choices?.[0]?.message?.content ?? '')
    } finally {
      clearTimeout(timer)
    }
  })()
  return Promise.race([call, timeout])
}

/** 从模型回复中容错提取 JSON 投票 */
export function parseVote(raw: string): { direction?: 'up' | 'down' | 'flat'; confidence?: number; reason?: string } {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try {
    const j = JSON.parse(m[0])
    const d = String(j.direction ?? '').toLowerCase()
    return {
      direction: d === 'up' || d === 'down' || d === 'flat' ? d : undefined,
      confidence: Math.min(5, Math.max(1, parseInt(j.confidence) || 3)),
      reason: typeof j.reason === 'string' ? j.reason.slice(0, 300) : undefined,
    }
  } catch {
    return {}
  }
}

const PROMPT = (target: string, context: string) => `你是一名投资分析师。请对标的「${target}」做未来 5-20 个交易日的方向性判断。

${context ? `【实时数据上下文】\n${context}\n` : ''}
只输出一个 JSON 对象（不要输出其他任何内容）：
{"direction":"up 或 down 或 flat","confidence":1到5的整数,"reason":"不超过 100 字的判断依据"}`

/** 运行一次 ensemble 决策：成员并行投票，置信度加权汇总，全程写入审计台账链 */
export async function runEnsemble(target: string, memberIds: string[], context = ''): Promise<EnsembleResult> {
  const members = memberIds.map(resolveModel).filter((x): x is ResolvedModel => !!x)
  if (!members.length) throw new Error('没有可调用成员模型，请先在「模型管理」配置本地或 API 模型')
  const prompt = PROMPT(target, context)
  const settled = await Promise.allSettled(
    members.map(async (m): Promise<EnsembleVote> => {
      const t0 = performance.now()
      const raw = await callOnce(m, prompt)
      const v = parseVote(raw)
      return {
        modelId: m.id, modelLabel: m.label, ok: !!v.direction,
        direction: v.direction, confidence: v.confidence, reason: v.reason,
        raw: raw.slice(0, 400), latencyMs: Math.round(performance.now() - t0),
      }
    })
  )
  const votes: EnsembleVote[] = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { modelId: members[i].id, modelLabel: members[i].label, ok: false, error: (r.reason as Error)?.message ?? '调用失败', latencyMs: 0 }
  )

  // 置信度加权计票
  const valid = votes.filter((v) => v.ok && v.direction)
  const weight: Record<string, number> = { up: 0, down: 0, flat: 0 }
  for (const v of valid) weight[v.direction!] += v.confidence ?? 3
  const totalW = weight.up + weight.down + weight.flat
  const consensus = totalW > 0 ? (Object.entries(weight).sort((a, b) => b[1] - a[1])[0][0] as 'up' | 'down' | 'flat') : null
  const result: EnsembleResult = {
    target, votes, consensus,
    consensusWeight: totalW > 0 && consensus ? +((weight[consensus] / totalW) * 100).toFixed(1) : 0,
    avgConfidence: valid.length ? +(valid.reduce((a, v) => a + (v.confidence ?? 3), 0) / valid.length).toFixed(1) : null,
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
  appendRecord('audit', 'ensemble.run', {
    target, members: members.map((m) => m.label), consensus: result.consensus,
    consensusWeight: result.consensusWeight, valid: valid.length, total: votes.length,
  })
  return result
}
