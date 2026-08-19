import { useEffect, useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Laptop, Network, Server, BookOpen, Search, Info } from 'lucide-react'
import { toast } from 'sonner'
import { loadKbEndpoints, kbProbe, kbSearch, type KbProbeResult, type KnowledgeHit } from '@/lib/knowledge'
import type { KnowledgeEndpoint } from '@/lib/types'

// ===== 三种连接方式设计说明 =====
const KB_MODES = [
  { key: 'lw-local', name: 'LLM Wiki · 本机模式', icon: Laptop, tone: 'purple' as const,
    desc: '本机部署 llm_wiki（默认 http://127.0.0.1:19828，Token 在其「设置 → API」生成），Markdown 知识页混合检索（关键词 + 向量），零运维' },
  { key: 'lw-lan', name: 'LLM Wiki · 局域网模式', icon: Network, tone: 'purple' as const,
    desc: '局域网内任一台机器部署 llm_wiki 并自行暴露端口，此处填它的局域网地址（如 http://192.168.1.10:19828）即可跨机器连接' },
  { key: 'al', name: 'AnythingLLM · 服务器模式', icon: Server, tone: 'blue' as const,
    desc: '连接 AnythingLLM 服务器（开发者设置生成 API Key），只调用 vector-search 纯向量检索取回片段——它只做存储，推理仍由对话页所选模型完成' },
]

export default function Knowledge() {
  return (
    <div>
      <PageHeader title="知识库" desc="三种连接方式接入你的知识库——端点在「长期记忆」页维护，此处实时查看连接状态并做检索验证；对话页工具栏选择启用" />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Section title="三种连接方式" desc="按部署形态任选，也可同时配置多个端点随时切换">
            <div className="space-y-2.5">
              {KB_MODES.map(({ key, name, icon: Icon, desc }) => (
                <div key={key} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4 text-sky-400 shrink-0" />
                    <span className="font-medium text-sm">{name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </Section>
          <KbConnectionsCard />
        </div>
        <div className="space-y-4">
          <KbSearchTest />
          <div className="rounded-lg bg-background/60 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 shrink-0 text-sky-400" />
            端点的添加、测试与删除请前往「长期记忆」页（记忆库下方「知识库端点」）；Token / API Key 仅存本机（桌面版 http 请求仅允许 localhost/私网段，公网知识库服务器须走 https）。
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== 知识库连接状态卡（自长期记忆页迁入）：三种方式已配置端点与实时在线状态 =====
const isLocalUrl = (u: string) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(u.trim())

const KB_CONN_MODES = [
  {
    key: 'lw-local', name: 'LLM Wiki · 本机模式', icon: Laptop,
    match: (e: KnowledgeEndpoint) => e.type === 'llmwiki' && isLocalUrl(e.baseUrl),
  },
  {
    key: 'lw-lan', name: 'LLM Wiki · 局域网模式', icon: Network,
    match: (e: KnowledgeEndpoint) => e.type === 'llmwiki' && !isLocalUrl(e.baseUrl),
  },
  {
    key: 'al', name: 'AnythingLLM · 服务器模式', icon: Server,
    match: (e: KnowledgeEndpoint) => e.type === 'anythingllm',
  },
] as const

function KbConnectionsCard() {
  const [eps, setEps] = useState<KnowledgeEndpoint[]>(() => loadKbEndpoints())
  const [probes, setProbes] = useState<Map<string, KbProbeResult>>(new Map())

  // 窗口聚焦时重载端点并逐个探测在线状态
  useEffect(() => {
    const reload = () => setEps(loadKbEndpoints())
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [])
  useEffect(() => {
    let alive = true
    ;(async () => {
      const next = new Map<string, KbProbeResult>()
      for (const ep of eps) {
        try { next.set(ep.id, await kbProbe(ep)) } catch { next.set(ep.id, { online: false, detail: '连接失败', targets: [] }) }
        if (!alive) return
        setProbes(new Map(next))
      }
    })()
    return () => { alive = false }
  }, [eps])

  return (
    <Section title="知识库连接状态" desc="三种方式下已配置端点的实时在线状态（进入页面自动探测）；端点的添加与测试在「长期记忆」页维护">
      <div className="grid grid-cols-1 gap-3">
        {KB_CONN_MODES.map(({ key, name, icon: Icon, match }) => {
          const matched = eps.filter(match)
          return (
            <div key={key} className="rounded-lg border border-border/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-sky-400 shrink-0" />
                <span className="font-medium text-sm">{name}</span>
              </div>
              <div className="space-y-1.5">
                {matched.length === 0 && <div className="text-xs text-muted-foreground/70">未配置</div>}
                {matched.map((ep) => {
                  const pr = probes.get(ep.id)
                  return (
                    <div key={ep.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{ep.name} <span className="text-muted-foreground font-mono">{ep.baseUrl}</span></span>
                      {pr == null ? <Pill>检测中…</Pill> : pr.online ? <Pill tone="green">在线{pr.detail ? ` · ${pr.detail}` : ''}</Pill> : <Pill tone="amber">离线</Pill>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ===== 检索验证：选端点输查询，实时返回命中片段 =====
function KbSearchTest() {
  const [eps, setEps] = useState<KnowledgeEndpoint[]>(() => loadKbEndpoints())
  const [epId, setEpId] = useState('')

  // 端点在「长期记忆」页维护，窗口聚焦时重载列表保持同步
  useEffect(() => {
    const reload = () => setEps(loadKbEndpoints())
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)

  const run = async () => {
    const ep = eps.find((x) => x.id === epId) ?? eps[0]
    if (!ep) { toast.error('请先在「长期记忆」页添加知识库端点'); return }
    if (!query.trim()) { toast.error('请输入测试查询'); return }
    setBusy(true)
    setHits(null)
    try {
      const r = await kbSearch(ep, query.trim(), 5)
      setHits(r)
      if (r.length === 0) toast.info('检索完成：无命中片段')
      else toast.success(`检索命中 ${r.length} 条（${ep.name}）`)
    } catch (e) {
      toast.error(`检索失败：${e instanceof Error ? e.message : '异常'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="检索验证" desc="用真实查询验证端点检索质量——命中的片段就是对话时注入知识库的内容">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={epId || (eps[0]?.id ?? '')} onValueChange={setEpId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="选择端点" /></SelectTrigger>
          <SelectContent>
            {eps.map((ep) => <SelectItem key={ep.id} value={ep.id}><BookOpen className="h-3.5 w-3.5 inline mr-1" />{ep.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="输入测试查询，如：宁德时代研报观点" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-48" onKeyDown={(e) => { if (e.key === 'Enter') run() }} />
        <Button onClick={run} disabled={busy}><Search className="h-4 w-4 mr-1" /> {busy ? '检索中…' : '检索'}</Button>
      </div>
      {hits && hits.length > 0 && (
        <div className="space-y-2 mt-3">
          {hits.map((h, i) => (
            <div key={i} className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Pill tone="purple">资料{i + 1}</Pill>
                <span className="text-xs font-medium">{h.title}</span>
                {h.score > 0 && <span className="text-[10px] text-muted-foreground">score {h.score.toFixed(2)}</span>}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{h.text}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
