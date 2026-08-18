import { useEffect, useRef, useState } from 'react'
import { useStore, uid, modelName } from '@/lib/store'
import { routeMessage, generateReply, pickFromMixture } from '@/lib/engine'
import { loadEndpoints, probeAll, ollamaChat, type OllamaTag, type OllamaEndpoint, type ChatMsg } from '@/lib/ollama'
import { buildMarketContext, extractMentionedCodes, loadWatchList } from '@/lib/marketApi'
import { kbSearch, loadKbEndpoints } from '@/lib/knowledge'
import { DATA_DOMAINS, loadDataCallCfg, saveDataCallCfg, buildDataCallContext, type DataDomainId } from '@/lib/chatData'
import { STRATEGIES } from '@/lib/backtest'
import { QVERIS_KEY_ID } from '@/lib/qveris'
import { getDsKey } from '@/lib/dataSources'
import { loadSecret } from '@/lib/secrets'
import type { ApiModel, KnowledgeEndpoint, RouteTrace } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pill } from '@/components/common'
import { Send, GitBranch, ThumbsUp, ThumbsDown, Brain, Copy, Paperclip, X, FileText, ImageIcon, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Attachment { id: string; name: string; kind: 'text' | 'image'; text?: string; dataUrl?: string }

// 对话长度：历史条数 + 输出 token 上限
const LEN_CONF = {
  short: { label: '短', history: 4, numPredict: 512 },
  standard: { label: '标准', history: 8, numPredict: 2048 },
  long: { label: '长', history: 16, numPredict: 8192 },
} as const
// 思考强度：提示词引导 + Ollama think 参数（支持的模型生效）
const THINK_CONF = {
  low: { label: '低', prompt: '请直接给出简明扼要的回答，不要展开推理过程。', think: false as boolean | undefined },
  standard: { label: '标准', prompt: '', think: undefined },
  high: { label: '高', prompt: '请先逐步深入思考：梳理背景、相关数据与逻辑链条，再给出结构化的完整回答。', think: true },
} as const
type ThinkLevel = keyof typeof THINK_CONF
type ChatLen = keyof typeof LEN_CONF

export default function Chat() {
  const s = useStore()
  const [input, setInput] = useState('')
  const [target, setTarget] = useState('auto')
  const [typing, setTyping] = useState(false)
  const [thinking, setThinking] = useState<{ label: string; since: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  // 行情上下文开关（默认开）：发送时把行情采集的实时数据注入模型
  const [useMarketCtx, setUseMarketCtx] = useState(() => localStorage.getItem('agentcore-chat-market-ctx') !== '0')
  const [thinkLevel, setThinkLevel] = useState<ThinkLevel>('standard')
  const [chatLen, setChatLen] = useState<ChatLen>('standard')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  // 知识库：'off' 不启用；选中端点时发送前检索并注入参考资料（端点列表在「模型管理」维护）
  const [kbTarget, setKbTarget] = useState('off')
  const [kbEndpoints, setKbEndpoints] = useState<KnowledgeEndpoint[]>(() => loadKbEndpoints())
  // 数据调用：勾选的数据中心域/回测/QVeris 在发送时实时采集注入；未勾选项按关键词智能触发
  const [dcCfg, setDcCfg] = useState(() => loadDataCallCfg())
  const [dcOpen, setDcOpen] = useState(false)
  const dcRef = useRef<HTMLDivElement>(null)
  const qvConfigured = !!getDsKey(QVERIS_KEY_ID)

  const toggleDomain = (id: DataDomainId) => {
    const domains = dcCfg.domains.includes(id) ? dcCfg.domains.filter((x) => x !== id) : [...dcCfg.domains, id]
    setDcCfg({ ...dcCfg, domains })
    saveDataCallCfg(domains, dcCfg.strategyId)
  }
  const setDcStrategy = (strategyId: string) => {
    setDcCfg({ ...dcCfg, strategyId })
    saveDataCallCfg(dcCfg.domains, strategyId)
  }
  // 点击数据调用面板外部自动收起
  useEffect(() => {
    if (!dcOpen) return
    const onDown = (e: PointerEvent) => {
      if (dcRef.current && !dcRef.current.contains(e.target as Node)) setDcOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [dcOpen])

  // 从模型管理页改完知识库端点回来后自动刷新列表
  useEffect(() => {
    const reload = () => setKbEndpoints(loadKbEndpoints())
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [])

  const toggleMarketCtx = () => {
    const v = !useMarketCtx
    setUseMarketCtx(v)
    localStorage.setItem('agentcore-chat-market-ctx', v ? '1' : '0')
    toast.success(v ? '行情上下文已开启：模型将看到自选行情与提及标的实时数据' : '行情上下文已关闭')
  }

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    for (const f of files.slice(0, 6)) {
      if (f.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })
        setAttachments((cur) => [...cur, { id: uid(), name: f.name, kind: 'image', dataUrl }])
      } else {
        let text = await f.text()
        if (text.length > 6000) text = text.slice(0, 6000) + '\n…（内容过长已截断）'
        setAttachments((cur) => [...cur, { id: uid(), name: f.name, kind: 'text', text }])
      }
    }
    if (files.length > 0) toast.success(`已附加 ${Math.min(files.length, 6)} 个文件`)
  }
  const [endpoints] = useState<OllamaEndpoint[]>(loadEndpoints)
  const [probes, setProbes] = useState<Map<string, OllamaTag[] | null>>(new Map())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [s.messages, typing, elapsed])

  // 思考计时：等待模型首个 token 期间每秒刷新
  useEffect(() => {
    if (!thinking) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - thinking.since) / 1000)), 500)
    return () => clearInterval(t)
  }, [thinking])

  // 启动时探测全部 Ollama 端点
  useEffect(() => {
    probeAll(endpoints).then((m) => {
      setProbes(m)
      endpoints.forEach((ep) => {
        const tags = m.get(ep.id)
        if (tags) s.log('model', `${ep.label}（${ep.base}）已连接，发现 ${tags.length} 个模型：${tags.map((t) => t.name).join('、') || '无'}`)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onlineCount = endpoints.filter((ep) => probes.get(ep.id) != null).length

  // 已选模型被删除/端点重扫后不存在/从模型列表移除时，自动切回自动路由
  useEffect(() => {
    if (!target.startsWith('ollama:')) return
    const rest = target.slice(7)
    const idx = rest.indexOf(':')
    const epId = rest.slice(0, idx)
    const model = rest.slice(idx + 1)
    const tags = probes.get(epId)
    const added = s.localModels.some((lm) => lm.name === model && lm.status === 'running')
    if (!added || (tags != null && !tags.some((t) => t.name === model))) {
      setTarget('auto')
      toast.info(!added ? `模型 ${model} 已从模型列表移除或已停止，已切回自动路由` : `模型 ${model} 已不在端点模型列表中，已切回自动路由`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probes, target, s.localModels])

  // 组装发往模型的完整会话：行为补丁 + 行情上下文 + 思考强度 + 历史 + 附件（Ollama/API 两路共用）
  const buildConversation = async (text: string, atts: Attachment[], withImages: boolean) => {
    const activePatches = s.patches.filter((p) => p.status === 'active')
    const sysMsgs: ChatMsg[] = activePatches.length ? [{ role: 'system', content: '行为规则：\n' + activePatches.map((p) => `- ${p.content}`).join('\n') }] : []
    // 行情上下文：注入自选股实时快照 + 消息提及标的的行情与资金流
    if (useMarketCtx) {
      try {
        const ctx = await buildMarketContext(text)
        if (ctx) sysMsgs.push({ role: 'system', content: `${ctx}\n（以上为你的行情采集系统实时数据，分析推理时请直接引用其中数字，不要编造行情数据。）` })
      } catch { /* 行情源异常不阻塞对话 */ }
    }
    // 数据调用：实时采集勾选/智能触发的数据中心域、回测结果与 QVeris 能力注入
    if (dcCfg.domains.length > 0 || text.trim()) {
      try {
        const mentioned = extractMentionedCodes(text)
        const codes = mentioned.length ? mentioned : loadWatchList().slice(0, 3).map((w) => w.code)
        const dc = await buildDataCallContext({ userText: text, domains: dcCfg.domains, strategyId: dcCfg.strategyId, codes })
        if (dc.text) {
          sysMsgs.push({ role: 'system', content: `${dc.text}\n（以上为你的数据系统刚刚实时采集的数据，回答时请直接引用，注明数据时间，不要编造。）` })
          s.log('model', `数据调用注入：${dc.used.join('、')}`)
        }
      } catch { /* 数据调用异常不阻塞对话 */ }
    }
    // 思考强度
    const think = THINK_CONF[thinkLevel]
    if (think.prompt) sysMsgs.push({ role: 'system', content: think.prompt })
    const lc = LEN_CONF[chatLen]
    // 附件：文本拼入用户消息，图片按需走 images 字段
    const textAtts = atts.filter((a) => a.kind === 'text')
    const images = withImages ? atts.filter((a) => a.kind === 'image' && a.dataUrl).map((a) => a.dataUrl!.split(',')[1]) : []
    const imgNote = !withImages && atts.some((a) => a.kind === 'image') ? `（附件含 ${atts.filter((a) => a.kind === 'image').length} 张图片，当前 API 通道不支持图片传输，请改用本地视觉模型查看）\n\n` : ''
    const fullUserText = (textAtts.length ? textAtts.map((a) => `【附件：${a.name}】\n${a.text}`).join('\n\n') + '\n\n' : '') + imgNote + text
    // 知识库检索增强：选用端点时把命中片段注入系统消息（检索失败不阻塞对话）
    let kbHits: string[] = []
    if (kbTarget !== 'off') {
      const kbEp = kbEndpoints.find((x) => x.id === kbTarget)
      if (kbEp && text.trim()) {
        try {
          const hits = await kbSearch(kbEp, text.trim(), 5)
          if (hits.length > 0) {
            sysMsgs.push({
              role: 'system',
              content: '知识库参考资料（来自知识库「' + kbEp.name + '」，回答时优先引用并注明来源）：\n\n'
                + hits.map((h, i) => '【资料' + (i + 1) + ' · ' + h.title + '】\n' + h.text).join('\n\n'),
            })
            kbHits = hits.map((h) => h.title)
            s.log('model', `知识库检索命中 ${hits.length} 条（${kbEp.name}）`)
          } else {
            s.log('model', `知识库「${kbEp.name}」检索无命中，按无知识库发送`)
          }
        } catch (e) {
          toast.error(`知识库检索失败：${e instanceof Error ? e.message : '异常'}（本次将不使用知识库）`)
        }
      }
    }
    const history: ChatMsg[] = [
      ...sysMsgs,
      ...s.messages.slice(-lc.history).filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: fullUserText, ...(images.length ? { images } : {}) },
    ]
    return { history, think, lc, kbHits }
  }

  // 真实调用指定端点的 Ollama 模型（流式）；trace 存在时表示自动路由分发，记路由日志
  const sendViaOllama = async (text: string, ep: OllamaEndpoint, model: string, atts: Attachment[] = [], trace?: RouteTrace) => {
    const t0 = performance.now()
    const replyId = uid()
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    const { history, think, lc, kbHits } = await buildConversation(text, atts, true)
    s.setMessages([...useStore.getState().messages, { id: replyId, role: 'assistant', content: '…', time: t, model: `${ep.label} · ${model}`, routeTrace: trace, kbSources: kbHits.length ? kbHits : undefined }])
    setThinking({ label: `${ep.label} · ${model}`, since: Date.now() })
    let firstToken = false
    try {
      const full = await ollamaChat(ep.base, model, history, (partial) => {
        if (!firstToken) { firstToken = true; setThinking(null) } // 首个 token 到达，结束思考计时
        s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? { ...m, content: partial } : m)))
      }, { numPredict: lc.numPredict, think: think.think })
      const latency = Math.round(performance.now() - t0)
      s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? {
        ...m, content: full || '（空回复）',
        routeTrace: trace ?? { taskType: '局域网直连', strategy: 'Ollama 直连', candidates: [model], chosen: `${ep.label} · ${model}`, reason: `指定 ${ep.label}（${ep.base}）真实推理`, latencyMs: latency, cost: 0 },
        tokens: Math.round(full.length / 1.5),
      } : m)))
      if (trace) {
        // 自动路由真实执行：记路由日志（自我学习样本）
        s.log('route', `「${trace.taskType}」→ ${ep.label} · ${model}（${latency}ms，本地零成本）`)
      } else {
        // 指定模型直发：记为 model 事件而非 route，避免污染路由决策统计与自我学习样本
        s.log('model', `${ep.label} · ${model} 真实推理完成（${latency}ms，零成本）`)
      }
    } catch (e) {
      s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? { ...m, content: `⚠️ ${ep.label} 调用失败：${e instanceof Error ? e.message : '连接异常'}\n\n请确认：1) ${ep.base} 的 Ollama 已启动；2) 模型 ${model} 已拉取；3) 本机与该服务器网络互通。` } : m)))
      toast.error('Ollama 调用失败，请检查端点状态')
    }
    setThinking(null)
    setTyping(false)
  }

  // 真实调用 API 模型（OpenAI 兼容 /chat/completions，SSE 流式）；trace 存在时表示自动路由分发
  const sendViaApi = async (text: string, am: ApiModel, atts: Attachment[] = [], trace?: RouteTrace) => {
    const t0 = performance.now()
    const replyId = uid()
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    const label = `${am.provider} · ${am.model}`
    const key = await loadSecret(`apikey:${am.id}`)
    if (!key) {
      s.setMessages([...useStore.getState().messages, { id: replyId, role: 'assistant', time: t, model: label, routeTrace: trace, content: `⚠️ 未找到 ${label} 的 API Key（可能因版本升级丢失）。请到「模型管理」删除后重新添加该模型。` }])
      setTyping(false)
      return
    }
    const { history, kbHits } = await buildConversation(text, atts, false)
    s.setMessages([...useStore.getState().messages, { id: replyId, role: 'assistant', content: '…', time: t, model: label, routeTrace: trace, kbSources: kbHits.length ? kbHits : undefined }])
    setThinking({ label, since: Date.now() })
    let firstToken = false
    try {
      const r = await fetch(`${am.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: am.model, messages: history.map(({ role, content }) => ({ role, content })), stream: true }),
      })
      if (!r.ok) {
        const errText = (await r.text().catch(() => '')).slice(0, 200)
        throw new Error(`HTTP ${r.status}${errText ? `：${errText}` : ''}`)
      }
      let full = ''
      const contentType = r.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream') && r.body) {
        // SSE 流式解析
        const reader = r.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            const payload = l.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
              const piece = j.choices?.[0]?.delta?.content ?? ''
              if (piece) {
                if (!firstToken) { firstToken = true; setThinking(null) }
                full += piece
                s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? { ...m, content: full } : m)))
              }
            } catch { /* 跳过坏行 */ }
          }
        }
      } else {
        // 非流式兜底（部分端点忽略 stream 参数）
        const j = await r.json() as { choices?: { message?: { content?: string } }[] }
        full = j.choices?.[0]?.message?.content ?? ''
        if (full) s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? { ...m, content: full } : m)))
      }
      const latency = Math.round(performance.now() - t0)
      const estTokens = Math.round(full.length / 1.5)
      const cost = +(am.costPer1k * estTokens / 1000).toFixed(4)
      s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? {
        ...m, content: full || '（空回复）',
        routeTrace: trace ?? { taskType: 'API 直连', strategy: 'OpenAI 兼容直连', candidates: [am.model], chosen: label, reason: `指定 ${label} 真实推理`, latencyMs: latency, cost },
        tokens: estTokens,
      } : m)))
      if (trace) {
        s.log('route', `「${trace.taskType}」→ ${label}（${latency}ms，约 $${cost}）`)
      } else {
        s.log('model', `${label} 真实推理完成（${latency}ms，约 $${cost}）`)
      }
    } catch (e) {
      s.setMessages(useStore.getState().messages.map((m) => (m.id === replyId ? { ...m, content: `⚠️ ${label} 调用失败：${e instanceof Error ? e.message : '网络异常'}\n\n请确认：1) Base URL 与 Key 正确；2) 网络可访问 ${am.baseUrl}；3) 模型名 ${am.model} 在该平台存在。` } : m)))
      toast.error('API 调用失败，请检查配置与网络')
    }
    setThinking(null)
    setTyping(false)
  }

  const send = () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || typing) return
    const atts = attachments
    setInput('')
    setAttachments([])
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    // 显示文本：原文 + 附件标注（附件正文仅注入模型，不占消息气泡）
    const attNote = atts.length ? `\n[附件 ${atts.length} 个：${atts.map((a) => a.name).join('、')}]` : ''
    const displayText = (text || '请分析附件内容') + attNote
    s.setMessages([...s.messages, { id: uid(), role: 'user', content: displayText, time: t }])
    setTyping(true)
    if (atts.some((a) => a.kind === 'image')) {
      toast.info('已附加图片：将随消息发送给模型（需所选模型支持视觉输入，如 qwen-vl / gemma 视觉版）')
    }

    if (target.startsWith('ollama:')) {
      const rest = target.slice(7)
      const idx = rest.indexOf(':')
      const ep = endpoints.find((e) => e.id === rest.slice(0, idx))
      const model = rest.slice(idx + 1)
      if (ep) {
        // 发送前校验：端点须在线且模型仍在已加载列表中，否则拦截并提示
        const tags = probes.get(ep.id)
        if (tags == null) {
          toast.error(`端点 ${ep.label}（${ep.base}）当前离线，无法发送`)
          setTyping(false)
          return
        }
        if (!tags.some((tg) => tg.name === model)) {
          toast.error(`模型 ${model} 已从 ${ep.label} 移除或未加载，请重新选择`)
          setTarget('auto')
          setTyping(false)
          return
        }
        if (!s.localModels.some((lm) => lm.name === model && lm.status === 'running')) {
          toast.error(`模型 ${model} 未添加或已停止，请先在「模型管理」同步并启动后再调用`)
          setTarget('auto')
          setTyping(false)
          return
        }
        sendViaOllama(text || '请分析附件内容', ep, model, atts)
        return
      }
    }

    // 空配置保护：未配置任何模型时引导去模型管理
    const hasModels = s.apiModels.length + s.mixtures.length + s.localModels.length > 0
    if (!hasModels) {
      s.setMessages([...useStore.getState().messages, {
        id: uid(), role: 'assistant', time: t,
        content: '还没有可用模型。请到「模型管理」：\n1) 确认局域网 Ollama 端点在线并「同步到模型列表」，或\n2) 添加一个 API 模型（填 Base URL 与 Key）。\n配置好后，也可以在上方选择器直接指定 Ollama 端点模型立即对话。',
      }])
      setTyping(false)
      return
    }

    // ===== 真实分发 =====
    // 自动路由：路由引擎在「已添加的本地模型 / API 模型」中挑选并真实调用
    // 指定目标：API 模型直连；聚合池按池策略选成员后真实调用
    const trace = target === 'auto' ? routeMessage(text || '附件分析') : null
    let chosenId = trace?.chosenId
    if (!chosenId && target !== 'auto') {
      chosenId = s.apiModels.some((m) => m.id === target) ? target : pickFromMixture(target) ?? undefined
    }
    if (chosenId) {
      const lm = s.localModels.find((m) => m.id === chosenId && m.status === 'running')
      if (lm) {
        // 本地模型：定位端点（epId → probes 反查 → 主端点），校验后真实调用
        const ep = endpoints.find((e) => e.id === lm.epId)
          ?? endpoints.find((e) => (probes.get(e.id) ?? []).some((tg) => tg.name === lm.name))
          ?? endpoints.find((e) => e.role === 'primary') ?? endpoints[0]
        const tags = ep ? probes.get(ep.id) : null
        if (ep && tags == null) {
          s.setMessages([...useStore.getState().messages, { id: uid(), role: 'assistant', time: t, model: lm.name, routeTrace: trace ?? undefined, content: `⚠️ 路由选中了本地模型 ${lm.name}，但端点 ${ep.label}（${ep.base}）当前离线。请启动该端点 Ollama 后重试，或在选择器改选其他模型。` }])
          if (trace) s.log('route', `「${trace.taskType}」→ ${lm.name}（端点离线，调用未执行）`)
          setTyping(false)
          return
        }
        if (ep) { sendViaOllama(text || '请分析附件内容', ep, lm.name, atts, trace ?? undefined); return }
      }
      const am = s.apiModels.find((m) => m.id === chosenId)
      if (am) { sendViaApi(text || '请分析附件内容', am, atts, trace ?? undefined); return }
    }

    // 兜底：路由结果不可执行（聚合池为空等）→ 模拟回复并明示原因
    setTimeout(() => {
      const chosen = trace ? trace.chosen : modelName(target, s)
      const reply = {
        id: uid(), role: 'assistant' as const,
        content: generateReply(text) + '\n\n（提示：路由结果暂不可真实执行——请确认聚合池成员已在「模型管理」中添加且本地模型为运行中状态。）',
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        model: chosen, routeTrace: trace ?? undefined,
        tokens: 200 + Math.floor(Math.random() * 800),
      }
      s.setMessages([...useStore.getState().messages, reply])
      if (trace) s.log('route', `「${trace.taskType}」→ ${chosen}（无可用真实模型，模拟回复）`)
      setTyping(false)
    }, 900 + Math.random() * 800)
  }

  const feedback = (good: boolean) => {
    s.log('learn', good ? '收到正向反馈，强化本次路由决策权重' : '收到负向反馈，已记录用于路由修正')
    toast.success(good ? '已反馈：本次路由将加分' : '已反馈：将复盘这次路由选择')
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">对话</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            自动模式下，路由引擎按任务类型与成本实时挑选模型
            {s.patches.filter((p) => p.status === 'active').length > 0 && (
              <Pill tone="purple">行为补丁 ×{s.patches.filter((p) => p.status === 'active').length} 生效中</Pill>
            )}
            {onlineCount > 0
              ? <Pill tone="green">Ollama {onlineCount}/{endpoints.length} 端点在线</Pill>
              : <Pill>Ollama 端点离线</Pill>}
          </p>
        </div>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">⚡ 自动路由（推荐）</SelectItem>
            {/* 本地模型 = 已在「模型管理」添加且运行中：始终可见；端点探测成功但模型已删的自动清除；探测失败的标注离线 */}
            {s.localModels.filter((lm) => lm.status === 'running').flatMap((lm) => {
              const ep = endpoints.find((e) => e.id === lm.epId)
                ?? endpoints.find((e) => (probes.get(e.id) ?? []).some((tg) => tg.name === lm.name))
                ?? endpoints.find((e) => e.role === 'primary') ?? endpoints[0]
              if (!ep) return []
              const tags = probes.get(ep.id)
              if (tags != null && !tags.some((tg) => tg.name === lm.name)) return [] // 探测成功但模型已从端点删除
              const offline = tags == null
              return [(
                <SelectItem key={`${ep.id}:${lm.name}`} value={`ollama:${ep.id}:${lm.name}`}>
                  🖥️ {ep.role === 'primary' ? '主推理' : '备用'} · {lm.name}{offline ? '（端点离线）' : ''}
                </SelectItem>
              )]
            })}
            {s.mixtures.filter((m) => m.enabled).map((m) => <SelectItem key={m.id} value={m.id}>聚合 · {m.name}</SelectItem>)}
            {s.apiModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.provider}/{m.model}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card/40 p-4 space-y-4">
        {s.messages.map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed',
              m.role === 'user' ? 'bg-primary/20 text-foreground' : 'bg-secondary/60')}>
              {m.role === 'assistant' && m.content === '…' ? (
                <div className="space-y-1.5 text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-sky-400 animate-pulse" />
                    <span>{thinking ? `${thinking.label} 思考中…` : '模型生成中…'} <span className="font-mono text-sky-400 text-base">{elapsed}s</span></span>
                  </div>
                  {elapsed >= 15 && (
                    <div className="text-xs">大模型首次响应需要加载权重，72B 级别通常 30~90 秒；收到首个字后即开始逐字输出</div>
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap">{m.content}</div>
              )}
              {m.routeTrace && (
                <div className="mt-3 rounded-lg border border-border/60 bg-background/60 p-2.5 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-sky-400"><GitBranch className="h-3.5 w-3.5" /> 路由轨迹</div>
                  <div className="text-muted-foreground">{m.routeTrace.reason}</div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Pill tone="blue">{m.routeTrace.strategy}</Pill>
                    <Pill>{m.routeTrace.latencyMs}ms</Pill>
                    <Pill tone={m.routeTrace.cost ? 'amber' : 'green'}>{m.routeTrace.cost ? `$${m.routeTrace.cost}` : '本地 · 零成本'}</Pill>
                    <Pill tone="purple">{m.tokens} tokens</Pill>
                  </div>
                </div>
              )}
              {m.kbSources && m.kbSources.length > 0 && (
                <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-violet-300"><BookOpen className="h-3.5 w-3.5" /> 知识库来源</div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {m.kbSources.map((title, i) => <Pill key={i} tone="purple">{title}</Pill>)}
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{m.time}</span>
                {m.model && <span>· {m.model}</span>}
                <button title="复制该条对话" onClick={() => { navigator.clipboard?.writeText(m.content).then(() => toast.success('已复制')).catch(() => toast.error('复制失败')) }} className="hover:text-sky-400"><Copy className="h-3 w-3" /></button>
                {m.role === 'assistant' && (
                  <span className="flex gap-1 ml-auto">
                    <button onClick={() => feedback(true)} className="hover:text-emerald-400"><ThumbsUp className="h-3 w-3" /></button>
                    <button onClick={() => feedback(false)} className="hover:text-red-400"><ThumbsDown className="h-3 w-3" /></button>
                    <button onClick={() => { s.setMemories([{ id: uid(), content: m.content.slice(0, 120), type: 'episode', importance: 55, source: '对话手动收藏', createdAt: new Date().toLocaleString('zh-CN', { hour12: false }), hits: 0 }, ...s.memories]); toast.success('已存入长期记忆') }} className="hover:text-violet-400"><Brain className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {typing && !s.messages.some((m) => m.content === '…') && (
          <div className="flex"><div className="bg-secondary/60 rounded-xl px-4 py-3 text-sm text-muted-foreground">
            <span className="animate-pulse">{target === 'auto' ? '路由引擎评估中 → 模型生成中…' : '模型生成中…'}</span>
          </div></div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 对话工具栏：行情上下文 / 思考强度 / 对话长度 */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={toggleMarketCtx}
          className={cn('rounded-full px-3 py-1.5 border transition-colors',
            useMarketCtx ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'border-border/60 text-muted-foreground hover:bg-accent')}>
          📈 行情上下文{useMarketCtx ? '·开' : '·关'}
        </button>
        {/* 数据调用：勾选后发送时实时采集注入；未勾选项按消息关键词智能触发 */}
        <div ref={dcRef} className="relative">
          <button onClick={() => setDcOpen(!dcOpen)}
            className={cn('rounded-full px-3 py-1.5 border transition-colors',
              dcCfg.domains.length > 0 ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'border-border/60 text-muted-foreground hover:bg-accent')}>
            🛰️ 数据调用{dcCfg.domains.length > 0 ? `·${dcCfg.domains.length}项` : '·智能'}
          </button>
          {dcOpen && (
            <div className="absolute bottom-full mb-2 left-0 z-30 w-80 rounded-lg border border-white/10 bg-accent p-3 shadow-xl space-y-2">
              <div className="text-muted-foreground leading-relaxed">勾选的数据域每次发送必带；未勾选的按消息关键词<b className="text-foreground">智能触发</b>（如提到「涨停」自动附带打板情绪）。全部实时采集，失败自动跳过。</div>
              <div className="grid grid-cols-2 gap-1">
                {DATA_DOMAINS.map((d) => {
                  const isQv = d.id === 'qveris'
                  const disabled = isQv && !qvConfigured
                  const on = dcCfg.domains.includes(d.id)
                  return (
                    <button key={d.id} disabled={disabled}
                      onClick={() => toggleDomain(d.id)}
                      title={disabled ? '请先在「数据中心 → 数据源」配置 QVeris API Key' : d.desc}
                      className={cn('rounded-md border px-2 py-1.5 text-left transition-colors',
                        on ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'border-border/60 text-muted-foreground hover:bg-background/60',
                        disabled && 'opacity-40 cursor-not-allowed')}>
                      <div className="font-medium">{d.label}{on && ' ✓'}</div>
                      <div className="text-[10px] opacity-80">{isQv && !qvConfigured ? '需配置 Key' : d.desc}</div>
                    </button>
                  )
                })}
              </div>
              {dcCfg.domains.includes('backtest') && (
                <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
                  <span className="text-muted-foreground shrink-0">回测策略</span>
                  <Select value={dcCfg.strategyId} onValueChange={setDcStrategy}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map((st) => (
                        <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>
        <span className="text-muted-foreground">思考强度</span>
        <Select value={thinkLevel} onValueChange={(v) => setThinkLevel(v as ThinkLevel)}>
          <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">低</SelectItem>
            <SelectItem value="standard">标准</SelectItem>
            <SelectItem value="high">高</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">对话长度</span>
        <Select value={chatLen} onValueChange={(v) => setChatLen(v as ChatLen)}>
          <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="short">短</SelectItem>
            <SelectItem value="standard">标准</SelectItem>
            <SelectItem value="long">长</SelectItem>
          </SelectContent>
        </Select>
        {/* 知识库选择：端点在「模型管理」配置；选中后发送前自动检索注入 */}
        {kbEndpoints.length > 0 && (
          <>
            <span className="text-muted-foreground flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> 知识库</span>
            <Select value={kbTarget} onValueChange={setKbTarget}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">关闭</SelectItem>
                {kbEndpoints.map((ep) => (
                  <SelectItem key={ep.id} value={ep.id}>{ep.type === 'llmwiki' ? '📕' : '🗄️'} {ep.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      {/* 附件 chips */}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-xs">
              {a.kind === 'image' ? <ImageIcon className="h-3 w-3 text-violet-400" /> : <FileText className="h-3 w-3 text-sky-400" />}
              {a.name}
              <button onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))} className="hover:text-red-400"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <input ref={fileRef} type="file" multiple className="hidden"
          accept=".txt,.md,.csv,.json,.log,.py,.js,.ts,.tsx,.jsx,.html,.css,.xml,.yml,.yaml,.png,.jpg,.jpeg,.webp,.gif"
          onChange={onPickFiles} />
        <Button variant="outline" title="上传文件 / 图片（文本将注入上下文，图片发给视觉模型）"
          onClick={() => fileRef.current?.click()} className="h-[52px] px-4">
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="输入任务，Enter 发送…可直接问「贵州茅台现在怎么样」，模型将引用实时行情回答"
          className="min-h-[52px] max-h-40 resize-none"
        />
        <Button onClick={send} disabled={typing || (!input.trim() && attachments.length === 0)} className="h-[52px] px-5"><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
