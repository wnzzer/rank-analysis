/**
 * 经 Rust 命令 stream_ai_analysis 直连 DashScope 的流式 AI 请求
 * 以及基于 sessionStorage 的结果缓存包装
 */

import { invoke, Channel } from '@tauri-apps/api/core'
import { getConfigByIpc } from '../ipc'
import { CONFIG_KEYS } from '../configKeys'
import type { AIAnalysisResult, StreamCallbacks } from './types'

export const DEFAULT_SYSTEM_PROMPT =
  '你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。所有结论都必须绑定数据证据，避免空泛。'

/**
 * 默认模型（DashScope 兼容 OpenAI 协议）。各 stage 调用方按 use case 覆盖。
 * qwen-flash：基准实测（tests/bench-ai-models.mjs）速度+有效率最优，故作兜底默认。
 */
export const DEFAULT_MODEL = 'qwen-flash'

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

export async function requestAIContentStream(
  prompt: string,
  callbacks: StreamCallbacks,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model: string = DEFAULT_MODEL,
  opts: AiRequestOptions = {}
): Promise<void> {
  let settled = false
  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    fn()
  }
  try {
    // 用户覆盖 key（设置里可填）；空则后端走 env / 编译期注入
    const override = (await getConfigByIpc<string>(CONFIG_KEYS.dashscopeApiKey)) || undefined

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
        model,
        apiKey: override,
        responseFormat: opts.jsonMode ? 'json_object' : undefined
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
  model: string = DEFAULT_MODEL,
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
