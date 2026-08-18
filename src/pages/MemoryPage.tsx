import { useState } from 'react'
import { useStore, uid } from '@/lib/store'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Trash2, Plus, Brain, Database, Sparkles, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { KnowledgeEndpoint, MemoryEntry } from '@/lib/types'
import { kbProbe, loadKbEndpoints, saveKbEndpoints, newKbEndpoint, type KbProbeResult } from '@/lib/knowledge'

const typeTone: Record<MemoryEntry['type'], 'blue' | 'purple' | 'amber' | 'default'> = { fact: 'blue', preference: 'purple', instruction: 'amber', episode: 'default' }
const typeLabel = { fact: '事实', preference: '偏好', instruction: '指令', episode: '经历' } as const

export default function MemoryPage() {
  const s = useStore()
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')

  const filtered = s.memories.filter((m) => !q || m.content.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <PageHeader title="长期记忆" desc="对话事实、偏好与指令经压缩后写入向量库，跨会话自动召回" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="记忆条目" value={String(s.memories.length)} sub="向量索引实时更新" icon={<Brain className="h-4 w-4 text-violet-400" />} />
        <StatCard label="召回命中率" value="—" sub="积累对话后统计" icon={<Sparkles className="h-4 w-4 text-amber-400" />} />
        <StatCard label="向量库" value="1536 维" sub="本地 embedding 模型" icon={<Database className="h-4 w-4 text-sky-400" />} />
        <StatCard label="压缩率" value="—" sub="产生摘要后展示" icon={<Brain className="h-4 w-4 text-emerald-400" />} />
      </div>

      <Section title="记忆库" desc="重要度影响召回排序；低价值记忆会被自动遗忘">
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input className="pl-9" placeholder="搜索记忆内容…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Input className="flex-1" placeholder="手动写入一条记忆…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button onClick={() => {
            if (!draft.trim()) return
            s.setMemories([{ id: uid(), content: draft.trim(), type: 'fact', importance: 60, source: '手动写入', createdAt: new Date().toLocaleString('zh-CN', { hour12: false }), hits: 0 }, ...s.memories])
            setDraft('')
            toast.success('已写入并向量化')
          }}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-2">
          {filtered.map((m) => (
            <div key={m.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-start gap-3">
                <Pill tone={typeTone[m.type]}>{typeLabel[m.type]}</Pill>
                <p className="flex-1 text-sm leading-relaxed">{m.content}</p>
                <button onClick={() => { s.setMemories(s.memories.filter((x) => x.id !== m.id)); toast.success('记忆已删除') }} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span className="w-40 flex items-center gap-2">重要度
                  <Progress value={m.importance} className="h-1.5 flex-1" /> {m.importance}
                </span>
                <span>来源：{m.source}</span>
                <span>{m.createdAt}</span>
                <span>召回 {m.hits} 次</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">没有匹配的记忆</div>}
        </div>
      </Section>

      {/* 知识库端点管理（自知识库页迁入）：LLM Wiki 本机/局域网 + AnythingLLM 服务器 */}
      <div className="mt-6">
        <KbEndpointsPanel />
      </div>
    </div>
  )
}

// ===== 知识库端点管理：添加 / 测试 / 指定项目（工作区）/ 删除 =====
function KbEndpointsPanel() {
  const [eps, setEps] = useState<KnowledgeEndpoint[]>(() => loadKbEndpoints())
  const [kbProbes, setKbProbes] = useState<Map<string, KbProbeResult>>(new Map())
  const [busy, setBusy] = useState('')
  const [draft, setDraft] = useState<KnowledgeEndpoint>(() => newKbEndpoint('llmwiki'))
  const save = (list: KnowledgeEndpoint[]) => { setEps(list); saveKbEndpoints(list) }

  const test = async (ep: KnowledgeEndpoint) => {
    setBusy(ep.id)
    const r = await kbProbe(ep)
    const next = new Map(kbProbes)
    next.set(ep.id, r)
    setKbProbes(next)
    setBusy('')
    if (r.online) toast.success(`已连接「${ep.name}」：${r.detail}`)
    else toast.error(`「${ep.name}」连接失败：${r.detail}`)
  }

  const addEp = () => {
    if (!draft.baseUrl.trim()) { toast.error('请填写端点地址'); return }
    save([...eps, { ...draft, baseUrl: draft.baseUrl.trim() }])
    setDraft(newKbEndpoint(draft.type))
    toast.success('知识库端点已添加，建议先点「测试」验证连通性')
  }

  const typePill = (t: KnowledgeEndpoint['type']) => t === 'llmwiki'
    ? <Pill tone="purple">LLM Wiki · 本地模式</Pill>
    : <Pill tone="blue">AnythingLLM · 服务器</Pill>

  return (
    <Section
      title="知识库端点"
      desc="LLM Wiki 默认 http://127.0.0.1:19828（Token 在其 设置→API 生成；跨机器填局域网地址）· AnythingLLM 填服务器地址 + 开发者 API Key · Token 仅存本机 · 连接状态与检索验证见「设置 → 知识库」"
    >
      <div className="space-y-3">
        {eps.map((ep) => {
          const pr = kbProbes.get(ep.id)
          return (
            <div key={ep.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{ep.name}</span>
                  {typePill(ep.type)}
                  {pr == null ? <Pill>未测试</Pill> : pr.online ? <Pill tone="green">在线 · {pr.detail}</Pill> : <Pill tone="amber">离线</Pill>}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => test(ep)} disabled={busy === ep.id}>
                    <RefreshCw className={cn('h-3.5 w-3.5 mr-1', busy === ep.id && 'animate-spin')} /> 测试
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { save(eps.filter((x) => x.id !== ep.id)); toast.success('端点已移除') }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{ep.baseUrl}</div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input
                  type="password"
                  placeholder={ep.type === 'llmwiki' ? 'LLM Wiki API Token' : 'AnythingLLM API Key'}
                  defaultValue={ep.token}
                  className="h-8 text-xs"
                  onChange={(e) => save(eps.map((x) => x.id === ep.id ? { ...x, token: e.target.value.trim() } : x))}
                />
                {pr?.online && pr.targets.length > 0 ? (
                  <Select value={ep.target || '__auto'} onValueChange={(v) => save(eps.map((x) => x.id === ep.id ? { ...x, target: v === '__auto' ? '' : v } : x))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto">自动（第一个{ep.type === 'llmwiki' ? '项目' : '工作区'}）</SelectItem>
                      {pr.targets.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder={ep.type === 'llmwiki' ? '项目 ID（留空自动）' : '工作区 slug（留空自动）'}
                    defaultValue={ep.target}
                    className="h-8 text-xs"
                    onChange={(e) => save(eps.map((x) => x.id === ep.id ? { ...x, target: e.target.value.trim() } : x))}
                  />
                )}
              </div>
            </div>
          )
        })}
        {eps.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">尚未配置端点，用下方表单添加</div>}
      </div>
      <div className="flex flex-wrap gap-2 mt-3 items-center">
        <Select value={draft.type} onValueChange={(v) => setDraft(newKbEndpoint(v as KnowledgeEndpoint['type']))}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="llmwiki">LLM Wiki（本地模式）</SelectItem>
            <SelectItem value="anythingllm">AnythingLLM（服务器）</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="端点名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-36" />
        <Input placeholder={draft.type === 'llmwiki' ? 'http://127.0.0.1:19828' : 'http://服务器:3001'} value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} className="w-56" />
        <Input type="password" placeholder="Token / API Key" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value })} className="w-44" />
        <Button variant="outline" onClick={addEp}><Plus className="h-4 w-4 mr-1" /> 添加端点</Button>
      </div>
    </Section>
  )
}

