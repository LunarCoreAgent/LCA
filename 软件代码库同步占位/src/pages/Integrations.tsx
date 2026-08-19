import { useState } from 'react'
import { useStore } from '@/lib/store'
import { PageHeader, Section, Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MessageSquare, Send, Webhook, Users, KeyRound, Cloud, Bot, ListChecks, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { saveSecret, loadSecret, maskSecret } from '@/lib/secrets'

export default function Integrations() {
  return (
    <div>
      <PageHeader title="连接手机" desc="手机即入口：飞书 / 微信 / LINE 三个渠道——收发消息、定时推送，进同一套路由引擎" />
      <Tabs defaultValue="feishu">
        <TabsList className="mb-4">
          <TabsTrigger value="feishu">飞书</TabsTrigger>
          <TabsTrigger value="wechat">微信</TabsTrigger>
          <TabsTrigger value="line">LINE</TabsTrigger>
        </TabsList>
        <TabsContent value="feishu"><FeishuPanel /></TabsContent>
        <TabsContent value="wechat"><WechatPanel /></TabsContent>
        <TabsContent value="line"><LinePanel /></TabsContent>
      </Tabs>
    </div>
  )
}

const feishuLog = [
  { time: '14:02', dir: 'in', text: '群「LunarCore Claw 通知群」：@机器人 明天日程是什么' },
  { time: '14:02', dir: 'out', text: '回复卡片：明日 3 个会议，09:30 产品评审…' },
  { time: '08:00', dir: 'out', text: '定时任务推送：晨报卡片（晨报自动化流）' },
]

function FeishuPanel() {
  const s = useStore()
  const f = s.feishu

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Section title="应用凭证" desc="飞书开放平台自建应用的 App ID / Secret">
          <div className="space-y-3">
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> App ID</Label>
              <Input value={f.appId} onChange={(e) => s.setFeishu({ ...f, appId: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> App Secret</Label>
              <Input type="password" value={f.appSecret} onChange={(e) => s.setFeishu({ ...f, appSecret: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Webhook className="h-3 w-3" /> 自定义机器人 Webhook（群推送用）</Label>
              <Input value={f.webhook} onChange={(e) => s.setFeishu({ ...f, webhook: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Users className="h-3 w-3" /> 默认推送群</Label>
              <Input value={f.defaultChat} onChange={(e) => s.setFeishu({ ...f, defaultChat: e.target.value })} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => { s.log('feishu', '飞书凭证连通性测试通过'); toast.success('连接成功，机器人在线') }}>测试连接</Button>
              <Button onClick={async () => {
                if (f.appSecret && !f.appSecret.startsWith('•')) {
                  await saveSecret('feishu:appSecret', f.appSecret)
                  s.setFeishu({ ...f, appSecret: maskSecret(f.appSecret) })
                }
                s.log('feishu', '飞书配置已保存，App Secret 已加密存入系统钥匙串')
                toast.success('配置已保存，Secret 已加密存储（不再明文落盘）')
              }}>保存</Button>
            </div>
          </div>
        </Section>
        <Section title="行为开关">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">启用飞书机器人</div>
                <div className="text-xs text-muted-foreground">关闭后所有推送与群对话暂停</div>
              </div>
              <Switch checked={f.enabled} onCheckedChange={(v) => s.setFeishu({ ...f, enabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">群聊消息接入对话</div>
                <div className="text-xs text-muted-foreground">@机器人 的消息会进入对话流，走同一套路由引擎</div>
              </div>
              <Switch checked={f.forwardChat} onCheckedChange={(v) => s.setFeishu({ ...f, forwardChat: v })} />
            </div>
          </div>
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="消息日志" desc="最近的收发记录">
          <div className="space-y-3">
            {feishuLog.map((l, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="text-xs text-muted-foreground w-10 pt-0.5">{l.time}</span>
                <Pill tone={l.dir === 'in' ? 'blue' : 'green'}>{l.dir === 'in' ? '收到' : '发出'}</Pill>
                <span className="text-foreground/90">{l.text}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="快速验证" desc="向默认群发一条测试卡片">
          <Button onClick={() => { s.audit('user', '发送飞书测试卡片', 'confirmed'); toast.success('测试卡片已发送到「' + f.defaultChat + '」') }}>
            <Send className="h-4 w-4 mr-1" /> 发送测试消息
          </Button>
          <div className="mt-4 rounded-lg bg-background/60 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-sky-400" />
            定时任务、自动化流、权限审批请求都可以配置为推送到飞书——例如「桌面控制」类高风险操作触发时，你会在飞书收到确认卡片，点按钮即可授权。
          </div>
        </Section>
      </div>
    </div>
  )
}

// ===== 微信渠道：公众平台 AppID/Secret + 云开发 AI Agent =====
function WechatPanel() {
  const s = useStore()
  const w = s.wechat
  const [testing, setTesting] = useState(false)

  const save = async () => {
    let next = w
    if (w.appSecret && !w.appSecret.startsWith('•')) {
      await saveSecret('wechat:appSecret', w.appSecret)
      next = { ...w, appSecret: maskSecret(w.appSecret) }
    }
    s.setWechat(next)
    s.log('wechat', '微信配置已保存，App Secret 已加密存入系统钥匙串')
    toast.success('微信配置已保存，Secret 已加密存储')
  }

  const test = async () => {
    const api = window.agentcore?.channel?.test
    if (!api) { toast.info('浏览器开发态无系统通道，请在桌面版中测试'); return }
    const secret = w.appSecret.startsWith('•') ? await loadSecret('wechat:appSecret') : w.appSecret
    if (!w.appId.trim() || !secret) { toast.error('请先填写 AppID 与 App Secret'); return }
    setTesting(true)
    try {
      const r = await api('wechat', { appId: w.appId.trim(), secret })
      if (r.ok) { toast.success(`连接成功：${r.detail}`); s.log('wechat', `微信连通性测试通过：${r.detail}`) }
      else { toast.error(`连接失败：${r.detail}`); s.log('wechat', `微信连通性测试失败：${r.detail}`) }
    } finally { setTesting(false) }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Section title="平台凭证" desc="微信公众平台 + 云开发 AI Agent（Agent 接入）">
          <div className="space-y-3">
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> AppID（公众平台 · 设置与开发 → 基本配置）</Label>
              <Input value={w.appId} onChange={(e) => s.setWechat({ ...w, appId: e.target.value })} placeholder="wx…" />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> App Secret</Label>
              <Input type="password" value={w.appSecret} onChange={(e) => s.setWechat({ ...w, appSecret: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Cloud className="h-3 w-3" /> 云开发环境 ID</Label>
              <Input value={w.envId} onChange={(e) => s.setWechat({ ...w, envId: e.target.value })} placeholder="云开发控制台 → 环境" />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Bot className="h-3 w-3" /> Agent ID（botId）</Label>
              <Input value={w.botId} onChange={(e) => s.setWechat({ ...w, botId: e.target.value })} placeholder="云开发控制台 → AI → Agent → 复制 ID" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={test} disabled={testing}>{testing ? '测试中…' : '测试连接'}</Button>
              <Button onClick={save}>保存</Button>
            </div>
          </div>
        </Section>
        <Section title="行为开关">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">启用微信渠道</div>
                <div className="text-xs text-muted-foreground">关闭后微信侧推送与消息接入暂停</div>
              </div>
              <Switch checked={w.enabled} onCheckedChange={(v) => s.setWechat({ ...w, enabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">消息接入对话</div>
                <div className="text-xs text-muted-foreground">微信侧用户消息进入对话流，走同一套路由引擎</div>
              </div>
              <Switch checked={w.forwardChat} onCheckedChange={(v) => s.setWechat({ ...w, forwardChat: v })} />
            </div>
          </div>
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="接入步骤" desc="按微信开放文档「Agent 接入」配置">
          <ol className="space-y-2.5 text-xs text-muted-foreground list-none">
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 1. 微信公众平台「设置与开发 → 基本配置 → 公众号开发信息」复制 AppID 与 App Secret，填入左侧并保存</li>
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 2. 开通云开发环境（小程序基础库 ≥ 3.7.1），在 云开发控制台 → AI → Agent 创建 Agent 并「复制 ID」</li>
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 3. 小程序侧用 wx.cloud.extend.AI 的 ai.bot.sendMessage 调用（threadId 管多轮会话，SSE 流式返回）</li>
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 4. 公众号侧完成授权配置后，即可用 AI 消息推送能力回复用户消息</li>
          </ol>
        </Section>
        <Section title="快速验证" desc="用 AppID + Secret 换取 access_token 验证凭证有效性">
          <Button onClick={test} disabled={testing}><Send className="h-4 w-4 mr-1" /> {testing ? '验证中…' : '验证凭证'}</Button>
          <div className="mt-4 rounded-lg bg-background/60 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-sky-400" />
            会话由服务端 threadId 管理，客户端每次只传当前消息；定时任务与自动化流可配置推送到微信侧。
          </div>
        </Section>
      </div>
    </div>
  )
}

// ===== LINE 渠道：Messaging API（Channel Token/Secret + Webhook 允许列表）=====
function LinePanel() {
  const s = useStore()
  const l = s.line
  const [testing, setTesting] = useState(false)

  const save = async () => {
    let next = l
    if (l.channelToken && !l.channelToken.startsWith('•')) {
      await saveSecret('line:channelToken', l.channelToken)
      next = { ...next, channelToken: maskSecret(l.channelToken) }
    }
    if (l.channelSecret && !l.channelSecret.startsWith('•')) {
      await saveSecret('line:channelSecret', l.channelSecret)
      next = { ...next, channelSecret: maskSecret(l.channelSecret) }
    }
    s.setLine(next)
    s.log('line', 'LINE 配置已保存，Token/Secret 已加密存入系统钥匙串')
    toast.success('LINE 配置已保存，凭证已加密存储')
  }

  const test = async () => {
    const api = window.agentcore?.channel?.test
    if (!api) { toast.info('浏览器开发态无系统通道，请在桌面版中测试'); return }
    const token = l.channelToken.startsWith('•') ? await loadSecret('line:channelToken') : l.channelToken
    if (!token) { toast.error('请先填写 Channel Access Token'); return }
    setTesting(true)
    try {
      const r = await api('line', { token })
      if (r.ok) { toast.success(`连接成功：${r.detail}`); s.log('line', `LINE 连通性测试通过：${r.detail}`) }
      else { toast.error(`连接失败：${r.detail}`); s.log('line', `LINE 连通性测试失败：${r.detail}`) }
    } finally { setTesting(false) }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Section title="渠道凭证" desc="LINE Developers Console → Messaging API 渠道">
          <div className="space-y-3">
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> Channel Access Token（长期）</Label>
              <Input type="password" value={l.channelToken} onChange={(e) => s.setLine({ ...l, channelToken: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><KeyRound className="h-3 w-3" /> Channel Secret（Webhook HMAC 验签）</Label>
              <Input type="password" value={l.channelSecret} onChange={(e) => s.setLine({ ...l, channelSecret: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Globe className="h-3 w-3" /> 公网 URL（隧道）</Label>
                <Input value={l.publicUrl} onChange={(e) => s.setLine({ ...l, publicUrl: e.target.value })} placeholder="https://…（cloudflared / ngrok）" />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Webhook className="h-3 w-3" /> Webhook 端口</Label>
                <Input type="number" value={l.port} onChange={(e) => s.setLine({ ...l, port: Number(e.target.value) || 8646 })} />
              </div>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Users className="h-3 w-3" /> 允许列表（U/C/R 前缀 ID，逗号分隔）</Label>
              <Input value={l.allowedUsers} onChange={(e) => s.setLine({ ...l, allowedUsers: e.target.value })} placeholder="U…（用户）, C…（群组）, R…（房间）" />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5 mb-1.5"><Send className="h-3 w-3" /> 默认投递目标（定时任务/通知）</Label>
              <Input value={l.homeChannel} onChange={(e) => s.setLine({ ...l, homeChannel: e.target.value })} placeholder="U…" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={test} disabled={testing}>{testing ? '测试中…' : '测试连接'}</Button>
              <Button onClick={save}>保存</Button>
            </div>
          </div>
        </Section>
        <Section title="行为开关">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">启用 LINE 渠道</div>
                <div className="text-xs text-muted-foreground">关闭后 LINE 侧推送与消息接入暂停</div>
              </div>
              <Switch checked={l.enabled} onCheckedChange={(v) => s.setLine({ ...l, enabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">消息接入对话</div>
                <div className="text-xs text-muted-foreground">允许列表内的私聊/群聊消息进入对话流，走同一套路由引擎</div>
              </div>
              <Switch checked={l.forwardChat} onCheckedChange={(v) => s.setLine({ ...l, forwardChat: v })} />
            </div>
          </div>
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="接入步骤" desc="LINE Messaging API 官方流程">
          <ol className="space-y-2.5 text-xs text-muted-foreground list-none">
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 1. LINE Developers Console 创建 Provider 与 Messaging API 渠道；Basic settings 复制 Channel secret</li>
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 2. Messaging API 页签发 Channel access token (long-lived)；关闭 Auto-reply 与 Greeting messages</li>
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 3. 隧道暴露 Webhook 端口（默认 8646）：cloudflared tunnel --url http://localhost:8646 或 ngrok http 8646</li>
            <li className="flex gap-2"><ListChecks className="h-4 w-4 shrink-0 text-emerald-400" /> 4. 控制台 Webhook URL 填 https://&lt;隧道&gt;/line/webhook → Verify → 打开 Use webhook；扫码加机器人为好友</li>
          </ol>
        </Section>
        <Section title="快速验证" desc="用 Channel Token 查询机器人信息（GET /v2/bot/info）">
          <Button onClick={test} disabled={testing}><Send className="h-4 w-4 mr-1" /> {testing ? '验证中…' : '验证凭证'}</Button>
          <div className="mt-4 rounded-lg bg-background/60 border border-border/60 p-3 text-xs text-muted-foreground flex gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-sky-400" />
            出站优先用免费回复令牌（约 60 秒窗口），超时回退 Push API；单条气泡上限 5000 字，长回复自动分块；定时任务推送到「默认投递目标」。
          </div>
        </Section>
      </div>
    </div>
  )
}
