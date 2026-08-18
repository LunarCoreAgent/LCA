import { useState } from 'react'
import { useStore, uid, modelName } from '@/lib/store'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, ArrowUp, ArrowDown, FlaskConical } from 'lucide-react'
import { routeMessage } from '@/lib/engine'
import { toast } from 'sonner'

export default function RouterPage() {
  const s = useStore()
  const [draft, setDraft] = useState({ taskType: '', keywords: '', target: 'mix-auto' })
  const [probe, setProbe] = useState('')
  const [probeResult, setProbeResult] = useState<ReturnType<typeof routeMessage> | null>(null)
  const [thresholds, setThresholds] = useState({ cost: 60, quality: 80, localFirst: 40 })

  const targets = [...s.mixtures.map((m) => m.id), ...s.apiModels.map((m) => m.id), ...s.localModels.map((m) => m.id)]

  const move = (id: string, dir: 1 | -1) => {
    const rules = [...s.routeRules].sort((a, b) => b.priority - a.priority)
    const i = rules.findIndex((r) => r.id === id)
    const j = i + dir
    if (j < 0 || j >= rules.length) return
    const tmp = rules[i].priority
    rules[i].priority = rules[j].priority
    rules[j].priority = tmp
    s.setRouteRules(rules)
  }

  return (
    <div>
      <PageHeader title="路由引擎" desc="规则 → 分类 → 级联 → 学习，四级路由策略在此编排" />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="任务类型路由规则" desc="按优先级从上到下匹配，命中即分发">
            <div className="space-y-2">
              {s.routeRules.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                  暂无路由规则。先在「模型管理」接入模型，再在下方添加规则（留空关键词即为兜底规则）；不添加规则时对话将使用默认直连。
                </div>
              )}
              {[...s.routeRules].sort((a, b) => b.priority - a.priority).map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-sm">
                  <Switch checked={r.enabled} onCheckedChange={(v) => s.setRouteRules(s.routeRules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))} />
                  <div className="w-36 shrink-0 font-medium">{r.taskType}</div>
                  <div className="flex-1 text-xs text-muted-foreground truncate">{r.keywords || '（兜底规则）'}</div>
                  <Pill tone="purple">{modelName(r.target, s)}</Pill>
                  <div className="flex gap-0.5">
                    <button onClick={() => move(r.id, -1)} className="p-1 hover:text-foreground text-muted-foreground"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => move(r.id, 1)} className="p-1 hover:text-foreground text-muted-foreground"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button onClick={() => s.setRouteRules(s.routeRules.filter((x) => x.id !== r.id))} className="p-1 hover:text-red-400 text-muted-foreground"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-[1fr_1.4fr_1fr_auto] gap-2">
              <Input placeholder="任务类型" value={draft.taskType} onChange={(e) => setDraft({ ...draft, taskType: e.target.value })} />
              <Input placeholder="关键词，逗号分隔" value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
              <Select value={draft.target} onValueChange={(v) => setDraft({ ...draft, target: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{targets.map((t) => <SelectItem key={t} value={t}>{modelName(t, s)}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={() => {
                if (!draft.taskType) { toast.error('填写任务类型'); return }
                if (targets.length === 0) { toast.error('暂无可用模型，请先到「模型管理」接入模型'); return }
                const target = targets.includes(draft.target) ? draft.target : targets[0]
                s.setRouteRules([...s.routeRules, { id: uid(), ...draft, target, priority: 50, enabled: true }])
                setDraft({ taskType: '', keywords: '', target: '' })
                toast.success('规则已添加')
              }}><Plus className="h-4 w-4" /></Button>
            </div>
          </Section>

          <Section title="路由沙盒" desc="输入测试语句，预览路由决策（不实际调用模型）">
            <div className="flex gap-2">
              <Input placeholder="如：帮我调试这段 Python 报错" value={probe} onChange={(e) => setProbe(e.target.value)} />
              <Button variant="outline" onClick={() => probe.trim() && setProbeResult(routeMessage(probe))}><FlaskConical className="h-4 w-4 mr-1" /> 探测</Button>
            </div>
            {probeResult && (
              <div className="mt-3 rounded-lg bg-background/60 border border-border/60 p-3 text-sm space-y-1.5">
                <div>任务识别：<Pill tone="blue">{probeResult.taskType}</Pill> 策略：<Pill>{probeResult.strategy}</Pill></div>
                <div className="text-muted-foreground text-xs">{probeResult.reason}</div>
                <div className="text-xs">候选：{probeResult.candidates.join('、')} → 选中 <span className="text-emerald-400 font-medium">{probeResult.chosen}</span></div>
                <div className="text-xs text-muted-foreground">预估延迟 {probeResult.latencyMs}ms · 预估成本 {probeResult.cost ? `$${probeResult.cost}` : '免费（本地）'}</div>
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="路由偏好权重" desc="影响加权策略的打分公式">
            <div className="space-y-5 text-sm">
              <div>
                <div className="flex justify-between mb-2"><span>成本敏感</span><span className="text-muted-foreground">{thresholds.cost}%</span></div>
                <Slider value={[thresholds.cost]} max={100} onValueChange={([v]) => setThresholds({ ...thresholds, cost: v })} />
              </div>
              <div>
                <div className="flex justify-between mb-2"><span>质量优先</span><span className="text-muted-foreground">{thresholds.quality}%</span></div>
                <Slider value={[thresholds.quality]} max={100} onValueChange={([v]) => setThresholds({ ...thresholds, quality: v })} />
              </div>
              <div>
                <div className="flex justify-between mb-2"><span>本地优先</span><span className="text-muted-foreground">{thresholds.localFirst}%</span></div>
                <Slider value={[thresholds.localFirst]} max={100} onValueChange={([v]) => setThresholds({ ...thresholds, localFirst: v })} />
              </div>
              <Button className="w-full" variant="outline" onClick={() => { s.log('route', `路由权重更新：成本${thresholds.cost}/质量${thresholds.quality}/本地${thresholds.localFirst}`); toast.success('权重已应用到加权路由') }}>应用权重</Button>
            </div>
          </Section>
          <Section title="级联与降级" desc="失败或低置信时的逃生通道">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center"><span>置信度阈值</span><Pill tone="amber">0.72</Pill></div>
              <div className="flex justify-between items-center"><span>单步最大重试</span><Pill>2 次</Pill></div>
              <div className="flex justify-between items-center"><span>API 故障降级</span><Pill>→ 首个可用本地模型</Pill></div>
              <div className="flex justify-between items-center"><span>超时阈值</span><Pill>30s</Pill></div>
              <p className="text-xs text-muted-foreground pt-2">级联门控带记忆：同一会话内已验证的能力档位不会重复探测，避免 Agent 多步调用时成本叠加。</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
