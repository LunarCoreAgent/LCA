import { useEffect, useState } from 'react'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Database, PlugZap, Wrench, RefreshCw, Table2, Info } from 'lucide-react'
import { toast } from 'sonner'
import { probePyBridge } from '@/lib/marketApi'
import {
  DB_DESIGN, dbDdl, dbEngines, dbInstall, dbTables, dbTest, cfgOf,
  loadDbProfile, saveDbProfile,
  type DbEngine, type DbProfile, type DbTablesResult,
} from '@/lib/dbApi'
import { useStore } from '@/lib/store'

export default function DatabasePage() {
  const s = useStore()
  const [profile, setProfile] = useState<DbProfile>(() => loadDbProfile())
  const [busy, setBusy] = useState<'test' | 'install' | 'tables' | null>(null)
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null)
  const [serverVer, setServerVer] = useState('')
  const [tablesInfo, setTablesInfo] = useState<DbTablesResult | null>(null)
  const [ddl, setDdl] = useState('')
  const [deps, setDeps] = useState<Record<string, { available: boolean; pip: string | null }>>({})

  // 桥在线状态 + 引擎依赖 + DDL 预览
  useEffect(() => {
    probePyBridge(true).then((b) => setBridgeOk(b.online)).catch(() => setBridgeOk(false))
    dbEngines().then((list) => {
      const m: Record<string, { available: boolean; pip: string | null }> = {}
      for (const e of list) m[e.id] = { available: e.available, pip: e.pip }
      setDeps(m)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    dbDdl(profile.engine).then((d) => setDdl(d.sql)).catch(() => setDdl(''))
  }, [profile.engine])

  const run = async (kind: 'test' | 'install' | 'tables') => {
    setBusy(kind)
    try {
      const cfg = await cfgOf(profile)
      if (kind === 'test') {
        const r = await dbTest(profile, cfg)
        setServerVer(r.version)
        toast.success(`连接成功：${profile.engine.toUpperCase()} ${r.version}`)
        s.log('db', `数据库连接测试通过（${profile.engine} ${r.version}）`)
      } else if (kind === 'install') {
        const r = await dbInstall(profile, cfg)
        toast.success(`数据库结构已就绪：新建 ${r.created.length} 张表，已存在 ${r.existing.length} 张，结构版本 v${r.schema_version}`)
        s.log('db', `自动建库完成（${profile.engine}）：新建 ${r.created.length} / 已存在 ${r.existing.length} / 结构 v${r.schema_version}`)
        setTablesInfo(await dbTables(profile, cfg))
      } else {
        setTablesInfo(await dbTables(profile, cfg))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '连接失败'
      if (/fetch|Failed to fetch|NetworkError/i.test(msg)) {
        setBridgeOk(false)
        toast.error('Python 数据桥未启动——请先到「数据中心」页启动数据桥')
      } else {
        toast.error(msg)
      }
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    const next = await saveDbProfile(profile)
    setProfile(next)
    toast.success('连接配置已保存（密码已加密存入系统钥匙串）')
    s.log('db', `数据库连接配置已保存（${next.engine}）`)
  }

  const engineDep = deps[profile.engine]
  const engineMissing = engineDep && !engineDep.available

  return (
    <div>
      <PageHeader title="数据库" desc="数据库结构设计与安装对接：选引擎 → 填连接 → 测试 → 一键自动在目标库建立 LunarCore 数据结构" />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* 结构设计总览 */}
          <Section title="数据库结构设计" desc="11 张业务表 + 索引 + 结构版本追踪（lc_meta.schema_version），三引擎方言自动适配">
            <div className="flex gap-1.5 mb-3">
              <Pill tone="green">结构 v1</Pill>
              <Pill tone="blue">SQLite 内置</Pill>
              <Pill>PostgreSQL</Pill>
              <Pill>MySQL</Pill>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {DB_DESIGN.map((t) => (
                <div key={t.name} className="rounded-lg border border-border/60 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <Table2 className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    <span className="font-mono text-xs font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.comment}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 font-mono mt-1 pl-5">{t.cols}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* 连接配置 */}
          <Section title="连接配置" desc="密码经系统钥匙串加密保存，不落明文">
            <div className="space-y-3">
              <div>
                <Label className="text-xs mb-1.5 flex items-center gap-1.5"><Database className="h-3 w-3" /> 数据库引擎</Label>
                <Select value={profile.engine} onValueChange={(v) => setProfile({ ...profile, engine: v as DbEngine })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqlite">SQLite（内置零依赖，本机文件）</SelectItem>
                    <SelectItem value="postgres">PostgreSQL（需桥端 psycopg2-binary）</SelectItem>
                    <SelectItem value="mysql">MySQL（需桥端 pymysql）</SelectItem>
                  </SelectContent>
                </Select>
                {engineMissing && (
                  <div className="text-xs text-amber-400 mt-1.5">桥端未安装该引擎驱动：<span className="font-mono">pip install {engineDep.pip}</span>（数据中心 → Python 数据桥可管理依赖）</div>
                )}
              </div>
              {profile.engine === 'sqlite' && (
                <div>
                  <Label className="text-xs mb-1.5 block">数据库文件路径（数据桥所在机器）</Label>
                  <Input value={profile.sqlitePath} onChange={(e) => setProfile({ ...profile, sqlitePath: e.target.value })} placeholder="lunarcore.db（相对桥目录）或绝对路径" />
                </div>
              )}
              {profile.engine === 'postgres' && (
                <PgFields profile={profile} setProfile={setProfile} />
              )}
              {profile.engine === 'mysql' && (
                <MyFields profile={profile} setProfile={setProfile} />
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" onClick={() => run('test')} disabled={busy != null}>
                  <PlugZap className="h-4 w-4 mr-1" /> {busy === 'test' ? '测试中…' : '测试连接'}
                </Button>
                <Button onClick={() => run('install')} disabled={busy != null}>
                  <Wrench className="h-4 w-4 mr-1" /> {busy === 'install' ? '建库中…' : '连接并自动建立数据库结构'}
                </Button>
                <Button variant="ghost" onClick={save}>保存配置</Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1 items-center">
                <span className="text-xs text-muted-foreground">状态：</span>
                {bridgeOk == null ? <Pill>检测中…</Pill> : bridgeOk ? <Pill tone="green">数据桥在线</Pill> : <Pill tone="amber">数据桥离线（先到数据中心启动）</Pill>}
                {serverVer && <Pill tone="blue">{profile.engine.toUpperCase()} {serverVer}</Pill>}
                {tablesInfo?.schema_version != null && <Pill tone="purple">结构 v{tablesInfo.schema_version} · {tablesInfo.tables.length} 张表</Pill>}
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          {/* 已建表总览 */}
          <Section title="已建表总览" desc="连接后自动获取目标库中的 LunarCore 表">
            <div className="flex justify-end mb-2">
              <Button variant="outline" size="sm" onClick={() => run('tables')} disabled={busy != null}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
              </Button>
            </div>
            {!tablesInfo && <div className="text-sm text-muted-foreground text-center py-6">执行「连接并自动建立数据库结构」或点刷新后显示</div>}
            {tablesInfo && tablesInfo.tables.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">目标库中尚无 lc_ 开头的表——点「连接并自动建立数据库结构」</div>}
            {tablesInfo && tablesInfo.tables.length > 0 && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr><th className="text-left px-3 py-2 font-medium">表名</th><th className="text-right px-3 py-2 font-medium">列数</th><th className="text-right px-3 py-2 font-medium">行数</th></tr>
                  </thead>
                  <tbody>
                    {tablesInfo.tables.map((t) => (
                      <tr key={t.name} className="border-t border-border/40">
                        <td className="px-3 py-1.5 font-mono">{t.name}</td>
                        <td className="px-3 py-1.5 text-right">{t.columns}</td>
                        <td className="px-3 py-1.5 text-right">{t.rows ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* DDL 预览 */}
          <Section title="DDL 预览" desc={`当前引擎（${profile.engine}）实际执行的建库语句，由数据桥按方言生成`}>
            <pre className="text-[10px] leading-relaxed font-mono bg-background/60 border border-border/60 rounded-lg p-3 max-h-72 overflow-auto whitespace-pre-wrap">
              {ddl || '（数据桥离线时不可获取）'}
            </pre>
          </Section>

          <div className="rounded-lg bg-background/60 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 shrink-0 text-sky-400" />
            本版本交付「结构安装」：连接后自动建表并写入结构版本；把对话、记忆、日志等运行时数据切换到数据库读写将在后续版本提供（当前仍走本机配置存储）。
          </div>
        </div>
      </div>
    </div>
  )
}

function PgFields({ profile, setProfile }: { profile: DbProfile; setProfile: (p: DbProfile) => void }) {
  const pg = profile.pg
  const up = (patch: Partial<typeof pg>) => setProfile({ ...profile, pg: { ...pg, ...patch } })
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><Label className="text-xs mb-1.5 block">主机</Label><Input value={pg.host} onChange={(e) => up({ host: e.target.value })} /></div>
        <div><Label className="text-xs mb-1.5 block">端口</Label><Input type="number" value={pg.port} onChange={(e) => up({ port: Number(e.target.value) || 5432 })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs mb-1.5 block">数据库名</Label><Input value={pg.dbname} onChange={(e) => up({ dbname: e.target.value })} /></div>
        <div><Label className="text-xs mb-1.5 block">用户名</Label><Input value={pg.user} onChange={(e) => up({ user: e.target.value })} /></div>
      </div>
      <div><Label className="text-xs mb-1.5 block">密码</Label><Input type="password" value={pg.password} onChange={(e) => up({ password: e.target.value })} /></div>
    </>
  )
}

function MyFields({ profile, setProfile }: { profile: DbProfile; setProfile: (p: DbProfile) => void }) {
  const my = profile.my
  const up = (patch: Partial<typeof my>) => setProfile({ ...profile, my: { ...my, ...patch } })
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><Label className="text-xs mb-1.5 block">主机</Label><Input value={my.host} onChange={(e) => up({ host: e.target.value })} /></div>
        <div><Label className="text-xs mb-1.5 block">端口</Label><Input type="number" value={my.port} onChange={(e) => up({ port: Number(e.target.value) || 3306 })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs mb-1.5 block">数据库名</Label><Input value={my.db} onChange={(e) => up({ db: e.target.value })} /></div>
        <div><Label className="text-xs mb-1.5 block">用户名</Label><Input value={my.user} onChange={(e) => up({ user: e.target.value })} /></div>
      </div>
      <div><Label className="text-xs mb-1.5 block">密码</Label><Input type="password" value={my.password} onChange={(e) => up({ password: e.target.value })} /></div>
    </>
  )
}
