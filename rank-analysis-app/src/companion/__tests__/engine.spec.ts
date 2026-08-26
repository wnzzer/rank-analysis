/**
 * 台词引擎单测：模板选择/槽位填充/冷却闸/历史缓冲/L2 润色回退。
 */
import { describe, expect, it, vi } from 'vitest'

import { createSpeaker, fillTemplate, shouldSpeak, type CompanionEvent } from '../engine'
import type { CompanionPersona } from '../persona'

const PERSONA: CompanionPersona = {
  id: 'builtin-xiaoman',
  name: '小满',
  persona: 'test',
  toneRules: [],
  triggers: { death: false }, // 显式关闭 death
  memoryTurns: 2
}

function evt(type: CompanionEvent['type'], at: number): CompanionEvent {
  return { type, at, championName: '薇恩', augmentName: '双刀流', streak: 3 }
}

describe('fillTemplate', () => {
  it('填充已知槽位并保留未知占位符', () => {
    expect(fillTemplate('{champion} 拿到{augment}', evt('augmentPick', 0))).toBe('薇恩 拿到双刀流')
    expect(fillTemplate('{unknown} {streak}', { ...evt('kill', 0), streak: 3 })).toBe('{unknown} 3')
  })
})

describe('shouldSpeak 冷却闸', () => {
  it('类型冷却与全局冷却独立生效', () => {
    const spoken = { kill: 1000 }
    // kill 自身冷却 120s 未到 → 不说（即便全局已过）
    expect(shouldSpeak('kill', spoken, 60_000, -Infinity)).toBe(false)
    // victory 无类型冷却条目 → 用默认 90s；从未说过 → 全局未开口过 → 说
    expect(shouldSpeak('victory', {}, 60_000, -Infinity)).toBe(true)
  })

  it('lossStreak 绕过全局冷却', () => {
    const now = Date.now()
    expect(shouldSpeak('lossStreak', {}, now, now - 1000)).toBe(true)
  })
})

describe('createSpeaker', () => {
  it('触发器开关拦下事件', async () => {
    const s = createSpeaker(PERSONA)
    expect(await s.onEvent(evt('death', Date.now()))).toBeNull()
  })

  it('模板命中且记录历史；超出 memoryTurns 截断', async () => {
    let call = 0
    const s = createSpeaker(PERSONA, { random: () => (call++ % 2 === 0 ? 0 : 0.99) })
    const l1 = await s.onEvent(evt('kill', 1000))
    expect(l1?.source).toBe('template')
    expect(l1?.text.length).toBeGreaterThan(0)

    await s.onEvent(evt('multikill', 200_000))
    await s.onEvent(evt('ace', 400_000))
    expect(s.history().length).toBe(PERSONA.memoryTurns)
  })

  it('同类型在冷却期内静默', async () => {
    const s = createSpeaker(PERSONA)
    expect((await s.onEvent(evt('kill', 1000)))?.text).toBeTruthy()
    expect(await s.onEvent(evt('kill', 2000))).toBeNull()
  })

  it('L2 润色成功替换文案并标记 source；失败回退模板', async () => {
    const polish = vi
      .fn()
      .mockResolvedValueOnce('LLM 改写的话')
      .mockRejectedValueOnce(new Error('x'))
    const s = createSpeaker(PERSONA, { random: () => 0, polish })
    const a = await s.onEvent(evt('kill', 1000))
    expect(a).toEqual({ text: 'LLM 改写的话', source: 'polished' })
    const b = await s.onEvent(evt('multikill', 300_000))
    expect(b?.source).toBe('template')
    expect(polish).toHaveBeenCalledTimes(2)
  })
})
