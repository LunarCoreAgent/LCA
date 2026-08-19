import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RefreshCw, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fetchLiveQuotes } from '@/lib/marketApi'
import { loadTrades, derivePositions, fmtMoney, type Position } from '@/lib/trading'
import type { Quote } from '@/lib/stockData'

interface Row extends Position {
  price?: number      // 最新价
  pctChg?: number     // 今日涨跌幅 %
  mktVal?: number     // 持仓市值
  floatPnl?: number   // 浮动盈亏 = 市值 - 净投入
  floatPct?: number   // 浮动收益率 %
  weight?: number     // 占总市值 %
}

export default function Portfolio() {
  const [positions, setPositions] = useState<Position[]>([])
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map())
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')

  const reload = useCallback(async (silent = false) => {
    const ps = derivePositions(loadTrades())
    setPositions(ps)
    if (!ps.length) return
    if (!silent) setLoading(true)
    try {
      const { quotes: qs, failed } = await fetchLiveQuotes(ps.map((p) => p.code), () => 'portfolio')
      setQuotes(new Map(qs.map((q) => [q.code, q])))
      setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      if (failed.length && !silent) toast.warning(`${failed.length} 只行情获取失败，该列暂用成本价展示`)
    } catch (e) {
      if (!silent) toast.error('行情刷新失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload(true) }, [reload])

  const rows: Row[] = useMemo(() => {
    const base = positions.map((p) => {
      const q = quotes.get(p.code)
      const price = q?.close
      const mktVal = price != null ? price * p.netQty : undefined
      const floatPnl = mktVal != null ? mktVal - p.netInvest : undefined
      return { ...p, price, pctChg: q?.pctChg, mktVal, floatPnl, floatPct: floatPnl != null && p.netInvest > 0 ? (floatPnl / p.netInvest) * 100 : undefined }
    })
    const totalVal = base.reduce((a, r) => a + (r.mktVal ?? 0), 0)
    return base.map((r) => ({ ...r, weight: totalVal > 0 && r.mktVal != null ? (r.mktVal / totalVal) * 100 : undefined }))
  }, [positions, quotes])

  const totalVal = rows.reduce((a, r) => a + (r.mktVal ?? 0), 0)
  const totalInvest = rows.reduce((a, r) => a + r.netInvest, 0)
  const totalPnl = totalVal - totalInvest
  const totalPct = totalInvest > 0 ? (totalPnl / totalInvest) * 100 : 0
  const recoveredCnt = rows.filter((r) => r.recovered).length

  const pnlCls = (v?: number) => (v == null ? 'text-muted-foreground' : v > 0 ? 'text-red-400' : v < 0 ? 'text-emerald-400' : 'text-muted-foreground')

  return (
    <div>
      <PageHeader
        title="投资组合"
        desc="持仓总览与盈亏跟踪：市值按实时行情估算，浮动盈亏 = 市值 - 净投入（摊薄口径）。行情数据来自行情采集通道，非交易时段显示最近收盘价。"
        extra={
          <Button variant="outline" onClick={() => reload()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} />刷新行情
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="持仓总市值" value={'¥' + fmtMoney(totalVal)} sub={updatedAt ? `行情更新于 ${updatedAt}` : '待刷新'} icon={<Wallet className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="净投入本金" value={'¥' + fmtMoney(totalInvest)} sub={`${rows.length} 只持仓`} />
        <StatCard
          label="浮动盈亏"
          value={(totalPnl >= 0 ? '+' : '') + fmtMoney(totalPnl)}
          sub={<span className={pnlCls(totalPnl)}>{(totalPct >= 0 ? '+' : '') + totalPct.toFixed(2)}%</span>}
        />
        <StatCard label="已回本标的" value={String(recoveredCnt)} sub="卖出回收已超买入投入" />
      </div>

      <Section title="持仓明细" desc="摊薄成本 =（总买入 - 总卖出）÷ 剩余股数；占比按市值计算">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            暂无持仓。请先到「交易日志」记录买卖，持仓将自动推导到这里。
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>代码</TableHead><TableHead>名称</TableHead>
                <TableHead className="text-right">持仓</TableHead>
                <TableHead className="text-right">摊薄成本</TableHead>
                <TableHead className="text-right">最新价</TableHead>
                <TableHead className="text-right">今日涨跌</TableHead>
                <TableHead className="text-right">市值</TableHead>
                <TableHead className="text-right">浮动盈亏</TableHead>
                <TableHead className="text-right">收益率</TableHead>
                <TableHead className="text-right">占比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right">{r.netQty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {r.recovered ? <Pill tone="green">已回本</Pill> : r.cost.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">{r.price != null ? r.price.toFixed(2) : '-'}</TableCell>
                  <TableCell className={cn('text-right', pnlCls(r.pctChg))}>
                    {r.pctChg != null ? (r.pctChg >= 0 ? '+' : '') + r.pctChg.toFixed(2) + '%' : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.mktVal != null ? fmtMoney(r.mktVal) : '-'}</TableCell>
                  <TableCell className={cn('text-right font-mono text-xs', pnlCls(r.floatPnl))}>
                    {r.floatPnl != null ? (r.floatPnl >= 0 ? '+' : '') + fmtMoney(r.floatPnl) : '-'}
                  </TableCell>
                  <TableCell className={cn('text-right', pnlCls(r.floatPct))}>
                    {r.floatPct != null ? (r.floatPct >= 0 ? '+' : '') + r.floatPct.toFixed(2) + '%' : '-'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {r.weight != null ? r.weight.toFixed(1) + '%' : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <p className="text-xs text-muted-foreground mt-4">
        提示：本页为观察级账本口径，不构成投资建议；成交金额与成本口径详见「交易日志」。涨红跌绿（A股习惯）。
      </p>
    </div>
  )
}
