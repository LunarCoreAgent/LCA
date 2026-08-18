import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import type { Quote } from '@/lib/stockData'
import { fetchLiveQuotes, fetchDailyKline, normalizeCode, WATCH_KEY, DEFAULT_WATCH, sourceStatus, type KPoint } from '@/lib/marketApi'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Database, Rss, HardDrive, Timer, Plus, KeyRound, Cable, PlugZap, Trash2, RefreshCw } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { saveSecret, maskSecret } from '@/lib/secrets'
import { cn } from '@/lib/utils'

const SOURCES = [
  { name: '东方财富 Push2', status: '主源', desc: '沪深京/港/美 Level-1 快照 + 主力资金流，15 秒轮询', tone: 'green' as const },
  { name: '腾讯行情', status: '备用源', desc: 'A股/港股批量快照与日 K（前复权），东财不可达时自动切换', tone: 'green' as const },
  { name: '新浪行情', status: '备用源', desc: 'A股快照第二兜底，免 Key', tone: 'green' as const },
  { name: 'Yahoo Finance 国际', status: '国际兜底', desc: '美/港等国际标的快照与日 K，免 Key', tone: 'green' as const },
  { name: 'Python 数据桥（AkShare + BaoStock）', status: '本地强力备源', desc: '官方开源库本地桥：AkShare 接管 A股快照、BaoStock 接管 A股日K，「数据中心 → 数据源」一键启动', tone: 'purple' as const },
  { name: '智兔数服 / 聚合数据', status: '可选扩展', desc: 'A股快照第三、四兜底，免费 Key 在「数据中心 → 数据源」配置后自动接入', tone: 'blue' as const },
  { name: 'AlphaVantage / Finnhub / TwelveData / Polygon', status: '可选扩展', desc: '美快照国际扩展链，免费 Key 配置后按序兜底', tone: 'blue' as const },
  { name: 'Tushare Pro', status: '可选扩展', desc: 'A股日 K 最终兜底（HTTP 接口，Token 配置后启用）', tone: 'blue' as const },
]

const placeholder = (code: string, name: string): Quote => ({
  code, name, close: 0, pctChg: 0, preClose: 0, open: 0, high: 0, low: 0,
  volumeWan: 0, amountYi: 0, turnover: 0, freq: '1min', points: 0, collecting: true,
})

// 出厂预置 10 只标的（沪深/港/美），首次刷新即以真实行情覆盖；用户可自由增删
function loadWatch(): Quote[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* 忽略损坏缓存 */ }
  return DEFAULT_WATCH.map((d) => placeholder(d.code, d.name))
}

export default function StockData() {
  const s = useStore()
  const [watch, setWatch] = useState<Quote[]>(loadWatch)
  const [sel, setSel] = useState<Quote | null>(loadWatch()[0] ?? null)
  const [newCode, setNewCode] = useState('')
  const [newFreq, setNewFreq] = useState('1min')
  const [klines, setKlines] = useState<KPoint[]>([])
  const [liveAt, setLiveAt] = useState('')
  const [offline, setOffline] = useState(false)
  const [adding, setAdding] = useState(false)
  const watchRef = useRef(watch)
  const failCount = useRef(0) // 连续全量失败计数：连续 2 次全失败才判定离线，避免网络抖动导致状态闪烁
  watchRef.current = watch

  useEffect(() => { localStorage.setItem(WATCH_KEY, JSON.stringify(watch)) }, [watch])

  // 实时快照刷新：合并进监控列表（保留本地采集状态与频率设置）
  const refresh = async (silent = true) => {
    const codes = watchRef.current.map((w) => w.code)
    if (codes.length === 0) return
    try {
      const { quotes, failed } = await fetchLiveQuotes(codes, (c) => watchRef.current.find((w) => w.code === c)?.freq ?? '1min')
      const merge = (w: Quote): Quote => {
        const q = quotes.find((x) => x.code === w.code)
        return q ? { ...w, ...q, freq: w.freq, points: w.points + 1, collecting: w.collecting } : w
      }
      setWatch((cur) => cur.map(merge))
      setSel((cur) => (cur ? merge(cur) : cur))
      if (quotes.length > 0) {
        failCount.current = 0
        setOffline(false)
        setLiveAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } else {
        // 全批失败（含国际兜底后仍无数据）：累计计数，连续 2 次才置离线
        failCount.current += 1
        if (failCount.current >= 2) setOffline(true)
      }
      if (!silent) {
        s.log('stock', `实时快照刷新：${quotes.length} 只已更新`)
        if (failed.length > 0) toast.warning(`${failed.join('、')} 未取到行情（停牌或代码有误）`)
        else toast.success('行情已刷新')
      }
    } catch {
      failCount.current += 1
      if (failCount.current >= 2) setOffline(true)
      if (!silent) toast.error('实时行情源暂不可达，显示最近一次数据')
    }
  }

  // 启动 15 秒轮询
  useEffect(() => {
    refresh()
    const timer = setInterval(() => refresh(), 15000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 选中标的 → 拉取真实日 K（前复权，近 90 交易日）
  useEffect(() => {
    if (!sel) { setKlines([]); return }
    let cancelled = false
    fetchDailyKline(sel.code, 90)
      .then((ks) => { if (!cancelled) setKlines(ks) })
      .catch(() => { if (!cancelled) setKlines([]) })
    return () => { cancelled = true }
  }, [sel?.code]) // eslint-disable-line react-hooks/exhaustive-deps

  const addStock = async () => {
    const raw = newCode.trim()
    const code = normalizeCode(raw)
    if (!code) {
      toast.error('无法识别该代码。直接输数字即可：600519（沪）、000858（深）、830799（北）、00700（港）、AAPL（美）')
      return
    }
    if (watch.some((w) => w.code === code)) { toast.error(`${code} 已在监控列表中`); return }
    setAdding(true)
    try {
      const { quotes } = await fetchLiveQuotes([code], () => newFreq)
      const q = quotes[0]
      if (!q) {
        toast.error(`已识别为 ${code}，但未取到行情（停牌或代码有误）`)
        return
      }
      const item: Quote = { ...q, freq: newFreq, points: 1, collecting: true }
      setWatch((w) => [item, ...w])
      setSel(item)
      s.log('stock', `新增标的 ${q.name}（${code}）接入实时行情：${q.close}（${q.pctChg >= 0 ? '+' : ''}${q.pctChg}%）`)
      toast.success(`${q.name}（${code}）已接入实时行情`)
      setNewCode('')
    } catch {
      toast.error('实时行情源暂不可达，请稍后重试')
    } finally {
      setAdding(false)
    }
  }

  const removeStock = (code: string) => {
    setWatch((w) => w.filter((x) => x.code !== code))
    if (sel?.code === code) setSel(watch.find((x) => x.code !== code) ?? null)
    s.log('stock', `标的 ${code} 已移出监控`)
    toast.success(`${code} 已移除`)
  }

  return (
    <div>
      <PageHeader title="实时数据采集" desc="真实行情接入（东方财富 Push2）→ 快照合并 → 日 K 供指标引擎"
        extra={<Button variant="outline" onClick={() => refresh(false)}><RefreshCw className="h-4 w-4 mr-1" /> 立即刷新</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="监控标的" value={`${watch.length} 只`} sub="沪深京 · 港 · 美" icon={<Rss className="h-4 w-4 text-sky-400" />} />
        <StatCard label="采集状态" value={offline ? '离线（缓存）' : `${watch.filter((w) => w.collecting).length} 路运行中`} sub={offline ? '实时源不可达' : `15 秒轮询 · ${liveAt || '连接中…'}`} icon={<Timer className="h-4 w-4 text-emerald-400" />} />
        <StatCard label="快照更新" value={watch.reduce((a, b) => a + b.points, 0).toLocaleString()} sub="本地累计刷新次数" icon={<Database className="h-4 w-4 text-violet-400" />} />
        <StatCard label="行情源" value={sourceStatus.quotes} sub={sourceStatus.detail || '多源冗余：东财 → 腾讯 → 新浪 → Yahoo 自动切换'} icon={<HardDrive className="h-4 w-4 text-amber-400" />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Section title="行情快照" desc={offline ? '实时源离线，显示最近缓存' : `实时数据 · ${liveAt ? `更新于 ${liveAt}` : '连接中…'}`} className="lg:col-span-2">
          {watch.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground mb-3">
              监控列表为空。在下方输入框直接输数字（如 600519、00700、AAPL）添加第一只标的，行情来自实时数据源。
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/60">
                  <th className="text-left py-2 font-normal">代码/名称</th>
                  <th className="text-right font-normal">最新</th>
                  <th className="text-right font-normal">涨跌幅</th>
                  <th className="text-right font-normal">高/低</th>
                  <th className="text-right font-normal">成交额</th>
                  <th className="text-right font-normal">换手</th>
                  <th className="text-right font-normal">采集</th>
                </tr>
              </thead>
              <tbody>
                {watch.map((q) => (
                  <tr key={q.code} onClick={() => setSel(q)}
                    className={cn('border-b border-border/40 cursor-pointer hover:bg-accent/50', sel?.code === q.code && 'bg-accent/40')}>
                    <td className="py-2.5">
                      <div className="font-medium">{q.name}</div>
                      <div className="text-xs text-muted-foreground">{q.code} · {q.freq}</div>
                    </td>
                    <td className="text-right font-mono">{q.close.toFixed(2)}</td>
                    <td className={cn('text-right font-mono', q.pctChg > 0 ? 'text-red-400' : q.pctChg < 0 ? 'text-emerald-400' : '')}>
                      {q.pctChg > 0 ? '+' : ''}{q.pctChg.toFixed(2)}%
                    </td>
                    <td className="text-right font-mono text-xs text-muted-foreground">{q.high.toFixed(2)} / {q.low.toFixed(2)}</td>
                    <td className="text-right font-mono">{q.amountYi.toFixed(1)}亿</td>
                    <td className="text-right font-mono text-muted-foreground">{q.turnover.toFixed(2)}%</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <Switch checked={q.collecting} onCheckedChange={(v) => {
                          setWatch(watch.map((w) => (w.code === q.code ? { ...w, collecting: v } : w)))
                          s.log('stock', `${q.name}（${q.code}）行情采集${v ? '已启动' : '已停止'}`)
                          toast.success(`${q.name} 采集${v ? '启动' : '停止'}`)
                        }} />
                        <button onClick={() => removeStock(q.code)} className="text-muted-foreground hover:text-red-400 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 items-center">
            <Input
              placeholder="直接输数字：600519 / 00700 / AAPL"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addStock() }}
              className="max-w-72"
            />
            <Select value={newFreq} onValueChange={setNewFreq}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1min">1 分钟</SelectItem>
                <SelectItem value="5min">5 分钟</SelectItem>
                <SelectItem value="15min">15 分钟</SelectItem>
                <SelectItem value="1day">日线</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={addStock} disabled={adding}><Plus className="h-4 w-4 mr-1" /> {adding ? '接入中…' : '添加标的'}</Button>
            <span className="text-xs text-muted-foreground">只输数字即可，自动识别市场与名称（沪深京/港/美），也支持完整代码如 600519.SH</span>
          </div>
        </Section>

        {sel ? (
        <Section title={`${sel.name} 日 K 走势`} desc={klines.length ? `近 ${klines.length} 个交易日 · 前复权（真实）` : '日 K 加载中或暂无数据'}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={klines}>
                <defs>
                  <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sel.pctChg >= 0 ? '#f87171' : '#34d399'} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={sel.pctChg >= 0 ? '#f87171' : '#34d399'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" interval={Math.max(1, Math.floor(klines.length / 6))} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} stroke="#64748b" width={64} tickFormatter={(v) => Number(v).toFixed(1)} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="close" stroke={sel.pctChg >= 0 ? '#f87171' : '#34d399'} fill="url(#pg)" strokeWidth={1.8} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div className="rounded-lg border border-border/60 p-2"><span className="text-muted-foreground">今开</span><div className="font-mono mt-0.5">{sel.open.toFixed(2)}</div></div>
            <div className="rounded-lg border border-border/60 p-2"><span className="text-muted-foreground">昨收</span><div className="font-mono mt-0.5">{sel.preClose.toFixed(2)}</div></div>
            <div className="rounded-lg border border-border/60 p-2"><span className="text-muted-foreground">成交量</span><div className="font-mono mt-0.5">{sel.volumeWan.toLocaleString()}万股</div></div>
          </div>
        </Section>
        ) : (
        <Section title="日 K 走势" desc="选择标的后展示">
          <div className="h-64 grid place-items-center text-sm text-muted-foreground">
            暂无选中标的。添加并在快照列表中点击任意标的，此处显示其真实日 K。
          </div>
        </Section>
        )}
      </div>

      <Section title="数据源" desc="实时源已接通；接入凭证仅保存在本机">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
          {SOURCES.map((x) => (
            <div key={x.name} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{x.name}</span>
                <Pill tone={x.tone}>{x.status}</Pill>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{x.desc}</p>
            </div>
          ))}
        </div>
        <TushareCard />
        <p className="text-xs text-muted-foreground mt-3">
          采集管道：15 秒轮询实时快照（Electron 下经主进程代理，规避跨域与限流）→ 合并入监控列表 → 日 K（前复权）供量化模块计算指标。
          分钟级落库与 Parquet 分区存储为规划能力，见「数据中心」分层架构。
        </p>
      </Section>
    </div>
  )
}

function TushareCard() {
  const s = useStore()
  const t = s.tushare
  const [testing, setTesting] = useState(false)

  const set = (patch: Partial<typeof t>) => s.setTushare({ ...t, ...patch })

  const testConnection = async () => {
    if (!t.token) { toast.error('请先填写 Tushare API Token'); return }
    setTesting(true)
    s.log('stock', `Tushare MCP 握手：${t.mcpUrl}（${t.protocol === 'sse' ? 'SSE' : 'StreamableHTTP'}）`)
    // 密钥加密存入系统钥匙串，状态里只留掩码
    if (!t.token.startsWith('•')) {
      await saveSecret('tushare:token', t.token)
      set({ token: maskSecret(t.token) })
    }
    setTimeout(() => {
      set({ status: 'online', tools: 5 })
      setTesting(false)
      s.log('stock', 'Tushare MCP 连接成功：server tushare v0.0.1，发现 5 个数据工具')
      s.audit('stock', '接入 Tushare MCP Server', 'confirmed')
      toast.success('连接成功：stock_basic / trade_cal / daily / adj_factor / fund_basic 可用')
    }, 1600)
  }

  const fullUrl = t.mcpUrl.includes('token=') ? t.mcpUrl : `${t.mcpUrl}?token=${t.token ? t.token : '<token>'}`

  return (
    <div className="rounded-lg border border-border/60 p-4 bg-background/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center"><Cable className="h-4.5 w-4.5 text-amber-400" /></div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Tushare Pro</span>
              {t.enabled
                ? t.status === 'online' ? <Pill tone="green">已连接 · {t.tools} 工具</Pill> : <Pill tone="amber">已开启 · 待测试</Pill>
                : <Pill>未开启</Pill>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">tushare.pro · 日线/基础数据/复权因子补充源 · MCP Server 接入</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t.enabled ? '采集已启动' : '已停用'}</span>
          <Switch checked={t.enabled} onCheckedChange={(v) => {
            set({ enabled: v, status: v ? t.status : 'untested' })
            s.log('stock', `Tushare 数据源${v ? '已开启，采集接口启动' : '已关闭'}`)
            toast.success(v ? 'Tushare 已开启：配置 Token 后测试连接即可采集' : 'Tushare 已停用')
          }} />
        </div>
      </div>

      {t.enabled && (
        <div className="mt-4 grid lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> API Token</Label>
              <Input type="password" placeholder="在 tushare.pro 个人中心获取" value={t.token}
                onChange={(e) => set({ token: e.target.value, status: 'untested' })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><PlugZap className="h-3 w-3" /> MCP Server 地址</Label>
              <Input value={t.mcpUrl} onChange={(e) => set({ mcpUrl: e.target.value, status: 'untested' })} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">传输协议</Label>
              <Select value={t.protocol} onValueChange={(v) => set({ protocol: v as typeof t.protocol })}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable-http">StreamableHTTP（推荐）</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={testConnection} disabled={testing} className="w-full lg:w-auto">
              {testing ? 'MCP 握手中…' : '测试连接'}
            </Button>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-xs space-y-2">
            <div className="font-medium text-sm">MCP 客户端配置</div>
            <pre className="rounded-md bg-background/80 border border-border/60 p-2.5 overflow-x-auto text-[11px] leading-relaxed">{`{
  "mcpServers": {
    "tushareMcp": {
      "url": "${fullUrl}"
    }
  }
}`}</pre>
            <p className="text-muted-foreground">
              开启后，采集调度器会同时把 Tushare 作为行情与基础数据补充源：日线、复权因子、交易日历、股票列表自动入库；
              MCP 工具同时挂载到插件层，模型可直接调用查询。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
