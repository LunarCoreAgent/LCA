import { useStore } from '@/lib/store'
import { PageHeader, Section, statusPill } from '@/components/common'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { Permission } from '@/lib/types'

const LEVELS: { value: Permission['level']; label: string; hint: string }[] = [
  { value: 'full', label: '完全自主', hint: '无需确认直接执行' },
  { value: 'confirm', label: '执行前确认', hint: '弹窗或飞书卡片确认' },
  { value: 'readonly', label: '只读', hint: '可观察不可修改' },
  { value: 'off', label: '关闭', hint: '完全禁止' },
]

export default function Permissions() {
  const s = useStore()

  return (
    <div>
      <PageHeader title="权限控制" desc="权限最大化的同时保持可控：每项能力独立分级，全程审计" />
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="能力矩阵" desc="Agent 对电脑与网络的操作边界">
          <div className="space-y-3">
            {s.permissions.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.capability}</span>
                    {statusPill(p.level)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.desc} · 范围：{p.scope}</div>
                </div>
                <Select
                  value={p.level}
                  onValueChange={(v) => {
                    s.setPermissions(s.permissions.map((x) => (x.id === p.id ? { ...x, level: v as Permission['level'] } : x)))
                    s.audit('user', `调整「${p.capability}」权限为 ${LEVELS.find((l) => l.value === v)?.label}`, 'confirmed')
                    toast.success(`「${p.capability}」→ ${LEVELS.find((l) => l.value === v)?.label}`)
                  }}
                >
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-background/60 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            「执行前确认」级别的动作会暂停流水线并向你发送确认（弹窗或飞书卡片），超时 10 分钟未确认则自动拒绝并记入审计。
          </div>
        </Section>
        <Section title="审计日志" desc="所有能力调用留痕，可回溯">
          <div className="space-y-3">
            {s.auditLogs.slice(0, 12).map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <span className="text-xs text-muted-foreground w-32 shrink-0 pt-0.5">{a.time.slice(5)}</span>
                <span className="w-20 shrink-0">{statusPill(a.result)}</span>
                <div>
                  <span className="text-sky-400 text-xs mr-2">[{a.actor}]</span>
                  <span className="text-foreground/90 text-sm">{a.action}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
