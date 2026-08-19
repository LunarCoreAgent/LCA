import { useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Activity, RefreshCw, Trash2, ArrowUpNarrowWide } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { healthReport, resetHealth, orderedSources, score, type SrcKind } from '@/lib/sourceHealth'
import { fetchLiveQuotes, fetchDailyKline } from '@/lib/marketApi'

const KIND_LABEL: Record<SrcKind, string> = { quotes: '实时行情', kline: '日 K 线', fundflow: '资金流' }
// 先验顺序：按封禁风险从低到高（与 marketApi 内部保持一致）
const PRIOR: Record<SrcKind, string[]> = {
  quotes: ['腾讯', '东方财富', '新浪', 'Yahoo'],
  kline: ['腾讯', '东方财富', 'Yahoo'],
  fundflow: ['东方财富'],
}

export default function SourceHealth() {
  const [, setTick] = useState(0)
  const [testing, setTesting] = useState(false)
  const store = healthReport()

  const refresh = () => setTick((t) => t + 1)

  const runTest = async () => {
    setTesting(true)
    try {
      await fetchLiveQuotes(['600519.SH'], () => 'manual')
    } catch { /* 失败也会记录健康度 */ }
    try {
      await fetchDailyKline('600519.SH', 5)
    } catch { /* 同上 */ }
    setTesting(false)
    refresh()
    toast.success('链路探测完成（以贵州茅台为样本，结果已计入健康度）')
  }

  const doReset = () => {
    resetHealth()
    refresh()
    toast.success('健康度数据已清空，链路回到先验顺序')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据源链路健康"
        desc="多源链式降级的运行状况：调用结果按源持久化记录，链顺序 = 先验（低封禁风险在前）+ 健康度自适应重排；连续失败自动降权，恢复后随成功样本回升"
        extra={
          <>
            <Button size="sm" variant="outline" onClick={runTest} disabled={testing}>
              <Activity className="h-4 w-4 mr-1" />{testing ? '探测中…' : '链路探测'}
            </Button>
            <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1" />刷新</Button>
            <Button size="sm" variant="ghost" onClick={doReset}><Trash2 className="h-4 w-4 mr-1" />清空</Button>
          </>
        }
      />

      {(Object.keys(PRIOR) as SrcKind[]).map((kind) => {
        const ordered = orderedSources(kind, PRIOR[kind])
        const recs = store[kind] || {}
        const reordered = ordered.some((s, i) => s !== PRIOR[kind][i])
        return (
          <Section
            key={kind}
            title={`${KIND_LABEL[kind]}链路`}
            desc={reordered ? '已按健康度自适应重排（与先验顺序不同）' : '当前保持先验顺序（低封禁风险在前）'}
            extra={reordered ? <Pill tone="purple"><ArrowUpNarrowWide className="h-3 w-3 mr-1" />已重排</Pill> : undefined}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>数据源</TableHead>
                  <TableHead className="text-right">健康分</TableHead>
                  <TableHead className="text-right">成功 / 失败</TableHead>
                  <TableHead className="text-right">成功率</TableHead>
                  <TableHead className="text-right">平均耗时</TableHead>
                  <TableHead>最近成功</TableHead>
                  <TableHead>最近错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((src, i) => {
                  const h = recs[src]
                  const total = h ? h.ok + h.fail : 0
                  const rate = total > 0 ? (h!.ok / total) : null
                  const avgMs = h && h.ok > 0 ? h.totalMs / h.ok : null
                  return (
                    <TableRow key={src}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">
                        {src}
                        {src !== PRIOR[kind][i] && <span className="text-xs text-violet-400 ml-2">↕</span>}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', score(kind, src) >= 0.7 ? 'text-emerald-500' : score(kind, src) >= 0.4 ? 'text-amber-500' : 'text-rose-500')}>
                        {score(kind, src).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{h ? `${h.ok} / ${h.fail}` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{rate === null ? '—' : `${(rate * 100).toFixed(0)}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{avgMs === null ? '—' : `${avgMs.toFixed(0)}ms`}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h?.lastOkAt ? h.lastOkAt.replace('T', ' ').slice(0, 19) : '—'}</TableCell>
                      <TableCell className="text-xs text-rose-400 max-w-[260px] truncate" title={h?.lastErr || ''}>{h?.lastErr || '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Section>
        )
      })}

      <Section title="机制说明" className="border-dashed">
        <div className="text-xs text-muted-foreground space-y-1">
          <p>健康分 = 拉普拉斯平滑成功率 − 延迟惩罚（样本上限 500，超限减半，旧数据自然衰减）。</p>
          <p>每次真实行情调用自动记账；页面「链路探测」用贵州茅台主动跑一遍行情与 K 线链路，便于网络切换后快速确认可用源。</p>
          <p>思路来源：Vibe-Trading 的 23 源降级链 —— 永不封禁的源优先，被封过的源靠后，运行时按健康度再调整。</p>
        </div>
      </Section>
    </div>
  )
}
