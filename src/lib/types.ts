// 全局类型定义
export type ModelStatus = 'running' | 'stopped' | 'downloading' | 'error'
export type RouteStrategy = 'rule' | 'cascade' | 'vote' | 'weighted'

export interface LocalModel {
  id: string
  name: string
  params: string      // 参数量，如 7B
  quant: string       // 量化，如 Q4_K_M
  size: string        // 磁盘占用
  ctx: number         // 上下文窗口
  status: ModelStatus
  port: number
  epId?: string       // 来源 Ollama 端点 id（同步时写入，用于对话直发定位端点）
  progress?: number   // 下载进度
}

export interface ApiModel {
  id: string
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  latencyMs: number
  costPer1k: number   // 美元/1k tokens
  status: 'online' | 'offline' | 'untested'
  tags: string[]
}

export interface Mixture {
  id: string
  name: string
  members: string[]   // 模型 id（本地或 API）
  strategy: RouteStrategy
  fallback: string
  enabled: boolean
  calls: number
}

export interface RouteRule {
  id: string
  taskType: string
  keywords: string
  target: string      // 模型或聚合 id
  priority: number
  enabled: boolean
}

export interface Plugin {
  id: string
  name: string
  desc: string
  category: string
  version: string
  enabled: boolean
  author: string
}

export interface CronJob {
  id: string
  name: string
  schedule: string    // cron 表达式
  action: string
  target: string
  enabled: boolean
  lastRun: string
  nextRun: string
  lastResult: 'success' | 'failed' | '-'
}

export interface WorkflowStep {
  name: string
  tool: string
}

export interface Workflow {
  id: string
  name: string
  desc: string
  trigger: 'manual' | 'cron' | 'event' | 'feishu'
  continuous: boolean     // 自动化连续性：结束后自动衔接下一轮
  steps: WorkflowStep[]
  status: 'idle' | 'running' | 'paused'
  runs: number
  lastRun: string
}

export interface MemoryEntry {
  id: string
  content: string
  type: 'fact' | 'preference' | 'instruction' | 'episode'
  importance: number      // 0-100
  source: string
  createdAt: string
  hits: number
}

export interface Permission {
  id: string
  capability: string
  desc: string
  level: 'full' | 'confirm' | 'readonly' | 'off'
  scope: string
}

export interface AuditLog {
  id: string
  time: string
  actor: string
  action: string
  result: 'allowed' | 'denied' | 'confirmed'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  time: string
  model?: string
  routeTrace?: RouteTrace
  tokens?: number
  /** 知识库检索来源标题（选用知识库端点时） */
  kbSources?: string[]
}

export interface RouteTrace {
  taskType: string
  strategy: string
  candidates: string[]
  chosen: string
  chosenId?: string   // 选中模型的内部 id（lm-*/am-*/mix-*），用于真实调用分发
  reason: string
  latencyMs: number
  cost: number
}

export interface LearnRecord {
  day: string
  accuracy: number    // 路由准确率
  thumbsUp: number
  thumbsDown: number
  samples: number
}

export interface ActivityItem {
  id: string
  time: string
  kind: string
  text: string
}

// ===== 自我进化 =====
export type PatchStatus = 'pending' | 'active' | 'disabled' | 'rolledback'

export interface BehaviorPatch {
  id: string
  date: string
  title: string          // 补丁标题
  content: string        // 注入系统提示的行为规则
  source: string         // 复盘归因来源
  status: PatchStatus
  level: 'L0' | 'L2'     // L0/L1 自动生效，L2 需批准
}

export interface EvolutionPhase {
  name: string           // 复盘员/归因员/路由师/记忆官/教官
  summary: string
}

export interface SkillDraft {
  id: string
  name: string
  desc: string
  reason: string         // 为什么草拟（重复模式证据）
  approved: boolean
}

export interface EvolutionRun {
  id: string
  date: string
  phases: EvolutionPhase[]
  patchIds: string[]
  routingNote: string
  memoryNote: string
  skillDrafts: SkillDraft[]
}

// ===== 知识库端点（LLM Wiki 本地部署模式 / AnythingLLM 服务器连接存储）=====
export interface KnowledgeEndpoint {
  id: string
  name: string
  type: 'llmwiki' | 'anythingllm'
  baseUrl: string      // http://127.0.0.1:19828 / http://192.168.x.x:19828 / http(s)://服务器:3001
  token: string        // LLM Wiki API Token / AnythingLLM API Key（仅存本机）
  target: string       // LLM Wiki 项目 ID / AnythingLLM 工作区 slug；留空自动取第一个
}
