/**
 * C2-L2 台词润色钩子（接 AI 服务商）。
 *
 * 把 L1 模板草稿 + 人设卡 + 近期事件交给常规 AI 管道改写；
 * 超时（8s）/失败返回 null，由引擎回退 L1 文案——陪伴体验永不被 LLM 卡住。
 */
import { requestAIContent } from '@renderer/services/ai/stream'

import type { CompanionEvent } from './engine'
import type { CompanionPersona } from './persona'

const TIMEOUT_MS = 8000
/** 台词硬上限：气泡场景长文案是灾难 */
const MAX_LEN = 60

/** 人设 system prompt（性格 + 语气硬规则）。 */
export function personaSystemPrompt(persona: CompanionPersona): string {
  const rules = persona.toneRules.length
    ? `\n语气规则（必须全部满足）：\n- ${persona.toneRules.join('\n- ')}`
    : ''
  return (
    `你是英雄联盟海克斯大乱斗对局里的 AI 游戏搭子「${persona.name}」。` +
    `性格设定：${persona.persona || '轻松友好的普通搭子'}。` +
    `${rules}\n只输出改写后的一句台词本身——不要引号、不要前缀、不要任何解释。`
  )
}

/** 用户 prompt：草稿 + 近期事件上下文（控制 token，最多 5 条）。 */
export function buildPolishPrompt(draft: string, history: CompanionEvent[]): string {
  const recent = history
    .slice(-5)
    .map(e => {
      const extra =
        [
          e.championName && `击杀对象:${e.championName}`,
          e.augmentName && `强化:${e.augmentName}`,
          e.streak != null && `${e.streak}连杀/连败`
        ]
          .filter(Boolean)
          .join('，') || ''
      return `- ${e.type}${extra ? `（${extra}）` : ''}`
    })
    .join('\n')
  return `请改写这句台词：\n「${draft}」\n\n最近发生（供参考，不要逐条复述）：\n${recent || '- 刚开局'}`
}

/**
 * 创建润色钩子（注入 engine.createSpeaker 的 polish 参数）。
 * 返回 null 表示放弃润色（超时/失败/空结果），调用方回退模板文案。
 */
export function createPolisher(persona: CompanionPersona) {
  return async (draft: string, history: CompanionEvent[]): Promise<string | null> => {
    // 无任何设定时润色没有增益，直接省一次调用
    if (!persona.persona && !persona.toneRules.length) return null

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
    }, TIMEOUT_MS)

    try {
      const req = requestAIContent(
        buildPolishPrompt(draft, history),
        // 台词不希望命中缓存复用旧话术：key 加入随机量
        `companion:${persona.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        personaSystemPrompt(persona)
      )
      const timeoutP = new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS))
      const res = (await Promise.race([req, timeoutP])) as {
        success: boolean
        content?: string
      } | null
      void timer
      if (timedOut || !res || !res.success || !res.content) return null
      const cleaned = res.content.trim().split('\n')[0]?.trim().slice(0, MAX_LEN)
      return cleaned || null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
