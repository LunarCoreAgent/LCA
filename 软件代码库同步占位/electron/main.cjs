const { app, BrowserWindow, shell, ipcMain, safeStorage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
const zlib = require('zlib')

// ===== 通用抓取：自动解压 gzip/deflate/br，可选 GBK 解码，自定义 UA/Referer =====
// 关键修复：Node 不会像浏览器那样自动解压 Content-Encoding，东财/腾讯 CDN 返回压缩包时必须手动解压，否则 JSON.parse 必败
function getRaw(url, redirects = 2, headers, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https:') ? https : http
    const req = lib.get(url, {
      headers: headers ?? { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Referer: 'https://quote.eastmoney.com/', 'Accept-Encoding': 'gzip, deflate, br' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString()
        getRaw(loc, redirects - 1, headers, encoding).then(resolve, reject)
        return
      }
      if (res.statusCode >= 400) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
      let stream = res
      const enc = String(res.headers['content-encoding'] || '')
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip())
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate())
      else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress())
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('end', () => {
        const buf = Buffer.concat(chunks)
        try {
          resolve(new TextDecoder(encoding === 'gbk' ? 'gbk' : 'utf-8').decode(buf))
        } catch { resolve(buf.toString('utf8')) }
      })
      stream.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('请求超时（10s）')))
    req.on('error', reject)
  })
}

function getJson(url, redirects = 2, headers) {
  return getRaw(url, redirects, headers).then((text) => {
    try { return JSON.parse(text) } catch { throw new Error('数据解析失败（非 JSON 响应）') }
  })
}

// 东方财富妙想（官方金融数据 AI 接口）：POST + apikey 头，白名单仅 dfcfs.com
ipcMain.handle('market:mxquery', (_e, apiKey, toolQuery) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ toolQuery: String(toolQuery ?? '') })
    const req = https.request('https://mkapi2.dfcfs.com/finskillshub/api/claw/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        apikey: String(apiKey ?? ''),
        'User-Agent': 'LunarCoreClaw/1.0',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: 20000,
    }, (res) => {
      let stream = res
      const enc = String(res.headers['content-encoding'] || '')
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip())
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate())
      else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress())
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}：${text.slice(0, 200)}`)); return }
        resolve(text)
      })
      stream.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('妙想接口请求超时（20s）')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
})

// QVeris 能力路由（https://qveris.ai/api/v1）：POST + Bearer，白名单仅 qveris.ai
ipcMain.handle('qveris:request', (_e, path, apiKey, body, query, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const p = String(path ?? '')
    if (!/^\/[a-z0-9/_-]*$/i.test(p)) { reject(new Error('非法 API 路径')); return }
    const u = new URL('https://qveris.ai/api/v1' + p)
    if (query && typeof query === 'object') {
      for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v))
    }
    const payload = JSON.stringify(body ?? {})
    const req = https.request(u.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${String(apiKey ?? '')}`,
        'User-Agent': 'LunarCoreClaw/1.0',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: Math.min(Math.max(Number(timeoutMs) || 30000, 5000), 120000),
    }, (res) => {
      let stream = res
      const enc = String(res.headers['content-encoding'] || '')
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip())
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate())
      else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress())
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}：${text.slice(0, 160)}`)); return }
        try { resolve(JSON.parse(text)) } catch { reject(new Error('数据解析失败（非 JSON 响应）')) }
      })
      stream.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('QVeris 接口请求超时')))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
})

// 通用 JSON POST IPC（Tushare Pro、理杏仁开放平台等）：白名单域名限定
const POST_HOSTS = ['tushare.pro', 'lixinger.com']

// ===== Python 本地数据桥（AkShare + BaoStock）生命周期管理 =====
const { spawn, execFile } = require('child_process')
const PY_BRIDGE_PORT = 17895
let pyChild = null
const pyLogFile = () => path.join(app.getPath('userData'), 'pybridge.log')
function pyLog(line) {
  try { fs.appendFileSync(pyLogFile(), `[${new Date().toISOString()}] ${line}\n`) } catch { /* ignore */ }
}
// 桥脚本定位：开发态在 <项目>/python，打包态在 Contents/Resources/python（pack 脚本拷入）
function bridgeSrcPath() {
  const candidates = [
    path.join(__dirname, '..', 'python', 'ak_bridge.py'),
    path.join(process.resourcesPath || '', 'python', 'ak_bridge.py'),
  ]
  return candidates.find((p) => { try { return fs.existsSync(p) } catch { return false } }) ?? null
}
function findPython() {
  const candidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
  for (const p of candidates) { try { if (fs.existsSync(p)) return p } catch { /* next */ } }
  return 'python3' // 依赖 PATH
}
function bridgeHealth(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PY_BRIDGE_PORT}/health`, { timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) } })
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
  })
}
ipcMain.handle('pybridge:status', async () => {
  const health = await bridgeHealth()
  return { running: !!pyChild && pyChild.exitCode == null, health }
})
ipcMain.handle('pybridge:start', () => {
  try {
    if (pyChild && pyChild.exitCode == null) return { ok: true, note: '已在运行' }
    const src = bridgeSrcPath()
    if (!src) return { ok: false, error: '未找到桥接脚本 ak_bridge.py' }
    // 复制到 userData 运行：.app 只读场景可用，且便于就地升级
    const dst = path.join(app.getPath('userData'), 'ak_bridge.py')
    fs.copyFileSync(src, dst)
    const py = findPython()
    pyChild = spawn(py, [dst], { stdio: ['ignore', 'pipe', 'pipe'] })
    pyChild.stdout.on('data', (d) => pyLog(`[out] ${String(d).trim()}`))
    pyChild.stderr.on('data', (d) => pyLog(`[err] ${String(d).trim()}`))
    pyChild.on('exit', (code) => { pyLog(`桥进程退出 code=${code}`); pyChild = null })
    pyLog(`桥已启动（${py} ${dst}）`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '启动失败' }
  }
})
ipcMain.handle('pybridge:stop', () => {
  try { if (pyChild) { pyChild.kill(); pyChild = null } pyLog('桥已停止'); return { ok: true } } catch { return { ok: true } }
})
// 一键安装依赖：python3 -m pip install --user akshare baostock（流式日志写入 pybridge.log）
ipcMain.handle('pybridge:install', () => {
  return new Promise((resolve) => {
    const py = findPython()
    pyLog(`开始安装依赖：${py} -m pip install --user akshare baostock`)
    execFile(py, ['-m', 'pip', 'install', '--user', '--upgrade', 'akshare', 'baostock'], { timeout: 300000 }, (err, stdout, stderr) => {
      if (stdout) pyLog(`[pip] ${String(stdout).slice(-2000)}`)
      if (stderr) pyLog(`[pip-err] ${String(stderr).slice(-2000)}`)
      if (err) { resolve({ ok: false, error: String(stderr || err.message).slice(-300) }); return }
      resolve({ ok: true })
    })
  })
})
ipcMain.handle('pybridge:log', () => {
  try { return fs.readFileSync(pyLogFile(), 'utf8').split('\n').slice(-80).join('\n') } catch { return '' }
})
ipcMain.handle('market:post', (_e, url, jsonBody) => {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(String(url)) } catch { reject(new Error('非法 URL')); return }
    if (!POST_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) {
      reject(new Error('域名不在数据接口白名单')); return
    }
    const body = typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody ?? {})
    const req = https.request(u.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'LunarCoreClaw/1.0',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: 15000,
    }, (res) => {
      let stream = res
      const enc = String(res.headers['content-encoding'] || '')
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip())
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate())
      else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress())
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return }
        resolve(text)
      })
      stream.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('POST 请求超时（15s）')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
})

// 文本抓取 IPC（腾讯/新浪行情为纯文本格式）：白名单域名 + 可选 GBK 解码
const TEXT_HOSTS = ['eastmoney.com', 'gtimg.cn', 'qq.com', 'sinajs.cn', 'sina.com.cn', 'yahoo.com', '126.net', '163.com',
  'zhituapi.com', 'juhe.cn', 'alphavantage.co', 'finnhub.io', 'twelvedata.com', 'polygon.io']
// ===== 知识库端点通用请求（LLM Wiki / AnythingLLM）=====
// 安全策略：http 仅允许 localhost/私网段（127.0.0.1、192.168.x、10.x、172.16-31.x），https 任意（公网知识库服务器须走 https）
// ===== 手机渠道连通性测试：微信（公众平台 access_token）/ LINE（bot info）=====
ipcMain.handle('channel:test', async (_e, kind, cfg) => {
  try {
    if (kind === 'wechat') {
      const j = await getJson(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(String(cfg?.appId || ''))}&secret=${encodeURIComponent(String(cfg?.secret || ''))}`)
      if (j && j.access_token) return { ok: true, detail: 'access_token 获取成功，AppID / AppSecret 有效' }
      return { ok: false, detail: j ? `${j.errcode ?? ''} ${j.errmsg ?? '未知错误'}`.trim() : '无响应' }
    }
    if (kind === 'line') {
      const j = await getJson('https://api.line.me/v2/bot/info', 2, { Authorization: `Bearer ${String(cfg?.token || '')}` })
      if (j && (j.displayName || j.userId)) return { ok: true, detail: `机器人在线：${j.displayName ?? j.userId}` }
      return { ok: false, detail: '未返回机器人信息（Token 可能无效）' }
    }
    return { ok: false, detail: '未知渠道' }
  } catch (e) { return { ok: false, detail: String(e && e.message ? e.message : e).slice(0, 150) } }
})

ipcMain.handle('kb:request', (_e, opts) => {
  return new Promise((resolve, reject) => {
    const { method, url, token, body } = opts || {}
    let u
    try { u = new URL(String(url)) } catch { reject(new Error('非法 URL')); return }
    const host = u.hostname
    const isLocal = host === '127.0.0.1' || host === 'localhost'
      || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    if (u.protocol === 'http:' && !isLocal) { reject(new Error('http 仅允许 localhost/私网段地址（公网请用 https）')); return }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { reject(new Error('仅支持 http/https')); return }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(u, {
      method: method === 'POST' ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(String(body)) } : {}),
      },
      timeout: 15000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks)
          const enc = res.headers['content-encoding']
          const done = (out) => {
            if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}: ${out.slice(0, 200)}`)); return }
            resolve(out)
          }
          if (enc === 'gzip') zlib.gunzip(buf, (e, d) => e ? reject(e) : done(d.toString('utf8')))
          else if (enc === 'deflate') zlib.inflate(buf, (e, d) => e ? reject(e) : done(d.toString('utf8')))
          else if (enc === 'br') zlib.brotliDecompress(buf, (e, d) => e ? reject(e) : done(d.toString('utf8')))
          else done(buf.toString('utf8'))
        } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.on('error', reject)
    if (body) req.write(String(body))
    req.end()
  })
})

ipcMain.handle('market:text', (_e, url, encoding, referer) => {
  try {
    const u = new URL(String(url))
    if (!TEXT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) {
      return Promise.reject(new Error('域名不在行情白名单'))
    }
  } catch { return Promise.reject(new Error('非法 URL')) }
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Accept-Encoding': 'gzip, deflate, br' }
  if (referer) headers.Referer = String(referer)
  return getRaw(String(url), 2, headers, encoding === 'gbk' ? 'gbk' : 'utf8')
})

const EM_FIELDS = 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18'
ipcMain.handle('market:quotes', (_e, secids) =>
  getJson(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(String(secids))}&fields=${EM_FIELDS}`))
ipcMain.handle('market:kline', (_e, secid, lmt) =>
  getJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(String(secid))}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&lmt=${Number(lmt) || 90}&end=20500101`))

// 主力资金流（批量）：f62 主力净流入 / f66 超大单 / f72 大单 / f78 中单 / f84 小单 / f184 主力净占比
const FLOW_FIELDS = 'f12,f14,f62,f66,f72,f78,f84,f184'
ipcMain.handle('market:fundflow', (_e, secids) =>
  getJson(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(String(secids))}&fields=${FLOW_FIELDS}`))

// ===== Yahoo Finance 国际接口（免费、无需 Key，覆盖美股/港股/全球）=====
function yahooSymbol(raw) {
  const s = String(raw).trim().toUpperCase()
  if (s.endsWith('.US')) return s.slice(0, -3)
  if (s.endsWith('.HK')) return s.slice(0, -3).replace(/^0+(\d{1,4})$/, '$1').padStart(4, '0') + '.HK' // 00700.HK → 0700.HK
  return s
}
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
ipcMain.handle('market:yquote', (_e, symbol) =>
  getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?interval=1d&range=5d`, 2, YAHOO_HEADERS))
ipcMain.handle('market:ykline', (_e, symbol, range) =>
  getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?interval=1d&range=${encodeURIComponent(String(range) || '1y')}`, 2, YAHOO_HEADERS))

// ===== API 模型自动识别：OpenAI 兼容 /models，或 Ollama /api/tags =====
const API_BASE_RE = /^https?:\/\/\S+$/
function getJsonWithKey(url, apiKey) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https:') ? https : http
    const headers = { 'User-Agent': 'LunarCoreClaw/1.0' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const req = lib.get(url, { headers, timeout: 15000 }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return }
        try { resolve(JSON.parse(buf)) } catch { reject(new Error('响应不是合法 JSON')) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('连接超时（15s）')))
    req.on('error', reject)
  })
}
ipcMain.handle('api:models', async (_e, base, apiKey) => {
  const b = String(base).trim().replace(/\/+$/, '')
  if (!API_BASE_RE.test(b)) throw new Error('非法的 Base URL')
  // 先按 OpenAI 兼容协议探测
  try {
    const j = await getJsonWithKey(`${b}/models`, apiKey)
    const list = Array.isArray(j?.data) ? j.data.map((m) => String(m.id ?? m.name ?? '')).filter(Boolean) : []
    if (list.length > 0) return { kind: 'openai', models: list }
  } catch { /* 继续探测 Ollama */ }
  // 再按 Ollama 协议探测
  const j2 = await getJsonWithKey(`${b}/api/tags`, apiKey)
  const list2 = Array.isArray(j2?.models) ? j2.models.map((m) => String(m.name ?? '')).filter(Boolean) : []
  if (list2.length === 0) throw new Error('未在端点上发现任何模型')
  return { kind: 'ollama', models: list2 }
})

// ===== Ollama 局域网代理：渲染层经 IPC 调用，规避跨域限制 =====
const OLLAMA_BASE_RE = /^https?:\/\/[\w.-]+:\d{1,5}$/

ipcMain.handle('ollama:tags', (_e, base) => {
  if (!OLLAMA_BASE_RE.test(String(base))) return Promise.reject(new Error('非法的 Ollama 地址'))
  return getJson(`${base}/api/tags`)
})

ipcMain.handle('ollama:chat', (event, { reqId, base, model, messages, options }) => {
  if (!OLLAMA_BASE_RE.test(String(base))) return Promise.reject(new Error('非法的 Ollama 地址'))
  return new Promise((resolve, reject) => {
    const u = new URL(base)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: u.hostname, port: u.port, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json' }, timeout: 120000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Ollama HTTP ${res.statusCode}`)); return }
      let buf = ''
      res.on('data', (c) => {
        buf += c.toString()
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
          if (!line.trim()) continue
          try {
            const j = JSON.parse(line)
            if (j.message?.content && !event.sender.isDestroyed()) event.sender.send('ollama:chunk', reqId, j.message.content)
          } catch { /* 忽略半行 */ }
        }
      })
      res.on('end', () => resolve(true))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Ollama 响应超时')))
    req.on('error', reject)
    // options 透传 Ollama 原生参数（num_predict 输出长度 / think 思考模式 等）
    const body = { model, messages, stream: true }
    if (options && typeof options === 'object') body.options = options
    req.write(JSON.stringify(body))
    req.end()
  })
})

// ===== 密钥存储：safeStorage（macOS Keychain）加密后落盘 =====
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.enc.json')

function readSecrets() {
  try {
    const raw = JSON.parse(fs.readFileSync(secretsFile(), 'utf8'))
    const out = {}
    for (const [k, enc] of Object.entries(raw)) {
      try { out[k] = safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { /* 解密失败跳过 */ }
    }
    return out
  } catch { return {} }
}

ipcMain.handle('secret:set', (_e, key, value) => {
  if (!safeStorage.isEncryptionAvailable()) return
  const raw = fs.existsSync(secretsFile()) ? JSON.parse(fs.readFileSync(secretsFile(), 'utf8')) : {}
  raw[key] = safeStorage.encryptString(String(value)).toString('base64')
  fs.writeFileSync(secretsFile(), JSON.stringify(raw))
})

ipcMain.handle('secret:get', (_e, key) => readSecrets()[key] ?? null)

// ===== 外部链接白名单 =====
const ALLOWED_HOSTS = ['github.com', 'www.github.com', 'tushare.pro', 'www.tushare.pro', 'open.feishu.cn', 'ollama.com']

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'LunarCore Claw 智能体平台',
    backgroundColor: '#0a0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadFile(path.join(__dirname, '../dist/index.html'))

  // 禁止任意页面跳转（仅允许应用自身 file:// 导航）
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })

  // 外部链接：仅放行白名单 https 地址
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname)) {
        shell.openExternal(url)
      }
    } catch { /* 非法 URL 一律拒绝 */ }
    return { action: 'deny' }
  })
}

// ===== 崩溃处理 =====
process.on('uncaughtException', (err) => {
  const logPath = path.join(app.getPath('userData'), 'crash.log')
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.stack}\n`)
  dialog.showErrorBox('LunarCore Claw 发生异常', `错误已记录到：\n${logPath}\n\n${err.message}`)
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
