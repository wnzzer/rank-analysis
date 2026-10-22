/**
 * AI 场景 → 模型名解析（远程可配）。
 *
 * 配置由 Rust `get_ai_config` 下发（仓库 `data/ai-config.json` 经 jsDelivr/GitCode 分发，
 * 内存 → 磁盘 → 网络三级缓存，永不失败）。换模型改 JSON 即可，不需要发版。
 * 场景未单独配置时用 `default`；IPC 本身失败（理论上不会）时回落调用方给的内置默认值。
 *
 * 用户在设置里选了 Claude 且区域检测通过时，改从 `claudeModels` 取（模型名以 `claude-` 开头，
 * stream.ts 据此路由到 Claude 中转）；区域不可用 / 检测失败一律静默回落 DashScope，绝不让 AI 不可用。
 */

import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc } from '../ipc'
import { CONFIG_KEYS } from '../configKeys'

/** 内置 Claude 默认模型：远端 manifest 没有 claudeModels（或 IPC 失败）时用 */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

/** AI 服务提供方 */
export type AiProvider = 'dashscope' | 'claude'

/** Rust `check_claude_region` 的返回 */
export interface ClaudeRegion {
  /** ISO 国家码；检测失败为 null */
  country: string | null
  allowed: boolean
  /** 检测失败原因（中转不可达等） */
  error: string | null
}

/** 模型名是否属于 Claude（stream.ts 按此选 provider） */
export const isClaudeModel = (model: string) => model.startsWith('claude-')

/** AI 场景名（与 data/ai-config.json 的 models 键一一对应） */
export type AiScene =
  'matchAttribution' | 'matchCritique' | 'inGame' | 'champSelect' | 'matchSearch' | 'tagSuggest'

interface AiConfig {
  schemaVersion: number
  models: Record<string, string>
  /** 选 Claude 时的场景 → 模型（可选，老 manifest 没有） */
  claudeModels?: Record<string, string>
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
 * 检测当前网络能否用 Claude（判定在 Oracle 中转按出口 IP 做，Rust 侧缓存 10 分钟）
 * @param force - true 时跳过缓存重测（切了网络 / VPN 后）
 * @returns 区域判定；IPC 失败按不可用处理
 */
export function checkClaudeRegion(force = false): Promise<ClaudeRegion> {
  return Promise.resolve()
    .then(() => invoke<ClaudeRegion>('check_claude_region', { force }))
    .catch(err => ({ country: null, allowed: false, error: String(err) }))
}

/** 用户选的 provider；读不到 / 非法值按 DashScope（同 loadConfig 包一层 then，同步抛错也兜住） */
function loadProvider(): Promise<AiProvider> {
  return Promise.resolve()
    .then(() => getConfigByIpc<string>(CONFIG_KEYS.aiProvider))
    .then(
      v => (v === 'claude' ? 'claude' : 'dashscope'),
      () => 'dashscope' as const
    )
}

/**
 * 预热到 Claude 中转的连接（仅用户选了 Claude 时）：打开含 AI 入口的页面就先把连接建好，
 * 留在 Rust 共享连接池里，用户点「AI 分析」时省掉到美东的握手。
 * fire-and-forget，任何失败都静默——只是优化。
 */
export function prewarmAi(): void {
  loadProvider()
    .then(p => (p === 'claude' ? invoke('prewarm_claude_relay') : undefined))
    .catch(() => {})
}

/**
 * 解析某场景应使用的模型名
 * @param scene - AI 场景
 * @param fallback - IPC 失败时的内置默认模型
 * @returns 选 Claude 且区域可用：claudeModels 场景 > claudeModels.default > 内置 Claude 默认；
 *          否则：场景配置 > default 配置 > fallback
 * @example
 * ```ts
 * const model = await resolveModel('inGame', DEFAULT_MODEL)
 * ```
 */
export async function resolveModel(scene: AiScene, fallback: string): Promise<string> {
  const [config, provider] = await Promise.all([loadConfig(), loadProvider()])
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  if (provider === 'claude' && (await checkClaudeRegion()).allowed) {
    const claude = config?.claudeModels
    const model = pick(claude?.[scene]) ?? pick(claude?.default)
    // 防远端把非 claude 模型写进 claudeModels：那样会被路由到 DashScope，用户以为在用 Claude
    return model && isClaudeModel(model) ? model : DEFAULT_CLAUDE_MODEL
  }
  const models = config?.models
  return pick(models?.[scene]) ?? pick(models?.default) ?? fallback
}
