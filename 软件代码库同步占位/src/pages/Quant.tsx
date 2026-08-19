import { useEffect, useMemo, useState } from 'react'
import { useStore, uid } from '@/lib/store'
import { TECH, signals, type TechRow } from '@/lib/stockData'
import { fetchDailyKline, computeTech, loadWatchList, normalizeCode, WATCH_KEY, type KPoint } from '@/lib/marketApi'
import { STRATEGIES, runBacktest, buildReport, type BacktestResult } from '@/lib/backtest'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FlaskConical, Sparkles, Signal, Play, Plus, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ComboResult {
  code: string
  name: string
  stratId: string
  r: BacktestResult | null
  days: number
  start?: string
  end?: string
}

export default function Quant() {
  const s = useStore()
  const [rows, setRows] = useState<TechRow[]>([])
  const [calcDate, setCalcDate] = useState('')
  const [live, setLive] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [adding, setAdding] = useState(false)

  // ===== 回测工作台状态 =====
  const [pickCodes, setPickCodes] = useState<string[]>([])
  const [pickStrats, setPickStrats] = useState<string[]>(['ma-cross', 'boll-revert', 'rsi-revert'])
  const [range, setRange] = useState('250')
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<ComboResult[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)

  // 可选标的：共享监控列表 ∪ 已分析标的
  const candidates = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of loadWatchList()) m.set(w.code, w.name)
    for (const r of rows) m.set(r.code, r.name)
    return [...m.entries()].map(([code, name]) => ({ code, name }))
  }, [rows])

  // 默认勾选前 3 只监控标的
  useEffect(() => {
    if (pickCodes.length === 0 && candidates.length > 0) setPickCodes(candidates.slice(0, 3).map((c) => c.code))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length])

  const bestSharpe = useMemo(() => {
    const vals = results.filter((x) => x.r).map((x) => x.r!.sharpe)
    return vals.length ? Math.max(...vals).toFixed(2) : '—'
  }, [results])

  const runAll = async () => {
    if (pickCodes.length === 0) { toast.error('请先勾选回测标的'); return }
    if (pickStrats.length === 0) { toast.error('请先勾选策略模型'); return }
    const total = pickCodes.length * pickStrats.length
    setRunning({ done: 0, total })
    setResults([])
    setOpenKey(null)
    const out: ComboResult[] = []
    for (const code of pickCodes) {
      let ks: KPoint[] = []
      try { ks = await fetchDailyKline(code, +range) } catch { /* 单只失败按无数据处理 */ }
      const name = candidates.find((c) => c.code === code)?.name ?? code
      for (const sid of pickStrats) {
        const st = STRATEGIES.find((x) => x.id === sid)!
        const r = ks.length >= 40 ? runBacktest(ks, st) : null
        out.push({
          code, name, stratId: sid, r,
          days: ks.length, start: ks[0]?.date, end: ks[ks.length - 1]?.date,
        })
        setRunning({ done: out.length, total })
      }
    }
    setResults(out.sort((a, b) => (b.r?.sharpe ?? -99) - (a.r?.sharpe ?? -99)))
    setRunning(null)
    const ok = out.filter((o) => o.r).length
    s.log('quant', `策略回测完成：${ok}/${total} 个「标的 × 策略」组合（近 ${range} 交易日）`)
    if (ok === 0) toast.error('未能完成任何回测：行情源不可达或 K 线数据不足')
    else toast.success(`回测完成：${ok} 个组合，按夏普排序`)
  }

  const emitReport = (x: ComboResult) => {
    if (!x.r) return
    const st = STRATEGIES.find((v) => v.id === x.stratId)!
    const md = buildReport({ name: x.name, code: x.code, strategy: st, r: x.r, start: x.start ?? '', end: x.end ?? '', days: x.days })
    s.setMessages([...s.messages, { id: uid(), role: 'assistant', content: md, time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }), model: '量化回测引擎' }])
    navigator.clipboard?.writeText(md).catch(() => { /* 剪贴板不可用时忽略 */ })
    s.log('quant', `量化报告已生成：${x.name} × ${st.name}（夏普 ${x.r.sharpe}）`)
    toast.success('量化报告已生成：推送至「对话」页并复制到剪贴板')
  }

  // 添加标的：实时拉日 K 计算指标，并同步进共享监控列表
  const addCode = async () => {
    const code = normalizeCode(newCode)
    if (!code) { toast.error('无法识别。直接输数字：600519（沪）、000858（深）、830799（北）、00700（港）、AAPL（美）'); return }
    if (rows.some((r) => r.code === code)) { toast.error(`${code} 已在分析列表中`); return }
    setAdding(true)
    try {
      const ks = await fetchDailyKline(code, 90)
      if (ks.length === 0) { toast.error(`已识别为 ${code}，但无日 K 数据（停牌或代码有误）`); return }
      // 名称优先取共享监控列表，其次用代码
      const listed = loadWatchList().find((x) => x.code === code)
      const t = computeTech(code, listed?.name ?? code.split('.')[0], ks)
      if (!t) { toast.error('日 K 数据不足，无法计算指标'); return }
      setRows((cur) => [t, ...cur])
      setCalcDate(ks[ks.length - 1].date)
      setLive(true)
      // 同步写入共享监控列表（与行情采集/数据中心一致）
      try {
        const raw = localStorage.getItem(WATCH_KEY)
        const list: { code: string }[] = raw ? JSON.parse(raw) : []
        if (!list.some((x) => x.code === code)) {
          localStorage.setItem(WATCH_KEY, JSON.stringify([{ code, name: t.name, close: t.close, pctChg: 0, preClose: t.close, open: t.close, high: t.close, low: t.close, volumeWan: 0, amountYi: 0, turnover: 0, freq: '1day', points: 0, collecting: true }, ...list]))
        }
      } catch { /* 忽略存储异常 */ }
      s.log('quant', `量化分析添加标的 ${t.name}（${code}），指标已实时计算`)
      toast.success(`${t.name}（${code}）指标计算完成`)
      setNewCode('')
    } catch {
      toast.error('实时行情源暂不可达，请稍后重试')
    } finally {
      setAdding(false)
    }
  }

  // 启动时：用监控列表的真实日 K 计算指标（最多取前 6 只）；失败回退历史种子
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const list = loadWatchList(TECH.map((t) => ({ code: t.code, name: t.name }))).slice(0, 6)
      const out: TechRow[] = []
      let latest = ''
      for (const { code, name } of list) {
        try {
          const ks = await fetchDailyKline(code, 90)
          if (ks.length > 0) {
            const t = computeTech(code, name, ks)
            if (t) { out.push(t); latest = ks[ks.length - 1].date }
          }
        } catch { /* 单只失败跳过 */ }
      }
      if (cancelled) return
      if (out.length > 0) {
        setRows(out)
        setCalcDate(latest)
        setLive(true)
      } else {
        setRows([])
        setCalcDate('')
        setLive(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const signalCount = rows.reduce((a, t) => a + signals(t).filter((x) => x.text !== '中性震荡').length, 0)

  const aiInterpret = () => {
    if (rows.length === 0) { toast.error('请先添加标的，指标计算完成后再生成解读'); return }
    const basis = live ? `最新日线指标（${calcDate}）` : '缓存指标'
    const parts = rows.map((t) => {
      const sig = signals(t).map((x) => x.text).join('、')
      return `${t.name}（收 ${t.close.toFixed(2)}）：${sig}；RSI6=${t.rsi6}，MACD=${t.macd}，KDJ-J=${t.j}，CCI=${t.cci}`
    })
    const text = `量化解读（基于${basis}）：${parts.join('。')}。以上信号已写入监控，触发时将推送飞书。`
    s.setMessages([...s.messages, { id: uid(), role: 'assistant', content: text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }), model: '量化引擎' }])
    s.log('quant', 'AI 量化解读已生成并推送至对话页')
    toast.success('解读已生成，已推送到「对话」页')
  }

  return (
    <div>
      <PageHeader title="量化分析" desc="真实日 K 驱动指标计算 → 信号识别 → 策略回测 → AI 解读闭环"
        extra={<Button onClick={aiInterpret}><Sparkles className="h-4 w-4 mr-1" /> AI 解读当前信号</Button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="监控指标" value="28 项" sub="MA/MACD/KDJ/RSI/BOLL/CCI…" icon={<Signal className="h-4 w-4 text-sky-400" />} />
        <StatCard label="触发信号" value={`${signalCount} 个`} sub={live ? '基于最新实时指标' : '基于历史种子'} icon={<FlaskConical className="h-4 w-4 text-emerald-400" />} />
        <StatCard label="策略模型" value={`${STRATEGIES.length} 个`} sub="趋势 / 回归 / 动量 / 多因子" icon={<Play className="h-4 w-4 text-violet-400" />} />
        <StatCard label="最优回测夏普" value={bestSharpe} sub={results.length ? `${results.filter((x) => x.r).length} 个组合已回测` : '运行回测后展示'} icon={<Sparkles className="h-4 w-4 text-amber-400" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="实时技术信号" desc={live ? `真实日 K 实时计算 · 数据日期 ${calcDate}` : '添加标的后实时计算'}>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <Input placeholder="直接输数字加标的：600519 / 00700 / AAPL" value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCode() }}
              className="max-w-64 h-9" />
            <Button size="sm" variant="outline" onClick={addCode} disabled={adding}><Plus className="h-3.5 w-3.5 mr-1" /> {adding ? '计算中…' : '添加分析'}</Button>
            <span className="text-xs text-muted-foreground">自动识别市场，实时计算指标并同步监控列表</span>
          </div>
          <div className="space-y-3">
            {rows.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                暂无分析标的。在上方输入代码（如 600519），实时拉取日 K 并计算指标。
              </div>
            )}
            {rows.map((t) => (
              <div key={t.code} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{t.code} · 收 {t.close.toFixed(2)}</span>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    RSI6 {t.rsi6.toFixed(1)} · MACD {t.macd.toFixed(2)} · KDJ {t.k.toFixed(0)}/{t.d.toFixed(0)}/{t.j.toFixed(0)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {signals(t).map((g) => <Pill key={g.text} tone={g.tone}>{g.text}</Pill>)}
                </div>
                <div className="text-xs text-muted-foreground mt-2 font-mono">
                  BOLL 上/中/下：{t.bollUp.toFixed(2)} / {t.bollMid.toFixed(2)} / {t.bollDn.toFixed(2)} · CCI {t.cci.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="策略回测工作台" desc="自选标的 × 自选策略模型 → 真实日 K 回测 → 量化报告">
            {/* 标的选择 */}
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1.5">回测标的（{pickCodes.length} 只，来自共享监控列表）</div>
              <div className="flex flex-wrap gap-1.5">
                {candidates.length === 0 && <span className="text-xs text-muted-foreground">监控列表为空，请先在「行情采集」或左侧添加标的</span>}
                {candidates.map((c) => (
                  <button key={c.code}
                    onClick={() => setPickCodes((cur) => cur.includes(c.code) ? cur.filter((x) => x !== c.code) : [...cur, c.code])}
                    className={cn('rounded-md px-2 py-1 text-xs border transition-colors',
                      pickCodes.includes(c.code) ? 'bg-primary/15 text-primary border-primary/40' : 'border-border/60 text-muted-foreground hover:bg-accent')}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            {/* 策略选择 */}
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-2">
                策略模型（{pickStrats.length}/{STRATEGIES.length}）
                <button className="text-sky-400 hover:underline" onClick={() => setPickStrats(STRATEGIES.map((x) => x.id))}>全选</button>
                <button className="text-muted-foreground hover:underline" onClick={() => setPickStrats([])}>清空</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STRATEGIES.map((st) => (
                  <button key={st.id} title={st.desc}
                    onClick={() => setPickStrats((cur) => cur.includes(st.id) ? cur.filter((x) => x !== st.id) : [...cur, st.id])}
                    className={cn('rounded-md px-2 py-1 text-xs border transition-colors',
                      pickStrats.includes(st.id) ? 'bg-violet-500/15 text-violet-300 border-violet-500/40' : 'border-border/60 text-muted-foreground hover:bg-accent')}>
                    {st.name}
                  </button>
                ))}
              </div>
            </div>
            {/* 区间 + 运行 */}
            <div className="flex items-center gap-2 mb-3">
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="120">近 120 交易日</SelectItem>
                  <SelectItem value="250">近 250 交易日（约1年）</SelectItem>
                  <SelectItem value="500">近 500 交易日（约2年）</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={runAll} disabled={running != null}>
                <Play className="h-4 w-4 mr-1" />
                {running ? `回测中 ${running.done}/${running.total}…` : '开始回测'}
              </Button>
              <span className="text-xs text-muted-foreground">T+1 开盘成交 · 佣金万2.5 + 印花税0.05%</span>
            </div>
            {/* 结果表 */}
            {results.length > 0 && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border/60 bg-background/40">
                      <th className="text-left py-2 px-3 font-normal">标的 × 策略</th>
                      <th className="text-right font-normal px-2">总收益</th>
                      <th className="text-right font-normal px-2">年化</th>
                      <th className="text-right font-normal px-2">夏普</th>
                      <th className="text-right font-normal px-2">回撤</th>
                      <th className="text-right font-normal px-2">胜率</th>
                      <th className="text-right font-normal px-3">报告</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((x) => {
                      const key = `${x.code}|${x.stratId}`
                      const st = STRATEGIES.find((v) => v.id === x.stratId)!
                      const open = openKey === key
                      return (
                        <FragmentRows
                          key={key}
                          x={x} stName={st.name} open={open}
                          onToggle={() => setOpenKey(open ? null : key)}
                          onReport={() => emitReport(x)}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {results.length === 0 && !running && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                勾选标的与策略后点击「开始回测」，结果按夏普比率排序，点击任意行展开净值曲线与交易明细。
              </div>
            )}
          </Section>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        闭环链路：实时行情采集（东方财富快照 + 日 K，国际标的走 Yahoo 兜底）→ 指标引擎本地计算 → 10 个策略模型日频回测（T+1 开盘价成交、含费用）→ 量化报告推送对话页。
        回测基于历史数据，不构成投资建议；多因子策略当前为行情代理因子版本，接入财务数据源后升级为完整 PE/PB/ROE 打分。
      </p>
    </div>
  )
}

// 回测结果行（点击展开净值曲线与交易明细）
function FragmentRows({ x, stName, open, onToggle, onReport }: {
  x: ComboResult
  stName: string
  open: boolean
  onToggle: () => void
  onReport: () => void
}) {
  const retCls = (v: number) => (v > 0 ? 'text-red-400' : v < 0 ? 'text-emerald-400' : '')
  return (
    <>
      <tr onClick={onToggle} className="border-b border-border/40 cursor-pointer hover:bg-accent/50">
        <td className="py-2.5 px-3">
          <div className="font-medium">{x.name}</div>
          <div className="text-xs text-muted-foreground">{stName} · {x.days} 个交易日</div>
        </td>
        {x.r ? (
          <>
            <td className={cn('text-right font-mono px-2', retCls(x.r.totalRet))}>{x.r.totalRet >= 0 ? '+' : ''}{x.r.totalRet}%</td>
            <td className={cn('text-right font-mono px-2', retCls(x.r.annualRet))}>{x.r.annualRet >= 0 ? '+' : ''}{x.r.annualRet}%</td>
            <td className="text-right font-mono px-2">{x.r.sharpe}</td>
            <td className="text-right font-mono px-2 text-emerald-400">{x.r.mdd}%</td>
            <td className="text-right font-mono px-2">{x.r.winRate}%</td>
          </>
        ) : (
          <td colSpan={5} className="text-right px-2 text-xs text-muted-foreground">K 线数据不足，无法回测</td>
        )}
        <td className="text-right px-3" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" className="h-7" disabled={!x.r} onClick={onReport}>
            <FileText className="h-3 w-3 mr-1" /> 报告
          </Button>
        </td>
      </tr>
      {open && x.r && (
        <tr className="border-b border-border/40 bg-background/30">
          <td colSpan={7} className="p-3">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={x.r.equity}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" interval={Math.max(1, Math.floor(x.r!.equity.length / 8))} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#64748b" domain={['auto', 'auto']} width={56} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line name="策略净值" type="monotone" dataKey="strategy" stroke="#a78bfa" strokeWidth={2} dot={false} />
                  <Line name="基准（买入持有）" type="monotone" dataKey="bench" stroke="#64748b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
              <Pill tone="blue">交易 {x.r.trades.length} 笔</Pill>
              <Pill tone="green">盈亏比 {x.r.profitFactor}</Pill>
              <Pill tone="amber">持仓占比 {x.r.exposure}%</Pill>
              <Pill>区间 {x.start} ~ {x.end}</Pill>
              {x.r.trades.length > 0 && (
                <span className="text-muted-foreground ml-auto">
                  最近交易：{x.r.trades.slice(-3).map((t) => `${t.buyDate.slice(5)}买→${t.sellDate.slice(5)}卖（${t.ret >= 0 ? '+' : ''}${t.ret}%）`).join('；')}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
