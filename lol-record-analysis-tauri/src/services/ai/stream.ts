/**
 * 通过 Cloudflare Worker 代理的流式 AI 请求
 * 以及基于 sessionStorage 的结果缓存包装
 */

import type { AIAnalysisResult, StreamCallbacks } from './types'

export const DEFAULT_SYSTEM_PROMPT =
  '你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。所有结论都必须绑定数据证据，避免空泛。'

const AI_WORKER_URL = 'https://ai.nuliyangguang.top'

/**
 * AI Worker 默认模型（DashScope 兼容 OpenAI 协议）。
 * 各 stage 调用方按 use case 覆盖：
 * - Stage 1 attribution / Stage 1 profile: qwen-plus（JSON 严格度好）
 * - Stage 2 critique / Stage 2 naming: qwen-max（中文锐评感强）
 */
export const DEFAULT_MODEL = 'qwen-turbo'

export async function requestAIContentStream(
  prompt: string,
  callbacks: StreamCallbacks,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model: string = DEFAULT_MODEL
): Promise<void> {
  try {
    const response = await fetch(AI_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        stream: true
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP error! status: ${response.status}, ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        emitSseLine(line, callbacks)
      }
    }

    const remaining = buffer.trim()
    if (remaining) {
      emitSseLine(remaining, callbacks)
    }

    callbacks.onDone()
  } catch (error: any) {
    callbacks.onError(error.message || '流式请求失败')
  }
}

function emitSseLine(line: string, callbacks: StreamCallbacks) {
  const trimmed = line.trim()
  if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) return

  const jsonStr = trimmed.slice(6)
  if (jsonStr === '[DONE]') return

  try {
    const data = JSON.parse(jsonStr)
    const content = data.choices?.[0]?.delta?.content || ''
    if (content) callbacks.onChunk(content)
  } catch {
    // 忽略单行解析错误，继续消费流
  }
}

/**
 * 带 sessionStorage 缓存的非流式请求（内部实际仍用流式 API 聚合）
 */
export async function requestAIContent(
  prompt: string,
  cacheKey: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model: string = DEFAULT_MODEL
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
      model
    )
  })
}
