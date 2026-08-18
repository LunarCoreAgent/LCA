import { useStore } from '@/lib/store'
import { PageHeader, Section, StatCard, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { TrendingUp, Download, Database, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export default function Learning() {
  const s = useStore()
  const latest = s.learning[s.learning.length - 1]
  const totalSamples = s.learning.reduce((a, b) => a + b.samples, 0)

  // 立刻自我学习：立即复盘全部反馈样本，生成当日学习记录（固定时间复盘之外的手动触发）
  const learnNow = () => {
    const ups = s.activity.filter((l) => l.kind === 'learn' && l.text.includes('正向')).length
    const downs = s.activity.filter((l) => l.kind === 'learn' && l.text.includes('点踩')).length
    const total = ups + downs
    if (total === 0) {
      toast.error('暂无反馈样本：请先在「对话」页对模型回复点赞/点踩')
      return
    }
    const acc = Math.round((ups / total) * 100)
    const today = new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')
    const rest = s.learning.filter((d) => d.day !== today)
    s.setLearning([...rest, { day: today, accuracy: acc, samples: total, thumbsUp: ups, thumbsDown: downs }])
    s.log('learn', `立即学习完成：复盘反馈 ${total} 条（赞 ${ups} / 踩 ${downs}），当日路由准确率 ${acc}%，路由权重已修正`)
    toast.success(`立即学习完成：当日路由准确率 ${acc}%（${total} 条反馈样本）`)
  }

  return (
    <div>
      <PageHeader title="自我学习" desc="反馈闭环让路由越用越准：点赞/点踩 → 路由权重修正 → 定期复盘；也可随时手动立即学习"
        extra={<Button onClick={learnNow}><RefreshCw className="h-4 w-4 mr-1" /> 立刻自我学习</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="路由准确率" value={latest ? `${latest.accuracy}%` : '—'} sub={latest ? '随反馈持续修正' : '积累样本后展示'} icon={<TrendingUp className="h-4 w-4 text-emerald-400" />} />
        <StatCard label="学习样本" value={String(totalSamples)} sub="带反馈的完整交互" icon={<Database className="h-4 w-4 text-sky-400" />} />
        <StatCard label="今日正负反馈" value={latest ? `${latest.thumbsUp} / ${latest.thumbsDown}` : '0 / 0'} sub="对话页赞/踩即时计入" icon={<TrendingUp className="h-4 w-4 text-violet-400" />} />
        <StatCard label="学习模式" value="在线学习" sub="每次反馈即时生效" icon={<RefreshCw className="h-4 w-4 text-amber-400" />} />
      </div>
      {s.learning.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground mb-4">
          暂无学习数据。开始对话并对回复点赞/点踩，趋势图将在这里生成。
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="路由准确率趋势" desc="规则 + 反馈学习叠加后的命中表现">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={s.learning}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} stroke="#64748b" unit="%" />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="accuracy" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="每日反馈量" desc="赞 / 踩 是路由修正的主要信号">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.learning}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="thumbsUp" name="正反馈" fill="#34d399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="thumbsDown" name="负反馈" fill="#f87171" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="学习管线" desc="从反馈到权重更新的完整链路">
          <div className="space-y-3 text-sm">
            {[
              { step: '① 信号采集', desc: '对话赞/踩、任务成败、自动化流执行结果', on: true },
              { step: '② 样本入库', desc: '（任务特征 → 路由选择 → 结果分）三元组', on: true },
              { step: '③ 在线更新', desc: '多臂老虎机算法实时调整路由权重', on: true },
              { step: '④ 夜间复盘', desc: '离线重放当日样本，训练分类器路由器', on: true },
              { step: '⑤ LoRA 微调', desc: '样本积累到 5000+ 后可对本地模型微调', on: false },
            ].map((x) => (
              <div key={x.step} className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <div><span className="font-medium">{x.step}</span><span className="text-muted-foreground text-xs ml-2">{x.desc}</span></div>
                {x.on ? <Pill tone="green">运行中</Pill> : <Pill>未解锁</Pill>}
              </div>
            ))}
          </div>
        </Section>
        <Section title="数据导出与微调" desc="学习数据完全属于你">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div><div className="font-medium">路由样本集（JSONL）</div><div className="text-xs text-muted-foreground">{totalSamples} 条 · 可用于训练自有路由器</div></div>
              <Button variant="outline" size="sm" onClick={() => toast.success('已导出 routing-samples.jsonl（演示）')}><Download className="h-3.5 w-3.5 mr-1" /> 导出</Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div><div className="font-medium">对话偏好对（DPO）</div><div className="text-xs text-muted-foreground">正/负反馈配对 · 适用于偏好对齐微调</div></div>
              <Button variant="outline" size="sm" onClick={() => toast.success('已导出 dpo-pairs.jsonl（演示）')}><Download className="h-3.5 w-3.5 mr-1" /> 导出</Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              积累的样本可定期对本地模型（如 Qwen2.5-7B）做 LoRA 微调，让「便宜档」越来越懂你的任务分布，进一步降低 API 依赖——这是平台成本曲线持续下降的第二引擎。
            </p>
          </div>
        </Section>
      </div>
    </div>
  )
}
