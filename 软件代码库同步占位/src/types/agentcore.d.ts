// Electron 预加载脚本注入的 window.agentcore 全局类型（集中声明，各处引用保持一致）
export {}

declare global {
  interface Window {
    agentcore?: {
      secrets?: {
        set(key: string, value: string): Promise<void>
        get(key: string): Promise<string | null>
      }
      market?: {
        quotes(secids: string): Promise<unknown>
        kline(secid: string, lmt: number): Promise<unknown>
        fundflow(secids: string): Promise<unknown>
        yquote(symbol: string): Promise<unknown>
        ykline(symbol: string, range: string): Promise<unknown>
        text(url: string, encoding: 'utf8' | 'gbk', referer?: string): Promise<string>
        mxquery(apiKey: string, toolQuery: string): Promise<string>
        post(url: string, body: unknown): Promise<string>
      }
      kb?: {
        request(opts: { method: 'GET' | 'POST'; url: string; token?: string; body?: string }): Promise<string>
      }
      channel?: {
        test(kind: 'wechat' | 'line', cfg: { appId?: string; secret?: string; token?: string }): Promise<{ ok: boolean; detail: string }>
      }
      qveris?: {
        request(path: string, apiKey: string, body: unknown, query?: Record<string, string>, timeoutMs?: number): Promise<unknown>
      }
      pybridge?: {
        status(): Promise<{ running: boolean; health: { ok: boolean; akshare: boolean; baostock: boolean; ts?: number } | null }>
        start(): Promise<{ ok: boolean; error?: string; note?: string }>
        stop(): Promise<{ ok: boolean }>
        install(): Promise<{ ok: boolean; error?: string }>
        log(): Promise<string>
      }
      api?: {
        models(base: string, apiKey: string): Promise<{ kind: 'openai' | 'ollama'; models: string[] }>
      }
      ollama?: {
        tags(base: string): Promise<unknown>
        chat(reqId: string, base: string, model: string, messages: unknown[], options?: Record<string, unknown>): Promise<void>
        onChunk(cb: (reqId: string, piece: string) => void): () => void
      }
    }
  }
}
