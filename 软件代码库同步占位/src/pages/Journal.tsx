import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Trash2, BookMarked } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { normalizeCode, fetchLiveQuotes } from '@/lib/marketApi'
import {
  loadTrades, addTrade, deleteTrade, derivePositions, fmtMoney, type TradeRec,
} from '@/lib/trading'
import { appendRecord } from '@/lib/auditLedger'
import { useStore } from '@/lib/store'

const today = () => new Date().toISOString().slice(0, 10)

export default function Journal() {
  const s = useStore()
  const [trades, setTrades] = useState<TradeRec[]>(() => loadTrades())
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [form, setForm] = useState({ date: today(), code: '', name: '', side: 'buy' as 'buy' | 'sell', price: '', qty: '', fee: '0', note: '' })

  const positions = useMemo(() => derivePositions(trades), [trades])
  const totalBuy = trades.filter((t) => t.side === 'buy').reduce((a, t) => a + t.price * t.qty + t.fee, 0)
  const totalSell = trades.filter((t) => t.side === 'sell').reduce((a, t) => a + t.price * t.qty - t.fee, 0)

  const resolveName = async (code: string) => {
    setResolving(true)
    try {
      const { quotes } = await fetchLiveQuotes([code], () => 'manual')
      if (quotes[0]?.name) {
        setForm((f) => ({ ...f, name: quotes[0].name }))
        return quotes[0].name
      }
    } catch { /* 忽略，允许手填 */ } finally {
      setResolving(false)
    }
    return ''
  }

  const submit = async () => {
    const code = normalizeCode(form.code)
    if (!code) { toast.error('代码格式不正确（支持 600519 / 600519.SH / 00700.HK / AAPL.US）'); return }
    const price = parseFloat(form.price)
    const qty = parseFloat(form.qty)
    const fee = parseFloat(form.fee) || 0
    if (!(price > 0) || !(qty > 0)) { toast.error('价格与数量必须大于 0'); return }
    let name = form.name.trim()
    if (!name) name = await resolveName(code)
    if (!name) { toast.error('请填写名称（或联网自动识别失败）'); return }
    const rec = addTrade({ date: form.date, code, name, side: form.side, price, qty, fee, note: form.note.trim() })
    appendRecord('audit', 'journal.add', { date: rec.date, code: rec.code, side: rec.side, price: rec.price, qty: rec.qty })
    s.log('trade', `交易日志新增：${form.side === 'buy' ? '买入' : '卖出'} ${name} ${qty} 股 @ ${price}`)
    setTrades(loadTrades())
    setOpen(false)
    setForm({ date: today(), code: '', name: '', side: 'buy', price: '', qty: '', fee: '0', note: '' })
    toast.success('已记账，并写入审计台账链')
  }

  const remove = (t: TradeRec) => {
    deleteTrade(t.id)
    appendRecord('audit', 'journal.delete', { date: t.date, code: t.code, side: t.side, price: t.price, qty: t.qty })
    setTrades(loadTrades())
    toast.success('已删除该笔记录')
  }

  return (
    <div>
      <PageHeader
        title="交易日志"
        desc="记录每笔买卖；当前持仓由交易记录自动推导，摊薄成本 =（总买入 - 总卖出）÷ 剩余股数，成本为负标注「已回本」。所有增删写入审计台账哈希链。"
        extra={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />记录交易</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="总买入（含费）" value={'¥' + fmtMoney(totalBuy)} />
        <StatCard label="总卖出（扣费）" value={'¥' + fmtMoney(totalSell)} />
        <StatCard label="净投入" value={'¥' + fmtMoney(totalBuy - totalSell)} />
        <StatCard label="交易笔数" value={String(trades.length)} sub={`当前持仓 ${positions.length} 只`} />
      </div>

      <Section title="当前持仓（自动推导）" desc="摊薄成本为负表示卖出回收已超过买入投入" className="mb-6">
        {positions.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">暂无持仓——点击右上角「记录交易」开始记账</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>代码</TableHead><TableHead>名称</TableHead>
                <TableHead className="text-right">持仓股数</TableHead>
                <TableHead className="text-right">摊薄成本</TableHead>
                <TableHead className="text-right">总买入</TableHead>
                <TableHead className="text-right">总卖出</TableHead>
                <TableHead>区间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p) => (
                <TableRow key={p.code}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-right">{p.netQty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {p.recovered ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="line-through text-muted-foreground">{p.cost.toFixed(2)}</span>
                        <Pill tone="green">已回本</Pill>
                      </span>
                    ) : (
                      p.cost.toFixed(2)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(p.buyAmt)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(p.sellAmt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.firstDate} ~ {p.lastDate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="交易明细" desc={`共 ${trades.length} 笔，按记录时间倒序`}>
        {trades.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">还没有交易记录</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead><TableHead>代码</TableHead><TableHead>名称</TableHead>
                <TableHead>方向</TableHead>
                <TableHead className="text-right">价格</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">金额</TableHead>
                <TableHead className="text-right">费用</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{t.date}</TableCell>
                  <TableCell className="font-mono text-xs">{t.code}</TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell>
                    <Pill tone={t.side === 'buy' ? 'red' : 'green'}>{t.side === 'buy' ? '买入' : '卖出'}</Pill>
                  </TableCell>
                  <TableCell className="text-right">{t.price.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{t.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(t.price * t.qty)}</TableCell>
                  <TableCell className="text-right text-xs">{t.fee ? t.fee.toFixed(2) : '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-40 truncate" title={t.note}>{t.note || '-'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" title="删除该笔" onClick={() => remove(t)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookMarked className="h-4 w-4" />记录一笔交易</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">日期</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">方向</Label>
                <Select value={form.side} onValueChange={(v: 'buy' | 'sell') => setForm({ ...form, side: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">买入</SelectItem>
                    <SelectItem value="sell">卖出</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">代码</Label>
                <Input
                  placeholder="600519 / 00700.HK / AAPL.US"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  onBlur={() => { const c = normalizeCode(form.code); if (c && !form.name) resolveName(c) }}
                />
              </div>
              <div>
                <Label className="text-xs">名称 {resolving && <span className="text-muted-foreground">（识别中…）</span>}</Label>
                <Input placeholder="留空自动识别" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">价格</Label>
                <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">数量（股）</Label>
                <Input type="number" step="100" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">费用（元）</Label>
                <Input type="number" step="0.01" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">备注</Label>
              <Textarea rows={2} placeholder="买入逻辑 / 卖出原因（可选）" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={submit} disabled={resolving} className={cn(resolving && 'opacity-60')}>保存并写入审计链</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
