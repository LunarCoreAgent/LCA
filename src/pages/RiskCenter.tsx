import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ShieldAlert, RefreshCw, FileWarning } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fetchLiveQuotes, fetchDailyKline } from '@/lib/marketApi'
import { loadTrades, derivePositions } from '@/lib/trading'
import { loadPaper, paperStats } from '@/lib/paperTrading'
import { appendRecord } from '@/lib/auditLedger'
import { useStore } from '@/lib/store'

// ===== 风险规则（可配置，本地持久化） =====
interface RiskRules { maxWeight: number; stopLoss: number; maxDrawdown: number }
const RULES_KEY = 'agentcore-risk-rules-v1'
const DEFAULT_RULES: RiskRules = { maxWeight: 30, stopLoss: -8, maxDrawdown: 15 }

function loadRules(): RiskRules {
  try { return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(RULES_KEY) ?? '{}') } } catch { return DEFAULT_RULES }
}

// ===== 实盘组合权益快照（风险刷新时追加，回撤口径） =====
interface PortEquity { date: string; total: number }
const PE_KEY = 'agentcore-portfolio-equity-v1'
function loadPortEquity(): PortEquity[] {
  try { return JSON.parse(localStorage.getItem(PE_KEY) ?? '[]') } catch { return [] }
}
function appendPortEquity(total: number) {
  const date = new Date().toISOString().slice(0, 10)
  const list = loadPortEquity().filter((x) => x.date !== date)
  list.push({ date, total })
  list.sort((a, b) => a.date.localeCompare(b.date))
  localStorage.setItem(PE_KEY, JSON.stringify(list.slice(-250)))
}

interface RiskRow {
  code: string; name: string; weight: number | null; floatPct: number | null
  vol20: number | null   // 20 日年化波动率 %
  level: 'red' | 'amber' | 'green'
  issues: string[]
}

const levelPill = (lv: 'red' | 'amber' | 'green') =>
  lv === 'red' ? <Pill tone="red">高风险</Pill> : lv === 'amber' ? <Pill tone="amber">关注</Pill> : <Pill tone="green">正常</Pill>

export default function RiskCenter() {
  const s = useStore()
  const [rules, setRules] = useState<RiskRules>(() => loadRules())
  const [rows, setRows] = useState<RiskRow[]>([])
  const [drawdown, setDrawdown] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scannedAt, setScannedAt] = useState('')
  const paper = useMemo(() => paperStats(loadPaper()), [])

  const saveRules = (r: RiskRules) => {
    setRules(r)
    localStorage.setItem(RULES_KEY, JSON.stringify(r))
  }

  const scan = async () => {
    const positions = derivePositions(loadTrades())
    if (!positions.length) { toast.error('暂无实盘持仓（请先在「交易日志」记账）'); return }
    setScanning(true)
    try {
      const { quotes } = await fetchLiveQuotes(positions.map((p) => p.code), () => 'risk')
      const qm = new Map(quotes.map((q) => [q.code, q]))
      const valued = positions.map((p) => {
        const q = qm.get(p.code)
        const val = q ? q.close * p.netQty : p.netInvest
        return { p, q, val }
      })
      const total = valued.reduce((a, x) => a + x.val, 0)
      appendPortEquity(total)

      // 组合回撤（实盘权益快照）
      const eq = loadPortEquity()
      if (eq.length >= 2) {
        const peak = Math.max(...eq.map((x) => x.total))
        setDrawdown(+(((peak - total) / peak) * 100).toFixed(2))
      } else {
        setDrawdown(0)
      }

      // 逐票风险指标（波动率取 20 日 K，失败留空）
      const rs: RiskRow[] = []
      for (const { p, val } of valued) {
        const issues: string[] = []
        const weight = total > 0 ? (val / total) * 100 : null
        const floatPct = p.netInvest > 0 ? ((val - p.netInvest) / p.netInvest) * 100 : null
        let vol20: number | null = null
        try {
          const ks = await fetchDailyKline(p.code, 25)
          if (ks.length >= 21) {
            const rets: number[] = []
            for (let i = ks.length - 20; i < ks.length; i++) rets.push((ks[i].close - ks[i - 1].close) / ks[i - 1].close)
            const mean = rets.reduce((a, r) => a + r, 0) / rets.length
            const std = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1))
            vol20 = +(std * Math.sqrt(244) * 100).toFixed(1)
          }
        } catch { /* 波动率留空 */ }

        let level: RiskRow['level'] = 'green'
        if (weight != null && weight > rules.maxWeight) { level = 'red'; issues.push(`集中度 ${weight.toFixed(1)}% 超红线 ${rules.maxWeight}%`) }
        else if (weight != null && weight > rules.maxWeight * 0.8) { level = 'amber'; issues.push(`集中度 ${weight.toFixed(1)}% 接近红线`) }
        if (floatPct != null && floatPct < rules.stopLoss) { level = 'red'; issues.push(`浮亏 ${floatPct.toFixed(1)}% 破止损线 ${rules.stopLoss}%`) }
        else if (floatPct != null && floatPct < rules.stopLoss * 0.6) { if (level === 'green') level = 'amber'; issues.push(`浮亏 ${floatPct.toFixed(1)}% 接近止损线`) }
        if (vol20 != null && vol20 > 60) { if (level === 'green') level = 'amber'; issues.push(`20 日年化波动率 ${vol20}% 偏高`) }
        rs.push({ code: p.code, name: p.name, weight, floatPct, vol20, level, issues })
      }
      setRows(rs)
      setScannedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      const red = rs.filter((r) => r.level === 'red').length
      appendRecord('audit', 'risk.scan', { positions: rs.length, red, total: +total.toFixed(2), drawdown: loadPortEquity().length >= 2 ? drawdown : 0 })
      s.log('risk', `风险扫描完成：${rs.length} 只持仓，${red} 只触红线`)
      if (red) toast.warning(`风险扫描：${red} 只持仓触发红线`)
      else toast.success('风险扫描完成，无红线')
    } catch (e) {
      toast.error('风险扫描失败：' + (e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const overall = rows.some((r) => r.level === 'red') ? 'red' : rows.some((r) => r.level === 'amber') ? 'amber' : rows.length ? 'green' : null
  const ddBreach = drawdown != null && drawdown > rules.maxDrawdown

  return (
    <div>
      <PageHeader
        title="风险中心"
        desc="实时风险引擎：单票集中度 / 止损线 / 组合回撤 / 20 日波动率四路监控。红线可配置；扫描结果写入审计台账链。涨红跌绿为 A 股习惯配色，风险色单独标注。"
        extra={
          <Button onClick={scan} disabled={scanning}>
            <RefreshCw className={cn('h-4 w-4 mr-1', scanning && 'animate-spin')} />{scanning ? '扫描中…' : '运行风险扫描'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="组合风险状态"
          value={overall == null ? '未扫描' : overall === 'red' ? '高风险' : overall === 'amber' ? '关注' : '正常'}
          sub={scannedAt ? `扫描于 ${scannedAt}` : '点击右上角运行扫描'}
          icon={<ShieldAlert className={cn('h-4 w-4', overall === 'red' ? 'text-red-400' : overall === 'amber' ? 'text-amber-400' : 'text-muted-foreground')} />}
        />
        <StatCard
          label="组合回撤"
          value={drawdown != null ? drawdown.toFixed(2) + '%' : '-'}
          sub={<span className={ddBreach ? 'text-red-400' : ''}>红线 {rules.maxDrawdown}%{ddBreach ? ' · 已突破' : ''}</span>}
        />
        <StatCard
          label="模拟盘联动"
          value={paper.winRate != null ? `${paper.winRate}%` : '-'}
          sub={`模拟胜率 · 闭合 ${paper?.closedTrades ?? 0} 笔（切换标准底稿）`}
        />
        <StatCard
          label="模拟盘回撤"
          value={paper.maxDrawdown != null ? `${paper.maxDrawdown}%` : '-'}
          sub="权益曲线最大回撤"
        />
      </div>

      <Section title="风险红线" desc="修改即保存，下次扫描生效" className="mb-6">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">单票集中度上限（%）</Label>
            <Input type="number" value={rules.maxWeight} onChange={(e) => saveRules({ ...rules, maxWeight: parseFloat(e.target.value) || DEFAULT_RULES.maxWeight })} />
          </div>
          <div>
            <Label className="text-xs">止损线（浮亏 %）</Label>
            <Input type="number" value={rules.stopLoss} onChange={(e) => saveRules({ ...rules, stopLoss: parseFloat(e.target.value) || DEFAULT_RULES.stopLoss })} />
          </div>
          <div>
            <Label className="text-xs">组合回撤红线（%）</Label>
            <Input type="number" value={rules.maxDrawdown} onChange={(e) => saveRules({ ...rules, maxDrawdown: parseFloat(e.target.value) || DEFAULT_RULES.maxDrawdown })} />
          </div>
        </div>
      </Section>

      <Section title="逐票风险" desc="集中度与浮亏按实时市值计算；波动率为 20 日日收益标准差年化（√244）">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-40" />
            尚未扫描——点击「运行风险扫描」对实盘持仓做四路检查
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标的</TableHead>
                <TableHead className="text-right">集中度</TableHead>
                <TableHead className="text-right">浮动盈亏</TableHead>
                <TableHead className="text-right">20日波动率</TableHead>
                <TableHead>风险等级</TableHead>
                <TableHead>触发项</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell>
                    <div>{r.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{r.code}</div>
                  </TableCell>
                  <TableCell className={cn('text-right', r.weight != null && r.weight > rules.maxWeight && 'text-red-400 font-medium')}>
                    {r.weight != null ? r.weight.toFixed(1) + '%' : '-'}
                  </TableCell>
                  <TableCell className={cn('text-right', r.floatPct != null && r.floatPct < rules.stopLoss ? 'text-red-400 font-medium' : (r.floatPct ?? 0) >= 0 ? 'text-red-400' : 'text-emerald-400')}>
                    {r.floatPct != null ? (r.floatPct >= 0 ? '+' : '') + r.floatPct.toFixed(2) + '%' : '-'}
                  </TableCell>
                  <TableCell className="text-right">{r.vol20 != null ? r.vol20.toFixed(1) + '%' : '-'}</TableCell>
                  <TableCell>{levelPill(r.level)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.issues.join('；') || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <p className="text-xs text-muted-foreground mt-4">
        说明：风险中心为监控与预警工具，不执行任何交易动作；止损/减仓决策由你人工确认后在券商端执行。扫描历史见审计台账链（risk.scan）。
      </p>
    </div>
  )
}
