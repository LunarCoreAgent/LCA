const { contextBridge, ipcRenderer } = require('electron')

// 仅暴露最小化接口：密钥保管 + 行情只读代理，不开放任何其他特权 API
contextBridge.exposeInMainWorld('agentcore', {
  secrets: {
    set: (key, value) => ipcRenderer.invoke('secret:set', key, value),
    get: (key) => ipcRenderer.invoke('secret:get', key),
  },
  market: {
    quotes: (secids) => ipcRenderer.invoke('market:quotes', secids),
    kline: (secid, lmt) => ipcRenderer.invoke('market:kline', secid, lmt),
    fundflow: (secids) => ipcRenderer.invoke('market:fundflow', secids),
    yquote: (symbol) => ipcRenderer.invoke('market:yquote', symbol),
    ykline: (symbol, range) => ipcRenderer.invoke('market:ykline', symbol, range),
    text: (url, encoding, referer) => ipcRenderer.invoke('market:text', url, encoding, referer),
    mxquery: (apiKey, toolQuery) => ipcRenderer.invoke('market:mxquery', apiKey, toolQuery),
    post: (url, body) => ipcRenderer.invoke('market:post', url, body),
  },
  kb: {
    request: (opts) => ipcRenderer.invoke('kb:request', opts),
  },
  channel: {
    test: (kind, cfg) => ipcRenderer.invoke('channel:test', kind, cfg),
  },
  qveris: {
    request: (path, apiKey, body, query, timeoutMs) => ipcRenderer.invoke('qveris:request', path, apiKey, body, query, timeoutMs),
  },
  pybridge: {
    status: () => ipcRenderer.invoke('pybridge:status'),
    start: () => ipcRenderer.invoke('pybridge:start'),
    stop: () => ipcRenderer.invoke('pybridge:stop'),
    install: () => ipcRenderer.invoke('pybridge:install'),
    log: () => ipcRenderer.invoke('pybridge:log'),
  },
  api: {
    models: (base, apiKey) => ipcRenderer.invoke('api:models', base, apiKey),
  },
  ollama: {
    tags: (base) => ipcRenderer.invoke('ollama:tags', base),
    chat: (reqId, base, model, messages, options) => ipcRenderer.invoke('ollama:chat', { reqId, base, model, messages, options }),
    onChunk: (cb) => {
      const listener = (_e, reqId, piece) => cb(reqId, piece)
      ipcRenderer.on('ollama:chunk', listener)
      return () => ipcRenderer.removeListener('ollama:chunk', listener)
    },
  },
})
