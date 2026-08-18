import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { Gauge, ShieldCheck, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { fetchDailyKline } from '@/lib/marketApi'
import {
  loadPredictions, savePredictions, judgePrediction,
  DIRECTION_LABEL, HIT_THRESHOLD, FLAT_BAND, type Prediction as Pred,
} from '@/lib/trading'
import { appendRecord, verifyChain, chainHead, chainLength, shortHash } from '@/lib/auditLedger'
import { cn } from '@/lib/utils'

const today = () => new Date().toISOString().slice(0, 10)

interface Bucket { label: string; total: number; hit: number; rate: number | null }

function bucketize(preds: Pred[], key: (p: Pred) => string, order: string[]): Bucket[] {
  const m = new Map<string, { total: number; hit: number }>()
  for (const p of preds) {
    const k = key(p)
    const b = m.get(k) ?? { total: 0, hit: 0 }
    b.total++
    if (p.status === 'hit') b.hit++
    m.set(k, b)
  }
  return order.filter((k) => m.has(k)).map((k) => {
    const b = m.get(k)!
    return { label: k, total: b.total, hit: b.hit, rate: b.total ? (b.hit / b.total) * 100 : null }
  })
}

export default function Benchmark() {
  const [preds, setPreds] = useState<Pred[]>(() => loadPredictions())
  const [busy, setBusy] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState('')

  const done = useMemo(() => preds.filter((p) => p.status !== 'open'), [preds])
  const openDue = useMemo(() => preds.filter((p) => p.status === 'open' && today() >= p.dueDate), [preds])
  const hits = done.filter((p) => p.status === 'hit').length
  const hitRate = done.length ? (hits / done.length) * 100 : null

  const byDirection = useMemo(() => bucketize(done, (p) => DIRECTION_LABEL[p.direction], ['看涨', '看跌', '震荡']), [done])
  const byHorizon = useMemo(() => bucketize(done, (p) => `${p.horizon} 日`, ['5 日', '10 日', '20 日']), [done])
  const byConfidence = useMemo(
    () => bucketize(done, (p) => `${p.confidence} 星`, ['1 星', '2 星', '3 星', '4 星', '5 星']),
    [done]
  )
  const recent = useMemo(() => [...done].sort((a, b) => (b.evaluatedAt ?? '').localeCompare(a.evaluatedAt ?? '')).slice(0, 10), [done])

  const reconcile = async () => {
    if (!openDue.length) { toast.info('没有到期待判定的推演'); return }
    setBusy(true)
    let ok = 0, fail = 0
    try {
      const list = loadPredictions()
      for (const p of openDue) {
        try {
          const ks = await fetchDailyKline(p.code, p.horizon * 2 + 15)
          const bar = ks.find((k) => k.date >= p.dueDate) ?? ks[ks.length - 1]
          if (!bar) throw new Error('无行情')
          const retPct = +(((bar.close - p.entryPrice) / p.entryPrice) * 100).toFixed(2)
          const status = judgePrediction(p, retPct)
          const idx = list.findIndex((x) => x.id === p.id)
          if (idx >= 0) {
            list[idx] = { ...p, status, exitPrice: bar.close, exitDate: bar.date, retPct, evaluatedAt: new Date().toLocaleString('zh-CN', { hour12: false }) }
          }
          appendRecord('prediction', 'prediction.evaluate', { code: p.code, status, retPct, exitPrice: bar.close })
          appendRecord('benchmark', 'benchmark.score', { code: p.code, status, retPct, direction: p.direction, confidence: p.confidence })
          ok++
        } catch { fail++ }
      }
      savePredictions(list)
      setPreds(loadPredictions())
      toast.success(`对账完成：判定 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const doVerify = () => {
    const r = verifyChain('benchmark')
    setVerifyMsg(r.ok ? `基准复盘链校验通过（共 ${r.total} 条）` : `校验失败：${r.reason}`)
    if (r.ok) toast.success('审计链校验通过'); else toast.error('审计链校验失败', { description: r.reason })
  }

  const BucketTable = ({ title, rows }: { title: string; rows: Bucket[] }) => (
    <Section title={title}>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">暂无已判定样本</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((b) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="w-14 text-xs text-muted-foreground">{b.label}</span>
              <Progress value={b.rate ?? 0} className="flex-1 h-2" />
              <span className="w-24 text-xs text-right font-mono">
                {b.rate != null ? `${b.rate.toFixed(0)}%（${b.hit}/${b.total}）` : '-'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )

  return (
    <div>
      <PageHeader
        title="预测基准"
        desc={`推演命中率的基准复盘与概率校准：方向命中 ±${HIT_THRESHOLD}%、震荡带 ±${FLAT_BAND}%；每次判定同步写入基准复盘链。样本量越足，校准越可信。`}
        extra={
          <Button variant="outline" onClick={reconcile} disabled={busy}>
            <RefreshCcw className={cn('h-4 w-4 mr-1', busy && 'animate-spin')} />
            对账到期推演{openDue.length ? `（${openDue.length}）` : ''}
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="已判定样本" value={String(done.length)} icon={<Gauge className="h-4 w-4 text-muted-foreground" />} sub={`进行中 ${preds.length - done.length} 条`} />
        <StatCard
          label="总命中率"
          value={hitRate != null ? hitRate.toFixed(1) + '%' : '-'}
          sub={done.length ? `${hits} 命中 / ${done.length - hits} 未命中` : '等待首批判定'}
        />
        <StatCard label="待对账" value={String(openDue.length)} sub="到期未判定的推演" />
        <StatCard label="基准复盘链" value={String(chainLength('benchmark'))} sub="条判定记录" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <BucketTable title="按方向" rows={byDirection} />
        <BucketTable title="按周期" rows={byHorizon} />
        <BucketTable title="按置信度（校准）" rows={byConfidence} />
      </div>

      <Section title="最近判定" desc="按判定时间倒序，最多展示 10 条" className="mb-6">
        {recent.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">暂无判定记录——到「推演预测」创建第一条推演</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标的</TableHead><TableHead>方向</TableHead>
                <TableHead className="text-right">入场价</TableHead>
                <TableHead className="text-right">到期价</TableHead>
                <TableHead className="text-right">收益率</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>判定时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div>{p.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{p.code}</div>
                  </TableCell>
                  <TableCell>
                    <Pill tone={p.direction === 'up' ? 'red' : p.direction === 'down' ? 'green' : 'default'}>{DIRECTION_LABEL[p.direction]}</Pill>
                  </TableCell>
                  <TableCell className="text-right">{p.entryPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{p.exitPrice?.toFixed(2) ?? '-'}</TableCell>
                  <TableCell className={cn('text-right', (p.retPct ?? 0) >= 0 ? 'text-red-400' : 'text-emerald-400')}>
                    {p.retPct != null ? (p.retPct >= 0 ? '+' : '') + p.retPct.toFixed(2) + '%' : '-'}
                  </TableCell>
                  <TableCell>{p.status === 'hit' ? <Pill tone="green">命中</Pill> : <Pill tone="red">未命中</Pill>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.evaluatedAt ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="审计链状态" desc="基准复盘链：每次判定一条，与推演预测链相互印证">
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">链长度</span>
            <div className="font-mono">{chainLength('benchmark')} 条</div>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-muted-foreground text-xs">链头哈希</span>
            <div className="font-mono text-xs truncate">{shortHash(chainHead('benchmark'))}</div>
          </div>
          <Button size="sm" variant="outline" onClick={doVerify}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />全链校验
          </Button>
        </div>
        {verifyMsg && <p className="text-xs mt-2 text-muted-foreground">{verifyMsg}</p>}
      </Section>
    </div>
  )
}
