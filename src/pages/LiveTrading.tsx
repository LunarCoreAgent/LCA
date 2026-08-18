import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Lock, ShieldCheck, RefreshCcw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { loadPaper, paperStats } from '@/lib/paperTrading'
import { verifyChain, chainLength } from '@/lib/auditLedger'

// ===== 切换标准（写死，不开放配置；全部达标前执行器物理隐藏） =====
const CRITERIA = [
  { id: 'trades', name: '闭合成交笔数', threshold: '≥ 60 笔', target: 60 },
  { id: 'days', name: '观察期', threshold: '≥ 90 天（3 个月）', target: 90 },
  { id: 'winRate', name: '模拟胜率', threshold: '≥ 55%', target: 55 },
  { id: 'profitFactor', name: '盈亏比', threshold: '≥ 1.5', target: 1.5 },
  { id: 'drawdown', name: '最大回撤红线', threshold: '≤ 15%', target: 15, reverse: true },
  { id: 'deviation', name: '信号执行偏差', threshold: '< 5%', target: 5, reverse: true },
] as const

export default function LiveTrading() {
  const [tick, setTick] = useState(0)
  const acc = useMemo(() => loadPaper(), [tick])
  const stats = useMemo(() => paperStats(acc), [tick])
  const paperChainOk = useMemo(() => verifyChain('paper').ok || chainLength('paper') === 0, [tick])

  // 各标准当前值与进度
  const items = CRITERIA.map((c) => {
    let current: number | null = null
    let note = ''
    switch (c.id) {
      case 'trades':
        current = stats.closedTrades
        note = stats.closedTrades ? `已闭合 ${stats.closedTrades} 笔` : '尚无闭合回合'
        break
      case 'days':
        current = stats.observedDays
        note = stats.firstTradeDate ? `自首笔 ${stats.firstTradeDate} 起 ${stats.observedDays} 天` : '尚未开始观察'
        break
      case 'winRate':
        current = stats.winRate
        note = stats.winRate != null ? `当前 ${stats.winRate}%` : '样本不足'
        break
      case 'profitFactor':
        current = stats.profitFactor === Infinity ? 99 : stats.profitFactor
        note = stats.profitFactor != null ? (stats.profitFactor === Infinity ? '当前 ∞（无亏损回合）' : `当前 ${stats.profitFactor}`) : '样本不足'
        break
      case 'drawdown':
        current = stats.maxDrawdown
        note = stats.maxDrawdown != null ? `当前 ${stats.maxDrawdown}%` : '权益曲线不足两次快照'
        break
      case 'deviation':
        // 当前口径：信号日收盘价成交，理论偏差 0；接入盘中盯价后改按实际滑点统计
        current = stats.closedTrades > 0 ? 0 : null
        note = stats.closedTrades > 0 ? '按收盘价成交口径，偏差 0（盯价接入后按滑点统计）' : '尚无成交'
        break
    }
    const pass = current != null && ('reverse' in c && c.reverse ? current <= c.target : current >= c.target)
    const pct = current == null ? 0 : 'reverse' in c && c.reverse
      ? (current <= c.target ? 100 : Math.max(0, 100 - (current - c.target) * 10))
      : Math.min(100, (current / c.target) * 100)
    return { ...c, current, note, pass, pct }
  })

  const passedCount = items.filter((i) => i.pass).length
  const allPass = passedCount === CRITERIA.length

  return (
    <div>
      <PageHeader
        title="实盘网关"
        desc="观察级：模拟盘全指标达标前，实盘执行器物理隐藏。切换标准写死于代码，任何人无法在界面绕过。最终目标为券商实盘（A股 QMT/PTrade 需申请有门槛；美股 IBKR 无门槛）；不做高频、不做衍生品。"
        extra={
          <Button variant="outline" onClick={() => { setTick((t) => t + 1); toast.success('已按最新模拟盘数据重新评估') }}>
            <RefreshCcw className="h-4 w-4 mr-1" />重新评估
          </Button>
        }
      />

      <div className={cn('rounded-lg border p-4 mb-6 flex items-center gap-3', allPass ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
        {allPass ? <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" /> : <Lock className="h-5 w-5 text-amber-400 shrink-0" />}
        <div className="flex-1">
          <div className="font-medium">{allPass ? '全部标准已达标' : `观察期进行中：${passedCount}/${CRITERIA.length} 项达标`}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {allPass
              ? '模拟盘已满足全部切换标准，可进入券商开通流程（仍需人工申请与复核）'
              : '执行器保持隐藏；达标进度来自「模拟交易」真实账本与审计链，不可手工修改'}
          </div>
        </div>
        <Pill tone={paperChainOk ? 'green' : 'red'}>模拟交易链{paperChainOk ? '完整' : '校验失败'}</Pill>
      </div>

      <Section title="切换标准（写死）" desc="进度条实时反映模拟盘账本统计；任一不达标即保持观察级" className="mb-6">
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-3">
              <div className="w-28 shrink-0">
                <div className="text-sm">{i.name}</div>
                <div className="text-[10px] text-muted-foreground">{i.threshold}</div>
              </div>
              <Progress value={i.pct} className={cn('flex-1 h-2', i.pass && '[&>div]:bg-emerald-500')} />
              <div className="w-44 text-right">
                {i.pass ? <Pill tone="green">达标</Pill> : <Pill tone="amber">未达标</Pill>}
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={i.note}>{i.note}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {allPass ? (
        <Section title="开通流程（人工）" desc="执行器解锁不代表自动下单已开启——券商接入需你人工完成以下步骤" className="mb-6">
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border/60 p-3">
              <div className="font-medium">A股：QMT / PTrade（量化终端）</div>
              <p className="text-xs text-muted-foreground mt-1">向开户券商申请量化交易权限（多数券商有资产门槛，常见 50 万～100 万）；获批后由我们开发券商执行器插件接入，全部下单仍写入「实盘网关」审计链。</p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="font-medium">美股：IBKR（盈透证券）</div>
              <p className="text-xs text-muted-foreground mt-1">无资产门槛，TWS API 文档完备，适合作为首个实盘执行器；同样受审计链与风险中心红线约束。</p>
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">外挂式自动化（模拟点击券商客户端）属灰色地带，本系统明确不做。高频交易与衍生品（期权/期货）不在范围内：信号为日级，盘中仅有风控盯价。</p>
            </div>
          </div>
        </Section>
      ) : (
        <Section title="执行器（已隐藏）" desc="以下区域在全部切换标准达标前不渲染任何可操作控件" className="mb-6">
          <div className="py-10 text-center">
            <Lock className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">实盘执行器物理隐藏中</p>
            <p className="text-xs text-muted-foreground/70 mt-1">达标 {passedCount}/{CRITERIA.length} · 执行器不存在于当前渲染树，无入口、无快捷键、无隐藏接口</p>
          </div>
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        口径说明：笔数/胜率/盈亏比来自模拟盘 FIFO 闭合回合；回撤来自模拟盘权益曲线；执行偏差当前按「信号日收盘价成交」口径为 0，接入盘中盯价后改按实际滑点统计。所有统计可由审计链复核。
      </p>
    </div>
  )
}
