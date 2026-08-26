/**
 * AI 搭子人设卡系统（feature-expansion-plan C1）。
 *
 * 人设 = 台词引擎的一切输入：性格描述与语气规则进 prompt（L2 润色），
 * 触发器开关决定哪些游戏事件会开口，模板库按 persona id 隔离。
 *
 * 存储：localStorage（`ra.companion.*`）。内置三张原创人设只读，
 * 用户改动会生成副本——保证升级时内置内容可安全演进。
 */

export type CompanionTriggerKey =
  'kill' | 'multikill' | 'death' | 'ace' | 'augmentPick' | 'victory' | 'defeat' | 'lossStreak'

/** 人设卡 */
export interface CompanionPersona {
  id: string
  name: string
  /** 一句话性格设定（L2 润色 prompt 的 system 素材） */
  persona: string
  /** 语气硬规则（逐条注入，如「每句不超过 20 字」） */
  toneRules: string[]
  /** 各触发器开关；缺省键视为开启 */
  triggers: Partial<Record<CompanionTriggerKey, boolean>>
  /** L2 润色携带的近期事件数上限 */
  memoryTurns: number
}

const PERSONAS_KEY = 'ra.companion.personas'
const ACTIVE_KEY = 'ra.companion.active'

/** 内置人设（原创文案，只读；id 带 built-in 前缀便于识别） */
export const BUILT_IN_PERSONAS: CompanionPersona[] = [
  {
    id: 'builtin-xiaoman',
    name: '小满',
    persona: '开朗热情的游戏搭子，海克斯大乱斗百科全书，擅长把数据讲成好消息',
    toneRules: ['每句不超过 18 字', '多用感叹号', '不嘲讽队友'],
    triggers: {},
    memoryTurns: 4
  },
  {
    id: 'builtin-ruiping',
    name: '锐评酱',
    persona: '嘴上不留情但心里有数的锐评人，专挑决策问题开火，赢了也不忘敲打',
    toneRules: ['每句不超过 22 字', '允许适度毒舌', '禁止人身攻击', '引用具体数据'],
    triggers: { death: true, defeat: true },
    memoryTurns: 6
  },
  {
    id: 'builtin-ace',
    name: '阿策',
    persona: '冷静的教练型搭档，只讲下一步该做什么，情绪价值靠稳定感提供',
    toneRules: ['每句不超过 16 字', '不用感叹号', '必须给出一个行动建议'],
    triggers: {},
    memoryTurns: 8
  }
]

export const ALL_TRIGGER_KEYS: CompanionTriggerKey[] = [
  'kill',
  'multikill',
  'death',
  'ace',
  'augmentPick',
  'victory',
  'defeat',
  'lossStreak'
]

function safeParse(raw: string | null): CompanionPersona[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as CompanionPersona[]
    return Array.isArray(list) ? list.filter(p => p && typeof p.id === 'string') : []
  } catch {
    return []
  }
}

/** 全部人设 = 用户自定义 + 内置（自定义优先展示在前） */
export function listPersonas(): CompanionPersona[] {
  try {
    return [...safeParse(localStorage.getItem(PERSONAS_KEY)), ...BUILT_IN_PERSONAS]
  } catch {
    return [...BUILT_IN_PERSONAS]
  }
}

/** 按 id 取人设；不存在回退第一个内置。 */
export function getPersona(id: string): CompanionPersona {
  return (
    listPersonas().find(p => p.id === id) ??
    BUILT_IN_PERSONAS[0] ?? {
      id: 'fallback',
      name: '搭子',
      persona: '',
      toneRules: [],
      triggers: {},
      memoryTurns: 4
    }
  )
}

/**
 * 保存人设：内置 id 会自动转为用户副本（id 加 `.custom` 后缀），避免污染内置定义。
 * @returns 实际落盘的 id
 */
export function upsertPersona(persona: CompanionPersona): string {
  const isBuiltin = BUILT_IN_PERSONAS.some(p => p.id === persona.id)
  const toSave: CompanionPersona = isBuiltin
    ? { ...persona, id: `${persona.id}.custom`, name: `${persona.name}·改` }
    : persona
  const users = safeParse(localStorage.getItem(PERSONAS_KEY)).filter(p => p.id !== toSave.id)
  users.push(toSave)
  try {
    localStorage.setItem(PERSONAS_KEY, JSON.stringify(users))
  } catch {
    /* 隐私模式等场景静默失败 */
  }
  return toSave.id
}

export function deletePersona(id: string): void {
  if (BUILT_IN_PERSONAS.some(p => p.id === id)) return // 内置不可删
  try {
    localStorage.setItem(
      PERSONAS_KEY,
      JSON.stringify(safeParse(localStorage.getItem(PERSONAS_KEY)).filter(p => p.id !== id))
    )
  } catch {
    /* ignore */
  }
}

export function getActivePersonaId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || BUILT_IN_PERSONAS[0]?.id || ''
  } catch {
    return BUILT_IN_PERSONAS[0]?.id ?? ''
  }
}

export function setActivePersonaId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    /* ignore */
  }
}

/** 触发器开关判定：缺省视为开启（内置人设无需穷举全部键）。 */
export function triggerEnabled(persona: CompanionPersona, key: CompanionTriggerKey): boolean {
  return persona.triggers[key] !== false
}
