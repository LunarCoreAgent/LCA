import { PageHeader, Section, Pill } from '@/components/common'
import { APP_VERSION, VERSION_LOG } from '@/lib/versionLog'
import { Sparkles, History } from 'lucide-react'

export default function Versions() {
  const [current, ...history] = VERSION_LOG
  return (
    <div>
      <PageHeader title="版本说明" desc={`当前版本 v${APP_VERSION} · Electron 41.7.1 · darwin-arm64`} />
      <div className="space-y-4 max-w-3xl">
        <Section title={`${current.version}（当前版本）· ${current.title}`} desc="本次更新内容">
          <div className="flex items-center gap-2 mb-3">
            <Pill tone="green"><Sparkles className="h-3 w-3 mr-1" /> 当前版本</Pill>
          </div>
          <ul className="space-y-2 text-sm text-foreground/90">
            {current.points.map((p, i) => <li key={i} className="flex gap-2"><span className="text-emerald-400 shrink-0">•</span>{p}</li>)}
          </ul>
        </Section>
        <Section title="历史版本" desc="过往更新记录">
          <div className="space-y-4">
            {history.map((v) => (
              <div key={v.version} className="rounded-lg border border-border/60 p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium text-sm">{v.version} · {v.title}</span>
                </div>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {v.points.map((p, i) => <li key={i} className="flex gap-2"><span className="shrink-0">-</span>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
