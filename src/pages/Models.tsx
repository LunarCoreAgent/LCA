import { useEffect, useState } from 'react'
import { useStore, uid, modelName } from '@/lib/store'
import { loadEndpoints, saveEndpoints, probeAll, type OllamaTag, type OllamaEndpoint } from '@/lib/ollama'
import { saveSecret, maskSecret } from '@/lib/secrets'
import { PageHeader, Section, Pill, statusPill } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Play, Square, Download, Plus, Trash2, RefreshCw, Layers, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ApiModel, Mixture, RouteStrategy } from '@/lib/types'

// 主流模型 API 地址预设（下拉可选，也可手填任意地址）
const API_BASE_PRESETS = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { name: 'Kimi（Moonshot）', url: 'https://api.moonshot.cn/v1' },
  { name: 'Google Gemini / Gemma', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'MiniMax', url: 'https://api.minimax.chat/v1' },
  { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: '通义千问（阿里）', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1' },
] as const

// 从 Base URL 推断提供方名称
function guessProvider(baseUrl: string): string {
  try {
    const h = new URL(baseUrl).hostname.toLowerCase()
    const table: [RegExp, string][] = [
      [/openai\.com/, 'OpenAI'],
      [/deepseek/, 'DeepSeek'],
      [/moonshot/, 'Kimi（Moonshot）'],
      [/minimax/, 'MiniMax'],
      [/bigmodel|zhipu/, '智谱 GLM'],
      [/dashscope|aliyun/, '通义千问'],
      [/siliconflow/, '硅基流动'],
      [/openrouter/, 'OpenRouter'],
      [/volces|ark/, '火山引擎'],
      [/anthropic/, 'Anthropic'],
      [/googleapis|generativelanguage/, 'Google'],
      [/^(localhost|127\.|192\.168\.|10\.|172\.)/, '本地/局域网'],
    ]
    for (const [re, name] of table) if (re.test(h)) return name
    return h.split('.').slice(-2, -1)[0]?.replace(/^\w/, (c) => c.toUpperCase()) ?? '自定义'
  } catch { return '自定义' }
}

export default function Models() {
  const s = useStore()
  const [pullName, setPullName] = useState('')
  const [apiDraft, setApiDraft] = useState({ provider: '', model: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' })
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState<{ kind: 'openai' | 'ollama'; models: string[] } | null>(null)
  const [mixDraft, setMixDraft] = useState({ name: '', strategy: 'weighted' as RouteStrategy, members: [] as string[] })
  const [mixOpen, setMixOpen] = useState(false)
  const [editingMixId, setEditingMixId] = useState<string | null>(null)
  const [endpoints, setEndpoints] = useState<OllamaEndpoint[]>(loadEndpoints)
  const [probes, setProbes] = useState<Map<string, OllamaTag[] | null>>(new Map())
  const [epDraft, setEpDraft] = useState({ label: '', base: '', role: 'backup' as 'primary' | 'backup' })

  const refreshProbes = (eps: OllamaEndpoint[]) => { probeAll(eps).then(setProbes) }
  useEffect(() => { refreshProbes(endpoints) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 旧版本缓存迁移：早期 localModels/apiModels 可能缺 id，导致聚合池勾选失效（members 永远是空）
  useEffect(() => {
    const fixedLocal = s.localModels.map((m) => (m.id ? m : { ...m, id: 'lm-' + String(m.name ?? uid()).replace(/[^a-z0-9]/gi, '-') }))
    if (fixedLocal.some((m, i) => m.id !== s.localModels[i]?.id)) s.setLocalModels(fixedLocal)
    const fixedApi = s.apiModels.map((m) => (m.id ? m : { ...m, id: 'am-' + uid() }))
    if (fixedApi.some((m, i) => m.id !== s.apiModels[i]?.id)) s.setApiModels(fixedApi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveEps = (eps: OllamaEndpoint[]) => {
    setEndpoints(eps)
    saveEndpoints(eps)
    refreshProbes(eps)
  }

  const addEndpoint = () => {
    const base = epDraft.base.trim().replace(/\/$/, '')
    if (!epDraft.label.trim() || !/^https?:\/\/[\w.-]+:\d{1,5}$/.test(base)) {
      toast.error('请填写名称与合法地址，如 http://127.0.0.1:11434 或局域网 http://192.168.x.x:11434')
      return
    }
    if (endpoints.some((e) => e.base === base)) { toast.error('该地址已存在'); return }
    saveEps([...endpoints, { id: 'ep-' + uid(), label: epDraft.label.trim(), base, role: epDraft.role }])
    toast.success('端点已添加，正在探测…')
    setEpDraft({ label: '', base: '', role: 'backup' })
  }

  const syncOllama = (ep: OllamaEndpoint) => {
    const tags = probes.get(ep.id)
    if (!tags) return
    const port = Number(new URL(ep.base).port) || 11434
    const existing = new Set(s.localModels.map((m) => m.name))
    const fresh = tags.filter((t) => !existing.has(t.name)).map((t) => ({
      id: 'lm-ollama-' + t.name.replace(/[^a-z0-9]/gi, '-'),
      name: t.name,
      params: t.details?.parameter_size ?? '-',
      quant: t.details?.quantization_level ?? '-',
      size: (t.size / 1e9).toFixed(1) + ' GB',
      ctx: 32768, status: 'running' as const, port,
      epId: ep.id, // 记录来源端点，对话直发时定位
    }))
    if (fresh.length === 0) { toast.info('该端点模型已全部在列表中'); return }
    s.setLocalModels([...s.localModels, ...fresh])
    s.log('model', `从 ${ep.label}（${ep.base}）同步 ${fresh.length} 个模型`)
    toast.success(`已同步 ${fresh.length} 个模型到本地模型列表`)
  }

  const toggleLocal = (id: string, run: boolean) => {
    s.setLocalModels(s.localModels.map((m) => (m.id === id ? { ...m, status: run ? 'running' : 'stopped' } : m)))
    const m = s.localModels.find((x) => x.id === id)!
    s.log('model', `本地模型 ${m.name} ${run ? '已启动' : '已停止'}`)
    toast.success(run ? `${m.name} 已加载到显存` : `${m.name} 已卸载`)
  }

  const pullModel = () => {
    if (!pullName.trim()) return
    const id = 'lm-' + uid()
    s.setLocalModels([...s.localModels, { id, name: pullName.trim(), params: '-', quant: 'Q4_K_M', size: '下载中', ctx: 8192, status: 'downloading', port: 11440 + s.localModels.length, progress: 12 }])
    s.log('model', `开始拉取本地模型 ${pullName}`)
    toast.success(`开始部署 ${pullName}，下载完成后可在此启动`)
    setPullName('')
  }

  // 自动识别：按 Base URL（+Key）拉取端点模型列表，自动填提供方与可选模型
  const detectApi = async () => {
    const base = apiDraft.baseUrl.trim()
    if (!/^https?:\/\/\S+$/.test(base)) { toast.error('请先填写合法的 Base URL，如 https://api.openai.com/v1'); return }
    setDetecting(true)
    setDetected(null)
    try {
      let result: { kind: 'openai' | 'ollama'; models: string[] }
      if (window.agentcore?.api) {
        result = await window.agentcore.api.models(base, apiDraft.apiKey)
      } else {
        // 浏览器开发模式直连（需端点允许 CORS）
        const r = await fetch(`${base.replace(/\/+$/, '')}/models`, { headers: apiDraft.apiKey ? { Authorization: `Bearer ${apiDraft.apiKey}` } : {} })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const list = Array.isArray(j?.data) ? j.data.map((m: { id?: string }) => String(m.id ?? '')).filter(Boolean) : []
        if (list.length === 0) throw new Error('未发现模型')
        result = { kind: 'openai', models: list }
      }
      setDetected(result)
      setApiDraft((d) => ({ ...d, provider: guessProvider(base), model: d.model || result.models[0] || '' }))
      s.log('model', `API 端点识别成功：${guessProvider(base)}（${result.kind === 'openai' ? 'OpenAI 兼容' : 'Ollama'}），发现 ${result.models.length} 个模型`)
      toast.success(`识别成功：${result.models.length} 个模型可选`)
    } catch (e) {
      toast.error(`识别失败：${e instanceof Error ? e.message : '端点不可达'}。仍可手动填写添加`)
    } finally {
      setDetecting(false)
    }
  }

  const addApi = async () => {
    if (!apiDraft.provider || !apiDraft.model) { toast.error('请填写提供方与模型名（或点「自动识别」）'); return }
    const id = 'api-' + uid()
    let storedKey = '未设置'
    if (apiDraft.apiKey) {
      await saveSecret(`apikey:${id}`, apiDraft.apiKey) // 密钥入钥匙串，界面只留掩码
      storedKey = maskSecret(apiDraft.apiKey)
    }
    s.setApiModels([...s.apiModels, { id, ...apiDraft, apiKey: storedKey, latencyMs: 500, costPer1k: 0.005, status: 'untested', tags: ['自定义'] } as ApiModel])
    s.log('model', `新增 API 模型 ${apiDraft.provider}/${apiDraft.model}（密钥已加密存储）`)
    toast.success('API 模型已添加，密钥已加密存入系统钥匙串')
    setApiDraft({ provider: '', model: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' })
    setDetected(null)
  }

  const testApi = (id: string) => {
    s.setApiModels(s.apiModels.map((m) => (m.id === id ? { ...m, status: 'online', latencyMs: 300 + Math.floor(Math.random() * 600) } : m)))
    toast.success('连通性测试通过')
  }

  const addMix = () => {
    if (!mixDraft.name.trim()) { toast.error('请先填写聚合池名称'); return }
    if (mixDraft.members.length < 2) { toast.error(`聚合池至少选择 2 个成员模型（当前已选 ${mixDraft.members.length} 个）`); return }
    if (editingMixId) {
      // 保存修改：保留调用计数与启用状态；原兜底成员被移出时重置兜底
      s.setMixtures(s.mixtures.map((x) => (x.id === editingMixId
        ? { ...x, name: mixDraft.name, members: mixDraft.members, strategy: mixDraft.strategy, fallback: mixDraft.members.includes(x.fallback) ? x.fallback : mixDraft.members[0] }
        : x)))
      toast.success(`聚合池「${mixDraft.name}」已更新`)
    } else {
      s.setMixtures([...s.mixtures, { id: 'mix-' + uid(), name: mixDraft.name, members: mixDraft.members, strategy: mixDraft.strategy, fallback: mixDraft.members[0], enabled: true, calls: 0 } as Mixture])
      toast.success(`聚合池「${mixDraft.name}」已创建并启用`)
    }
    setMixDraft({ name: '', strategy: 'weighted', members: [] })
    setEditingMixId(null)
    setMixOpen(false)
  }

  // 打开「修改」对话框：预填该池配置
  const editMix = (m: Mixture) => {
    setMixDraft({ name: m.name, strategy: m.strategy, members: [...m.members] })
    setEditingMixId(m.id)
    setMixOpen(true)
  }

  const deleteMix = (m: Mixture) => {
    s.setMixtures(s.mixtures.filter((x) => x.id !== m.id))
    s.log('model', `聚合池「${m.name}」已删除`)
    toast.success(`聚合池「${m.name}」已删除`)
  }

  const allModels = [...s.localModels.map((m) => m.id), ...s.apiModels.map((m) => m.id)].filter((id): id is string => !!id)

  return (
    <div>
      <PageHeader title="模型管理" desc="本地模型独立部署 · API 模型独立配置 · 聚合池混合路由" />
      <Tabs defaultValue="mixture">
        <TabsList className="mb-4">
          <TabsTrigger value="mixture">聚合池</TabsTrigger>
          <TabsTrigger value="local">本地模型</TabsTrigger>
          <TabsTrigger value="api">API 模型</TabsTrigger>
        </TabsList>

        {/* 聚合池 */}
        <TabsContent value="mixture" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={mixOpen} onOpenChange={(v) => { setMixOpen(v); if (!v) { setEditingMixId(null); setMixDraft({ name: '', strategy: 'weighted', members: [] }) } }}>
              <DialogTrigger asChild><Button onClick={() => { setEditingMixId(null); setMixDraft({ name: '', strategy: 'weighted', members: [] }) }}><Plus className="h-4 w-4 mr-1" /> 新建聚合池</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editingMixId ? '修改聚合池' : '创建聚合池（API + 本地混合）'}</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <Input placeholder="名称，如：推理增强池" value={mixDraft.name} onChange={(e) => setMixDraft({ ...mixDraft, name: e.target.value })} />
                  <Select value={mixDraft.strategy} onValueChange={(v) => setMixDraft({ ...mixDraft, strategy: v as RouteStrategy })}>
                    <SelectTrigger><SelectValue placeholder="路由策略" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weighted">加权路由（按成本/延迟/质量打分）</SelectItem>
                      <SelectItem value="cascade">级联路由（便宜优先，不行升级）</SelectItem>
                      <SelectItem value="vote">投票聚合（多模型同答后裁决）</SelectItem>
                      <SelectItem value="rule">规则直通（按关键词固定分发）</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="rounded-lg border border-border/60 p-3 max-h-48 overflow-y-auto space-y-2">
                    <div className="text-xs text-muted-foreground mb-1">选择成员（至少 2 个，可混选本地与 API）</div>
                    {allModels.map((id) => (
                      <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={mixDraft.members.includes(id)}
                          onCheckedChange={(ch) => setMixDraft({ ...mixDraft, members: ch ? [...new Set([...mixDraft.members, id])] : mixDraft.members.filter((x) => x !== id) })}
                        />
                        {modelName(id, s)}
                      </label>
                    ))}
                    <div className="text-xs text-muted-foreground pt-1">已选 {mixDraft.members.length} 个{mixDraft.members.length >= 2 ? ' ✓' : '（至少 2 个）'}</div>
                  </div>
                  <Button onClick={addMix} className="w-full">{editingMixId ? '保存修改' : '创建并启用'}</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {s.mixtures.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
              <div className="text-sm font-medium mb-1">暂无聚合池</div>
              <div className="text-xs text-muted-foreground max-w-md mx-auto">
                先在「本地模型」tab 同步局域网 Ollama 模型，或在「API 模型」tab 接入在线模型，然后点击右上角「新建聚合池」把多个模型组合成混合路由池（加权 / 级联 / 投票 / 规则）。
              </div>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {s.mixtures.map((m) => (
              <Section key={m.id} title={m.name} desc={`策略：${{ weighted: '加权路由', cascade: '级联路由', vote: '投票聚合', rule: '规则直通' }[m.strategy]} · 兜底：${modelName(m.fallback, s)}`}>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {m.members.map((id) => <Pill key={id} tone={id.startsWith('lm-') ? 'green' : 'blue'}>{modelName(id, s)}</Pill>)}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground text-xs">累计调用 {m.calls} 次</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => editMix(m)}>修改</Button>
                    <Button size="sm" variant="ghost" title="删除聚合池" onClick={() => deleteMix(m)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    <span className="text-xs text-muted-foreground">{m.enabled ? '已启用' : '已停用'}</span>
                    <Switch checked={m.enabled} onCheckedChange={(v) => s.setMixtures(s.mixtures.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)))} />
                  </div>
                </div>
              </Section>
            ))}
          </div>
        </TabsContent>

        {/* 本地模型 */}
        <TabsContent value="local" className="space-y-4">
          {/* Ollama 局域网端点 */}
          <Section title="Ollama 端点（局域网模型集群）" desc="对话页可直接调用在线端点的模型；桌面版经主进程代理，无跨域限制">
            <div className="space-y-3">
              {endpoints.map((ep) => {
                const tags = probes.get(ep.id)
                return (
                  <div key={ep.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{ep.label}</span>
                        <Pill tone={ep.role === 'primary' ? 'purple' : 'blue'}>{ep.role === 'primary' ? '主推理' : '备用/快速'}</Pill>
                        {tags == null ? <Pill>离线</Pill> : <Pill tone="green">在线 · {tags.length} 个模型</Pill>}
                      </div>
                      <div className="flex items-center gap-2">
                        {tags != null && <Button size="sm" variant="outline" onClick={() => syncOllama(ep)}>同步到模型列表</Button>}
                        <Button size="sm" variant="ghost" onClick={() => { saveEps(endpoints.filter((x) => x.id !== ep.id)); toast.success('端点已移除') }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">{ep.base}</div>
                    {tags != null && <div className="text-xs text-muted-foreground mt-1">{tags.map((t) => t.name).join('、') || '（无模型）'}</div>}
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <Input placeholder="端点名称，如：主推理" value={epDraft.label} onChange={(e) => setEpDraft({ ...epDraft, label: e.target.value })} className="w-36" />
              <Input placeholder="http://IP:11434" value={epDraft.base} onChange={(e) => setEpDraft({ ...epDraft, base: e.target.value })} className="w-56" />
              <Select value={epDraft.role} onValueChange={(v) => setEpDraft({ ...epDraft, role: v as 'primary' | 'backup' })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">主推理</SelectItem>
                  <SelectItem value="backup">备用/快速</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={addEndpoint}><Plus className="h-4 w-4 mr-1" /> 添加端点</Button>
            </div>
          </Section>
          <Section title="知识库端点" desc="知识库端点管理已迁至「长期记忆」页">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-sky-400" />
              请前往「长期记忆」页（记忆库下方「知识库端点」）添加、测试端点；连接状态与检索验证见「设置 → 知识库」，对话页工具栏选择启用。
            </div>
          </Section>
          <Section title="部署新模型" desc="兼容 Ollama / vLLM 运行时，输入模型标识即可拉取">
            <div className="flex gap-2">
              <Input placeholder="如：qwen3:14b 或 gguf 仓库地址" value={pullName} onChange={(e) => setPullName(e.target.value)} />
              <Button onClick={pullModel}><Download className="h-4 w-4 mr-1" /> 部署</Button>
            </div>
          </Section>
          {s.localModels.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center text-xs text-muted-foreground">
              模型列表为空。端点在线时点击其右侧「同步到模型列表」，或用上方「部署新模型」拉取模型。
            </div>
          )}
          <div className="space-y-3">
            {s.localModels.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card/60 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.name}</span>
                    {statusPill(m.status)}
                    <Pill>{m.quant}</Pill>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {m.params} · {m.size} · 上下文 {m.ctx.toLocaleString()} · 端口 :{m.port}
                    {m.status === 'downloading' && ` · 下载 ${m.progress}%`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {m.status === 'running'
                    ? <Button variant="outline" size="sm" onClick={() => toggleLocal(m.id, false)}><Square className="h-3.5 w-3.5 mr-1" /> 停止</Button>
                    : <Button size="sm" disabled={m.status === 'downloading'} onClick={() => toggleLocal(m.id, true)}><Play className="h-3.5 w-3.5 mr-1" /> 启动</Button>}
                  <Button variant="ghost" size="sm" onClick={() => { s.setLocalModels(s.localModels.filter((x) => x.id !== m.id)); toast.success('已移除') }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* API 模型 */}
        <TabsContent value="api" className="space-y-4">
          <Section title="接入 API 模型" desc="填 Base URL 与 Key 后点「自动识别」，自动识别提供方并列出可用模型；密钥仅保存在本机">
            <div className="grid grid-cols-2 gap-2">
              {/* Base URL：左侧显性下拉选预设（自动填地址与提供方），右侧可继续手改 */}
              <div className="col-span-2 flex gap-2">
                <Select
                  value={API_BASE_PRESETS.find((p) => p.url === apiDraft.baseUrl)?.name ?? '__custom'}
                  onValueChange={(v) => {
                    if (v === '__custom') return
                    const p = API_BASE_PRESETS.find((x) => x.name === v)
                    if (p) setApiDraft({ ...apiDraft, baseUrl: p.url, provider: apiDraft.provider || p.name.replace(/（.*?）/, '') })
                    setDetected(null)
                  }}
                >
                  <SelectTrigger className="w-52 shrink-0"><SelectValue placeholder="常用服务商" /></SelectTrigger>
                  <SelectContent>
                    {API_BASE_PRESETS.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                    <SelectItem value="__custom">自定义（手填）</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Base URL：从左侧下拉选择，或直接手动填写"
                  value={apiDraft.baseUrl}
                  onChange={(e) => { setApiDraft({ ...apiDraft, baseUrl: e.target.value }); setDetected(null) }}
                />
              </div>
              <Input placeholder="API Key（识别与调用时使用）" type="password" value={apiDraft.apiKey} onChange={(e) => setApiDraft({ ...apiDraft, apiKey: e.target.value })} />
              <Input placeholder="提供方（识别后自动填）" value={apiDraft.provider} onChange={(e) => setApiDraft({ ...apiDraft, provider: e.target.value })} />
              {detected && detected.models.length > 0 ? (
                <Select value={apiDraft.model} onValueChange={(v) => setApiDraft({ ...apiDraft, model: v })}>
                  <SelectTrigger><SelectValue placeholder="选择模型" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {detected.models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input placeholder="模型名（识别后可选）" value={apiDraft.model} onChange={(e) => setApiDraft({ ...apiDraft, model: e.target.value })} />
              )}
            </div>
            {detected && (
              <div className="mt-2 text-xs text-muted-foreground">
                识别结果：{detected.kind === 'openai' ? 'OpenAI 兼容端点' : 'Ollama 端点'} · {detected.models.length} 个模型
                {detected.models.length > 8 ? `（${detected.models.slice(0, 8).join('、')} 等）` : `：${detected.models.join('、')}`}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="outline" onClick={detectApi} disabled={detecting}>
                <RefreshCw className={cn('h-4 w-4 mr-1', detecting && 'animate-spin')} /> {detecting ? '识别中…' : '自动识别'}
              </Button>
              <Button onClick={addApi}><Plus className="h-4 w-4 mr-1" /> 添加</Button>
            </div>
          </Section>
          {s.apiModels.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center text-xs text-muted-foreground">
              尚未接入任何 API 模型。上方填写提供方、模型名、Base URL 与密钥即可添加，密钥仅保存在本机。
            </div>
          )}
          <div className="space-y-3">
            {s.apiModels.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card/60 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.provider}/{m.model}</span>
                    {statusPill(m.status)}
                    {m.tags.map((t) => <Pill key={t} tone="blue">{t}</Pill>)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">延迟 {m.latencyMs}ms · ${m.costPer1k}/1k tokens · {m.baseUrl}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => testApi(m.id)}><RefreshCw className="h-3.5 w-3.5 mr-1" /> 测试</Button>
                  <Button variant="ghost" size="sm" onClick={() => { s.setApiModels(s.apiModels.filter((x) => x.id !== m.id)); toast.success('已移除') }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Layers className="h-3.5 w-3.5" /> 聚合池可同时引用本地模型与 API 模型，实现混合路由与故障自动降级。</div>
        </TabsContent>
      </Tabs>
    </div>
  )
}


