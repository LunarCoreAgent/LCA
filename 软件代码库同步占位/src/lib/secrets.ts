// 密钥管理：正式版经 Electron safeStorage（macOS Keychain）加密存储
// 浏览器/开发环境仅保存在内存（不写 localStorage）
// window.agentcore 类型统一声明于 src/types/agentcore.d.ts

const memoryVault = new Map<string, string>()

export async function saveSecret(key: string, value: string): Promise<void> {
  if (window.agentcore?.secrets) {
    await window.agentcore.secrets.set(key, value)
  } else {
    memoryVault.set(key, value) // 非 Electron 环境：仅内存，不落盘
  }
}

export async function loadSecret(key: string): Promise<string | null> {
  if (window.agentcore?.secrets) return window.agentcore.secrets.get(key)
  return memoryVault.get(key) ?? null
}

/** 展示用掩码：保留最后 4 位 */
export const maskSecret = (v: string) => (v ? '••••••••' + v.slice(-4) : '')
