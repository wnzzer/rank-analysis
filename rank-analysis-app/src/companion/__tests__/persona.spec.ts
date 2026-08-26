/**
 * 人设卡系统单测：存取/内置保护/触发器判定。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BUILT_IN_PERSONAS,
  deletePersona,
  getActivePersonaId,
  getPersona,
  listPersonas,
  setActivePersonaId,
  triggerEnabled,
  upsertPersona
} from '../persona'

describe('persona store', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('无存储时返回内置三张人设', () => {
    const list = listPersonas()
    expect(list.length).toBe(BUILT_IN_PERSONAS.length)
    expect(list.map(p => p.id)).toContain('builtin-xiaoman')
  })

  it('编辑内置人设生成副本而非污染内置', () => {
    const base = BUILT_IN_PERSONAS[0]
    const savedId = upsertPersona({ ...base, persona: '改过的性格' })

    expect(savedId).toBe('builtin-xiaoman.custom')
    // 副本出现在列表中且带「·改」名
    const copy = getPersona(savedId)
    expect(copy.persona).toBe('改过的性格')
    expect(copy.name).toContain('·改')
    // 内置原版保持不变
    expect(getPersona(base.id).persona).toBe(base.persona)
  })

  it('删除接口对内置 id 是 no-op，自定义可删', () => {
    deletePersona('builtin-xiaoman')
    expect(getPersona('builtin-xiaoman').id).toBe('builtin-xiaoman')

    upsertPersona({
      id: 'my-own',
      name: '自定义',
      persona: '',
      toneRules: [],
      triggers: {},
      memoryTurns: 2
    })
    deletePersona('my-own')
    expect(listPersonas().some(p => p.id === 'my-own')).toBe(false)
  })

  it('激活 id 持久化；未知 id 回退第一个内置', () => {
    setActivePersonaId('builtin-ace')
    expect(getActivePersonaId()).toBe('builtin-ace')

    localStorage.setItem('ra.companion.active', 'not-exist')
    expect(getPersona(getActivePersonaId()).id).toBe(BUILT_IN_PERSONAS[0].id)
  })

  it('触发器开关缺省视为开启', () => {
    const p = BUILT_IN_PERSONAS[1] // 只显式开了 death/defeat
    expect(triggerEnabled(p, 'death')).toBe(true)
    expect(triggerEnabled(p, 'victory')).toBe(true) // 缺省 = 开
    expect(triggerEnabled({ ...p, triggers: { victory: false } }, 'victory')).toBe(false)
  })
})
