import { useStore } from '@/lib/store'
import { PageHeader, Pill } from '@/components/common'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Globe, Terminal, FolderOpen, Clock, MessageSquare, Database, Package, MousePointer, Plus } from 'lucide-react'
import { toast } from 'sonner'

const ICONS: Record<string, typeof Globe> = {
  'pl-web': Globe, 'pl-shell': Terminal, 'pl-file': FolderOpen, 'pl-cron': Clock,
  'pl-feishu': MessageSquare, 'pl-rag': Database, 'pl-skill': Package, 'pl-gui': MousePointer,
}

export default function Plugins() {
  const s = useStore()

  return (
    <div>
      <PageHeader title="插件" desc="能力以插件形式挂载，启用即对 Agent 可见，权限统一受控"
        extra={<Button variant="outline" onClick={() => toast.info('从 .skill / 插件包安装（占位）')}><Plus className="h-4 w-4 mr-1" /> 安装插件包</Button>} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {s.plugins.map((p) => {
          const Icon = ICONS[p.id] ?? Package
          return (
            <Card key={p.id} className="bg-card/60">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-secondary grid place-items-center"><Icon className="h-5 w-5 text-sky-400" /></div>
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">v{p.version} · {p.author}</div>
                    </div>
                  </div>
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(v) => {
                      s.setPlugins(s.plugins.map((x) => (x.id === p.id ? { ...x, enabled: v } : x)))
                      s.audit('user', `${v ? '启用' : '停用'}插件「${p.name}」`, 'allowed')
                      toast.success(`${p.name} 已${v ? '启用' : '停用'}`)
                    }}
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-3">{p.desc}</p>
                <div className="mt-3 flex gap-1.5">
                  <Pill>{p.category}</Pill>
                  {p.id === 'pl-gui' && <Pill tone="red">高风险</Pill>}
                  {p.enabled && <Pill tone="green">运行中</Pill>}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-4">插件是 Agent 的「手」：路由引擎决定「谁思考」，插件决定「能做什么」。每个插件的能力声明会注入系统提示，模型按需调用。</p>
    </div>
  )
}
