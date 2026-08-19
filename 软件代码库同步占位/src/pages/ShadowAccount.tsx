import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { ScanSearch, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fmtMoney } from '@/lib/trading'
import { fetchDailyKline } from '@/lib/marketApi'
import { diagnoseFromStorage, chasePanicAnalysis, type ChaseItem } from '@/lib/shadow'
import { extractRules, shadowBacktest, type RuleFinding, type ShadowSim } from '@/lib/shadowRules'

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export default function ShadowAccount() {
  const report = useMemo(() => diagnoseFromStorage(), [])
  const [chase, setChase] = useState<ChaseItem[] | null>(null)
  const [rules, setRules] = useState<RuleFinding[] | null>(null)
  const [sims, setSims] = useState<ShadowSim[] | null>(null)
  const [scanning, setScanning] = useState(false)

  const runChase = async () => {
    if (report.trips.length === 0) { toast.error('没有闭合回合可分析'); return }
    setScanning(true)
    try {
      const kf = async (code: string) => {
        const ks = await fetchDailyKline(code, 260)
        return ks.map((k) => ({ date: k.date, close: k.close }))
      }
      const items = await chasePanicAnalysis(report.trips, kf)
      setChase(items)
      setRules(extractRules(items))
      setSims(await shadowBacktest(items, kf))
      const chaseN = items.filter((i) => i.chase).length
      const panicN = items.filter((i) => i.panic).length
      if (chaseN + panicN > 0) toast.warning(`追高 ${chaseN} 次 / 恐慌割肉 ${panicN} 次`)
      else toast.success('未发现明显追涨杀跌')
    } catch (e) {
      toast.error(`行情拉取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setScanning(false)
    }
  }

  const scoreColor = report.score >= 80 ? 'text-emerald-500' : report.score >= 60 ? 'text-amber-500' : 'text-rose-500'

  return (
    <div className="space-y-6">
      <PageHeader
        title="影子账户 · 行为诊断"
        desc="从交易日志推导你的交易人格：胜率、盈亏比、处置效应、报复性交易、追涨杀跌；一键提取可复现的行为规则并在历史 K 线上做影子回测 —— 思路借鉴 Vibe-Trading Shadow Account（行为 → 规则 → 影子回测）"
        extra={
          <Button size="sm" variant="outline" onClick={runChase} disabled={scanning}>
            <ScanSearch className="h-4 w-4 mr-1" />{scanning ? '正在拉取行情…' : '规则提取 + 影子回测'}
          </Button>
        }
      />

      {/* 行为分 + 评语 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="行为纪律分" className="flex flex-col items-center justify-center">
          <div className={cn('text-6xl font-bold tabular-nums', scoreColor)}>{report.score}</div>
          <div className="text-xs text-muted-foreground mt-2">{report.trips.length} 个闭合回合 · {pct(report.winRate)} 胜率</div>
        </Section>
        <Section title="诊断结论" className="lg:col-span-2">
          <div className="space-y-2">
            {report.verdicts.map((v, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {v.level === 'good' && <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />}
                {v.level === 'warn' && <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />}
                {v.level === 'bad' && <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />}
                <span>{v.text}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* 六项核心指标 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="闭合盈亏" value={fmtMoney(report.closedPnl)} icon={report.closedPnl >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-rose-500" />} />
        <StatCard label="胜率" value={pct(report.winRate)} />
        <StatCard label="盈亏比" value={report.profitFactor === null ? '—' : report.profitFactor.toFixed(2)} />
        <StatCard label="盈利单均持" value={`${report.avgHoldWin.toFixed(1)} 天`} />
        <StatCard label="亏损单均持" value={`${report.avgHoldLoss.toFixed(1)} 天`} sub={report.disposition !== null && report.disposition > 5 ? '处置效应' : undefined} />
        <StatCard label="月均交易" value={report.tradesPerMonth.toFixed(1)} sub={report.tradesPerMonth > 20 ? '过度交易' : undefined} />
      </div>

      {/* 月度盈亏 */}
      {report.monthly.length > 0 && (
        <Section title="月度闭合盈亏">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.monthly}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {report.monthly.map((m, i) => (
                    <Cell key={i} fill={m.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* 追涨杀跌结果 */}
      {chase && (
        <Section title="追涨杀跌扫描（近 20 日区间分位）">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标的</TableHead>
                <TableHead>买入日 / 分位</TableHead>
                <TableHead>卖出日 / 分位</TableHead>
                <TableHead>盈亏</TableHead>
                <TableHead>标记</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chase.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{c.trip.name}<span className="text-xs text-muted-foreground ml-1">{c.trip.code}</span></TableCell>
                  <TableCell>{c.trip.buyDate}{c.buyPct !== null && <span className={cn('ml-1 text-xs', c.chase ? 'text-rose-500' : 'text-muted-foreground')}>{pct(c.buyPct)}</span>}</TableCell>
                  <TableCell>{c.trip.sellDate}{c.sellPct !== null && <span className={cn('ml-1 text-xs', c.panic ? 'text-rose-500' : 'text-muted-foreground')}>{pct(c.sellPct)}</span>}</TableCell>
                  <TableCell className={c.trip.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}>{fmtMoney(c.trip.pnl)}</TableCell>
                  <TableCell>
                    {c.chase && <Pill tone="red">追高买入</Pill>}
                    {c.panic && <Pill tone="red">恐慌割肉</Pill>}
                    {!c.chase && !c.panic && <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {/* 行为规则 */}
      {rules && rules.length > 0 && (
        <Section title="行为规则提取（IF-THEN）" desc="从你的闭合回合中挖掘可复现模式；样本 ≥3 才定性">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rules.map((r) => (
              <div key={r.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{r.title}</span>
                  {r.profitable === null && <Pill>样本不足</Pill>}
                  {r.profitable === true && <Pill tone="green">赚钱模式</Pill>}
                  {r.profitable === false && <Pill tone="red">亏钱模式</Pill>}
                </div>
                <div className="text-xs text-muted-foreground mb-2">{r.condition}</div>
                <div className="text-xs">{r.conclusion}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  {r.support} 笔 · 合计 {fmtMoney(r.sumPnl)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 影子回测 */}
      {sims && sims.length > 0 && (
        <Section title="影子回测：真人操作 vs 机械执行" desc="把规则在历史 K 线上机械重放，盈亏变化为正 = 机械执行更好">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>机械规则</TableHead>
                <TableHead>模拟口径</TableHead>
                <TableHead className="text-right">影响回合</TableHead>
                <TableHead className="text-right">盈亏变化</TableHead>
                <TableHead>解读</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sims.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px]">{s.detail}</TableCell>
                  <TableCell className="text-right">{s.affected}</TableCell>
                  <TableCell className={cn('text-right font-medium', s.deltaPnl >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                    {s.deltaPnl >= 0 ? '+' : ''}{fmtMoney(s.deltaPnl)}
                  </TableCell>
                  <TableCell className="text-xs">{s.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {/* 回合明细 */}
      <Section title="闭合回合明细（FIFO 配对，近 50 条）">
        {report.trips.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            暂无闭合回合 —— 去「交易日志」记录完整的买入与卖出后，这里会自动生成行为画像
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标的</TableHead>
                <TableHead>买入 → 卖出</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">持有天数</TableHead>
                <TableHead className="text-right">收益率</TableHead>
                <TableHead className="text-right">盈亏</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.trips.slice(0, 50).map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{t.name}<span className="text-xs text-muted-foreground ml-1">{t.code}</span></TableCell>
                  <TableCell className="text-xs">{t.buyDate} → {t.sellDate}</TableCell>
                  <TableCell className="text-right">{t.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{t.holdDays}</TableCell>
                  <TableCell className={cn('text-right', t.ret >= 0 ? 'text-emerald-500' : 'text-rose-500')}>{pct(t.ret)}</TableCell>
                  <TableCell className={cn('text-right font-medium', t.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500')}>{fmtMoney(t.pnl)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="v0.13.0 预告" className="border-dashed">
        <div className="text-xs text-muted-foreground">
          TS 量化函数库（把已验证的收益/风险/技术指标公式沉淀为本地 quantlib，页面与 Agent 同用一套经过测试的公式）+ 462 因子动物园工作台（因子 IC  bench，衡量信号真实预测力）。
        </div>
      </Section>
    </div>
  )
}
