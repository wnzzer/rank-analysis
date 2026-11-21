/**
 * 经 Rust 命令 stream_ai_analysis 的流式 AI 请求，以及基于 sessionStorage 的结果缓存包装。
 *
 * 发往哪里：用户选了自定义接入点 → 他填的地址与密钥；否则按模型名前缀——
 * `claude-` 走 Oracle 中转，其余直连内置的阿里云。
 */

import { invoke, Channel } from '@tauri-apps/api/core'
import { getConfigByIpc } from '../ipc'
import { CONFIG_KEYS } from '../configKeys'
import type { AIAnalysisResult, StreamCallbacks } from './types'
import { BUILTIN_DEFAULT_MODEL, isClaudeModel, loadAiModels, loadProvider } from './modelConfig'

export const DEFAULT_SYSTEM_PROMPT =
  '你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。所有结论都必须绑定数据证据，避免空泛。'

/**
 * 内置默认模型（DashScope 兼容 OpenAI 协议）。实际模型由 ./modelConfig.ts 按场景远程下发，
 * 这里只是 IPC 失败时的兜底；与 Rust `ai_config::DEFAULT_MODEL` 保持一致。
 */
export const DEFAULT_MODEL = BUILTIN_DEFAULT_MODEL

/** 自定义接入点没配完时给用户的提示 */
export const CUSTOM_ENDPOINT_INCOMPLETE = '自定义接入点还没配置完，请先到 设置 → AI 模型 填写'

/** Rust stream_ai_analysis 命令经 Channel 回传的事件 */
export interface AiStreamEvent {
  event: 'chunk' | 'done' | 'error'
  data?: string | null
}

/** 把 Channel 事件映射到 StreamCallbacks（纯函数，便于测试） */
export function mapStreamEvent(evt: AiStreamEvent, callbacks: StreamCallbacks): void {
  switch (evt.event) {
    case 'chunk':
      if (evt.data) callbacks.onChunk(evt.data)
      break
    case 'done':
      callbacks.onDone()
      break
    case 'error':
      callbacks.onError(evt.data || 'AI 请求失败')
      break
  }
}

/** AI 请求可选项 */
export interface AiRequestOptions {
  /** true 时启用 DashScope JSON mode（response_format=json_object），强制模型输出合法 JSON */
  jsonMode?: boolean
}

/** 一次请求发往哪里 */
interface RequestTarget {
  provider: 'dashscope' | 'claude' | 'custom'
  model: string
  /** 用户自己的密钥；内置 / Claude 留空时后端用内置的 */
  apiKey?: string
  /** 仅自定义接入点有 */
  baseUrl?: string
}

/**
 * 决定一次请求发往哪里、用什么密钥
 * @param model - 调用方给的模型名（通常来自 resolveModel）；缺省时用当前服务的默认模型
 * @returns 自定义接入点没填地址或模型时返回 null
 */
async function resolveTarget(model: string | undefined): Promise<RequestTarget | null> {
  const read = async (key: string) => ((await getConfigByIpc<string>(key)) || '').trim()

  if ((await loadProvider()) === 'custom') {
    // 自定义下不看模型名前缀：用户的接入点上也可能有叫 claude-xxx 的模型
    const baseUrl = await read(CONFIG_KEYS.aiCustomBaseUrl)
    const custom = model?.trim() || (await loadAiModels()).custom.default
    if (!baseUrl || !custom) return null
    const apiKey = (await read(CONFIG_KEYS.aiCustomApiKey)) || undefined
    return { provider: 'custom', model: custom, apiKey, baseUrl }
  }

  // provider 跟着模型名走（resolveModel 已按用户选择 + 区域检测给出模型），两者不会错配。
  // 用户覆盖 key（设置里可填）；DashScope 空则后端走 env / 编译期注入，Claude 空则用中转内置 key
  const name = model || DEFAULT_MODEL
  const claude = isClaudeModel(name)
  const apiKey =
    (await read(claude ? CONFIG_KEYS.anthropicApiKey : CONFIG_KEYS.dashscopeApiKey)) || undefined
  return { provider: claude ? 'claude' : 'dashscope', model: name, apiKey }
}

export async function requestAIContentStream(
  prompt: string,
  callbacks: StreamCallbacks,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model?: string,
  opts: AiRequestOptions = {}
): Promise<void> {
  let settled = false
  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    fn()
  }
  try {
    const target = await resolveTarget(model)
    if (!target) {
      settle(() => callbacks.onError(CUSTOM_ENDPOINT_INCOMPLETE))
      return
    }

    // 终态回调（onDone/onError）经 settle 包裹，保证恰好触发一次；分发统一走
    // mapStreamEvent，避免 done/error 逻辑与兜底文案在两处重复。
    const channel = new Channel<AiStreamEvent>()
    channel.onmessage = evt =>
      mapStreamEvent(evt, {
        onChunk: callbacks.onChunk,
        onDone: () => settle(callbacks.onDone),
        onError: e => settle(() => callbacks.onError(e))
      })

    await invoke('stream_ai_analysis', {
      request: {
        prompt,
        systemPrompt,
        model: target.model,
        apiKey: target.apiKey,
        responseFormat: opts.jsonMode ? 'json_object' : undefined,
        provider: target.provider,
        baseUrl: target.baseUrl
      },
      onEvent: channel
    })
  } catch (error: any) {
    settle(() => callbacks.onError(error?.message || String(error) || '流式请求失败'))
  }
}

/**
 * 带 sessionStorage 缓存的非流式请求（内部实际仍用流式 API 聚合）
 */
export async function requestAIContent(
  prompt: string,
  cacheKey: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model?: string,
  opts: AiRequestOptions = {}
): Promise<AIAnalysisResult> {
  const cached = sessionStorage.getItem(cacheKey)
  if (cached) {
    return { success: true, content: cached }
  }

  return new Promise(resolve => {
    let fullContent = ''
    requestAIContentStream(
      prompt,
      {
        onChunk: chunk => {
          fullContent += chunk
        },
        onDone: () => {
          sessionStorage.setItem(cacheKey, fullContent)
          resolve({ success: true, content: fullContent })
        },
        onError: error => resolve({ success: false, error })
      },
      systemPrompt,
      model,
      opts
    )
  })
}
