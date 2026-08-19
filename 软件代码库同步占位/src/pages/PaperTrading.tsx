import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Play, Plus, Trash2, PlayCircle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { STRATEGIES } from '@/lib/backtest'
import { normalizeCode, fetchLiveQuotes } from '@/lib/marketApi'
import { fmtMoney } from '@/lib/trading'
import {
  loadPaper, savePaper, resetPaper, runPaperScan, paperPositions, paperStats, roundTrips,
  loadEquity, appendEquity, type PaperAccount, type PaperAssignment, type ScanResult,
} from '@/lib/paperTrading'
import { appendRecord } from '@/lib/auditLedger'
import { useStore, uid } from '@/lib/store'

export default function PaperTrading() {
  const s = useStore()
  const [acc, setAcc] = useState<PaperAccount>(() => loadPaper())
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<ScanResult[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ strategyId: STRATEGIES[0].id, code: '', name: '', alloc: '200000' })

  const positions = useMemo(() => paperPositions(acc), [acc])
  const stats = useMemo(() => paperStats(acc), [acc])
  const trips = useMemo(() => roundTrips(acc), [acc])
  const equity = useMemo(() => loadEquity(), [acc, results])
  const stratName = (id: string) => STRATEGIES.find((x) => x.id === id)?.name ?? id

  const posValue = positions.reduce((a, p) => a + p.invested, 0) // 无实时价时用占用资金近似
  const totalAsset = acc.cash + posValue

  const scan = async () => {
    if (!acc.assignments.some((a) => a.enabled)) { toast.error('请先添加并启用至少一个策略绑定'); return }
    setScanning(true)
    try {
      const { acc: next, results: rs } = await runPaperScan(acc)
      // 权益快照：尝试用实时价重估持仓市值
      let pv = paperPositions(next).reduce((a, p) => a + p.invested, 0)
      try {
        const ps = paperPositions(next)
        if (ps.length) {
          const { quotes } = await fetchLiveQuotes(ps.map((p) => p.code), () => 'paper')
          const qm = new Map(quotes.map((q) => [q.code, q]))
          pv = ps.reduce((a, p) => a + (qm.get(p.code)?.close ?? p.avgCost) * p.qty, 0)
        }
      } catch { /* 无网时用成本口径 */ }
      appendEquity({ date: new Date().toISOString().slice(0, 10), cash: next.cash, posValue: +pv.toFixed(2), total: +(next.cash + pv).toFixed(2) })
      appendRecord('paper', 'paper.scan', { assignments: next.assignments.filter((a) => a.enabled).length, trades: rs.filter((r) => r.trade).length })
      setAcc(loadPaper())
      setResults(rs)
      const n = rs.filter((r) => r.trade).length
      s.log('paper', `模拟盘扫描完成：${rs.length} 个绑定，${n} 笔成交`)
      if (n) toast.success(`扫描完成，${n} 笔虚拟成交（已写入模拟交易链）`)
      else toast.success('扫描完成，本轮无成交（信号延续）')
    } catch (e) {
      toast.error('扫描失败：' + (e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const addAssign = async () => {
    const code = normalizeCode(form.code)
    if (!code) { toast.error('代码格式不正确'); return }
    const alloc = parseFloat(form.alloc)
    if (!(alloc > 0)) { toast.error('分配资金必须大于 0'); return }
    let name = form.name.trim()
    if (!name) {
      try {
        const { quotes } = await fetchLiveQuotes([code], () => 'paper')
        name = quotes[0]?.name ?? ''
      } catch { /* 忽略 */ }
    }
    const a: PaperAssignment = { id: uid(), strategyId: form.strategyId, code, name: name || code, alloc, enabled: true }
    const next = { ...acc, assignments: [a, ...acc.assignments] }
    savePaper(next)
    setAcc(next)
    appendRecord('paper', 'paper.assign.add', { code, strategy: stratName(a.strategyId), alloc })
    setAddOpen(false)
    setForm({ strategyId: STRATEGIES[0].id, code: '', name: '', alloc: '200000' })
    toast.success('已添加策略绑定')
  }

  const toggleAssign = (a: PaperAssignment) => {
    const next = { ...acc, assignments: acc.assignments.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)) }
    savePaper(next); setAcc(next)
  }

  const removeAssign = (a: PaperAssignment) => {
    const pos = positions.find((p) => p.assignId === a.id)
    if (pos) { toast.error('该绑定仍有持仓，请先等信号转空卖出（或重置模拟盘）'); return }
    const next = { ...acc, assignments: acc.assignments.filter((x) => x.id !== a.id) }
    savePaper(next); setAcc(next)
    appendRecord('paper', 'paper.assign.remove', { code: a.code, strategy: stratName(a.strategyId) })
    toast.success('已删除绑定')
  }

  return (
    <div>
      <PageHeader
        title="模拟交易"
        desc="观察级模拟账本：策略绑定标的，日级信号扫描驱动虚拟成交（T 日收盘价、含佣金与印花税、A股整手）。全部信号与成交写入「模拟交易」审计链，作为实盘切换标准的对账底稿。不做高频、不做衍生品。"
        extra={
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline"><RotateCcw className="h-4 w-4 mr-1" />重置</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>重置模拟盘？</AlertDialogTitle>
                  <AlertDialogDescription>将清空全部虚拟成交、策略绑定与权益曲线，资金回到初始 100 万。审计链上的历史记录保留。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setAcc(resetPaper()); setResults([]); toast.success('模拟盘已重置') }}>确认重置</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />策略绑定</Button>
            <Button onClick={scan} disabled={scanning}>
              <Play className={cn('h-4 w-4 mr-1', scanning && 'animate-pulse')} />{scanning ? '扫描中…' : '运行信号扫描'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="总资产（元）" value={fmtMoney(totalAsset)} sub={`初始 ${fmtMoney(acc.initialCash)}`} icon={<PlayCircle className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="可用资金" value={fmtMoney(acc.cash)} sub={`持仓占用 ${fmtMoney(posValue)}`} />
        <StatCard
          label="已实现盈亏（闭合回合）"
          value={(stats.totalPnl >= 0 ? '+' : '') + fmtMoney(stats.totalPnl)}
          sub={stats.closedTrades ? `${stats.closedTrades} 笔闭合` : '尚无闭合回合'}
        />
        <StatCard
          label="胜率 / 盈亏比"
          value={stats.winRate != null ? `${stats.winRate}%` : '-'}
          sub={stats.profitFactor != null ? `盈亏比 ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor}` : '样本不足'}
        />
      </div>

      <Section title="策略绑定" desc="每个绑定 = 一个策略 × 一只标的 × 一份资金上限；扫描时按最新日 K 信号开平仓" className="mb-6"
        extra={<Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />添加</Button>}>
        {acc.assignments.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">暂无绑定——添加「策略 × 标的」后点「运行信号扫描」</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>策略</TableHead><TableHead>标的</TableHead>
                <TableHead className="text-right">资金上限</TableHead>
                <TableHead>最新信号</TableHead>
                <TableHead>最近扫描</TableHead>
                <TableHead>启用</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {acc.assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{stratName(a.strategyId)}</TableCell>
                  <TableCell>
                    <div>{a.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{a.code}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">¥{fmtMoney(a.alloc)}</TableCell>
                  <TableCell>
                    {a.lastSignal ? (a.lastSignal === 'hold' ? <Pill tone="red">持有信号</Pill> : <Pill>空仓信号</Pill>) : <span className="text-xs text-muted-foreground">未扫描</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.lastScan ?? '-'}</TableCell>
                  <TableCell><Switch checked={a.enabled} onCheckedChange={() => toggleAssign(a)} /></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" title="删除绑定" onClick={() => removeAssign(a)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {results.length > 0 && (
        <Section title="本轮扫描结果" desc="按绑定逐一汇报" className="mb-6">
          <div className="space-y-1.5">
            {results.map((r) => (
              <div key={r.assignId} className="flex items-center gap-3 text-sm rounded-md border border-border/50 px-3 py-2">
                {r.action === 'buy' ? <Pill tone="red">买入</Pill>
                  : r.action === 'sell' ? <Pill tone="green">卖出</Pill>
                  : r.action === 'error' ? <Pill tone="amber">异常</Pill>
                  : <Pill>无操作</Pill>}
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground flex-1">{r.detail}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Section title="模拟持仓" desc="按绑定隔离仓位（同标的不同策略各算各的）">
          {positions.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">当前空仓</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标的</TableHead><TableHead>策略</TableHead>
                  <TableHead className="text-right">股数</TableHead>
                  <TableHead className="text-right">均价（含费）</TableHead>
                  <TableHead className="text-right">占用资金</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => (
                  <TableRow key={p.assignId}>
                    <TableCell>
                      <div>{p.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{p.code}</div>
                    </TableCell>
                    <TableCell className="text-xs">{stratName(acc.assignments.find((a) => a.id === p.assignId)?.strategyId ?? '')}</TableCell>
                    <TableCell className="text-right">{p.qty.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{p.avgCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtMoney(p.invested)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="权益曲线" desc="每次扫描追加快照（有实时价时按市值，否则按成本）">
          {equity.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">运行首轮扫描后生成</div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={equity}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => (v / 10000).toFixed(0) + '万'} width={44} />
                  <Tooltip formatter={(v: number) => '¥' + fmtMoney(v)} />
                  <Line type="monotone" dataKey="total" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="总资产" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
      </div>

      <Section title="成交记录" desc={`共 ${acc.trades.length} 笔虚拟成交；闭合回合 ${trips.length} 笔（FIFO 配对）`}>
        {acc.trades.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">暂无成交</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead><TableHead>标的</TableHead><TableHead>方向</TableHead>
                <TableHead className="text-right">价格</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">费用</TableHead>
                <TableHead>信号依据</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...acc.trades].reverse().slice(0, 50).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{t.date}</TableCell>
                  <TableCell>
                    <div>{t.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{t.code}</div>
                  </TableCell>
                  <TableCell><Pill tone={t.side === 'buy' ? 'red' : 'green'}>{t.side === 'buy' ? '买入' : '卖出'}</Pill></TableCell>
                  <TableCell className="text-right">{t.price.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{t.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs">{t.fee.toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-56 truncate" title={t.reason}>{t.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加策略绑定</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">回测策略（10 选 1）</Label>
              <Select value={form.strategyId} onValueChange={(v) => setForm({ ...form, strategyId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{STRATEGIES.find((x) => x.id === form.strategyId)?.desc}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">标的代码</Label>
                <Input placeholder="600519 / 00700.HK" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">名称（留空自动识别）</Label>
                <Input placeholder="留空自动识别" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">资金上限（元）</Label>
              <Input type="number" step="10000" value={form.alloc} onChange={(e) => setForm({ ...form, alloc: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
              <Button onClick={addAssign}>添加</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
