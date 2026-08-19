import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ClipboardList, RefreshCcw, Trash2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { fetchLiveQuotes, loadWatchList } from '@/lib/marketApi'
import {
  loadReviews, addReview, deleteReview, loadTrades, derivePositions, loadPredictions,
  fmtMoney, DIRECTION_LABEL, type DailyReviewRec,
} from '@/lib/trading'
import { appendRecord } from '@/lib/auditLedger'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

const today = () => new Date().toISOString().slice(0, 10)

// 三大指数（东财 secid 规则与个股一致：1.=沪 0.=深）
const INDICES = [
  { code: '000001.SH', name: '上证指数' },
  { code: '399001.SZ', name: '深证成指' },
  { code: '399006.SZ', name: '创业板指' },
]

export default function DailyReview() {
  const s = useStore()
  const [reviews, setReviews] = useState<DailyReviewRec[]>(() => loadReviews())
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<DailyReviewRec | null>(null)

  const todayRec = useMemo(() => reviews.find((r) => r.date === today()), [reviews])

  const generate = async () => {
    setBusy(true)
    const lines: string[] = []
    const day = today()
    try {
      lines.push(`# 每日复盘 · ${day}`)
      lines.push('')

      // 1) 大盘指数
      try {
        const { quotes: idx } = await fetchLiveQuotes(INDICES.map((i) => i.code), () => 'review')
        if (idx.length) {
          lines.push('## 大盘')
          for (const q of idx) {
            const sign = q.pctChg >= 0 ? '+' : ''
            lines.push(`- ${q.name || q.code}：${q.close.toFixed(2)}（${sign}${q.pctChg.toFixed(2)}%）`)
          }
          lines.push('')
        }
      } catch { lines.push('## 大盘\n- 指数行情获取失败（非交易时段或网络异常）', '') }

      // 2) 自选股
      const watch = loadWatchList([])
      if (watch.length) {
        try {
          const { quotes } = await fetchLiveQuotes(watch.map((w) => w.code), () => 'review')
          const sorted = [...quotes].sort((a, b) => b.pctChg - a.pctChg)
          const up = quotes.filter((q) => q.pctChg > 0).length
          const down = quotes.filter((q) => q.pctChg < 0).length
          lines.push(`## 自选股（${quotes.length} 只：涨 ${up} / 跌 ${down}）`)
          const show = (q: (typeof quotes)[number]) => `- ${q.name}（${q.code}）：${q.close.toFixed(2)}（${q.pctChg >= 0 ? '+' : ''}${q.pctChg.toFixed(2)}%）`
          if (sorted[0]) lines.push(`领涨：${show(sorted[0]).slice(2)}`)
          if (sorted[sorted.length - 1]) lines.push(`领跌：${show(sorted[sorted.length - 1]).slice(2)}`)
          lines.push('')
        } catch { lines.push('## 自选股\n- 行情获取失败', '') }
      } else {
        lines.push('## 自选股\n- 监控列表为空，可到「行情采集」添加', '')
      }

      // 3) 持仓与当日交易
      const trades = loadTrades()
      const todayTrades = trades.filter((t) => t.date === day)
      const positions = derivePositions(trades)
      lines.push('## 持仓')
      if (!positions.length) {
        lines.push('- 当前无持仓')
      } else {
        try {
          const { quotes } = await fetchLiveQuotes(positions.map((p) => p.code), () => 'review')
          const qm = new Map(quotes.map((q) => [q.code, q]))
          let totalVal = 0, totalInvest = 0
          for (const p of positions) {
            const q = qm.get(p.code)
            const val = q ? q.close * p.netQty : p.netInvest
            totalVal += val; totalInvest += p.netInvest
            const pnl = val - p.netInvest
            lines.push(`- ${p.name}（${p.code}）：${p.netQty.toLocaleString()} 股，摊薄成本 ${p.cost.toFixed(2)}${p.recovered ? '（已回本）' : ''}，市值 ¥${fmtMoney(val)}，浮动盈亏 ${pnl >= 0 ? '+' : ''}${fmtMoney(pnl)}`)
          }
          lines.push(`- 合计：市值 ¥${fmtMoney(totalVal)}，净投入 ¥${fmtMoney(totalInvest)}，浮动盈亏 ${totalVal - totalInvest >= 0 ? '+' : ''}${fmtMoney(totalVal - totalInvest)}`)
        } catch {
          for (const p of positions) lines.push(`- ${p.name}（${p.code}）：${p.netQty.toLocaleString()} 股，摊薄成本 ${p.cost.toFixed(2)}${p.recovered ? '（已回本）' : ''}（行情未取到，市值略）`)
        }
      }
      lines.push('')
      lines.push(`## 当日交易（${todayTrades.length} 笔）`)
      if (todayTrades.length) {
        for (const t of todayTrades) lines.push(`- ${t.side === 'buy' ? '买入' : '卖出'} ${t.name}（${t.code}）${t.qty.toLocaleString()} 股 @ ${t.price.toFixed(2)}${t.note ? `：${t.note}` : ''}`)
      } else {
        lines.push('- 今日无交易')
      }
      lines.push('')

      // 4) 推演预测动态
      const preds = loadPredictions()
      const openP = preds.filter((p) => p.status === 'open')
      const dueP = openP.filter((p) => day >= p.dueDate)
      const doneToday = preds.filter((p) => p.evaluatedAt && p.evaluatedAt.startsWith(day.replace(/-/g, '/')))
      lines.push('## 推演预测')
      lines.push(`- 进行中 ${openP.length} 条${dueP.length ? `，其中 ${dueP.length} 条已到期可判定` : ''}`)
      if (doneToday.length) {
        for (const p of doneToday) lines.push(`- 今日判定：${p.name} ${DIRECTION_LABEL[p.direction]} → ${p.status === 'hit' ? '命中' : '未命中'}（${(p.retPct ?? 0) >= 0 ? '+' : ''}${p.retPct}%）`)
      }
      lines.push('')
      lines.push('---')
      lines.push('本报告由「每日复盘」自动生成，数据来自实时行情与本地账本，已写入审计台账链。')

      const rec = addReview(day, lines.join('\n'))
      const ar = appendRecord('audit', 'review.generate', { date: day, positions: positions.length, trades: todayTrades.length, watch: watch.length })
      rec.auditHash = ar.hash.slice(0, 16)
      addReview(day, rec.text, rec.auditHash)
      setReviews(loadReviews())
      s.log('review', `生成每日复盘 ${day}（持仓 ${positions.length} / 交易 ${todayTrades.length} 笔）`)
      toast.success('今日复盘已生成', { description: `审计链哈希 ${ar.hash.slice(0, 18)}…` })
    } catch (e) {
      toast.error('生成失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = (r: DailyReviewRec) => {
    deleteReview(r.id)
    setReviews(loadReviews())
    toast.success('已删除该篇复盘（审计链记录保留）')
  }

  return (
    <div>
      <PageHeader
        title="每日复盘"
        desc="一键汇总当日大盘、自选股、持仓盈亏、交易与推演动态，生成复盘报告并写入审计台账链。同一日期重复生成将覆盖旧稿。"
        extra={
          <Button onClick={generate} disabled={busy}>
            <RefreshCcw className={cn('h-4 w-4 mr-1', busy && 'animate-spin')} />
            {todayRec ? '重新生成今日复盘' : '生成今日复盘'}
          </Button>
        }
      />

      <Section title="复盘档案" desc={`共 ${reviews.length} 篇，保留最近 120 篇`}>
        {reviews.length === 0 ? (
          <div className="text-sm text-muted-foreground py-10 text-center">
            <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-40" />
            还没有复盘报告——点击右上角「生成今日复盘」
          </div>
        ) : (
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3 hover:bg-accent/50 transition-colors">
                <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.date}</span>
                    {r.date === today() && <Pill tone="blue">今日</Pill>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    生成于 {r.createdAt}{r.auditHash ? ` · 链上 ${r.auditHash.slice(0, 10)}…` : ''}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                  <Eye className="h-3.5 w-3.5 mr-1" />查看
                </Button>
                <Button size="sm" variant="ghost" title="删除该篇" onClick={() => remove(r)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>每日复盘 · {viewing?.date}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">{viewing?.text}</pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
