import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { fetchFundFlows, loadWatchCodes, sourceStatus, queryMiaoxiang, MX_KEY, type FundFlow } from '@/lib/marketApi'
import {
  fetchAnnouncements, fetchFinNews, fetchMetals, fetchLimitOverview, fetchFundamentals,
  fetchOptionChain, fetchReports, fetchLhb, fetchMargin, OPTION_UNDERLYINGS,
  type NewsItem, type OptionRow,
} from '@/lib/dataCenterApi'
import { DATA_SOURCES, getDsKey, setDsKey, buildPythonScript } from '@/lib/dataSources'
import { qvDiscover, qvCall, QVERIS_KEY_ID, type QvTool, type QvCallResult } from '@/lib/qveris'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SOURCE_GOVERNANCE, LIMITER, PITFALLS } from '@/lib/marketLayers'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import WatchlistEditor from '@/components/WatchlistEditor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Coins, Flame, MessagesSquare, FileText, BarChart3, Sigma, ShieldCheck, Download, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const num = (v: number) => (v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString())
const cls = (v: number) => (v > 0 ? 'text-red-400' : v < 0 ? 'text-emerald-400' : '')

// ===== 通用轮询 Hook：自动采集 + 手动刷新 + 失败标记 =====
function usePolling<T>(fn: () => Promise<T>, ms: number, watch: unknown = null) {
  const [data, setData] = useState<T | null>(null)
  const [at, setAt] = useState('')
  const [fail, setFail] = useState(false)
  const [busy, setBusy] = useState(false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback(async (manual = false) => {
    if (manual) setBusy(true)
    try {
      const d = await fnRef.current()
      setData(d)
      setFail(false)
      setAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    } catch { setFail(true) } finally { setBusy(false) }
  }, [])
  useEffect(() => {
    run()
    const t = setInterval(() => run(), ms)
    return () => clearInterval(t)
  }, [ms, run, watch])
  return { data, at, fail, busy, reload: () => run(true) }
}

// 新闻列表通用渲染
function NewsList({ items, empty }: { items: NewsItem[]; empty: string }) {
  if (items.length === 0) return <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{empty}</div>
  return (
    <div className="space-y-2.5">
      {items.map((n) => (
        <div key={n.id} className="text-sm">
          <a href={n.url || undefined} target="_blank" rel="noreferrer" className="leading-snug hover:text-cyan-400 transition-colors">{n.title}</a>
          <div className="text-xs text-muted-foreground mt-0.5 flex gap-2"><span>{n.source}</span><span>{n.time}</span></div>
        </div>
      ))}
    </div>
  )
}

export default function DataCenter() {
  const s = useStore()

  return (
    <div>
      <PageHeader title="数据中心" desc="真实接口自动采集：新闻公告 · 金融新闻 · 资金面 · 基本面 · 打板情绪 · ETF期权 · 研报 · QVeris 能力路由 · 数据源治理" />
      <div className="mb-4">
        <WatchlistEditor />
      </div>
      <Tabs defaultValue="news">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="news">新闻公告</TabsTrigger>
          <TabsTrigger value="finnews">金融新闻</TabsTrigger>
          <TabsTrigger value="fund">资金面</TabsTrigger>
          <TabsTrigger value="basic">基本面</TabsTrigger>
          <TabsTrigger value="limit">打板情绪</TabsTrigger>
          <TabsTrigger value="option">ETF期权</TabsTrigger>
          <TabsTrigger value="report">研报</TabsTrigger>
          <TabsTrigger value="qveris">QVeris</TabsTrigger>
          <TabsTrigger value="sources">数据源</TabsTrigger>
          <TabsTrigger value="gov">数据源治理</TabsTrigger>
        </TabsList>

        {/* 新闻公告：政府政策 / 出口管制 / 矿产信息 / 国际新闻 */}
        <TabsContent value="news" className="space-y-4">
          <NewsPanel />
        </TabsContent>

        {/* 金融新闻：国内金融 + 国际金融 + 金价银价 */}
        <TabsContent value="finnews" className="space-y-4">
          <FinNewsPanel />
        </TabsContent>

        {/* 资金面 */}
        <TabsContent value="fund" className="space-y-4">
          <FundPanel log={s.log} />
        </TabsContent>

        {/* 基本面 */}
        <TabsContent value="basic">
          <BasicPanel />
        </TabsContent>

        {/* 打板情绪 */}
        <TabsContent value="limit" className="space-y-4">
          <LimitPanel />
        </TabsContent>

        {/* ETF 期权 */}
        <TabsContent value="option">
          <OptionPanel />
        </TabsContent>

        {/* 研报 */}
        <TabsContent value="report">
          <ReportPanel log={s.log} />
        </TabsContent>

        {/* QVeris 能力路由 */}
        <TabsContent value="qveris" className="space-y-4">
          <QverisPanel log={s.log} />
        </TabsContent>

        {/* 数据源 */}
        <TabsContent value="sources" className="space-y-4">
          <SourcesPanel />
        </TabsContent>

        {/* 数据源治理 */}
        <TabsContent value="gov" className="space-y-4">
          <Section title="数据源优先级（按封 IP 风险分层）" desc="移植 a-stock-data 的防封实践">
            <div className="space-y-3">
              {SOURCE_GOVERNANCE.map((g) => (
                <div key={g.tier} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone={g.tone}>{g.tier}</Pill>
                    {g.sources.map((x) => <span key={x} className="text-sm font-medium">{x}</span>)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">{g.use}</p>
                </div>
              ))}
            </div>
          </Section>
          <div className="grid lg:grid-cols-2 gap-4">
            <Section title="统一限流入口" desc="所有风控源请求的唯一通道">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-400" /><span className="font-mono text-sm">{LIMITER.name}</span></div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div>调用间隔：<span className="font-mono">{LIMITER.interval}</span></div>
                  <div>模式：<span className="font-mono">{LIMITER.mode}</span></div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{LIMITER.note}</p>
              </div>
            </Section>
            <Section title="避坑清单" desc="a-stock-data 交过的学费">
              <div className="space-y-2">
                {PITFALLS.map((p, i) => (
                  <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" /><span>{p}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><MessagesSquare className="h-3.5 w-3.5" /> 数据层结构对齐 a-stock-data 十层端点（行情/资金/打板/舆情/研报/新闻/基本面/公告/ETF期权/信号），后端接入时按字段直换，前端零改动。</div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ===== 新闻公告面板：政府政策 / 出口管制 / 矿产信息 / 国际新闻（东财栏目流自动分拣，60 秒轮询）=====
function NewsPanel() {
  const { data, at, fail, busy, reload } = usePolling(fetchAnnouncements, 60000)
  const desc = `生效源：${sourceStatus.news}（东财栏目资讯流按主题自动分拣） · ${at ? `更新于 ${at}` : '加载中…'}`
  const groups = [
    { key: 'policy', title: '政府政策', items: data?.policy ?? [] },
    { key: 'exportCtrl', title: '出口管制', items: data?.exportCtrl ?? [] },
    { key: 'mineral', title: '矿产信息', items: data?.mineral ?? [] },
    { key: 'intl', title: '国际新闻', items: data?.intl ?? [] },
  ]
  return (
    <>
      <div className="flex items-center gap-2">
        <Pill tone={fail ? 'amber' : 'green'}>{fail ? '源暂不可达，自动重试中' : '自动采集中 · 60 秒轮询'}</Pill>
        <Button variant="outline" size="sm" onClick={reload} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5 mr-1', busy && 'animate-spin')} /> 刷新</Button>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        {groups.map((g) => (
          <Section key={g.key} title={g.title} desc={desc}>
            <NewsList items={g.items} empty={fail ? '新闻源暂不可达，请检查网络后等待自动重试。' : '正在采集…若长时间为空，该主题近期无相关资讯。'} />
          </Section>
        ))}
      </div>
    </>
  )
}

// ===== 金融新闻面板：国内金融 + 国际金融 + 金价银价（60 秒轮询）=====
function FinNewsPanel() {
  const news = usePolling(fetchFinNews, 60000)
  const metals = usePolling(fetchMetals, 30000)
  return (
    <>
      {/* 金价银价 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(metals.data ?? []).map((m) => (
          <StatCard
            key={m.key}
            label={`${m.name}（${m.unit}）`}
            value={m.price.toLocaleString()}
            sub={<span className={cls(m.pct)}>{m.pct > 0 ? '+' : ''}{m.pct}%</span>}
            icon={<Coins className={cn('h-4 w-4', m.pct >= 0 ? 'text-amber-400' : 'text-emerald-400')} />}
          />
        ))}
        {(metals.data ?? []).length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {metals.fail ? '贵金属行情源（新浪财经）暂不可达，30 秒后自动重试。' : '正在采集金价银价…'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>贵金属源：{sourceStatus.metals} · 30 秒轮询{metals.at ? ` · ${metals.at}` : ''}</span>
        <span className="ml-auto">新闻源：{sourceStatus.finnews} · 60 秒轮询{news.at ? ` · ${news.at}` : ''}</span>
        <Button variant="outline" size="sm" className="h-7" onClick={() => { news.reload(); metals.reload() }}><RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新</Button>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="国内金融新闻" desc="东财国内财经栏目（新浪财经兜底）">
          <NewsList items={news.data?.cn ?? []} empty={news.fail ? '新闻源暂不可达，自动重试中。' : '正在采集国内金融新闻…'} />
        </Section>
        <Section title="国际金融新闻" desc="东财环球 / 海外栏目">
          <NewsList items={news.data?.intl ?? []} empty={news.fail ? '新闻源暂不可达，自动重试中。' : '正在采集国际金融新闻…'} />
        </Section>
      </div>
    </>
  )
}

// ===== 基本面面板：监控标的 PE/PB/ROE/增速/毛利率（东财 F10 + push2，120 秒轮询）=====
function BasicPanel() {
  const { data, at, fail, busy, reload } = usePolling(fetchFundamentals, 120000)
  const rows = data ?? []
  return (
    <Section
      title="基本面速览"
      desc={`监控列表 A 股标的 · 最新报告期财务指标（东财 F10）+ 估值增强（${sourceStatus.basicVal || 'push2'}；配置理杏仁 Token 或启动 Python 桥可升级） · 生效源：${sourceStatus.basic} · ${at ? `更新于 ${at} · 120 秒轮询` : '加载中…'}`}
    >
      <div className="flex justify-end -mt-2 mb-2">
        <Button variant="outline" size="sm" className="h-7" onClick={reload} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5 mr-1', busy && 'animate-spin')} /> 刷新</Button>
      </div>
      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground mb-3">
          {fail ? '基本面源暂不可达，请检查网络后等待自动重试。' : '正在按监控列表采集基本面…若长时间为空，请先添加 A 股监控标的。'}
        </div>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border/60">
            <th className="text-left py-2 font-normal">名称</th><th className="text-right font-normal">PE(TTM)</th><th className="text-right font-normal">PB</th>
            <th className="text-right font-normal">PS(TTM)</th><th className="text-right font-normal">股息率</th><th className="text-right font-normal">ROE(加权)</th>
            <th className="text-right font-normal">营收增速</th><th className="text-right font-normal">净利增速</th><th className="text-right font-normal">毛利率</th>
          </tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.code} className="border-b border-border/40">
                <td className="py-2.5"><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{f.code}{f.reportDate ? ` · ${f.reportDate} 期` : ''}</div></td>
                <td className="text-right font-mono">{f.pe}</td><td className="text-right font-mono">{f.pb}</td>
                <td className="text-right font-mono">{f.ps}</td>
                <td className="text-right font-mono text-amber-400">{f.dv}</td>
                <td className="text-right font-mono">{f.roe}</td>
                <td className="text-right font-mono text-red-400">{f.rev}</td>
                <td className="text-right font-mono text-red-400">{f.profit}</td>
                <td className="text-right font-mono text-muted-foreground">{f.gross}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><BarChart3 className="h-3.5 w-3.5" /> 深度财报（三大报表、业务分部）可经「数据源 · 东财妙想」自然语言查询。</div>
    </Section>
  )
}

// ===== 打板情绪面板：东财涨停/跌停/炸板/昨涨停四池（60 秒轮询）=====
function LimitPanel() {
  const { data, at, fail, busy, reload } = usePolling(fetchLimitOverview, 60000)
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="涨停 / 跌停" value={data ? `${data.zt} / ${data.dt}` : '—'} sub={data ? `${data.date} 全市场` : '加载中…'} icon={<Flame className="h-4 w-4 text-red-400" />} />
        <StatCard label="炸板率" value={data?.zbRate ?? '—'} sub={data ? `炸板 ${data.zb} 只` : '—'} icon={<Flame className="h-4 w-4 text-amber-400" />} />
        <StatCard label="连板高度" value={data ? `${data.height} 板` : '—'} sub={data?.pool[0] ? `${data.pool[0].name} 领衔` : '—'} icon={<Flame className="h-4 w-4 text-violet-400" />} />
        <StatCard label="昨涨停今表现" value={data?.yzAvg ?? '—'} sub={data ? `晋级率 ${data.yzPromote} · 样本 ${data.yzCount} 只` : '—'} icon={<Flame className="h-4 w-4 text-emerald-400" />} />
      </div>
      <div className="flex items-center gap-2">
        <Pill tone={fail ? 'amber' : 'green'}>{fail ? '源暂不可达，自动重试中' : `自动采集中 · 60 秒轮询 · 生效源：${sourceStatus.limitPool}`}</Pill>
        <span className="text-xs text-muted-foreground">{at ? `更新于 ${at}` : ''}</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={reload} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5 mr-1', busy && 'animate-spin')} /> 刷新</Button>
      </div>
      {fail && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">打板数据源（东方财富）暂不可达，60 秒后自动重试。</div>
      )}
      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="连板梯队" desc="市场情绪的温度计（≥2 板）">
          <div className="space-y-2">
            {(data?.ladder ?? []).length === 0 && <div className="text-xs text-muted-foreground py-3 text-center">{data ? '当前无 2 板及以上个股' : '加载中…'}</div>}
            {(data?.ladder ?? []).map((l) => (
              <div key={l.level} className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
                <Pill tone="red">{l.level}</Pill>
                <div className="flex flex-wrap gap-1.5">{l.stocks.map((x) => <span key={x} className="text-sm">{x}</span>)}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="涨停池" desc="封板时间与封单资金（按连板数排序）" className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-b border-border/60">
              <th className="text-left py-2 font-normal">名称</th><th className="text-left font-normal">行业</th>
              <th className="text-right font-normal">连板</th><th className="text-right font-normal">首次封板</th><th className="text-right font-normal">封单额</th><th className="text-right font-normal">炸板</th>
            </tr></thead>
            <tbody>
              {(data?.pool ?? []).map((l) => (
                <tr key={l.code} className="border-b border-border/40">
                  <td className="py-2 font-medium">{l.name}<span className="text-xs text-muted-foreground ml-1.5">{l.code}</span></td>
                  <td className="text-xs text-muted-foreground">{l.industry}</td>
                  <td className="text-right"><Pill tone="red">{l.lbc > 0 ? `${l.lbc}板` : '首板'}</Pill></td>
                  <td className="text-right font-mono text-xs">{l.firstTime}</td>
                  <td className="text-right font-mono">{l.fundYi}亿</td>
                  <td className="text-right font-mono text-xs text-muted-foreground">{l.zbCount > 0 ? l.zbCount : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </>
  )
}

// ===== ETF 期权面板：新浪 T 型报价 + 希腊字母（60 秒轮询，标的可切换）=====
function OptionPanel() {
  const [underlying, setUnderlying] = useState('510050')
  const { data, at, fail, busy, reload } = usePolling<OptionRow[]>(() => fetchOptionChain(underlying), 60000, underlying)
  const rows = data ?? []
  return (
    <Section
      title="ETF 期权希腊字母"
      desc={`近月合约按持仓量取主力 · 希腊字母/IV 为交易所预算值（新浪财经） · 生效源：${sourceStatus.option} · ${at ? `更新于 ${at} · 60 秒轮询` : '加载中…'}`}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {OPTION_UNDERLYINGS.map((u) => (
          <Button key={u.id} size="sm" variant={underlying === u.id ? 'default' : 'outline'} className="h-7" onClick={() => setUnderlying(u.id)}>{u.name}</Button>
        ))}
        <Button variant="outline" size="sm" className="h-7 ml-auto" onClick={reload} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5 mr-1', busy && 'animate-spin')} /> 刷新</Button>
      </div>
      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground mb-3">
          {fail ? '期权行情源（新浪财经）暂不可达，60 秒后自动重试。' : '正在采集期权链…'}
        </div>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border/60">
            <th className="text-left py-2 font-normal">合约</th><th className="text-right font-normal">最新</th><th className="text-right font-normal">涨跌%</th>
            <th className="text-right font-normal">行权价</th><th className="text-right font-normal">持仓量</th>
            <th className="text-right font-normal">Delta</th><th className="text-right font-normal">Gamma</th>
            <th className="text-right font-normal">Theta</th><th className="text-right font-normal">Vega</th><th className="text-right font-normal">IV</th>
          </tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.code} className="border-b border-border/40">
                <td className="py-2.5"><span className="font-medium">{o.name}</span> <Pill tone={o.cp === '认购' ? 'red' : 'green'}>{o.cp}</Pill></td>
                <td className="text-right font-mono">{o.last.toFixed(4)}</td>
                <td className={cn('text-right font-mono', cls(o.pct))}>{o.pct > 0 ? '+' : ''}{o.pct.toFixed(2)}</td>
                <td className="text-right font-mono">{o.strike.toFixed(3)}</td>
                <td className="text-right font-mono text-xs text-muted-foreground">{o.oi.toLocaleString()}</td>
                <td className={cn('text-right font-mono', o.delta != null ? cls(o.delta) : '')}>{o.delta?.toFixed(4) ?? '—'}</td>
                <td className="text-right font-mono">{o.gamma?.toFixed(4) ?? '—'}</td>
                <td className="text-right font-mono text-emerald-400">{o.theta?.toFixed(4) ?? '—'}</td>
                <td className="text-right font-mono">{o.vega?.toFixed(4) ?? '—'}</td>
                <td className="text-right font-mono">{o.iv != null ? `${(o.iv * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Sigma className="h-3.5 w-3.5" /> 希腊字母取自交易所每日预算（新浪财经转发），与券商终端口径一致。</div>
    </Section>
  )
}

// ===== 研报面板：东财研报中心（机构评级 + 三年 EPS 预测，5 分钟轮询）=====
function ReportPanel({ log }: { log: (t: 'stock', m: string) => void }) {
  const { data, at, fail, busy, reload } = usePolling(fetchReports, 300000)
  const rows = data ?? []
  return (
    <Section
      title="研报与盈利预测"
      desc={`近 30 日机构研报 · 评级 / 目标价 / 三年 EPS 预测 · 生效源：${sourceStatus.report}（东财研报中心） · ${at ? `更新于 ${at} · 5 分钟轮询` : '加载中…'}`}
    >
      <div className="flex justify-end -mt-2 mb-2">
        <Button variant="outline" size="sm" className="h-7" onClick={reload} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5 mr-1', busy && 'animate-spin')} /> 刷新</Button>
      </div>
      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {fail ? '研报源暂不可达，请检查网络后等待自动重试。' : '正在采集最新研报…'}
        </div>
      )}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-border/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-sm">{r.title}</div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <Pill tone="blue">{r.org}</Pill>
                  <Pill tone={r.rating === '买入' ? 'red' : 'amber'}>{r.rating}</Pill>
                  <span className="text-xs text-muted-foreground">{r.stock}</span>
                  {r.industry && <span className="text-xs text-muted-foreground">· {r.industry}</span>}
                  <span className="text-xs text-muted-foreground">目标价 {r.target}</span>
                  <span className="text-xs text-muted-foreground">{r.date}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground mb-1">EPS 预测 当年/次年/后年</div>
                <div className="font-mono text-sm">{r.eps.join(' / ')}</div>
              </div>
            </div>
            {r.url && (
              <div className="mt-2.5">
                <Button variant="outline" size="sm" className="h-7" onClick={() => { window.open(r.url, '_blank'); log('stock', `打开研报原文：${r.title.slice(0, 20)}…`) }}>
                  <FileText className="h-3 w-3 mr-1" /> 查看原文 / 下载 PDF
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ===== 资金面面板：主力资金流（30 秒）+ 两融市场（120 秒）+ 龙虎榜（120 秒）+ 妙想 =====
function FundPanel({ log }: { log: (t: 'stock', m: string) => void }) {
  // 主力资金流：监控列表标的（东财真实数据，腾讯兜底，30 秒轮询）
  const [flows, setFlows] = useState<FundFlow[]>([])
  const [flowAt, setFlowAt] = useState('')
  const [flowOffline, setFlowOffline] = useState(false)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const codes = loadWatchCodes()
      if (codes.length === 0) { if (!cancelled) setFlows([]); return }
      try {
        const fs = await fetchFundFlows(codes)
        if (cancelled) return
        setFlows(fs)
        setFlowOffline(fs.length === 0)
        setFlowAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } catch { if (!cancelled) setFlowOffline(true) }
    }
    run()
    const timer = setInterval(run, 30000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  const margin = usePolling(fetchMargin, 120000)
  const lhb = usePolling(fetchLhb, 120000)

  const topIn = flows.length ? [...flows].sort((a, b) => b.mainInWan - a.mainInWan)[0] : null
  const topOut = flows.length ? [...flows].sort((a, b) => a.mainInWan - b.mainInWan)[0] : null
  const totalIn = flows.reduce((a, b) => a + b.mainInWan, 0)
  const m = margin.data

  // 东方财富妙想：官方金融数据 AI 接口（API Key 仅存本机）
  const [mxKey, setMxKey] = useState(() => localStorage.getItem(MX_KEY) ?? '')
  const [mxQuery, setMxQuery] = useState('')
  const [mxResult, setMxResult] = useState('')
  const [mxBusy, setMxBusy] = useState(false)
  const saveMxKey = () => {
    localStorage.setItem(MX_KEY, mxKey.trim())
    setMxKey(mxKey.trim())
    toast.success(mxKey.trim() ? '妙想 API Key 已保存在本机' : '已清除妙想 API Key')
  }
  const runMxQuery = async () => {
    if (!mxKey.trim()) { toast.error('请先填写妙想 API Key（ai.eastmoney.com/mxClaw 获取）'); return }
    if (!mxQuery.trim()) { toast.error('请输入查询内容，如「贵州茅台最新价和主力资金」'); return }
    setMxBusy(true)
    setMxResult('')
    try {
      const raw = await queryMiaoxiang(mxKey.trim(), mxQuery.trim())
      let pretty = raw
      try {
        const j = JSON.parse(raw)
        pretty = JSON.stringify(j?.data ?? j, null, 2)
      } catch { /* 非 JSON 直接展示 */ }
      setMxResult(pretty)
      log('stock', `妙想查询完成：${mxQuery.trim().slice(0, 30)}`)
    } catch (e) {
      setMxResult(`⚠️ 查询失败：${e instanceof Error ? e.message : '网络异常'}（请确认 Key 有效且网络可达 mkapi2.dfcfs.com）`)
    }
    setMxBusy(false)
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="监控主力合计" value={`${totalIn >= 0 ? '+' : ''}${(totalIn / 10000).toFixed(2)}亿`} sub={`监控 ${flows.length} 只 · 30 秒轮询${flowAt ? ` · ${flowAt}` : ''}`} icon={<Coins className="h-4 w-4 text-amber-400" />} />
        <StatCard label="主力净流入最多" value={topIn?.name ?? '—'} sub={topIn ? `+${(topIn.mainInWan / 10000).toFixed(2)}亿 · 净占比 ${topIn.mainPct}%` : '添加监控标的后展示'} icon={<Coins className="h-4 w-4 text-red-400" />} />
        <StatCard label="主力净流出最多" value={topOut?.name ?? '—'} sub={topOut ? `${(topOut.mainInWan / 10000).toFixed(2)}亿 · 净占比 ${topOut.mainPct}%` : '添加监控标的后展示'} icon={<Coins className="h-4 w-4 text-emerald-400" />} />
        <StatCard
          label="两融余额（全市场）"
          value={m ? `${m.rzyeYi.toLocaleString()}亿` : '—'}
          sub={m ? `环比 ${m.chgYi >= 0 ? '+' : ''}${m.chgYi}亿 · 融券 ${m.rqyeYi}亿 · ${m.date}（${sourceStatus.margin}）` : margin.fail ? '两融源暂不可达' : '加载中…'}
          icon={<Coins className="h-4 w-4 text-sky-400" />}
        />
      </div>
      <Section title="主力资金流（实时）" desc={flowOffline ? `资金源流暂不可达，30 秒后自动重试（当前源：${sourceStatus.fundflow}）` : `超大单 + 大单为主力口径 · 生效源：${sourceStatus.fundflow}（东财不可达时自动切换腾讯财经） · ${flowAt ? `更新于 ${flowAt}` : '加载中…'}`}>
        {flows.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground mb-3">
            {flowOffline ? '资金流数据暂不可用，请检查网络后等待自动重试。' : '正在按监控列表采集主力资金流…若长时间为空，请先在上方添加监控标的。'}
          </div>
        )}
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border/60">
            <th className="text-left py-2 font-normal">名称</th><th className="text-right font-normal">主力净流入</th>
            <th className="text-right font-normal">超大单</th><th className="text-right font-normal">大单</th>
            <th className="text-right font-normal">中单</th><th className="text-right font-normal">散户</th><th className="text-right font-normal">净占比</th>
          </tr></thead>
          <tbody>
            {flows.map((f) => (
              <tr key={f.code} className="border-b border-border/40">
                <td className="py-2.5"><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{f.code}</div></td>
                <td className={cn('text-right font-mono', cls(f.mainInWan))}>{num(f.mainInWan)}万</td>
                <td className={cn('text-right font-mono text-xs', cls(f.superLargeWan))}>{num(f.superLargeWan)}</td>
                <td className={cn('text-right font-mono text-xs', cls(f.largeWan))}>{num(f.largeWan)}</td>
                <td className={cn('text-right font-mono text-xs', cls(f.midWan))}>{num(f.midWan)}</td>
                <td className={cn('text-right font-mono text-xs', cls(f.retailWan))}>{num(f.retailWan)}</td>
                <td className={cn('text-right font-mono', cls(f.mainPct))}>{f.mainPct > 0 ? '+' : ''}{f.mainPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="龙虎榜（近 5 日净买额榜）" desc={`机构与游资席位动向 · 生效源：${sourceStatus.lhb}（东方财富） · ${lhb.at ? `更新于 ${lhb.at} · 120 秒轮询` : '加载中…'}`}>
        {(lhb.data ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground mb-2">
            {lhb.fail ? '龙虎榜源暂不可达，自动重试中。' : '正在采集龙虎榜…'}
          </div>
        )}
        <div className="space-y-2">
          {(lhb.data ?? []).map((l, i) => (
            <div key={i} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.code}</span>
                <Pill tone="amber">{l.reason || '龙虎榜'}</Pill>
                <span className={cn('ml-auto font-mono', l.netYi >= 0 ? 'text-red-400' : 'text-emerald-400')}>{l.netYi >= 0 ? '+' : ''}{l.netYi}亿</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">买 {l.buyYi}亿 / 卖 {l.sellYi}亿 · 收盘 {l.close}（{l.pct > 0 ? '+' : ''}{l.pct}%） · {l.date}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 东方财富妙想：官方金融数据 AI 接口 */}
      <Section title="东方财富妙想 · 金融数据 AI 接口" desc="东财官方妙想 Skills 数据服务（mkapi2.dfcfs.com）· 用自然语言查行情/资金/财务/资讯 · Key 在 ai.eastmoney.com/mxClaw 免费获取，仅保存在本机">
        <div className="flex gap-2 mb-2">
          <Input
            type="password"
            placeholder="妙想 API Key（mkt_ 开头）"
            value={mxKey}
            onChange={(e) => setMxKey(e.target.value)}
          />
          <Button variant="outline" onClick={saveMxKey} className="shrink-0">保存 Key</Button>
          <Pill tone={mxKey.trim() ? 'green' : 'default'}>{mxKey.trim() ? '已配置' : '未配置'}</Pill>
        </div>
        <div className="flex gap-2">
          <Textarea
            rows={2}
            placeholder="自然语言查询，如：贵州茅台最新价和主力资金流向 / 今日央行公开市场操作"
            value={mxQuery}
            onChange={(e) => setMxQuery(e.target.value)}
          />
          <Button onClick={runMxQuery} disabled={mxBusy} className="shrink-0 self-end">
            <Sparkles className="h-4 w-4 mr-1" />{mxBusy ? '查询中…' : '妙想查询'}
          </Button>
        </div>
        {mxResult && (
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">{mxResult}</pre>
        )}
      </Section>
    </>
  )
}

// ===== QVeris 面板：discover 能力发现 → 参数确认 → call 结构化调用 =====
const QV_QUICK = [
  { label: '指数涨跌榜', query: 'stock index movers gainers losers' },
  { label: '财报快照', query: 'company earnings snapshot filings' },
  { label: '行业表现', query: 'market sector performance today' },
  { label: '宏观指标', query: 'macro economic indicators rates inflation' },
  { label: '加密行情', query: 'crypto price market data' },
  { label: '新闻信号', query: 'financial news event signals' },
]

function QverisPanel({ log }: { log: (t: 'stock', m: string) => void }) {
  const [key, setKey] = useState(() => getDsKey(QVERIS_KEY_ID))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState<QvTool[]>([])
  const [searchId, setSearchId] = useState<string | undefined>(undefined)
  const [sel, setSel] = useState<QvTool | null>(null)
  const [paramsText, setParamsText] = useState('{}')
  const [calling, setCalling] = useState(false)
  const [result, setResult] = useState<QvCallResult | null>(null)

  const saveKey = () => {
    setDsKey(QVERIS_KEY_ID, key.trim())
    toast.success(key.trim() ? 'QVeris Key 已保存（仅存本机）' : 'QVeris Key 已清除')
  }

  const discover = async (q: string) => {
    if (!key.trim()) { toast.error('请先配置 QVeris API Key（数据源页签或此处）'); return }
    if (!q.trim()) return
    setBusy(true); setResult(null); setSel(null)
    try {
      const r = await qvDiscover(key.trim(), q.trim(), 8)
      setTools(r.results ?? [])
      setSearchId(r.search_id)
      log('stock', `QVeris 发现「${q.trim()}」命中 ${r.results?.length ?? 0} 个能力`)
      if ((r.results ?? []).length === 0) toast.info('未找到匹配能力，换个英文能力描述试试')
    } catch (e) {
      toast.error(`QVeris 发现失败：${e instanceof Error ? e.message : '异常'}`)
      setTools([])
    } finally { setBusy(false) }
  }

  const pickTool = (t: QvTool) => {
    setSel(t)
    setParamsText(JSON.stringify(t.examples?.sample_parameters ?? {}, null, 2))
    setResult(null)
  }

  const call = async () => {
    if (!sel) return
    let params: Record<string, unknown>
    try { params = JSON.parse(paramsText || '{}') } catch { toast.error('参数不是合法 JSON'); return }
    setCalling(true)
    try {
      const r = await qvCall(key.trim(), sel.tool_id, searchId, params)
      setResult(r)
      log('stock', `QVeris 调用 ${sel.name || sel.tool_id}：${r.success ? '成功' : '失败'}（${r.elapsed_time_ms ?? '?'}ms，${r.cost ?? 0} credits）`)
      if (!r.success) toast.error(`调用失败：${r.error_message || '未知错误'}`)
    } catch (e) {
      toast.error(`QVeris 调用异常：${e instanceof Error ? e.message : '异常'}`)
    } finally { setCalling(false) }
  }

  return (
    <>
      <Section title="QVeris 能力路由网络" desc="discover（自然语言发现能力，免费）→ 选定工具确认参数 → call（结构化返回，按 credits 计费）。行情 / 财报研究 / 宏观 / 加密 / 另类信号等万级能力统一入口。">
        <div className="flex items-center gap-2">
          <Input type="password" placeholder="QVeris API Key（qveris.ai 注册后自动签发）" value={key} onChange={(e) => setKey(e.target.value)} />
          <Button variant="outline" onClick={saveKey} className="shrink-0">保存 Key</Button>
          <Pill tone={key.trim() ? 'green' : 'default'}>{key.trim() ? '已配置' : '未配置'}</Pill>
          <a href="https://qveris.ai" target="_blank" rel="noreferrer" className="shrink-0 text-xs text-cyan-400 hover:underline">申请 Key ↗</a>
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="英文能力描述效果最佳，如：stock index movers gainers losers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') discover(query) }}
          />
          <Button onClick={() => discover(query)} disabled={busy} className="shrink-0">
            <Sparkles className="h-4 w-4 mr-1" />{busy ? '发现中…' : '发现能力'}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QV_QUICK.map((q) => (
            <button key={q.label} onClick={() => { setQuery(q.query); discover(q.query) }}
              className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              {q.label}
            </button>
          ))}
        </div>
      </Section>

      {tools.length > 0 && (
        <Section title={`候选能力（${tools.length}）`} desc="成功率 / 平均耗时来自 QVeris 路由统计；点击卡片选定工具">
          <div className="grid gap-2 md:grid-cols-2">
            {tools.map((t) => (
              <button key={t.tool_id} onClick={() => pickTool(t)}
                className={cn('rounded-lg border p-3 text-left transition-colors',
                  sel?.tool_id === t.tool_id ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-border/60 hover:bg-accent/60')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{t.name || t.tool_id}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {t.stats?.success_rate != null ? `${Math.round(t.stats.success_rate * 100)}%` : '--'} · {t.stats?.avg_execution_time_ms != null ? `${Math.round(t.stats.avg_execution_time_ms)}ms` : '--'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description || '（无描述）'}</div>
                <div className="mt-1.5 text-[10px] text-muted-foreground/80 font-mono truncate">{t.tool_id}</div>
                {t.params && t.params.length > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    必填参数：{t.params.filter((p) => p.required).map((p) => p.name).join('、') || '无'}
                  </div>
                )}
              </button>
            ))}
          </div>
        </Section>
      )}

      {sel && (
        <Section title={`调用：${sel.name || sel.tool_id}`} desc="参数已按 QVeris 示例预填，可直接修改；调用按 credits 计费">
          <Textarea rows={5} value={paramsText} onChange={(e) => setParamsText(e.target.value)}
            className="font-mono text-xs" placeholder='{"symbol": "AAPL"}' />
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={call} disabled={calling}>
              {calling ? '调用中…' : '执行调用'}
            </Button>
            {result?.elapsed_time_ms != null && <Pill tone="default">{result.elapsed_time_ms}ms</Pill>}
            {result?.cost != null && <Pill tone="default">{result.cost} credits</Pill>}
            {result && <Pill tone={result.success ? 'green' : 'red'}>{result.success ? '成功' : '失败'}</Pill>}
          </div>
          {result && (
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {result.success ? JSON.stringify(result.result ?? {}, null, 2) : `错误：${result.error_message || '未知'}`}
            </pre>
          )}
        </Section>
      )}
    </>
  )
}

// ===== 数据源面板：内置链路状态 + 可选 Key 接口配置 + Python 库脚本导出 =====
function SourcesPanel() {
  const [, force] = useState(0)
  const s = useStore()
  const chain = DATA_SOURCES.filter((d) => d.kind === 'chain')
  const keyed = DATA_SOURCES.filter((d) => d.kind === 'key')
  const pys = DATA_SOURCES.filter((d) => d.kind === 'python')

  const exportScript = () => {
    const codes = loadWatchCodes()
    const blob = new Blob([buildPythonScript(codes)], { type: 'text/x-python;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'lunarcore_采集脚本.py'
    a.click()
    URL.revokeObjectURL(a.href)
    s.log('stock', `导出 Python 采集脚本（${codes.length} 只标的，AkShare + Baostock）`)
    toast.success('已导出 Python 采集脚本，本机 pip install akshare baostock 后即可运行')
  }

  const thCls = 'text-left py-2 text-xs text-muted-foreground font-normal'
  const tdCls = 'py-2 pr-3 text-xs align-top'

  return (
    <div className="space-y-4">
      <Section title="内置实时链路（免 Key · 自动冗余切换）" desc={`当前生效——行情源：${sourceStatus.quotes} · K线源：${sourceStatus.kline} · 资金流源：${sourceStatus.fundflow}`}>
        <table className="w-full">
          <thead><tr className="border-b border-border/60">
            <th className={thCls}>接口</th><th className={thCls}>覆盖市场</th><th className={thCls}>免费策略</th><th className={thCls}>说明</th><th className={`${thCls} text-right`}>状态</th>
          </tr></thead>
          <tbody>
            {chain.map((d) => (
              <tr key={d.id} className="border-b border-border/40">
                <td className={`${tdCls} font-medium`}>{d.name}</td>
                <td className={tdCls}>{d.markets}</td>
                <td className={tdCls}>{d.policy}</td>
                <td className={`${tdCls} text-muted-foreground`}>{d.desc}</td>
                <td className={`${tdCls} text-right`}><Pill tone="green">已接入链路</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <PyBridgeCard />

      <Section title="可选 REST 接口（免费申请 Key · 配置后自动加入行情/K线冗余链）" desc="Key 仅保存在本机，不会上传；留空保存即删除。美股 Key 源按 AlphaVantage → Finnhub → TwelveData → Polygon 顺序兜底，A股按 智兔 → 聚合 兜底，Tushare 用于日 K 兜底">
        <table className="w-full">
          <thead><tr className="border-b border-border/60">
            <th className={thCls}>接口</th><th className={thCls}>覆盖市场</th><th className={thCls}>免费策略</th><th className={thCls}>说明</th><th className={thCls}>Key</th><th className={`${thCls} text-right`}>状态</th>
          </tr></thead>
          <tbody>
            {keyed.map((d) => {
              const configured = !!getDsKey(d.id) || (d.id === 'miaoxiang' && !!localStorage.getItem(MX_KEY))
              return (
                <tr key={d.id} className="border-b border-border/40">
                  <td className={`${tdCls} font-medium`}>{d.name}</td>
                  <td className={tdCls}>{d.markets}</td>
                  <td className={tdCls}>{d.policy}</td>
                  <td className={`${tdCls} text-muted-foreground`}>
                    {d.desc}
                    {d.homepage && <a href={d.homepage} target="_blank" rel="noreferrer" className="block text-cyan-400 hover:underline mt-0.5">申请 Key ↗</a>}
                  </td>
                  <td className={tdCls}>
                    {d.id === 'miaoxiang' ? (
                      <span className="text-xs text-muted-foreground">在「资金面 · 妙想」卡片配置</span>
                    ) : (
                      <div className="flex gap-1 min-w-44">
                        <Input
                          type="password"
                          placeholder={d.keyHint ?? 'API Key'}
                          defaultValue={getDsKey(d.id)}
                          className="h-7 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setDsKey(d.id, (e.target as HTMLInputElement).value.trim())
                              force((x) => x + 1)
                              toast.success(`${d.name} Key 已保存，下一轮采集生效`)
                            }
                          }}
                        />
                        <Button
                          size="sm" variant="outline" className="h-7 shrink-0"
                          onClick={(e) => {
                            const input = (e.currentTarget.previousSibling as HTMLInputElement)
                            setDsKey(d.id, input.value.trim())
                            force((x) => x + 1)
                            toast.success(input.value.trim() ? `${d.name} Key 已保存，下一轮采集生效` : `已清除 ${d.name} Key`)
                          }}
                        >保存</Button>
                      </div>
                    )}
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <Pill tone={configured ? 'green' : 'default'}>{configured ? '已配置' : '未配置'}</Pill>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Python 开源库（本地脚本运行 · 一键生成）" desc="Python 库无法在应用内直接执行——点右侧按钮按当前自选股生成 AkShare + Baostock 双引擎采集脚本，本机运行即可">
        <div className="flex justify-end -mt-2 mb-2">
          <Button size="sm" onClick={exportScript}><Download className="h-4 w-4 mr-1" /> 导出采集脚本（.py）</Button>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-border/60">
            <th className={thCls}>库</th><th className={thCls}>覆盖市场</th><th className={thCls}>免费策略</th><th className={thCls}>特点</th><th className={thCls}>安装</th>
          </tr></thead>
          <tbody>
            {pys.map((d) => (
              <tr key={d.id} className="border-b border-border/40">
                <td className={`${tdCls} font-medium`}>
                  {d.homepage ? <a href={d.homepage} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">{d.name} ↗</a> : d.name}
                </td>
                <td className={tdCls}>{d.markets}</td>
                <td className={tdCls}>{d.policy}</td>
                <td className={`${tdCls} text-muted-foreground`}>{d.desc}</td>
                <td className={`${tdCls} font-mono text-muted-foreground`}>{d.id === 'lixingerpy' ? 'github.com/huhefa/lixinger-universal' : `pip install ${d.id === 'tusharepy' ? 'tushare' : d.id === 'vnpy' ? 'vnpy' : d.id}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

// ===== Python 本地数据桥控制卡（AkShare + BaoStock）=====
function PyBridgeCard() {
  const [st, setSt] = useState<{ running: boolean; health: { ok: boolean; akshare: boolean; baostock: boolean } | null } | null>(null)
  const [busy, setBusy] = useState('')
  const [log, setLog] = useState('')
  const [showLog, setShowLog] = useState(false)
  const ipc = window.agentcore?.pybridge

  const refresh = async () => {
    if (!ipc) return
    try { setSt(await ipc.status()) } catch { /* ignore */ }
  }
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const online = !!st?.health?.ok
  const run = async (action: 'start' | 'stop' | 'install') => {
    if (!ipc) return
    setBusy(action)
    try {
      const r = action === 'start' ? await ipc.start() : action === 'stop' ? await ipc.stop() : await ipc.install()
      if (!r.ok) toast.error((r as { error?: string }).error ?? '操作失败')
      else if (action === 'install') toast.success('依赖安装完成，重启桥后生效')
      else if (action === 'start') toast.success('桥已启动，几秒后自动接入采集链')
      if (action === 'start' || action === 'install') setTimeout(refresh, 1500)
      await refresh()
    } finally { setBusy('') }
  }
  const viewLog = async () => {
    if (!ipc) return
    setLog(await ipc.log())
    setShowLog(!showLog)
  }

  return (
    <Section title="Python 本地数据桥（AkShare + BaoStock）" desc="akfamily/akshare + HanYayaya/BaoStock 官方开源库 · 桥仅监听 127.0.0.1:17895 不接受外部连接 · 在线时 AkShare 接管 A股快照备源与基本面估值指标（PS/股息率）、BaoStock 接管 A股日K备源（前复权，每日 17:30 更新）">
      {!ipc ? (
        <p className="text-xs text-muted-foreground">桥控制仅在桌面版（Electron）中可用；浏览器预览模式无法管理本地进程。</p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={online ? 'green' : st?.running ? 'amber' : 'default'}>
              {online ? `桥在线${st?.health?.akshare ? ' · AkShare✓' : ' · AkShare✗'}${st?.health?.baostock ? ' · BaoStock✓' : ' · BaoStock✗'}` : st?.running ? '进程运行中（等待就绪）' : '桥离线'}
            </Pill>
            {!online && (
              <Button size="sm" onClick={() => run('start')} disabled={busy === 'start'}>{busy === 'start' ? '启动中…' : '启动数据桥'}</Button>
            )}
            {online && (
              <Button size="sm" variant="outline" onClick={() => run('stop')} disabled={busy === 'stop'}>{busy === 'stop' ? '停止中…' : '停止'}</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => run('install')} disabled={busy === 'install'}>
              {busy === 'install' ? '安装中（最长5分钟）…' : '一键安装/更新依赖（pip install akshare baostock）'}
            </Button>
            <Button size="sm" variant="ghost" onClick={viewLog}>{showLog ? '收起日志' : '查看日志'}</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            依赖本机 Python 3（macOS 自带 /usr/bin/python3 或 brew 安装）。首次使用：点「一键安装依赖」→ 完成后「启动数据桥」。桥在线期间无需任何操作，快照/K线断源时自动接管。
          </p>
          {showLog && <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 text-xs whitespace-pre-wrap">{log || '（暂无日志）'}</pre>}
        </>
      )}
    </Section>
  )
}
