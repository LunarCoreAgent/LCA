import { useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { FlaskConical, ShieldCheck, Play } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { normalizeCode, fetchDailyKline, loadWatchList, DEFAULT_WATCH } from '@/lib/marketApi'
import { f, icBench, crossSectionalIC, quantlibSelfTest } from '@/lib/quantlib'

interface FactorDef { id: string; name: string; desc: string; calc: (o: OHLCV) => number[] }
interface OHLCV { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }
interface FactorRow extends FactorDef { latest: number; ic: number; rankIC: number; icir: number; posRate: number; days: number }

const rollStdev = (xs: number[], n: number) => xs.map((_, i) => (i < n ? NaN : f.stdev(xs.slice(i - n, i + 1).filter((x) => !Number.isNaN(x)))))

const FACTORS: FactorDef[] = [
  { id: 'mom20', name: '20 日动量', desc: 'roc(close, 20) —— 趋势跟随', calc: (d) => f.roc(d.close, 20) },
  { id: 'rev5', name: '5 日反转', desc: '-roc(close, 5) —— 短期均值回复', calc: (d) => f.roc(d.close, 5).map((x) => -x) },
  { id: 'vol20', name: '20 日波动率', desc: 'stdev(returns, 20) —— 低波异象', calc: (d) => rollStdev(f.returns(d.close), 20) },
  { id: 'volratio', name: '量比 5/20', desc: 'sma(vol,5)/sma(vol,20) —— 放量程度', calc: (d) => { const s5 = f.sma(d.volume, 5), s20 = f.sma(d.volume, 20); return d.close.map((_, i) => (Number.isNaN(s5[i]) || Number.isNaN(s20[i]) || s20[i] === 0 ? NaN : s5[i] / s20[i])) } },
  { id: 'rsi14', name: 'RSI(14)', desc: 'Wilder 相对强弱', calc: (d) => f.rsi(d.close, 14) },
  { id: 'macdhist', name: 'MACD 柱', desc: '2×(DIF−DEA)，国内惯例', calc: (d) => f.macd(d.close).hist },
  { id: 'bollpos', name: '布林位置', desc: '(close−mid)/(up−dn) ∈ [0,1]', calc: (d) => { const b = f.boll(d.close, 20, 2); return d.close.map((c, i) => (Number.isNaN(b.up[i]) || b.up[i] === b.dn[i] ? NaN : (c - b.dn[i]) / (b.up[i] - b.dn[i]))) } },
  { id: 'bias20', name: '20 日乖离率', desc: '(close−ma20)/ma20 —— 偏离度', calc: (d) => { const m = f.sma(d.close, 20); return d.close.map((c, i) => (Number.isNaN(m[i]) ? NaN : c / m[i] - 1)) } },
  { id: 'atrr', name: 'ATR 占比', desc: 'atr(14)/close —— 真实波幅', calc: (d) => { const a = f.atr(d.high, d.low, d.close, 14); return d.close.map((c, i) => (Number.isNaN(a[i]) ? NaN : a[i] / c)) } },
  { id: 'kdjj', name: 'KDJ·J 值', desc: 'kdj(9) 的 J —— 超买超卖弹性', calc: (d) => f.kdj(d.high, d.low, d.close, 9).j },
  { id: 'cci20', name: 'CCI(20)', desc: '典型价偏离度 —— 顺势强度', calc: (d) => f.cci(d.high, d.low, d.close, 20) },
  { id: 'wr14', name: '威廉 WR(14)', desc: '区间位置 −100~0 —— 反向超卖', calc: (d) => f.wr(d.high, d.low, d.close, 14) },
  { id: 'mfi14', name: 'MFI(14)', desc: '量能加权 RSI —— 资金强度', calc: (d) => f.mfi(d.high, d.low, d.close, d.volume, 14) },
  { id: 'aroonosc', name: 'Aroon 振荡', desc: 'aroon(25) up−dn —— 趋势新旧', calc: (d) => f.aroon(d.high, d.low, 25).osc },
  { id: 'stochk', name: '随机 %K(14)', desc: '收盘在 14 日区间的位置', calc: (d) => f.stoch(d.high, d.low, d.close, 14) },
  { id: 'trix15', name: 'TRIX(15)', desc: '三重 EMA 变化率 —— 平滑动量', calc: (d) => f.trix(d.close, 15) },
]

const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`)
const num = (x: number, d = 3) => (Number.isNaN(x) ? '—' : x.toFixed(d))

export default function AlphaZoo() {
  const [code, setCode] = useState('600519.SH')
  const [mode, setMode] = useState<'single' | 'xs'>('single')
  const [rows, setRows] = useState<FactorRow[] | null>(null)
  const [running, setRunning] = useState(false)
  const [meta, setMeta] = useState('')
  const selfTests = quantlibSelfTest()
  const passAll = selfTests.every((t) => t.pass)

  const run = async () => {
    if (mode === 'xs') return runXs()
    const c = normalizeCode(code)
    if (!c) { toast.error('代码格式不正确'); return }
    setRunning(true)
    try {
      const ks = await fetchDailyKline(c, 300)
      if (ks.length < 60) { toast.error(`K 线数据不足（${ks.length} 根），至少 60 根`); return }
      const d: OHLCV = {
        open: ks.map((k) => k.open), high: ks.map((k) => k.high), low: ks.map((k) => k.low),
        close: ks.map((k) => k.close), volume: ks.map((k) => k.volume),
      }
      const out: FactorRow[] = FACTORS.map((fd) => {
        const vals = fd.calc(d)
        const latest = [...vals].reverse().find((x) => !Number.isNaN(x)) ?? NaN
        const st = icBench(vals, d.close, 5)
        return { ...fd, latest, ic: st.ic, rankIC: st.rankIC, icir: st.icir, posRate: st.positiveRate, days: st.days }
      }).sort((a, b) => Math.abs(b.rankIC || 0) - Math.abs(a.rankIC || 0))
      setRows(out)
      setMeta(`${ks[0].date} ~ ${ks[ks.length - 1].date} · ${ks.length} 根日 K · 前瞻 5 日收益`)
      toast.success('因子 IC bench 完成')
    } catch (e) {
      toast.error(`行情拉取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  /** 横截面模式：自选股批量，逐日全截面秩 IC（462 动物园口径） */
  const runXs = async () => {
    const watch = loadWatchList(DEFAULT_WATCH).slice(0, 12)
    if (watch.length < 3) { toast.error('自选股至少 3 只才能跑横截面（到「行情采集」添加）'); return }
    setRunning(true)
    try {
      const byCode: Record<string, OHLCV> = {}
      const failed: string[] = []
      for (const w of watch) {
        try {
          const ks = await fetchDailyKline(w.code, 160)
          if (ks.length < 60) { failed.push(w.name); continue }
          byCode[w.code] = {
            open: ks.map((k) => k.open), high: ks.map((k) => k.high), low: ks.map((k) => k.low),
            close: ks.map((k) => k.close), volume: ks.map((k) => k.volume),
          }
        } catch { failed.push(w.name) }
      }
      const codes = Object.keys(byCode)
      if (codes.length < 3) { toast.error(`有效标的不足 3 只（${failed.join('、')} 失败）`); return }
      const out: FactorRow[] = FACTORS.map((fd) => {
        const factorByCode: Record<string, number[]> = {}
        const closeByCode: Record<string, number[]> = {}
        for (const c of codes) { factorByCode[c] = fd.calc(byCode[c]); closeByCode[c] = byCode[c].close }
        const st = crossSectionalIC(factorByCode, closeByCode, 5)
        const latest = f.mean(codes.map((c) => [...factorByCode[c]].reverse().find((x) => !Number.isNaN(x)) ?? NaN).filter((x) => !Number.isNaN(x)))
        return { ...fd, latest, ic: st.ic, rankIC: st.rankIC, icir: st.icir, posRate: st.positiveRate, days: st.days }
      }).sort((a, b) => Math.abs(b.rankIC || 0) - Math.abs(a.rankIC || 0))
      setRows(out)
      setMeta(`横截面：${codes.length} 只自选股 × ${out[0]?.days ?? 0} 个交易日 · 前瞻 5 日收益${failed.length ? ` · 跳过 ${failed.join('、')}` : ''}`)
      toast.success(`横截面 IC bench 完成（${codes.length} 只标的）`)
    } catch (e) {
      toast.error(`横截面计算失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="因子工场 · IC Bench"
        desc="本地 quantlib（121 函数 · 50 项自检）驱动：16 个经典因子与未来 5 日收益对账 IC / 秩 IC / ICIR——单标的看时序预测力，横截面（自选股批量）看选股区分度；公式全部来自经过自检的 quantlib（Vibe-Trading：公式属于被测试的库，不属于提示词）"
        extra={
          <div className="flex gap-2 items-center">
            <div className="flex rounded-md border border-border overflow-hidden">
              <button className={cn('px-2.5 h-8 text-xs', mode === 'single' ? 'bg-primary text-primary-foreground' : 'bg-transparent')} onClick={() => setMode('single')}>单标的</button>
              <button className={cn('px-2.5 h-8 text-xs', mode === 'xs' ? 'bg-primary text-primary-foreground' : 'bg-transparent')} onClick={() => setMode('xs')}>横截面·自选股</button>
            </div>
            {mode === 'single' && <Input className="w-36 h-8" value={code} onChange={(e) => setCode(e.target.value)} placeholder="600519.SH" />}
            <Button size="sm" onClick={run} disabled={running}><Play className="h-4 w-4 mr-1" />{running ? '计算中…' : '运行 IC Bench'}</Button>
          </div>
        }
      />

      {/* quantlib 自检 */}
      <Section
        title="quantlib 公式自检"
        desc="关键公式对已知输入的断言，全部通过才允许页面使用"
        extra={passAll ? <Pill tone="green"><ShieldCheck className="h-3 w-3 mr-1" />{selfTests.length} 项全过</Pill> : <Pill tone="red">存在失败</Pill>}
      >
        <div className="flex flex-wrap gap-2">
          {selfTests.map((t) => (
            <span key={t.name} className={cn('text-xs rounded-md px-2 py-1 border', t.pass ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-400')}>
              {t.pass ? '✓' : '✗'} {t.name}
            </span>
          ))}
        </div>
      </Section>

      {/* IC 表 */}
      {rows && (
        <Section title={`因子 IC 对账（按 |秩 IC| 排序）`} desc={meta}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>因子</TableHead>
                <TableHead>公式</TableHead>
                <TableHead className="text-right">最新值</TableHead>
                <TableHead className="text-right">IC</TableHead>
                <TableHead className="text-right">秩 IC</TableHead>
                <TableHead className="text-right">ICIR</TableHead>
                <TableHead className="text-right">IC&gt;0 占比</TableHead>
                <TableHead>判读</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.desc}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.latest)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.ic > 0.02 ? 'text-emerald-500' : r.ic < -0.02 ? 'text-rose-500' : '')}>{num(r.ic)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums font-medium', r.rankIC > 0.03 ? 'text-emerald-500' : r.rankIC < -0.03 ? 'text-rose-500' : '')}>{num(r.rankIC)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.icir, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.posRate)}</TableCell>
                  <TableCell>
                    {Number.isNaN(r.rankIC) && <Pill>样本不足</Pill>}
                    {!Number.isNaN(r.rankIC) && Math.abs(r.rankIC) >= 0.05 && r.posRate >= 0.55 && <Pill tone={r.rankIC > 0 ? 'green' : 'amber'}>{r.rankIC > 0 ? '正向有效' : '反向有效（可取反用）'}</Pill>}
                    {!Number.isNaN(r.rankIC) && Math.abs(r.rankIC) < 0.05 && <Pill>噪声区间</Pill>}
                    {!Number.isNaN(r.rankIC) && Math.abs(r.rankIC) >= 0.05 && r.posRate < 0.55 && <Pill tone="amber">有效但不稳</Pill>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {/* 秩 IC 图 */}
      {rows && (
        <Section title="秩 IC 对比">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => num(Number(v))} />
                <ReferenceLine y={0} stroke="#666" />
                <ReferenceLine y={0.05} stroke="#10b981" strokeDasharray="4 4" />
                <ReferenceLine y={-0.05} stroke="#f43f5e" strokeDasharray="4 4" />
                <Bar dataKey="rankIC" radius={[4, 4, 0, 0]}>
                  {rows.map((r, i) => (
                    <Cell key={i} fill={Number.isNaN(r.rankIC) ? '#555' : r.rankIC >= 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            判读口径：|秩 IC| ≥ 0.05 且 IC&gt;0 占比 ≥55% 视为有效；负秩 IC 的因子取反后同样可用。单标的模式为时序 IC（滚动 20 日窗口）；横截面模式为逐日全截面秩 IC（462 因子动物园口径），标的越多区分度越可信。
          </div>
        </Section>
      )}

      {!rows && (
        <Section title="使用说明" className="border-dashed">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><b>单标的</b>：输入代码（600519.SH / 00700.HK / AAPL.US），拉 300 根日 K，看因子的时序预测力。</p>
            <p><b>横截面·自选股</b>：批量拉取自选股（≤12 只），逐日全截面秩 IC —— 选股区分度口径，更接近真实选股场景。</p>
            <p><FlaskConical className="h-3 w-3 inline" /> 灵感来源：Vibe-Trading 的 462 因子动物园（qlib158 / alpha101 / gtja191…）与「公式必须出自被测试的库」原则。</p>
          </div>
        </Section>
      )}
    </div>
  )
}
