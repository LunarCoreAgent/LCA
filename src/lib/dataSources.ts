// 数据接口注册表：免费行情/数据源的统一登记、Key 管理与状态判定
// - chain：免 Key，已内置于四源冗余链，开箱即用
// - key：需免费申请的 Key/Token（仅存本机 localStorage），配置后自动加入冗余链
// - python：Python 开源库，应用内不可直接调用，提供一键导出采集脚本

export interface DataSourceDef {
  id: string
  name: string
  kind: 'chain' | 'key' | 'python'
  markets: string
  policy: string
  desc: string
  homepage?: string   // Key 申请或库主页
  keyHint?: string    // Key 输入框占位
}

export const DATA_SOURCES: DataSourceDef[] = [
  // ===== 免 Key 内置链路 =====
  { id: 'eastmoney', name: '东方财富', kind: 'chain', markets: '沪深京港美', policy: '完全免费', desc: '主源：实时快照/日K/资金流（push2 系列）' },
  { id: 'tencent', name: '腾讯财经', kind: 'chain', markets: '沪深京港', policy: '完全免费', desc: '备源：实时快照/日K/资金流（qt.gtimg.cn ff_）' },
  { id: 'sina', name: '新浪财经', kind: 'chain', markets: '沪深A股', policy: '完全免费', desc: '备源：实时快照（hq.sinajs.cn）' },
  { id: 'yahoo', name: 'Yahoo Finance', kind: 'chain', markets: '全球市场', policy: '免费（非官方）', desc: '国际兜底：港美股快照与日K' },
  // ===== 需 Key（免费申请，配置后接入链路）=====
  { id: 'miaoxiang', name: '东方财富妙想', kind: 'key', markets: '全品类金融数据', policy: '免费申请', desc: '官方金融数据 AI 接口，自然语言查行情/资金/财务', homepage: 'https://ai.eastmoney.com/mxClaw', keyHint: 'mkt_ 开头' },
  { id: 'zhitu', name: '智兔数服', kind: 'key', markets: '沪深京A股/港股/基金', policy: '免费申请 Token', desc: '实时行情/历史K线/技术指标（KDJ/MACD/BOLL）/资金流', homepage: 'https://www.zhituapi.com/gettoken.html', keyHint: 'zhituapi.com 免费申请' },
  { id: 'juhe', name: '聚合数据', kind: 'key', markets: '沪深/港/美', policy: '每日 50 次免费', desc: 'A 股实时行情与历史K线', homepage: 'https://www.juhe.cn/docs/api/id/21', keyHint: '聚合 AppKey' },
  { id: 'tushare', name: 'Tushare Pro', kind: 'key', markets: '股票/基金/期货/期权', policy: '积分制（基础免费）', desc: '日线/财报数据丰富（HTTP POST 接口，日K 兜底）', homepage: 'https://tushare.pro/register', keyHint: 'tushare.pro Token' },
  { id: 'lixinger', name: '理杏仁', kind: 'key', markets: 'A股/港股/美股/指数/基金', policy: '开放平台 Token（基础免费）', desc: '公司基本面/估值指标（PE/PB/PS/股息率/ROE 等，POST JSON 直连，用于基本面估值增强）', homepage: 'https://www.lixinger.com/open/api/token', keyHint: '开放平台 Token' },
  { id: 'stockapi', name: 'StockApi', kind: 'key', markets: '沪深A股', policy: '免费测试额度', desc: '实时行情/Level-2/资金流向/集合竞价', homepage: 'https://stockapi.com.cn', keyHint: 'StockApi Key' },
  { id: 'alphavantage', name: 'Alpha Vantage', kind: 'key', markets: '美股/外汇/加密', policy: '每分钟 5 次 · 每天 500 次', desc: '美股快照与日K（GLOBAL_QUOTE）', homepage: 'https://www.alphavantage.co/support/#api-key', keyHint: '免费 API Key' },
  { id: 'finnhub', name: 'Finnhub', kind: 'key', markets: '美股/外汇/加密', policy: '每分钟 60 次', desc: '美股实时快照（/quote）', homepage: 'https://finnhub.io/register', keyHint: '免费 Token' },
  { id: 'twelvedata', name: 'Twelve Data', kind: 'key', markets: '全球市场', policy: '每分钟 8 次 · 每天 800 次', desc: '全球快照（/quote）', homepage: 'https://twelvedata.com/pricing', keyHint: '免费 API Key' },
  { id: 'polygon', name: 'Polygon.io', kind: 'key', markets: '美股', policy: '免费 tier 每日限额', desc: '美股前收快照（/prev）', homepage: 'https://polygon.io/dashboard/signup', keyHint: '免费 API Key' },
  { id: 'qveris', name: 'QVeris', kind: 'key', markets: '全球行情/财报研究/宏观/另类信号', policy: '注册赠 1000 credits + 每日 100；发现与检视免费，调用按次计费', desc: 'AI 能力路由网络：discover 自然语言发现万级能力（行情/研究/宏观/加密/信号），inspect 免费检视，call 结构化返回；用于「数据中心 → QVeris」页签与对话页数据调用', homepage: 'https://qveris.ai', keyHint: 'qveris.ai 注册后自动签发' },
  // ===== Python 开源库（导出脚本使用；AkShare/Baostock 另经本地数据桥进程内直连）=====
  { id: 'akshare', name: 'AkShare', kind: 'python', markets: '沪深A股/港股/期货/基金/外汇', policy: '完全免费无注册', desc: '数据源自新浪/东财等，覆盖面广；桥内已接管 A股快照 + 基本面估值指标', homepage: 'https://github.com/akfamily/akshare' },
  { id: 'baostock', name: 'Baostock', kind: 'python', markets: '沪深A股', policy: '完全免费无注册', desc: '轻量，历史日线/分钟线/财务；桥内已接管 A股日K（前复权）', homepage: 'https://github.com/HanYayaya/BaoStock' },
  { id: 'tusharepy', name: 'Tushare', kind: 'python', markets: '股票/基金/期货/期权', policy: '积分制免费', desc: '社区成熟，日线/财报丰富', homepage: 'https://tushare.pro' },
  { id: 'lixingerpy', name: 'lixinger-universal', kind: 'python', markets: 'A股/港股/美股/指数', policy: '需理杏仁 Token', desc: '理杏仁开放平台 Python 封装（应用已 REST 直连，配置 Token 走「可选 REST」）', homepage: 'https://github.com/huhefa/lixinger-universal' },
  { id: 'efinance', name: 'efinance', kind: 'python', markets: '沪深A股/基金/债券', policy: '完全免费', desc: '轻量封装东财，实时/历史/基金', homepage: 'https://efinance.readthedocs.io' },
  { id: 'pytdx', name: 'Pytdx', kind: 'python', markets: '沪深A股', policy: '完全免费', desc: '通达信协议，实时行情与历史', homepage: 'https://github.com/rainx/pytdx' },
  { id: 'qstock', name: 'Qstock', kind: 'python', markets: '沪深A股', policy: '完全免费', desc: '数据获取与可视化一体', homepage: 'https://github.com/tkfy920/qstock' },
  { id: 'quantaxis', name: 'QUANTAXIS', kind: 'python', markets: '沪深A股/期货', policy: '开源免费', desc: '完整量化回测框架含采集', homepage: 'https://github.com/quantaxis/quantaxis' },
  { id: 'vnpy', name: 'VN.PY', kind: 'python', markets: '多市场', policy: '开源免费', desc: '量化交易框架内置数据源', homepage: 'https://www.vnpy.com' },
]

const KEY_PREFIX = 'agentcore-ds-key-'

export function getDsKey(id: string): string {
  try { return localStorage.getItem(KEY_PREFIX + id) ?? '' } catch { return '' }
}

export function setDsKey(id: string, key: string): void {
  try {
    if (key) localStorage.setItem(KEY_PREFIX + id, key)
    else localStorage.removeItem(KEY_PREFIX + id)
  } catch { /* ignore */ }
}

// 生成 Python 采集脚本（AkShare + Baostock 双引擎，按当前自选股）
export function buildPythonScript(codes: string[]): string {
  const cn = codes.filter((c) => !c.endsWith('.US') && !c.endsWith('.HK'))
  const hk = codes.filter((c) => c.endsWith('.HK'))
  const us = codes.filter((c) => c.endsWith('.US'))
  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# LunarCore Claw 导出的数据采集脚本
# 覆盖引擎：AkShare（新浪/东财源，免注册）+ Baostock（沪深历史，免注册）
# 安装依赖：pip install akshare baostock pandas

import akshare as ak
import baostock as bs
import pandas as pd

WATCH_CN = ${JSON.stringify(cn.map((c) => c.split('.')[0]))}   # 沪深京代码（6位）
WATCH_HK = ${JSON.stringify(hk.map((c) => c.split('.')[0]))}   # 港股代码
WATCH_US = ${JSON.stringify(us.map((c) => c.split('.')[0]))}   # 美股代码

def akshare_spot():
    """AkShare 实时快照：沪深A股 + 港股 + 美股"""
    frames = []
    if WATCH_CN:
        spot = ak.stock_zh_a_spot_em()
        frames.append(spot[spot['代码'].str[2:].isin(WATCH_CN)])
    if WATCH_HK:
        hk_spot = ak.stock_hk_spot_em()
        frames.append(hk_spot[hk_spot['代码'].str[2:].isin(WATCH_HK)])
    if WATCH_US:
        us_spot = ak.stock_us_spot_em()
        frames.append(us_spot[us_spot['代码'].str.split('.').str[-1].isin(WATCH_US)])
    return pd.concat(frames) if frames else pd.DataFrame()

def baostock_daily(start='2024-01-01'):
    """Baostock 沪深历史日K（前复权）"""
    bs.login()
    out = {}
    for code in WATCH_CN:
        market = 'sh' if code.startswith('6') else ('bj' if code.startswith(('4', '8')) else 'sz')
        rs = bs.query_history_k_data_plus(
            f'{market}.{code}',
            'date,open,high,low,close,volume,amount,turn,pctChg',
            start_date=start, frequency='d', adjustflag='2')
        rows = []
        while rs.error_code == '0' and rs.next():
            rows.append(rs.get_row_data())
        out[code] = pd.DataFrame(rows, columns=rs.fields)
    bs.logout()
    return out

if __name__ == '__main__':
    print('=== AkShare 实时快照 ===')
    print(akshare_spot())
    print('=== Baostock 历史日K ===')
    for code, df in baostock_daily().items():
        print(f'--- {code} 最近5日 ---')
        print(df.tail())
`
}
