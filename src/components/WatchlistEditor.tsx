import { useEffect, useRef, useState } from 'react'
import { QUOTES, type Quote } from '@/lib/stockData'
import { fetchLiveQuotes, normalizeCode, WATCH_KEY } from '@/lib/marketApi'
import { Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'

function loadWatch(): Quote[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* 忽略损坏缓存 */ }
  return QUOTES
}

// 自选标的编辑器：行情采集 / 数据中心 / 量化分析共用同一 localStorage 列表
export default function WatchlistEditor({ title = '自选标的池', desc = '与「行情采集」共用同一列表，此处添加即时同步', onChange }: {
  title?: string
  desc?: string
  onChange?: (codes: string[]) => void
}) {
  const s = useStore()
  const [watch, setWatch] = useState<Quote[]>(loadWatch)
  const [code, setCode] = useState('')
  const [adding, setAdding] = useState(false)
  const [liveAt, setLiveAt] = useState('')
  const watchRef = useRef(watch)
  watchRef.current = watch

  useEffect(() => {
    localStorage.setItem(WATCH_KEY, JSON.stringify(watch))
    onChange?.(watch.map((w) => w.code))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch])

  // 挂载时拉一次实时价
  useEffect(() => {
    ;(async () => {
      const codes = watchRef.current.map((w) => w.code)
      if (codes.length === 0) return
      try {
        const { quotes } = await fetchLiveQuotes(codes, (c) => watchRef.current.find((w) => w.code === c)?.freq ?? '1min')
        setWatch((cur) => cur.map((w) => {
          const q = quotes.find((x) => x.code === w.code)
          return q ? { ...w, ...q, freq: w.freq } : w
        }))
        setLiveAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } catch { /* 离线时保持原数据 */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async () => {
    const normalized = normalizeCode(code)
    if (!normalized) { toast.error('无法识别。直接输数字：600519（沪）、000858（深）、830799（北）、00700（港）、AAPL（美）'); return }
    if (watch.some((w) => w.code === normalized)) { toast.error(`${normalized} 已在列表中`); return }
    setAdding(true)
    try {
      const { quotes } = await fetchLiveQuotes([normalized], () => '1min')
      const q = quotes[0]
      if (!q) { toast.error(`已识别为 ${normalized}，但未取到行情（停牌或代码有误）`); return }
      setWatch((w) => [{ ...q, freq: '1min', points: 1, collecting: true }, ...w])
      s.log('stock', `数据中心添加自选标的 ${q.name}（${normalized}）`)
      toast.success(`${q.name}（${normalized}）已加入自选池`)
      setCode('')
    } catch {
      toast.error('实时行情源暂不可达，请稍后重试')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Section title={title} desc={`${desc}${liveAt ? ` · 行情更新于 ${liveAt}` : ''}`}>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Input placeholder="直接输数字：600519 / 00700 / AAPL" value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          className="max-w-64" />
        <Button variant="outline" onClick={add} disabled={adding}><Plus className="h-4 w-4 mr-1" /> {adding ? '接入中…' : '添加标的'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setWatch(loadWatch())}><RefreshCw className="h-3.5 w-3.5 mr-1" /> 同步列表</Button>
        <span className="text-xs text-muted-foreground">自动识别市场与名称（沪深京/港/美）</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {watch.map((w) => (
          <span key={w.code} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-sm">
            <span className="font-medium">{w.name}</span>
            <span className="text-xs text-muted-foreground">{w.code}</span>
            <span className={cn('text-xs font-mono', (w.pctChg ?? 0) > 0 ? 'text-red-400' : (w.pctChg ?? 0) < 0 ? 'text-emerald-400' : '')}>
              {(w.close ?? 0).toFixed(2)} {(w.pctChg ?? 0) > 0 ? '+' : ''}{(w.pctChg ?? 0).toFixed(2)}%
            </span>
            <button onClick={() => { setWatch(watch.filter((x) => x.code !== w.code)); toast.success(`${w.code} 已移除`) }}
              className="text-muted-foreground hover:text-red-400 ml-0.5"><Trash2 className="h-3 w-3" /></button>
          </span>
        ))}
        {watch.length === 0 && <span className="text-xs text-muted-foreground">列表为空，输入代码添加第一只标的</span>}
      </div>
      <div className="mt-2"><Pill tone="blue">{watch.length} 只在池</Pill></div>
    </Section>
  )
}
