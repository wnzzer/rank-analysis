/**
 * AI 场景 → 模型名解析（远程可配）。
 *
 * 配置由 Rust `get_ai_config` 下发（仓库 `data/ai-config.json` 经 jsDelivr/GitCode 分发，
 * 内存 → 磁盘 → 网络三级缓存，永不失败）。换模型改 JSON 即可，不需要发版。
 * 场景未单独配置时用 `default`；IPC 本身失败（理论上不会）时回落调用方给的内置默认值。
 */

import { invoke } from '@tauri-apps/api/core'

/** AI 场景名（与 data/ai-config.json 的 models 键一一对应） */
export type AiScene =
  'matchAttribution' | 'matchCritique' | 'inGame' | 'champSelect' | 'matchSearch' | 'tagSuggest'

interface AiConfig {
  schemaVersion: number
  models: Record<string, string>
}

/**
 * 每次都走 IPC，不在前端缓存：Rust 侧已有内存 + 磁盘 TTL 缓存（IPC 仅毫秒级），
 * 前端再缓存会让长时间挂着的客户端收不到远端切换。
 * 包一层 then：invoke 同步抛错（非 Tauri 环境 / mock）也走 catch 兜底，绝不阻断 AI 请求。
 */
function loadConfig(): Promise<AiConfig | null> {
  return Promise.resolve()
    .then(() => invoke<AiConfig>('get_ai_config'))
    .catch(err => {
      console.warn('get_ai_config failed, using built-in models:', err)
      return null
    })
}

/**
 * 解析某场景应使用的模型名
 * @param scene - AI 场景
 * @param fallback - IPC 失败时的内置默认模型
 * @returns 场景配置 > default 配置 > fallback
 * @example
 * ```ts
 * const model = await resolveModel('inGame', DEFAULT_MODEL)
 * ```
 */
export async function resolveModel(scene: AiScene, fallback: string): Promise<string> {
  const models = (await loadConfig())?.models
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return pick(models?.[scene]) ?? pick(models?.default) ?? fallback
}
