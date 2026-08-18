import { useState } from 'react'
import { useStore, uid } from '@/lib/store'
import { PageHeader, statusPill, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Trash2, Clock } from 'lucide-react'
import { toast } from 'sonner'

const PRESETS = [
  { label: '每 30 分钟', cron: '*/30 * * * *' },
  { label: '每天 08:00', cron: '0 8 * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每周五 20:00', cron: '0 20 * * 5' },
]

export default function CronPage() {
  const s = useStore()
  const [draft, setDraft] = useState({ name: '', schedule: '0 8 * * *', action: '' })
  const [open, setOpen] = useState(false)

  const add = () => {
    if (!draft.name || !draft.action) { toast.error('请填写名称与执行动作'); return }
    s.setCronJobs([...s.cronJobs, { id: uid(), ...draft, target: 'workflow', enabled: true, lastRun: '-', nextRun: '待调度器计算', lastResult: '-' }])
    s.log('cron', `新建定时任务「${draft.name}」（${draft.schedule}）`)
    toast.success('定时任务已创建并启用')
    setDraft({ name: '', schedule: '0 8 * * *', action: '' })
    setOpen(false)
  }

  return (
    <div>
      <PageHeader title="定时任务" desc="cron 驱动的工作流与插件动作，结果可自动推送飞书"
        extra={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> 新建任务</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新建定时任务</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                <Input placeholder="任务名称，如：每晚备份对话" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <Input placeholder="cron 表达式" value={draft.schedule} onChange={(e) => setDraft({ ...draft, schedule: e.target.value })} />
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p.cron} onClick={() => setDraft({ ...draft, schedule: p.cron })}
                      className="text-xs rounded-md border border-border/60 px-2 py-1 hover:bg-accent">{p.label}</button>
                  ))}
                </div>
                <Input placeholder="执行动作，如：调用指定工作流或插件" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
                <Button onClick={add} className="w-full">创建</Button>
              </div>
            </DialogContent>
          </Dialog>
        } />
      <div className="space-y-3">
        {/* 系统级进化作业：不可删除，仅可暂停 */}
        <div className="flex items-center gap-4 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <Switch checked={s.evolutionSettings.enabled} onCheckedChange={(v) => {
            s.setEvolutionSettings({ ...s.evolutionSettings, enabled: v })
            s.log('cron', `系统进化作业${v ? '启用' : '暂停'}`)
          }} />
          <div className="flex-1">
            <div className="font-medium text-sm flex items-center gap-2">夜间进化作业 <Pill tone="purple">系统级</Pill></div>
            <div className="text-xs text-muted-foreground mt-0.5">复盘当日交互 → 归因 → 更新路由权重 → 整理记忆 → 产出行为补丁（详见「进化日志」）</div>
          </div>
          <div className="text-right text-xs space-y-1">
            <div className="flex items-center gap-1.5 justify-end"><Clock className="h-3 w-3 text-violet-400" /><code className="text-violet-300">{s.evolutionSettings.cron}</code></div>
            <div className="text-muted-foreground">每晚 02:00 自动执行</div>
          </div>
        </div>
        {s.cronJobs.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center text-xs text-muted-foreground">
            暂无定时任务。使用上方表单创建第一个任务（如每日收盘后自动拉取行情）。
          </div>
        )}
        {s.cronJobs.map((c) => (
          <div key={c.id} className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/60 p-4">
            <Switch checked={c.enabled} onCheckedChange={(v) => {
              s.setCronJobs(s.cronJobs.map((x) => (x.id === c.id ? { ...x, enabled: v } : x)))
              s.log('cron', `定时任务「${c.name}」${v ? '启用' : '停用'}`)
            }} />
            <div className="flex-1">
              <div className="font-medium text-sm">{c.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.action}</div>
            </div>
            <div className="text-right text-xs space-y-1">
              <div className="flex items-center gap-1.5 justify-end"><Clock className="h-3 w-3 text-amber-400" /><code className="text-amber-300">{c.schedule}</code></div>
              <div className="text-muted-foreground">上次 {c.lastRun} {statusPill(c.lastResult)}</div>
              <div className="text-muted-foreground">下次 {c.nextRun}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { s.setCronJobs(s.cronJobs.filter((x) => x.id !== c.id)); toast.success('已删除') }}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  )
}
