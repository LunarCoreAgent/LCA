import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Telescope, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { normalizeCode, fetchLiveQuotes, fetchDailyKline } from '@/lib/marketApi'
import {
  loadPredictions, savePredictions, judgePrediction, estimateDueDate,
  DIRECTION_LABEL, HIT_THRESHOLD, FLAT_BAND, type Prediction as Pred, type Direction,
} from '@/lib/trading'
import { appendRecord, verifyChain, chainHead, chainLength, shortHash } from '@/lib/auditLedger'
import { useStore, uid } from '@/lib/store'
import { cn } from '@/lib/utils'

const today = () => new Date().toISOString().slice(0, 10)

function statusPill(p: Pred) {
  if (p.status === 'open') return today() >= p.dueDate ? <Pill tone="amber">待判定</Pill> : <Pill tone="blue">进行中</Pill>
  return p.status === 'hit' ? <Pill tone="green">命中</Pill> : <Pill tone="red">未命中</Pill>
}

export default function Prediction() {
  const s = useStore()
  const [preds, setPreds] = useState<Pred[]>(() => loadPredictions())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const [verifyMsg, setVerifyMsg] = useState('')
  const [form, setForm] = useState({ code: '', direction: 'up' as Direction, horizon: 5, confidence: 3, thesis: '' })

  const stats = useMemo(() => {
    const open = preds.filter((p) => p.status === 'open').length
    const hit = preds.filter((p) => p.status === 'hit').length
    const miss = preds.filter((p) => p.status === 'miss').length
    return { open, hit, miss, total: preds.length }
  }, [preds])

  const shown = useMemo(() => {
    if (filter === 'open') return preds.filter((p) => p.status === 'open')
    if (filter === 'done') return preds.filter((p) => p.status !== 'open')
    return preds
  }, [preds, filter])

  const submit = async () => {
    const code = normalizeCode(form.code)
    if (!code) { toast.error('代码格式不正确'); return }
    if (!form.thesis.trim()) { toast.error('请填写推演依据（将随预测一同写入审计链）'); return }
    setBusy(true)
    try {
      const { quotes } = await fetchLiveQuotes([code], () => 'prediction')
      const q = quotes[0]
      if (!q || !(q.close > 0)) { toast.error('未取到当前价格，无法锚定入场价'); return }
      const entryDate = today()
      const pred: Pred = {
        id: uid(),
        createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        code, name: q.name || code,
        direction: form.direction, horizon: form.horizon, confidence: form.confidence,
        thesis: form.thesis.trim(),
        entryPrice: q.close, entryDate,
        dueDate: estimateDueDate(entryDate, form.horizon),
        status: 'open',
      }
      const rec = appendRecord('prediction', 'prediction.create', {
        code: pred.code, name: pred.name, direction: pred.direction, horizon: pred.horizon,
        confidence: pred.confidence, entryPrice: pred.entryPrice, entryDate: pred.entryDate, dueDate: pred.dueDate, thesis: pred.thesis,
      })
      pred.auditHash = rec.hash.slice(0, 16)
      savePredictions([pred, ...loadPredictions()])
      setPreds(loadPredictions())
      s.log('prediction', `新建推演：${pred.name} ${DIRECTION_LABEL[pred.direction]} ${pred.horizon} 日（入场 ${pred.entryPrice}）`)
      setOpen(false)
      setForm({ code: '', direction: 'up', horizon: 5, confidence: 3, thesis: '' })
      toast.success('推演已创建并写入审计链', { description: `哈希 ${rec.hash.slice(0, 18)}…` })
    } catch (e) {
      toast.error('创建失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const evaluateOne = async (p: Pred): Promise<Pred> => {
    const ks = await fetchDailyKline(p.code, p.horizon * 2 + 15)
    const bar = ks.find((k) => k.date >= p.dueDate) ?? ks[ks.length - 1]
    if (!bar) throw new Error('无行情数据')
    const retPct = ((bar.close - p.entryPrice) / p.entryPrice) * 100
    const status = judgePrediction(p, retPct)
    const done: Pred = {
      ...p, status, exitPrice: bar.close, exitDate: bar.date,
      retPct: +retPct.toFixed(2), evaluatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    }
    appendRecord('prediction', 'prediction.evaluate', {
      code: p.code, direction: p.direction, entryPrice: p.entryPrice, exitPrice: bar.close,
      retPct: done.retPct, status, dueDate: p.dueDate,
    })
    appendRecord('benchmark', 'benchmark.score', { code: p.code, status, retPct: done.retPct, direction: p.direction, confidence: p.confidence })
    return done
  }

  const evaluateDue = async () => {
    const due = preds.filter((p) => p.status === 'open' && today() >= p.dueDate)
    if (!due.length) { toast.info('当前没有到期待判定的推演'); return }
    setBusy(true)
    let ok = 0, fail = 0
    try {
      const list = loadPredictions()
      for (const p of due) {
        try {
          const done = await evaluateOne(p)
          const idx = list.findIndex((x) => x.id === p.id)
          if (idx >= 0) list[idx] = done
          ok++
        } catch { fail++ }
      }
      savePredictions(list)
      setPreds(loadPredictions())
      s.log('prediction', `推演判定：命中/未命中 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
      toast.success(`已判定 ${ok} 条${fail ? `，${fail} 条行情获取失败` : ''}`, { description: '判定结果同步写入推演预测链与基准复盘链' })
    } finally {
      setBusy(false)
    }
  }

  const remove = (p: Pred) => {
    savePredictions(loadPredictions().filter((x) => x.id !== p.id))
    setPreds(loadPredictions())
    toast.success('已删除该推演（审计链记录保留，保证可追溯）')
  }

  const doVerify = () => {
    const r = verifyChain('prediction')
    setVerifyMsg(r.ok ? `推演预测链校验通过（共 ${r.total} 条）` : `校验失败：${r.reason}`)
    if (r.ok) toast.success('审计链校验通过'); else toast.error('审计链校验失败', { description: r.reason })
  }

  return (
    <div>
      <PageHeader
        title="推演预测"
        desc={`对个股做方向性推演：创建时锚定入场价并写入 SHA-256 审计链，到期按收盘价自动判定。命中口径：方向 ±${HIT_THRESHOLD}%，震荡带 ±${FLAT_BAND}%。`}
        extra={
          <>
            <Button variant="outline" onClick={evaluateDue} disabled={busy}>判定到期推演</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新建推演</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="推演总数" value={String(stats.total)} icon={<Telescope className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="进行中 / 待判定" value={String(stats.open)} sub="到期后点「判定到期推演」" />
        <StatCard label="命中" value={String(stats.hit)} sub={<span className="text-emerald-400">hit</span>} />
        <StatCard label="未命中" value={String(stats.miss)} sub={<span className="text-red-400">miss</span>} />
      </div>

      <Section
        title="推演记录"
        desc="创建与判定均写入审计链，记录删除不影响链上痕迹"
        extra={
          <div className="flex gap-1.5">
            {(['all', 'open', 'done'] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                {f === 'all' ? '全部' : f === 'open' ? '进行中' : '已判定'}
              </Button>
            ))}
          </div>
        }
        className="mb-6"
      >
        {shown.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">暂无推演记录——点击右上角「新建推演」开始</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>创建时间</TableHead><TableHead>标的</TableHead>
                <TableHead>方向</TableHead>
                <TableHead className="text-right">周期</TableHead>
                <TableHead className="text-right">置信度</TableHead>
                <TableHead className="text-right">入场价</TableHead>
                <TableHead>到期日</TableHead>
                <TableHead className="text-right">到期价</TableHead>
                <TableHead className="text-right">收益率</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>链上哈希</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground">{p.entryDate}</TableCell>
                  <TableCell>
                    <div>{p.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{p.code}</div>
                  </TableCell>
                  <TableCell>
                    <Pill tone={p.direction === 'up' ? 'red' : p.direction === 'down' ? 'green' : 'default'}>
                      {DIRECTION_LABEL[p.direction]}
                    </Pill>
                  </TableCell>
                  <TableCell className="text-right">{p.horizon} 日</TableCell>
                  <TableCell className="text-right">{'★'.repeat(p.confidence)}</TableCell>
                  <TableCell className="text-right">{p.entryPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-xs">{p.dueDate}</TableCell>
                  <TableCell className="text-right">{p.exitPrice?.toFixed(2) ?? '-'}</TableCell>
                  <TableCell className={cn('text-right', p.retPct == null ? '' : p.retPct >= 0 ? 'text-red-400' : 'text-emerald-400')}>
                    {p.retPct != null ? (p.retPct >= 0 ? '+' : '') + p.retPct.toFixed(2) + '%' : '-'}
                  </TableCell>
                  <TableCell>{statusPill(p)}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground" title={p.auditHash}>{p.auditHash ? p.auditHash.slice(0, 10) + '…' : '-'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" title="删除该推演" onClick={() => remove(p)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="审计链状态" desc="推演预测链：创建与判定逐条上链，任何历史改动都会导致校验失败">
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">链长度</span>
            <div className="font-mono">{chainLength('prediction')} 条</div>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-muted-foreground text-xs">链头哈希</span>
            <div className="font-mono text-xs truncate">{shortHash(chainHead('prediction'))}</div>
          </div>
          <Button size="sm" variant="outline" onClick={doVerify}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />全链校验
          </Button>
        </div>
        {verifyMsg && <p className="text-xs mt-2 text-muted-foreground">{verifyMsg}</p>}
      </Section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Telescope className="h-4 w-4" />新建方向性推演</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">标的代码</Label>
              <Input placeholder="600519 / 00700.HK / AAPL.US" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">方向</Label>
                <Select value={form.direction} onValueChange={(v: Direction) => setForm({ ...form, direction: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="up">看涨（≥+{HIT_THRESHOLD}% 命中）</SelectItem>
                    <SelectItem value="down">看跌（≤-{HIT_THRESHOLD}% 命中）</SelectItem>
                    <SelectItem value="flat">震荡（±{FLAT_BAND}% 内命中）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">周期（交易日）</Label>
                <Select value={String(form.horizon)} onValueChange={(v) => setForm({ ...form, horizon: parseInt(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 日</SelectItem>
                    <SelectItem value="10">10 日</SelectItem>
                    <SelectItem value="20">20 日</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">置信度：{'★'.repeat(form.confidence)}（{form.confidence}/5）</Label>
              <Slider value={[form.confidence]} min={1} max={5} step={1} onValueChange={([v]) => setForm({ ...form, confidence: v })} />
            </div>
            <div>
              <Label className="text-xs">推演依据</Label>
              <Textarea rows={3} placeholder="为什么看涨/看跌/震荡？依据将随预测一并写入审计链，不可篡改" value={form.thesis} onChange={(e) => setForm({ ...form, thesis: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={submit} disabled={busy} className={cn(busy && 'opacity-60')}>{busy ? '锚定价格中…' : '创建并上链'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
