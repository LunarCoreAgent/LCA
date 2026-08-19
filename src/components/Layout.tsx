import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import {
  LayoutDashboard, MessageSquare, Boxes, Route, Puzzle, Workflow,
  Clock, Brain, ShieldCheck, GraduationCap,
  CandlestickChart, ChartLine, Dna, DatabaseZap, Settings, ChevronDown, ChevronUp, Smartphone, Database, History, BookOpen,
  Wallet, BookMarked, ClipboardList, Telescope, Gauge,
  PlayCircle, ShieldAlert, Network, Ghost, Activity, FlaskConical,
} from 'lucide-react'
import logoUrl from '@/assets/logo.png'

// 主导航按业务域分组（对齐 v3.1.0 蓝图分类：洞察 / 市场 / 量化 / 系统）
export interface NavItem { id: string; label: string; icon: typeof LayoutDashboard }

export const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: '洞察',
    items: [
      { id: 'dashboard', label: '总览', icon: LayoutDashboard },
      { id: 'chat', label: '对话', icon: MessageSquare },
    ],
  },
  {
    group: '市场',
    items: [
      { id: 'stockdata', label: '行情采集', icon: CandlestickChart },
      { id: 'datacenter', label: '数据中心', icon: DatabaseZap },
      { id: 'sources', label: '数据链路', icon: Activity },
    ],
  },
  {
    group: '量化',
    items: [
      { id: 'portfolio', label: '投资组合', icon: Wallet },
      { id: 'journal', label: '交易日志', icon: BookMarked },
      { id: 'shadow', label: '影子账户', icon: Ghost },
      { id: 'review', label: '每日复盘', icon: ClipboardList },
      { id: 'prediction', label: '推演预测', icon: Telescope },
      { id: 'benchmark', label: '预测基准', icon: Gauge },
      { id: 'paper', label: '模拟交易', icon: PlayCircle },
      { id: 'risk', label: '风险中心', icon: ShieldAlert },
      // 实盘网关页面已隐藏（v0.10.2）：LiveTrading.tsx 保留，恢复时取消下一行注释并还原 App.tsx 路由
      // { id: 'live', label: '实盘网关', icon: Lock },
      { id: 'ensemble', label: '决策中心', icon: Network },
      { id: 'quant', label: '量化分析', icon: ChartLine },
      { id: 'alpha', label: '因子工场', icon: FlaskConical },
    ],
  },
  {
    group: '系统',
    items: [
      { id: 'automation', label: '自动化', icon: Workflow },
      { id: 'cron', label: '定时任务', icon: Clock },
      { id: 'learning', label: '自我学习', icon: GraduationCap },
      { id: 'evolution', label: '进化日志', icon: Dna },
    ],
  },
]

export const NAV_MAIN: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

// 设置菜单（收纳于左下角「设置」按钮，在状态区上方展开）
export const NAV_SETTINGS = [
  { id: 'models', label: '模型管理', icon: Boxes },
  { id: 'router', label: '路由引擎', icon: Route },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'integrations', label: '连接手机', icon: Smartphone },
  { id: 'database', label: '数据库', icon: Database },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
  { id: 'memory', label: '长期记忆', icon: Brain },
  { id: 'permissions', label: '权限控制', icon: ShieldCheck },
] as const

export const NAV = [...NAV_MAIN, ...NAV_SETTINGS] as const

export type PageId = (typeof NAV)[number]['id'] | 'versions'

// 两字/三字标签拉伸到四字宽度（两端对齐），与四字标签视觉对齐
function NavLabel({ label }: { label: string }) {
  const chars = [...label.replace(/[\s·]/g, '')].length
  if (chars >= 4) return <span>{label}</span>
  return <span className="inline-block w-[4em] text-justify [text-align-last:justify]">{label}</span>
}

function NavButton({ id, label, icon: Icon, page, setPage }: { id: PageId; label: string; icon: typeof LayoutDashboard; page: PageId; setPage: (p: PageId) => void }) {
  return (
    <button
      onClick={() => setPage(id)}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
        page === id ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <NavLabel label={label} />
    </button>
  )
}

const SETTINGS_KEY = 'agentcore-nav-settings-open'

export function Layout({ page, setPage, children }: { page: PageId; setPage: (p: PageId) => void; children: ReactNode }) {
  const { localModels, apiModels, mixtures } = useStore()
  const running = localModels.filter((m) => m.status === 'running').length
  const online = apiModels.filter((m) => m.status === 'online').length
  const activeMix = mixtures.filter((m) => m.enabled).length
  const inSettings = (NAV_SETTINGS as readonly { id: string }[]).some((n) => n.id === page)
  const [settingsOpen, setSettingsOpen] = useState(() => {
    const saved = localStorage.getItem(SETTINGS_KEY)
    return saved != null ? saved === '1' : inSettings
  })

  // 通过快捷键/直达链接进入设置类页面时自动展开设置菜单
  useEffect(() => {
    if (inSettings) setSettingsOpen(true)
  }, [inSettings])

  const toggleSettings = () => {
    const v = !settingsOpen
    setSettingsOpen(v)
    localStorage.setItem(SETTINGS_KEY, v ? '1' : '0')
  }

  // 点击设置菜单以外的任意位置时自动收起
  const settingsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
        localStorage.setItem(SETTINGS_KEY, '0')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [settingsOpen])

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* 侧边栏 */}
      <aside className="w-60 shrink-0 border-r border-border/60 flex flex-col fixed inset-y-0 bg-card/40 backdrop-blur">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border/60">
          <img src={logoUrl} alt="LunarCore Claw" className="h-8 w-8 rounded-lg" />
          <div>
            <div className="font-bold leading-tight">LunarCore Claw</div>
            <div className="text-[10px] text-muted-foreground">多模型智能体平台</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-0.5">
          {NAV_GROUPS.map((g) => (
            <div key={g.group}>
              <div className="px-3 pt-3 pb-1 text-[10px] font-medium tracking-[0.3em] text-muted-foreground/60 select-none">
                {g.group}
              </div>
              {g.items.map(({ id, label, icon }) => (
                <NavButton key={id} id={id} label={label} icon={icon} page={page} setPage={setPage} />
              ))}
            </div>
          ))}
        </nav>
        {/* 设置菜单：模型管理 / 路由引擎 / 插件 / 连接手机 / 数据库 / 知识库 / 长期记忆 / 权限控制 */}
        <div ref={settingsRef} className="px-3 pb-3 space-y-1.5">
          {settingsOpen && (
            <div className="space-y-0.5 rounded-lg border border-white/10 bg-accent p-1.5">
              {NAV_SETTINGS.map(({ id, label, icon }) => (
                <NavButton key={id} id={id} label={label} icon={icon} page={page} setPage={setPage} />
              ))}
            </div>
          )}
          <button
            onClick={toggleSettings}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              inSettings ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <NavLabel label="设置" />
            {settingsOpen ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronUp className="h-3.5 w-3.5 ml-auto" />}
          </button>
          <NavButton id="versions" label="版本说明" icon={History} page={page} setPage={setPage} />
        </div>
        <div className="p-4 border-t border-border/60 text-xs space-y-1.5">
          <div className="flex justify-between"><span className="text-muted-foreground">本地模型</span><span className="text-emerald-400">{running} 运行中</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">API 模型</span><span className="text-sky-400">{online} 在线</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">聚合池</span><span className="text-violet-400">{activeMix} 启用</span></div>
        </div>
      </aside>
      {/* 主区域：宽度自适应屏幕，窗口放大后内容同步拉伸 */}
      <main className="flex-1 ml-60 p-8 w-full min-w-0">{children}</main>
    </div>
  )
}
