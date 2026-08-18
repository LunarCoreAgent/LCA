import { useMemo, useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Network, Play, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useStore, uid } from '@/lib/store'
import { normalizeCode, fetchLiveQuotes, buildMarketContext } from '@/lib/marketApi'
import { runEnsemble, type EnsembleResult } from '@/lib/ensemble'
import { loadPredictions, savePredictions, estimateDueDate, DIRECTION_LABEL, type Prediction as Pred } from '@/lib/trading'
import { appendRecord } from '@/lib/auditLedger'

const dirPill = (d?: 'up' | 'down' | 'flat' | null) =>
  d == null ? <Pill>-</Pill> : d === 'up' ? <Pill tone="red">看涨</Pill> : d === 'down' ? <Pill tone="green">看跌</Pill> : <Pill>震荡</Pill>

export default function EnsembleCenter() {
  const s = useStore()
  const [code, setCode] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [withContext, setWithContext] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<EnsembleResult | null>(null)
  const [history, setHistory] = useState<EnsembleResult[]>([])

  const allModels = useMemo(() => [
    ...s.localModels.map((m) => ({ id: m.id, label: `${m.name}（本地）`, status: m.status })),
    ...s.apiModels.map((m) => ({ id: m.id, label: `${m.provider}/${m.model}`, status: m.status })),
  ], [s.localModels, s.apiModels])

  const useMixture = (mixId: string) => {
    const mix = s.mixtures.find((m) => m.id === mixId)
    if (mix) {
      setSelected(mix.members.filter((id) => allModels.some((m) => m.id === id)))
      toast.success(`已载入聚合池「${mix.name}」的 ${mix.members.length} 个成员`)
    }
  }

  const toggle = (id: string) => setSelected((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]))

  const run = async () => {
    const c = normalizeCode(code)
    if (!c) { toast.error('请输入标的代码'); return }
    if (!selected.length) { toast.error('请勾选至少一个模型（或从聚合池载入）'); return }
    setRunning(true)
    setResult(null)
    try {
      let name = c
      try {
        const { quotes } = await fetchLiveQuotes([c], () => 'ensemble')
        if (quotes[0]?.name) name = `${quotes[0].name}（${c}）`
      } catch { /* 名称解析失败用代码 */ }
      let ctx = ''
      if (withContext) {
        try { ctx = await buildMarketContext(c) } catch { ctx = '' }
      }
      const r = await runEnsemble(name, selected, ctx)
      setResult(r)
      setHistory((h) => [r, ...h].slice(0, 10))
      s.log('ensemble', `ensemble 决策 ${name}：${r.consensus ? DIRECTION_LABEL[r.consensus] : '无共识'}（${r.votes.filter((v) => v.ok).length}/${r.votes.length} 有效）`)
      if (!r.consensus) toast.warning('所有成员调用失败或未产出有效投票')
      else toast.success(`共识：${DIRECTION_LABEL[r.consensus]}（权重 ${r.consensusWeight}%）`)
    } catch (e) {
      toast.error('决策失败：' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const toPrediction = async () => {
    if (!result?.consensus) return
    const c = normalizeCode(code)!
    try {
      const { quotes } = await fetchLiveQuotes([c], () => 'prediction')
      const q = quotes[0]
      if (!q || !(q.close > 0)) { toast.error('未取到当前价格，无法锚定入场价'); return }
      const entryDate = new Date().toISOString().slice(0, 10)
      const conf = Math.max(1, Math.min(5, Math.round(result.avgConfidence ?? 3)))
      const validReasons = result.votes.filter((v) => v.ok && v.reason).map((v) => `${v.modelLabel}：${v.reason}`).slice(0, 3).join('；')
      const pred: Pred = {
        id: uid(), createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        code: c, name: q.name || c,
        direction: result.consensus, horizon: 10, confidence: conf,
        thesis: `【ensemble 共识】${DIRECTION_LABEL[result.consensus]}（权重 ${result.consensusWeight}%，${result.votes.filter((v) => v.ok).length}/${result.votes.length} 票）。${validReasons}`,
        entryPrice: q.close, entryDate, dueDate: estimateDueDate(entryDate, 10), status: 'open',
      }
      const rec = appendRecord('prediction', 'prediction.create', {
        code: pred.code, name: pred.name, direction: pred.direction, horizon: pred.horizon,
        confidence: pred.confidence, entryPrice: pred.entryPrice, entryDate: pred.entryDate, dueDate: pred.dueDate, thesis: pred.thesis,
      })
      pred.auditHash = rec.hash.slice(0, 16)
      savePredictions([pred, ...loadPredictions()])
      toast.success('已转为推演并上链', { description: '到「推演预测」页可跟踪判定' })
    } catch (e) {
      toast.error('转推演失败：' + (e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="决策中心"
        desc="多模型 ensemble：同一标的分发给多个模型独立判断，结构化 JSON 投票 + 置信度加权汇总。每次运行写入审计台账链；共识可一键转为推演预测（进入命中率对账体系）。"
      />

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Section title="决策配置" desc="聚合池可一键载入成员" className="lg:col-span-1">
          <div className="space-y-3">
            <div>
              <Label className="text-xs">标的代码</Label>
              <Input placeholder="600519 / 00700.HK / AAPL.US" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            {s.mixtures.length > 0 && (
              <div>
                <Label className="text-xs">从聚合池载入成员</Label>
                <Select onValueChange={useMixture}>
                  <SelectTrigger><SelectValue placeholder="选择聚合池" /></SelectTrigger>
                  <SelectContent>
                    {s.mixtures.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}（{m.members.length} 成员）</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">参与模型（{selected.length} 已选）</Label>
              {allModels.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">暂无模型——请先到「模型管理」添加本地 Ollama 或 API 模型</p>
              ) : (
                <div className="mt-1 space-y-1 max-h-44 overflow-y-auto pr-1">
                  {allModels.map((m) => (
                    <label key={m.id} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer transition-colors', selected.includes(m.id) ? 'border-primary/50 bg-primary/10' : 'border-border/60 hover:bg-accent/60')}>
                      <input type="checkbox" className="accent-primary" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                      <span className="flex-1 truncate">{m.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">附带实时行情上下文</Label>
              <Switch checked={withContext} onCheckedChange={setWithContext} />
            </div>
            <Button className="w-full" onClick={run} disabled={running || !allModels.length}>
              <Play className={cn('h-4 w-4 mr-1', running && 'animate-pulse')} />{running ? '多模型推理中…' : '运行 ensemble 决策'}
            </Button>
          </div>
        </Section>

        <Section title="共识结果" desc="置信度加权计票" className="lg:col-span-2">
          {!result ? (
            <div className="text-sm text-muted-foreground py-10 text-center">
              <Network className="h-8 w-8 mx-auto mb-2 opacity-40" />
              配置标的与模型后运行决策
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 rounded-lg border border-border/60 p-4">
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">共识方向</div>
                  <div className="mt-1">{dirPill(result.consensus)}</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">共识权重</div>
                  <div className="text-xl font-bold mt-0.5">{result.consensus ? result.consensusWeight + '%' : '-'}</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">平均置信度</div>
                  <div className="text-xl font-bold mt-0.5">{result.avgConfidence != null ? '★'.repeat(Math.round(result.avgConfidence)) : '-'}</div>
                </div>
                <Button variant="outline" disabled={!result.consensus} onClick={toPrediction}>
                  转为推演<ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>模型</TableHead><TableHead>判断</TableHead>
                    <TableHead className="text-right">置信度</TableHead>
                    <TableHead>依据</TableHead>
                    <TableHead className="text-right">耗时</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.votes.map((v) => (
                    <TableRow key={v.modelId}>
                      <TableCell className="text-xs">{v.modelLabel}</TableCell>
                      <TableCell>{v.ok ? dirPill(v.direction) : <Pill tone="amber">失败</Pill>}</TableCell>
                      <TableCell className="text-right text-xs">{v.ok ? '★'.repeat(v.confidence ?? 3) : '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-72">
                        <span title={v.raw}>{v.reason ?? v.error ?? '-'}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{v.latencyMs ? (v.latencyMs / 1000).toFixed(1) + 's' : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
      </div>

      {history.length > 0 && (
        <Section title="本次会话决策历史" desc="最近 10 次（持久记录见审计台账链 ensemble.run）">
          <div className="space-y-1.5">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-sm rounded-md border border-border/50 px-3 py-2">
                <span className="text-xs text-muted-foreground">{h.time}</span>
                <span className="font-medium">{h.target}</span>
                {dirPill(h.consensus)}
                <span className="text-xs text-muted-foreground">权重 {h.consensus ? h.consensusWeight + '%' : '-'}</span>
                <span className="text-xs text-muted-foreground ml-auto">{h.votes.filter((v) => v.ok).length}/{h.votes.length} 票有效</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
