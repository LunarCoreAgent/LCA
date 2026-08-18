import type { RouteTrace } from './types'
import { useStore, modelName } from './store'

// 聚合池成员打分：API 看延迟与在线状态，本地看是否运行中（加权路由与直接选池共用）
function memberScore(id: string, s: ReturnType<typeof useStore.getState>): number {
  const a = s.apiModels.find((m) => m.id === id)
  if (a) return 1000 / a.latencyMs + (a.status === 'online' ? 2 : -10)
  const l = s.localModels.find((m) => m.id === id)
  if (l) return l.status === 'running' ? 5 : -10
  return 0
}

// 按池策略从聚合池中选出成员 id（cascade 优先本地，vote 随机，weighted 打分）
export function pickFromMixture(mixId: string): string | null {
  const s = useStore.getState()
  const mix = s.mixtures.find((m) => m.id === mixId)
  if (!mix || mix.members.length === 0) return null
  if (mix.strategy === 'cascade') return mix.members.find((id) => id.startsWith('lm-')) ?? mix.members[0]
  if (mix.strategy === 'vote') return mix.members[Math.floor(Math.random() * mix.members.length)]
  return [...mix.members].sort((x, y) => memberScore(y, s) - memberScore(x, s))[0]
}

// 模拟路由引擎：按规则匹配任务类型，返回路由轨迹
export function routeMessage(input: string): RouteTrace {
  const s = useStore.getState()
  const text = input.toLowerCase()
  const rules = [...s.routeRules].filter((r) => r.enabled).sort((a, b) => b.priority - a.priority)

  let hit = rules.find((r) => r.keywords && r.keywords.split(/[,，]/).some((k) => k.trim() && text.includes(k.trim().toLowerCase())))
  if (!hit) hit = rules[rules.length - 1]

  const target = hit ? hit.target : 'mix-auto'
  const taskType = hit?.taskType ?? '日常问答'
  const mix = s.mixtures.find((m) => m.id === target)

  let chosen = target
  let candidates: string[] = [target]
  let strategy = '规则路由'

  if (mix) {
    candidates = mix.members
    strategy = { rule: '规则路由', cascade: '级联路由', vote: '投票聚合', weighted: '加权路由' }[mix.strategy]
    chosen = pickFromMixture(mix.id) ?? mix.members[0] ?? target
  }

  const api = s.apiModels.find((m) => m.id === chosen)
  const latency = api ? api.latencyMs + Math.floor(Math.random() * 200) : 180 + Math.floor(Math.random() * 300)
  const cost = api ? +(api.costPer1k * (0.6 + Math.random())).toFixed(4) : 0

  return {
    taskType,
    strategy,
    candidates: candidates.map((c) => modelName(c, s)),
    chosen: modelName(chosen, s),
    chosenId: chosen,
    reason: mix
      ? `命中规则「${taskType}」→ 聚合池「${mix.name}」→ ${strategy}选中 ${modelName(chosen, s)}`
      : `命中规则「${taskType}」，直达 ${modelName(chosen, s)}`,
    latencyMs: latency,
    cost,
  }
}

const CANNED: [RegExp, string][] = [
  [/你好|hi|hello|在吗/i, '在的。有什么任务交给我？我会按路由策略挑选合适的模型执行。'],
  [/代码|bug|函数|报错|python|js|typescript/i, '这是代码类任务。把报错堆栈和最小复现代码贴给我，我先定位根因再给出修复建议。'],
  [/总结|论文|报告|长文/i, '长文任务建议走长上下文模型。把文档发我，我会先抽取结构、再分块总结、最后合并为带要点的摘要。'],
  [/记忆|记住/i, '已写入长期记忆。你可以在「记忆」页查看、编辑或删除这条记忆，我会在后续对话中自动召回相关内容。'],
  [/定时|cron|每天|每周/i, '可以在「定时任务」里创建：选择 cron 表达式或自然语言（如"每天早上8点"），绑定工作流或插件动作，我会按计划自动执行。'],
  [/飞书/i, '飞书机器人在「集成」页配置：填入 App ID / Secret 并验证后，即可支持群聊接入、卡片通知和消息转发。'],
]

export function generateReply(input: string): string {
  for (const [re, ans] of CANNED) if (re.test(input)) return ans
  return `已收到任务：「${input.slice(0, 60)}${input.length > 60 ? '…' : ''}」。\n\n按当前路由策略，我会先拆解为子任务，再按需分发给最合适的模型执行，关键步骤会请求你的确认（受权限系统约束）。执行过程中的中间产物会存入记忆，结果可自动衔接定时任务或飞书推送。`
}
