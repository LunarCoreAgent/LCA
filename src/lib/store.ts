import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  LocalModel, ApiModel, Mixture, RouteRule, Plugin, CronJob,
  Workflow, MemoryEntry, Permission, AuditLog, ChatMessage, LearnRecord, ActivityItem,
  BehaviorPatch, EvolutionRun,
} from './types'

const now = () => new Date().toLocaleString('zh-CN', { hour12: false })

// 出厂清理（一次性）：清除旧版本地缓存的测试数据，保证全新安装从空白开始
// v5：重置监控列表键，使出厂预置的 10 只标（沪深/港/美）的生效
const FACTORY_KEY = 'agentcore-factory-v5'
if (typeof localStorage !== 'undefined' && !localStorage.getItem(FACTORY_KEY)) {
  localStorage.removeItem('agentcore-watchlist')
  localStorage.removeItem('agentcore-ollama-endpoints')
  localStorage.setItem(FACTORY_KEY, '1')
}

interface State {
  localModels: LocalModel[]
  apiModels: ApiModel[]
  mixtures: Mixture[]
  routeRules: RouteRule[]
  plugins: Plugin[]
  cronJobs: CronJob[]
  workflows: Workflow[]
  memories: MemoryEntry[]
  permissions: Permission[]
  auditLogs: AuditLog[]
  messages: ChatMessage[]
  learning: LearnRecord[]
  activity: ActivityItem[]
  feishu: { appId: string; appSecret: string; webhook: string; defaultChat: string; enabled: boolean; forwardChat: boolean }
  // 微信（公众平台 AppID + 云开发 AI Agent）；LINE（Messaging API 渠道）
  wechat: { appId: string; appSecret: string; envId: string; botId: string; enabled: boolean; forwardChat: boolean }
  line: { channelToken: string; channelSecret: string; publicUrl: string; port: number; allowedUsers: string; homeChannel: string; enabled: boolean; forwardChat: boolean }
  tushare: { enabled: boolean; token: string; mcpUrl: string; protocol: 'sse' | 'streamable-http'; status: 'untested' | 'online' | 'failed'; tools: number }
  patches: BehaviorPatch[]
  evolutionRuns: EvolutionRun[]
  evolutionSettings: { cron: string; autoApplyL01: boolean; requireApprovalL2: boolean; enabled: boolean }

  setLocalModels: (m: LocalModel[]) => void
  setApiModels: (m: ApiModel[]) => void
  setMixtures: (m: Mixture[]) => void
  setRouteRules: (r: RouteRule[]) => void
  setPlugins: (p: Plugin[]) => void
  setCronJobs: (c: CronJob[]) => void
  setWorkflows: (w: Workflow[]) => void
  setMemories: (m: MemoryEntry[]) => void
  setPermissions: (p: Permission[]) => void
  setAuditLogs: (a: AuditLog[]) => void
  setMessages: (m: ChatMessage[]) => void
  setLearning: (l: LearnRecord[]) => void
  setFeishu: (f: State['feishu']) => void
  setWechat: (w: State['wechat']) => void
  setLine: (l: State['line']) => void
  setTushare: (t: State['tushare']) => void
  setPatches: (p: BehaviorPatch[]) => void
  setEvolutionRuns: (r: EvolutionRun[]) => void
  setEvolutionSettings: (e: State['evolutionSettings']) => void
  log: (kind: string, text: string) => void
  audit: (actor: string, action: string, result: AuditLog['result']) => void
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export const useStore = create<State>()(
  persist(
    (set) => ({
      // ===== 出厂空数据：模型 / 聚合池 / 路由规则全部由用户自行配置 =====
      localModels: [],
      apiModels: [],
      mixtures: [],
      routeRules: [],
      plugins: [
        { id: 'pl-web', name: '网页浏览', desc: '访问 URL、抓取页面正文、截图', category: '网络', version: '1.4.2', enabled: true, author: 'LunarCore Claw' },
        { id: 'pl-shell', name: 'Shell 执行', desc: '在宿主机执行终端命令（受权限系统约束）', category: '系统', version: '1.1.0', enabled: true, author: 'LunarCore Claw' },
        { id: 'pl-file', name: '文件系统', desc: '读写指定目录文件，支持知识库目录', category: '系统', version: '1.2.7', enabled: true, author: 'LunarCore Claw' },
        { id: 'pl-cron', name: '定时调度', desc: 'cron 表达式驱动任务与自动化流', category: '自动化', version: '2.0.1', enabled: true, author: 'LunarCore Claw' },
        { id: 'pl-feishu', name: '飞书机器人', desc: '收发飞书消息、群聊接入、卡片通知', category: '集成', version: '0.9.5', enabled: true, author: 'LunarCore Claw' },
        { id: 'pl-rag', name: '向量检索', desc: '记忆与文档的 embedding 索引与召回', category: '记忆', version: '1.0.3', enabled: true, author: 'LunarCore Claw' },
        { id: 'pl-skill', name: '技能市场', desc: '安装第三方 .skill 能力包', category: '扩展', version: '0.8.0', enabled: false, author: '社区' },
        { id: 'pl-gui', name: '桌面控制', desc: '鼠标键盘控制、窗口操作（高风险）', category: '系统', version: '0.5.2', enabled: false, author: 'LunarCore Claw' },
      ],
      cronJobs: [],
      workflows: [],
      memories: [],
      permissions: [
        { id: 'p1', capability: '网络访问', desc: '发起 HTTP 请求、浏览网页', level: 'full', scope: '全部域名' },
        { id: 'p2', capability: '文件读写', desc: '读写宿主机文件', level: 'confirm', scope: '~/Documents, 知识库目录' },
        { id: 'p3', capability: 'Shell 命令', desc: '执行终端命令', level: 'confirm', scope: '白名单命令' },
        { id: 'p4', capability: '桌面控制', desc: '鼠标、键盘、窗口操作', level: 'readonly', scope: '仅观察' },
        { id: 'p5', capability: '消息发送', desc: '以用户身份发飞书消息', level: 'confirm', scope: '指定群组' },
        { id: 'p6', capability: '定时自治', desc: '无人值守连续执行自动化流', level: 'full', scope: '已启用的工作流' },
      ],
      auditLogs: [],
      messages: [
        { id: 'msg0', role: 'assistant', content: '你好，我是 LunarCore Claw。当前是全新安装：请先到「模型管理」确认局域网 Ollama 端点在线或添加 API 模型，然后回到这里开始第一次对话。', time: now() },
      ],
      learning: [],
      activity: [],
      feishu: { appId: '', appSecret: '', webhook: '', defaultChat: '', enabled: false, forwardChat: false },
      wechat: { appId: '', appSecret: '', envId: '', botId: '', enabled: false, forwardChat: false },
      line: { channelToken: '', channelSecret: '', publicUrl: '', port: 8646, allowedUsers: '', homeChannel: '', enabled: false, forwardChat: false },
      tushare: { enabled: false, token: '', mcpUrl: 'https://api.tushare.pro/mcp/', protocol: 'streamable-http', status: 'untested', tools: 0 },
      patches: [],
      evolutionRuns: [],
      evolutionSettings: { cron: '0 2 * * *', autoApplyL01: true, requireApprovalL2: true, enabled: true },

      setLocalModels: (m) => set({ localModels: m }),
      setApiModels: (m) => set({ apiModels: m }),
      setMixtures: (m) => set({ mixtures: m }),
      setRouteRules: (r) => set({ routeRules: r }),
      setPlugins: (p) => set({ plugins: p }),
      setCronJobs: (c) => set({ cronJobs: c }),
      setWorkflows: (w) => set({ workflows: w }),
      setMemories: (m) => set({ memories: m }),
      setPermissions: (p) => set({ permissions: p }),
      setAuditLogs: (a) => set({ auditLogs: a }),
      setMessages: (m) => set({ messages: m }),
      setLearning: (l) => set({ learning: l }),
      setFeishu: (f) => set({ feishu: f }),
      setWechat: (w) => set({ wechat: w }),
      setLine: (l) => set({ line: l }),
      setTushare: (t) => set({ tushare: t }),
      setPatches: (p) => set({ patches: p }),
      setEvolutionRuns: (r) => set({ evolutionRuns: r }),
      setEvolutionSettings: (e) => set({ evolutionSettings: e }),
      log: (kind, text) => set((s) => ({ activity: [{ id: uid(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }), kind, text }, ...s.activity].slice(0, 50) })),
      audit: (actor, action, result) => set((s) => ({ auditLogs: [{ id: uid(), time: now(), actor, action, result }, ...s.auditLogs].slice(0, 100) })),
    }),
    {
      name: 'agentcore-store',
      version: 4,
      // 密钥类字段永不写入 localStorage（由 Electron safeStorage/内存保管）
      partialize: (s) => ({
        ...s,
        feishu: { ...s.feishu, appSecret: '' },
        wechat: { ...s.wechat, appSecret: '' },
        line: { ...s.line, channelToken: '', channelSecret: '' },
        tushare: { ...s.tushare, token: '' },
      }),
      migrate: (state: unknown, version: number) => {
        const s = state as State
        if (version < 4) {
          // v4 出厂重置：旧版所有种子/测试数据一律清空，仅保留权限与插件注册表
          return {
            ...s,
            localModels: [], apiModels: [], mixtures: [], routeRules: [],
            cronJobs: [], workflows: [], memories: [], auditLogs: [], activity: [],
            learning: [], patches: [], evolutionRuns: [],
            messages: [{ id: 'msg0', role: 'assistant' as const, content: '你好，我是 LunarCore Claw。当前是全新安装：请先到「模型管理」确认局域网 Ollama 端点在线或添加 API 模型，然后回到这里开始第一次对话。', time: now() }],
            feishu: { appId: '', appSecret: '', webhook: '', defaultChat: '', enabled: false, forwardChat: false },
      wechat: { appId: '', appSecret: '', envId: '', botId: '', enabled: false, forwardChat: false },
      line: { channelToken: '', channelSecret: '', publicUrl: '', port: 8646, allowedUsers: '', homeChannel: '', enabled: false, forwardChat: false },
            tushare: { enabled: false, token: '', mcpUrl: 'https://api.tushare.pro/mcp/', protocol: 'streamable-http' as const, status: 'untested' as const, tools: 0 },
            evolutionSettings: { cron: '0 2 * * *', autoApplyL01: true, requireApprovalL2: true, enabled: true },
          }
        }
        return s
      },
    }
  )
)

export const modelName = (id: string, s: Pick<State, 'localModels' | 'apiModels' | 'mixtures'>) => {
  const l = s.localModels.find((m) => m.id === id); if (l) return `${l.name}（本地）`
  const a = s.apiModels.find((m) => m.id === id); if (a) return `${a.provider}/${a.model}`
  const x = s.mixtures.find((m) => m.id === id); if (x) return `聚合 · ${x.name}`
  return id
}
