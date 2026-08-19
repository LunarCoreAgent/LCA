import { useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sunrise, Sunset, HeartPulse, FlaskConical, Play, CalendarPlus, Trash2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { PLAYBOOKS, runPlaybook, loadReports, deleteReport, type PlaybookReport } from '@/lib/playbooks'

const ICONS: Record<string, typeof Sunrise> = {
  'pre-market': Sunrise,
  'close-review': Sunset,
  'watch-health': HeartPulse,
  'factor-scan': FlaskConical,
}

export default function Playbooks() {
  const s = useStore()
  const [reports, setReports] = useState<PlaybookReport[]>(() => loadReports())
  const [running, setRunning] = useState<string | null>(null)
  const [view, setView] = useState<PlaybookReport | null>(null)

  const run = async (id: string) => {
    const pb = PLAYBOOKS.find((p) => p.id === id)!
    setRunning(id)
    try {
      const r = await runPlaybook(pb)
      setReports(loadReports())
      setView(r)
      toast.success(`「${pb.name}」已生成（${r.model}）`)
    } catch (e) {
      toast.error(`运行失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(null)
    }
  }

  const addCron = (id: string) => {
    const pb = PLAYBOOKS.find((p) => p.id === id)!
    if (s.cronJobs.some((c) => c.action === `playbook:${id}`)) { toast.warning('该剧本已在定时任务中'); return }
    s.setCronJobs([...s.cronJobs, {
      id: `cron-pb-${id}`, name: `研究剧本 · ${pb.name}`, schedule: pb.schedule,
      action: `playbook:${id}`, target: pb.name, enabled: true, lastRun: '-', nextRun: '-', lastResult: '-',
    }])
    toast.success(`已加入定时任务（${pb.schedule}），到点在「定时任务」页可见`)
  }

  const del = (id: string) => {
    deleteReport(id)
    setReports(loadReports())
    toast.success('报告已删除')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="研究剧本"
        desc="把固定研究流程固化为可重复执行的剧本：采集数据（自适应数据链）→ 组装上下文 → 模型成稿 → 存档并写入审计链；可挂到定时任务自动运行 —— 思路借鉴 Vibe-Trading playbooks"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PLAYBOOKS.map((pb) => {
          const Icon = ICONS[pb.id] || FileText
          const scheduled = s.cronJobs.some((c) => c.action === `playbook:${pb.id}`)
          return (
            <Section key={pb.id} title={pb.name} desc={pb.desc}
              extra={scheduled ? <Pill tone="blue">已定时</Pill> : undefined}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  <span>建议频率：{pb.schedule}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => addCron(pb.id)}>
                    <CalendarPlus className="h-4 w-4 mr-1" />定时
                  </Button>
                  <Button size="sm" onClick={() => run(pb.id)} disabled={running !== null}>
                    <Play className="h-4 w-4 mr-1" />{running === pb.id ? '运行中…' : '运行'}
                  </Button>
                </div>
              </div>
            </Section>
          )
        })}
      </div>

      <Section title={`研究报告存档（最近 ${reports.length} 份）`} desc="成稿写入审计链；无可用模型时自动降级为数据直出">
        {reports.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">暂无报告 —— 运行任一剧本后在此查看</div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <button className="text-left flex-1" onClick={() => setView(r)}>
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">成稿：{r.model} · {new Date(r.createdAt).toLocaleString('zh-CN')}</div>
                </button>
                <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={!!view} onOpenChange={() => setView(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{view?.title}</DialogTitle></DialogHeader>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{view?.content}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
