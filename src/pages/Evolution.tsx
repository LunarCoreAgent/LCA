import { useState } from 'react'
import { useStore, uid } from '@/lib/store'
import { PageHeader, Section, Pill, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dna, Play, Check, X, RotateCcw, Ban, MoonStar, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BehaviorPatch, EvolutionRun, SkillDraft } from '@/lib/types'
import { cn } from '@/lib/utils'

// 新进化轮次可用的补丁池（按轮次轮转）
const PATCH_POOL: Omit<BehaviorPatch, 'id' | 'date' | 'status'>[] = [
  { title: '行情解读先列信号再给观点', content: '做行情分析时，先罗列触发的技术信号（指标+数值），再给出综合观点。', source: '通用规则：强化解读的证据链结构', level: 'L0' },
  { title: '定时任务失败自动降级重试', content: '定时任务执行失败时，自动降级到备用通道重试一次，仍失败再告警。', source: '通用规则：任务失败重试机制', level: 'L0' },
  { title: '凭证类操作主动提示轮换', content: '检测到对话中出现私钥/Token 时，主动提醒该凭证已暴露并建议轮换。', source: '通用规则：凭证安全', level: 'L2' },
  { title: '自动化流结束产出三段式小结', content: '工作流每轮结束时，产出「做了什么/结果如何/下轮计划」三段式小结。', source: '通用规则：提升运行记录可读性', level: 'L0' },
]

const SKILL_POOL: Omit<SkillDraft, 'id' | 'approved'>[] = [
  { name: '周报自动汇总流', desc: '每周五 20:00 汇总本周对话、任务与路由数据，生成周报推飞书', reason: '周报类任务适合固化为技能' },
  { name: '盘后复盘流', desc: '每交易日 15:30 拉取监控标的收盘数据，跑指标信号并生成复盘解读', reason: '行情与量化模块适合串联为盘后技能' },
]

const PHASES = ['复盘员', '归因员', '路由师', '记忆官', '教官']

export default function Evolution() {
  const s = useStore()
  const [running, setRunning] = useState(false)
  const [phaseIdx, setPhaseIdx] = useState(-1)

  const active = s.patches.filter((p) => p.status === 'active')
  const pending = s.patches.filter((p) => p.status === 'pending')

  const runEvolution = () => {
    if (running) return
    setRunning(true)
    s.log('learn', '进化作业启动（手动触发）')
    s.audit('evolution', '启动夜间进化作业（手动）', 'confirmed')

    // 逐阶段推进动画
    PHASES.forEach((_, i) => setTimeout(() => setPhaseIdx(i), (i + 1) * 900))

    setTimeout(() => {
      const st = useStore.getState()
      const round = st.evolutionRuns.length
      const today = new Date().toLocaleString('zh-CN', { hour12: false })
      // 轮转取 1-2 个补丁（跳过已存在的标题）
      const existTitles = new Set(st.patches.map((p) => p.title))
      const fresh = PATCH_POOL.filter((p) => !existTitles.has(p.title)).slice(0, 2)
      const newPatches: BehaviorPatch[] = fresh.map((p) => ({
        ...p, id: uid(), date: today.slice(0, 10),
        status: p.level === 'L0' && st.evolutionSettings.autoApplyL01 ? 'active' : 'pending',
      }))
      // 技能草稿（每两轮给 1 个，跳过已草拟的）
      const drafted = st.evolutionRuns.flatMap((r) => r.skillDrafts.map((d) => d.name))
      const skill = round % 2 === 1 ? SKILL_POOL.filter((k) => !drafted.includes(k.name)).slice(0, 1) : []

      const run: EvolutionRun = {
        id: uid(), date: today,
        patchIds: newPatches.map((p) => p.id),
        routingNote: `路由权重微调：近 24h 反馈样本 ${30 + Math.floor(Math.random() * 40)} 条，代码类本地命中率 ${(88 + Math.random() * 8).toFixed(0)}%`,
        memoryNote: `压缩会话 ${2 + Math.floor(Math.random() * 4)} 段，合并相似记忆 ${Math.floor(Math.random() * 3)} 条`,
        skillDrafts: skill.map((k) => ({ ...k, id: uid(), approved: false })),
        phases: [
          { name: '复盘员', summary: `重放近 24h 全部交互（${st.messages.length} 条对话、${st.activity.length} 条事件），定位可改进点` },
          { name: '归因员', summary: '失败与低效任务归因：输出结构、环境确认、凭证意识等维度' },
          { name: '路由师', summary: '基于反馈样本微调路由权重，变更已记录可回滚' },
          { name: '记忆官', summary: 'episode 压缩、相似合并、低价值遗忘' },
          { name: '教官', summary: `产出行为补丁 ${newPatches.length} 条${skill.length ? `、技能草稿 ${skill.length} 份` : ''}` },
        ],
      }
      st.setEvolutionRuns([run, ...st.evolutionRuns])
      st.setPatches([...newPatches, ...st.patches])
      st.log('learn', `进化作业完成：补丁 ${newPatches.length} 条${newPatches.some((p) => p.status === 'pending') ? '（含待批准）' : ''}`)
      toast.success(`进化完成：产出补丁 ${newPatches.length} 条${skill.length ? `、技能草稿 ${skill.length} 份` : ''}`)
      setRunning(false)
      setPhaseIdx(-1)
    }, 900 * PHASES.length + 800)
  }

  const setPatch = (id: string, status: BehaviorPatch['status'], verb: string) => {
    s.setPatches(s.patches.map((p) => (p.id === id ? { ...p, status } : p)))
    const p = s.patches.find((x) => x.id === id)!
    s.log('learn', `补丁「${p.title}」${verb}`)
    s.audit('user', `${verb}行为补丁「${p.title}」`, status === 'rolledback' ? 'denied' : 'confirmed')
    toast.success(`「${p.title}」${verb}`)
  }

  const approveSkill = (runId: string, draftId: string) => {
    const run = s.evolutionRuns.find((r) => r.id === runId)!
    const d = run.skillDrafts.find((x) => x.id === draftId)!
    s.setEvolutionRuns(s.evolutionRuns.map((r) => (r.id === runId ? { ...r, skillDrafts: r.skillDrafts.map((x) => (x.id === draftId ? { ...x, approved: true } : x)) } : r)))
    s.setWorkflows([...s.workflows, { id: 'wf-' + uid(), name: d.name, desc: d.desc, trigger: 'cron', continuous: false, status: 'idle', runs: 0, lastRun: '-', steps: [{ name: '数据采集', tool: 'pl-file' }, { name: '模型汇总', tool: 'mix-auto' }, { name: '飞书推送', tool: 'pl-feishu' }] }])
    s.log('learn', `技能草稿「${d.name}」已批准，转为正式工作流`)
    s.audit('user', `批准技能草稿「${d.name}」`, 'confirmed')
    toast.success(`「${d.name}」已转为正式工作流，可在「自动化」页查看`)
  }

  return (
    <div>
      <PageHeader title="进化日志" desc="夜间进化循环：复盘 → 归因 → 打补丁 → 验证，每晚产出的变更都在这里"
        extra={<Button onClick={runEvolution} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          {running ? '进化作业运行中…' : '立即运行进化作业'}
        </Button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="进化轮次" value={String(s.evolutionRuns.length)} sub={`计划：每天 ${s.evolutionSettings.cron}`} icon={<MoonStar className="h-4 w-4 text-violet-400" />} />
        <StatCard label="活跃补丁" value={String(active.length)} sub="已注入系统行为" icon={<Dna className="h-4 w-4 text-emerald-400" />} />
        <StatCard label="待批准" value={String(pending.length)} sub="L2 级变更需你确认" icon={<Check className="h-4 w-4 text-amber-400" />} />
        <StatCard label="回滚次数" value={String(s.patches.filter((p) => p.status === 'rolledback').length)} sub="所有变更可一键回滚" icon={<RotateCcw className="h-4 w-4 text-sky-400" />} />
      </div>

      {/* 运行进度 */}
      {running && (
        <Section title="进化作业进行中" desc="五个角色依次作业" className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {PHASES.map((p, i) => (
              <div key={p} className={cn('rounded-lg border px-3 py-2 text-sm flex items-center gap-2',
                i < phaseIdx ? 'border-emerald-500/40 text-emerald-400' : i === phaseIdx ? 'border-amber-500/40 text-amber-400' : 'border-border/60 text-muted-foreground')}>
                {i < phaseIdx ? <Check className="h-3.5 w-3.5" /> : i === phaseIdx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {p}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 行为补丁 */}
        <Section title="行为补丁" desc="复盘产出的行为规则，注入系统提示即生效；L2 级需批准后启用">
          <div className="space-y-3">
            {s.patches.map((p) => (
              <div key={p.id} className={cn('rounded-lg border p-3', p.status === 'active' ? 'border-emerald-500/30 bg-emerald-500/5' : p.status === 'pending' ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/60 opacity-70')}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.title}</span>
                  <Pill tone="purple">{p.level}</Pill>
                  {p.status === 'active' && <Pill tone="green">生效中</Pill>}
                  {p.status === 'pending' && <Pill tone="amber">待批准</Pill>}
                  {p.status === 'disabled' && <Pill>已停用</Pill>}
                  {p.status === 'rolledback' && <Pill tone="red">已回滚</Pill>}
                  <span className="text-xs text-muted-foreground ml-auto">{p.date}</span>
                </div>
                <p className="text-sm text-foreground/85 mt-1.5">{p.content}</p>
                <p className="text-xs text-muted-foreground mt-1">来源：{p.source}</p>
                <div className="flex gap-2 mt-2.5">
                  {p.status === 'pending' && (<>
                    <Button size="sm" className="h-7" onClick={() => setPatch(p.id, 'active', '已批准启用')}><Check className="h-3 w-3 mr-1" /> 批准启用</Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setPatch(p.id, 'rolledback', '已拒绝并回滚')}><X className="h-3 w-3 mr-1" /> 拒绝</Button>
                  </>)}
                  {p.status === 'active' && (<>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setPatch(p.id, 'disabled', '已停用')}><Ban className="h-3 w-3 mr-1" /> 停用</Button>
                    <Button size="sm" variant="outline" className="h-7 text-red-400" onClick={() => setPatch(p.id, 'rolledback', '已回滚')}><RotateCcw className="h-3 w-3 mr-1" /> 回滚</Button>
                  </>)}
                  {p.status === 'disabled' && <Button size="sm" variant="outline" className="h-7" onClick={() => setPatch(p.id, 'active', '已重新启用')}><Check className="h-3 w-3 mr-1" /> 重新启用</Button>}
                </div>
              </div>
            ))}
            {s.patches.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">暂无补丁，运行一次进化作业试试</div>}
          </div>
        </Section>

        <div className="space-y-4">
          {/* 进化时间线 */}
          <Section title="进化时间线" desc="每晚作业的五阶段记录">
            <div className="space-y-4">
              {s.evolutionRuns.map((r) => (
                <div key={r.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <MoonStar className="h-4 w-4 text-violet-400" />
                    <span className="font-medium text-sm">{r.date}</span>
                    <Pill tone="blue">补丁 {r.patchIds.length}</Pill>
                    {r.skillDrafts.length > 0 && <Pill tone="amber">技能草稿 {r.skillDrafts.length}</Pill>}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {r.phases.map((ph) => (
                      <div key={ph.name} className="flex gap-2"><span className="text-violet-400 w-12 shrink-0">{ph.name}</span><span className="text-muted-foreground">{ph.summary}</span></div>
                    ))}
                    <div className="flex gap-2 pt-1 border-t border-border/40"><span className="text-sky-400 w-12 shrink-0">路由</span><span className="text-muted-foreground">{r.routingNote}</span></div>
                    <div className="flex gap-2"><span className="text-sky-400 w-12 shrink-0">记忆</span><span className="text-muted-foreground">{r.memoryNote}</span></div>
                  </div>
                  {r.skillDrafts.map((d) => (
                    <div key={d.id} className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">技能草稿：{d.name}</span>
                        {d.approved ? <Pill tone="green">已转正</Pill> : <Button size="sm" className="h-7" onClick={() => approveSkill(r.id, d.id)}><Check className="h-3 w-3 mr-1" /> 批准转正</Button>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{d.desc}</p>
                      <p className="text-xs text-amber-400/80 mt-0.5">草拟依据：{d.reason}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Section>

          {/* 设置 */}
          <Section title="进化设置" desc="对应权限矩阵「自我修改」能力">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><div className="text-sm font-medium">夜间进化作业</div><div className="text-xs text-muted-foreground">cron：{s.evolutionSettings.cron}（每天凌晨 2 点）</div></div>
                <Switch checked={s.evolutionSettings.enabled} onCheckedChange={(v) => { s.setEvolutionSettings({ ...s.evolutionSettings, enabled: v }); toast.success(v ? '进化作业已启用' : '进化作业已暂停') }} />
              </div>
              <div className="flex items-center justify-between">
                <div><div className="text-sm font-medium">L0/L1 变更自动生效</div><div className="text-xs text-muted-foreground">行为补丁、路由权重微调无需确认</div></div>
                <Switch checked={s.evolutionSettings.autoApplyL01} onCheckedChange={(v) => s.setEvolutionSettings({ ...s.evolutionSettings, autoApplyL01: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div><div className="text-sm font-medium">L2 及以上需批准</div><div className="text-xs text-muted-foreground">新技能、评估标准变更必须人工确认</div></div>
                <Switch checked={s.evolutionSettings.requireApprovalL2} onCheckedChange={(v) => s.setEvolutionSettings({ ...s.evolutionSettings, requireApprovalL2: v })} />
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
