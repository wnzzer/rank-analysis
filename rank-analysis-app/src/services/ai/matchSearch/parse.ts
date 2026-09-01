/**
 * 自然语言 → ParsedMatchQuery 的解析入口
 *
 * 单轮 qwen-flash(JSON mode)调用;英雄/队列清单模块级缓存
 * (一次会话内不变);同一句原文的解析结果走 requestAIContent 的
 * sessionStorage 缓存,重复搜索零成本。
 */

import { invoke } from '@tauri-apps/api/core'
import { requestAIContent } from '@renderer/services/ai/stream'
import { getGameModesByIpc } from '@renderer/services/ipc'
import type { championOption } from '@renderer/types/domain/champion'
import { buildMatchSearchPrompt, type PromptContext } from './prompt'
import { validateParsedQuery } from './schema'
import type { ParsedMatchQuery } from './types'

/** 英雄/队列清单缓存(会话内不变,避免每次解析都打两个 IPC) */
let ctxCache: Omit<PromptContext, 'today'> | null = null

/** 测试专用:清空模块级缓存 */
export function __resetParseCachesForTests(): void {
  ctxCache = null
}

async function loadContext(): Promise<Omit<PromptContext, 'today'>> {
  if (ctxCache) return ctxCache
  const [champions, modes] = await Promise.all([
    invoke<championOption[]>('get_champion_options'),
    getGameModesByIpc()
  ])
  ctxCache = { champions, modes }
  return ctxCache
}

/** 解析结果的 sessionStorage 缓存 key(与 parseMatchQuery 内部一致) */
function parseCacheKey(text: string): string {
  return `matchSearch:${new Date().toISOString().slice(0, 10)}:${text}`
}

/**
 * 清除某句描述的解析缓存。
 * requestAIContent 会缓存「成功但内容是垃圾」的响应(如非 JSON 闲聊),
 * 重试前必须清掉,否则重试永远命中同一份坏缓存。
 */
export function clearParseCache(text: string): void {
  try {
    sessionStorage.removeItem(parseCacheKey(text))
  } catch {
    // sessionStorage 不可用时本来也不会有缓存
  }
}

/**
 * 从模型输出里提取 JSON 对象(容忍 ```json 围栏与前后闲话)
 * @returns 解析出的对象;找不到合法 JSON 时返回 null
 */
export function extractJson(content: string): unknown | null {
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  const direct = tryParse(content.trim())
  if (direct !== null) return direct
  // 取第一个 '{' 到最后一个 '}' 的最大区间(围栏/闲话都在区间外)
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return tryParse(content.slice(start, end + 1))
}

/**
 * 把自然语言解析为结构化战绩检索条件
 * @param text - 用户原文
 * @throws Error 中文可展示信息(请求失败 / 输出不是 JSON)
 */
export async function parseMatchQuery(text: string): Promise<ParsedMatchQuery> {
  const { champions, modes } = await loadContext()
  const today = new Date().toISOString().slice(0, 10)
  const { system, user } = buildMatchSearchPrompt(text, { today, champions, modes })

  const result = await requestAIContent(user, parseCacheKey(text), system, undefined, {
    jsonMode: true
  })
  if (!result.success || !result.content) {
    throw new Error(result.error || 'AI 解析请求失败')
  }

  const raw = extractJson(result.content)
  if (raw === null) {
    throw new Error('AI 未能解析这句描述,请换个说法重试')
  }

  const q = validateParsedQuery(
    raw,
    new Set(champions.map(c => c.value)),
    new Set(modes.map(m => m.value).filter(v => v > 0))
  )

  // 确定性钳制:模型偶尔输出未来日期(如把「这个月」解析成整个日历月)。
  // to 在未来 = 「至今」,置空;from 在未来则整个时间窗不可信,作废。
  if (q.timeRange.to && q.timeRange.to > today) q.timeRange.to = null
  if (q.timeRange.from && q.timeRange.from > today) q.timeRange = { from: null, to: null }
  return q
}
