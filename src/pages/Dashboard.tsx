import { useStore } from '@/lib/store'
import { PageHeader, StatCard, Section, Pill } from '@/components/common'
import type { PageId } from '@/components/Layout'
import { Cpu, Zap, DollarSign, Activity, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Dashboard({ go }: { go: (p: PageId) => void }) {
  const { activity, cronJobs, workflows, learning, memories, permissions, feishu } = useStore()
  const acc = learning[learning.length - 1]?.accuracy ?? 0
  const permConfirm = permissions.filter((p) => p.level === 'confirm').length
  const permAuto = permissions.filter((p) => p.level === 'full').length

  return (
    <div>
      <PageHeader title="总览" desc="多模型路由、自动化与成本的实时状态"
        extra={<Button onClick={() => go('chat')}>开始对话 <ArrowRight className="h-4 w-4 ml-1" /></Button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="今日调用" value="0" sub="开始对话后统计" icon={<Cpu className="h-4 w-4 text-emerald-400" />} />
        <StatCard label="路由准确率" value={`${acc}%`} sub="自我学习数据积累后展示" icon={<Zap className="h-4 w-4 text-amber-400" />} />
        <StatCard label="本周成本" value="$0" sub="配置 API 模型后统计" icon={<DollarSign className="h-4 w-4 text-sky-400" />} />
        <StatCard label="活跃自动化" value={`${workflows.filter((w) => w.status !== 'paused').length} 流 / ${cronJobs.filter((c) => c.enabled).length} 定时`} sub={workflows.length + cronJobs.length > 0 ? '连续性模式已开启' : '尚未创建自动化'} icon={<Activity className="h-4 w-4 text-violet-400" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="实时动态" desc="路由、插件、自动化事件流">
          <div className="space-y-3">
            {activity.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                暂无事件。模型调用、定时任务、工作流产生的事件会实时出现在这里。
              </div>
            )}
            {activity.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <span className="text-xs text-muted-foreground w-10 pt-0.5 shrink-0">{a.time}</span>
                <Pill tone={a.kind === 'route' ? 'blue' : a.kind === 'cron' ? 'amber' : a.kind === 'workflow' ? 'purple' : 'default'}>{a.kind}</Pill>
                <span className="text-foreground/90">{a.text}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="系统速览" desc="记忆与任务健康度">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">长期记忆</div>
              <div className="text-xl font-bold">{memories.length} 条</div>
              <div className="text-xs text-muted-foreground">对话中自动沉淀</div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">定时任务</div>
              <div className="text-xl font-bold">{cronJobs.filter((c) => c.enabled).length} 运行中</div>
              <div className="text-xs text-muted-foreground">{cronJobs.length === 0 ? '在「定时任务」页创建' : '按计划自动执行'}</div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">权限模式</div>
              <div className="text-xl font-bold">受控最大化</div>
              <div className="text-xs text-muted-foreground">{permConfirm} 项需确认 · {permAuto} 项全自动</div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">飞书机器人</div>
              <div className={`text-xl font-bold ${feishu.enabled ? 'text-emerald-400' : ''}`}>{feishu.enabled ? '已连接' : '未配置'}</div>
              <div className="text-xs text-muted-foreground">{feishu.enabled ? '双向对话转发开启' : '在「连接手机」页配置'}</div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
