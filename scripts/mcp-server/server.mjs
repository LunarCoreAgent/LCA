// LunarCore Claw · quantlib MCP Server（stdio，零依赖）
// 把本地量化函数库以 MCP 工具形式暴露给任何 MCP 客户端（Claude Desktop / Kimi 等）。
//
// 工具清单：
//   quant_list      列出函数库全部函数与用法摘要
//   quant_compute   调用单个函数：{ name, args } → f[name](...args)
//   quant_selftest  运行内置自检（50 项已知输入断言）
//   ic_bench        单标的因子 IC 对账：{ factor, closes, horizon }
//   xs_ic           横截面因子 IC 对账：{ factorByCode, closeByCode, horizon }
//
// 启动：npm run mcp:serve（首次请先 npm run mcp:build）
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const here = path.dirname(fileURLToPath(import.meta.url))
const libPath = path.join(here, 'quantlib.mjs')

if (!existsSync(libPath)) {
  process.stderr.write('[quantlib-mcp] 缺少 quantlib.mjs，请先在仓库根目录运行 npm run mcp:build\n')
  process.exit(1)
}

const lib = await import(libPath)
const { f, icBench, crossSectionalIC, quantlibSelfTest } = lib

const DOC = {
  returns: 'returns(closes) → 逐日收益率', sma: 'sma(xs,n)', ema: 'ema(xs,n)', wma: 'wma(xs,n)',
  dema: 'dema(xs,n)', tema: 'tema(xs,n)', trima: 'trima(xs,n)', kama: 'kama(xs,n,fast=2,slow=30)',
  hma: 'hma(xs,n)', vwma: 'vwma(c,v,n)', vwap: 'vwap(h,l,c,v,n=20)',
  macd: 'macd(c,12,26,9) → {dif,dea,hist}', rsi: 'rsi(c,n=14)', boll: 'boll(c,n=20,k=2) → {mid,up,dn}',
  kdj: 'kdj(h,l,c,n=9) → {k,d,j}', atr: 'atr(h,l,c,n=14)', sar: 'sar(h,l,af=0.02,max=0.2)',
  supertrend: 'supertrend(h,l,c,n=10,mult=3) → {st,dir}', cci: 'cci(h,l,c,n=20)', wr: 'wr(h,l,c,n=14)',
  stoch: 'stoch(h,l,c,n=14)', stochRsi: 'stochRsi(c,rsiN=14,stochN=14)', trix: 'trix(c,n=15)',
  ppo: 'ppo(c,12,26,9) → {ppo,signal,hist}', cmo: 'cmo(c,n=14)', uo: 'uo(h,l,c,7,14,28)',
  aroon: 'aroon(h,l,n=25) → {up,dn,osc}', dmi: 'dmi(h,l,c,n=14) → {pdi,mdi,adx,adxr}',
  psy: 'psy(c,n=12)', ao: 'ao(h,l)', kst: 'kst(c) → {kst,signal}', fisher: 'fisher(h,l,n=9) → {fish,signal}',
  vortex: 'vortex(h,l,c,n=14) → {viP,viM}', dpo: 'dpo(c,n=20)', choppiness: 'choppiness(h,l,c,n=14)',
  vhf: 'vhf(c,n=28)', coppock: 'coppock(c)', obv: 'obv(c,v)', adl: 'adl(h,l,c,v)',
  adosc: 'adosc(h,l,c,v,3,10)', mfi: 'mfi(h,l,c,v,n=14)', pvt: 'pvt(c,v)', eom: 'eom(h,l,v,n=14)',
  vroc: 'vroc(v,n)', vr: 'vr(c,v,n=26)', cr: 'cr(h,l,c,n=26)', vma: 'vma(v,n)',
  natr: 'natr(h,l,c,n=14)', trange: 'trange(h,l,c)', rollingStd: 'rollingStd(xs,n)', hv: 'hv(c,n=20,ppy=252)',
  keltner: 'keltner(h,l,c,n=20,mult=2) → {mid,up,dn}', donchian: 'donchian(h,l,n=20) → {up,dn,mid}',
  ulcer: 'ulcer(c,n=14)', sharpe: 'sharpe(c,rf=0,ppy=252)', sortino: 'sortino(c,rf=0,ppy=252)',
  calmar: 'calmar(c,ppy=252)', maxDrawdown: 'maxDrawdown(c) → {mdd,peak,trough}',
  betaAlpha: 'betaAlpha(c,bench,ppy=252) → {beta,alpha}', informationRatio: 'informationRatio(c,bench,ppy=252)',
  captureRatio: 'captureRatio(c,bench) → {up,down}', histVar: 'histVar(rets,alpha=0.05)', histCVar: 'histCVar(rets,alpha=0.05)',
  omegaRatio: 'omegaRatio(rets,threshold=0)', ic: 'ic(factor,fwdRet)', rankIC: 'rankIC(factor,fwdRet)',
  xsRank: 'xsRank(byCode)', xsZscore: 'xsZscore(byCode)', xsDemean: 'xsDemean(byCode)',
  crossUp: 'crossUp(a,b) → boolean[]', count: 'count(conds,n)', barsSince: 'barsSince(conds)',
}

const TOOLS = [
  {
    name: 'quant_list',
    description: '列出 LunarCore quantlib 全部 121 个函数的名称与调用签名',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'quant_compute',
    description: '调用 quantlib 任意函数。所有序列参数为 number[]；K 线类函数依次传 high/low/close(/volume)。暖窗期返回 NaN。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '函数名，如 rsi / macd / kdj / xsRank' },
        args: { type: 'array', description: '参数数组，按签名顺序', items: {} },
      },
      required: ['name', 'args'],
      additionalProperties: false,
    },
  },
  {
    name: 'quant_selftest',
    description: '运行 quantlib 内置自检（50 项已知输入断言），返回逐项通过状态',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ic_bench',
    description: '单标的因子有效性对账：因子序列 vs 前瞻 horizon 日收益，返回 IC/秩IC/ICIR/IC>0占比',
    inputSchema: {
      type: 'object',
      properties: {
        factor: { type: 'array', items: { type: ['number', 'null'] } },
        closes: { type: 'array', items: { type: 'number' } },
        horizon: { type: 'number', default: 5 },
      },
      required: ['factor', 'closes'],
      additionalProperties: false,
    },
  },
  {
    name: 'xs_ic',
    description: '横截面因子对账：多只标的逐日秩 IC 序列，返回均值/ICIR/胜率（标的 ≥3，天数 ≥10）',
    inputSchema: {
      type: 'object',
      properties: {
        factorByCode: { type: 'object', description: '{代码: 因子序列}' },
        closeByCode: { type: 'object', description: '{代码: 收盘价序列}' },
        horizon: { type: 'number', default: 5 },
      },
      required: ['factorByCode', 'closeByCode'],
      additionalProperties: false,
    },
  },
]

const norm = (x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x)
const deepNorm = (x) =>
  Array.isArray(x) ? x.map(deepNorm)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deepNorm(v)]))
    : norm(x)

function callTool(name, args) {
  switch (name) {
    case 'quant_list':
      return { count: Object.keys(f).length, functions: DOC }
    case 'quant_compute': {
      const fn = f[args?.name]
      if (typeof fn !== 'function') throw new Error(`未知函数: ${args?.name}，先调 quant_list 查看清单`)
      const argus = (args.args || []).map((a) => (Array.isArray(a) ? a.map((x) => (x === null ? NaN : x)) : a))
      return deepNorm(fn(...argus))
    }
    case 'quant_selftest': {
      const r = quantlibSelfTest()
      return { total: r.length, failed: r.filter((t) => !t.pass).length, tests: r }
    }
    case 'ic_bench':
      return icBench((args.factor || []).map((x) => (x === null ? NaN : x)), args.closes || [], args.horizon ?? 5)
    case 'xs_ic':
      return crossSectionalIC(args.factorByCode || {}, args.closeByCode || {}, args.horizon ?? 5)
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
const replyErr = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const s = line.trim()
  if (!s) return
  let msg
  try { msg = JSON.parse(s) } catch { return }
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'lunarcore-quantlib', version: '0.15.0' },
      })
    } else if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      // 无需响应
    } else if (method === 'ping') {
      reply(id, {})
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS })
    } else if (method === 'tools/call') {
      const data = callTool(params?.name, params?.arguments || {})
      reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] })
    } else if (id !== undefined) {
      replyErr(id, -32601, `Method not found: ${method}`)
    }
  } catch (e) {
    if (id !== undefined) replyErr(id, -32000, String(e?.message || e))
  }
})

process.stderr.write('[quantlib-mcp] ready · 121 functions · 5 tools\n')
