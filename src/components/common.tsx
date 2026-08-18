import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function PageHeader({ title, desc, extra }: { title: string; desc: string; extra?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{desc}</p>
      </div>
      {extra && <div className="flex gap-2">{extra}</div>}
    </div>
  )
}

export function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="bg-card/60">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'green' | 'red' | 'amber' | 'blue' | 'purple' }) {
  const map = {
    default: 'bg-secondary text-secondary-foreground',
    green: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    red: 'bg-red-500/15 text-red-400 border border-red-500/30',
    amber: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    blue: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
    purple: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
  }
  return <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', map[tone])}>{children}</span>
}

export function Section({ title, desc, children, className, extra }: { title: string; desc?: string; children: ReactNode; className?: string; extra?: ReactNode }) {
  return (
    <Card className={cn('bg-card/60', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
          </div>
          {extra && <div className="flex gap-2 shrink-0">{extra}</div>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export const statusPill = (s: string) => {
  switch (s) {
    case 'running': case 'online': case 'success': case 'allowed': return <Pill tone="green">{s}</Pill>
    case 'stopped': case 'offline': case 'paused': case 'readonly': return <Pill>{s}</Pill>
    case 'downloading': case 'confirm': case 'confirmed': case 'idle': return <Pill tone="amber">{s}</Pill>
    case 'error': case 'failed': case 'denied': return <Pill tone="red">{s}</Pill>
    case 'full': return <Pill tone="purple">full</Pill>
    default: return <Pill>{s}</Pill>
  }
}
