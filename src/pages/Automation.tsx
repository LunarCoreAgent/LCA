import { useStore, modelName } from '@/lib/store'
import { PageHeader, Section, Pill, statusPill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Play, Pause, ArrowRight, Repeat } from 'lucide-react'
import { toast } from 'sonner'

const triggerLabel = { manual: '手动触发', cron: '定时触发', event: '事件触发', feishu: '飞书指令' } as const

export default function Automation() {
  const s = useStore()

  const runNow = (id: string) => {
    const w = s.workflows.find((x) => x.id === id)!
    s.setWorkflows(s.workflows.map((x) => (x.id === id ? { ...x, status: 'running' as const, runs: x.runs + 1, lastRun: new Date().toLocaleString('zh-CN', { hour12: false }) } : x)))
    s.log('workflow', `「${w.name}」开始执行（第 ${w.runs + 1} 次）`)
    s.audit('workflow', `执行工作流「${w.name}」`, 'allowed')
    toast.success(`「${w.name}」已启动`)
    setTimeout(() => {
      s.setWorkflows(useStore.getState().workflows.map((x) => (x.id === id && x.status === 'running' ? { ...x, status: 'idle' as const } : x)))
      s.log('workflow', `「${w.name}」执行完成${w.continuous ? '，连续性模式已排队下一轮' : ''}`)
    }, 3000)
  }

  return (
    <div>
      <PageHeader title="自动化" desc="工作流把「模型 + 插件 + 权限」串成可复用的自动流水线" />
      <div className="space-y-4">
        {s.workflows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
            <div className="text-sm font-medium mb-1">暂无工作流</div>
            <div className="text-xs text-muted-foreground">接入模型后，可在此把「模型 + 插件 + 权限」编排成自动流水线。</div>
          </div>
        )}
        {s.workflows.map((w) => (
          <Section key={w.id} title={w.name} desc={w.desc}>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Pill tone="blue">{triggerLabel[w.trigger]}</Pill>
              {statusPill(w.status)}
              {w.continuous && <Pill tone="purple"><Repeat className="h-3 w-3 mr-1" /> 连续性</Pill>}
              <span className="text-xs text-muted-foreground ml-auto">已运行 {w.runs} 次 · 最近 {w.lastRun}</span>
            </div>
            {/* 步骤链 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {w.steps.map((st, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <div className="text-sm">{st.name}</div>
                    <div className="text-[10px] text-muted-foreground">{st.tool.startsWith('pl-') ? s.plugins.find((p) => p.id === st.tool)?.name ?? st.tool : modelName(st.tool, s)}</div>
                  </div>
                  {i < w.steps.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              ))}
              {w.continuous && <div className="text-xs text-violet-400 flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> 循环衔接</div>}
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => runNow(w.id)} disabled={w.status === 'running'}><Play className="h-3.5 w-3.5 mr-1" /> 立即运行</Button>
              <Button size="sm" variant="outline" onClick={() => {
                s.setWorkflows(s.workflows.map((x) => (x.id === id_of(w) ? { ...x, status: x.status === 'paused' ? 'idle' as const : 'paused' as const } : x)))
                toast.success(w.status === 'paused' ? '已恢复' : '已暂停')
              }}><Pause className="h-3.5 w-3.5 mr-1" /> {w.status === 'paused' ? '恢复' : '暂停'}</Button>
              <div className="flex items-center gap-2 ml-auto text-sm">
                <span className="text-xs text-muted-foreground">自动化连续性</span>
                <Switch checked={w.continuous} onCheckedChange={(v) => {
                  s.setWorkflows(s.workflows.map((x) => (x.id === w.id ? { ...x, continuous: v } : x)))
                  s.audit('user', `${v ? '开启' : '关闭'}「${w.name}」连续性自治`, v ? 'confirmed' : 'allowed')
                  toast.success(v ? '已开启：结束后自动衔接下一轮，无需人工干预' : '已关闭连续性')
                }} />
              </div>
            </div>
          </Section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        「连续性」开启后，工作流完成一轮会自动评估产出并触发下一轮（如：持续监控、增量备份、滚动摘要），直至你暂停或权限系统拦截。
      </p>
    </div>
  )
}

const id_of = (w: { id: string }) => w.id
