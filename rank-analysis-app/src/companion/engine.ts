/**
 * AI 搭子台词引擎（feature-expansion-plan C2）。
 *
 * 两级生成，纪律与计划一致：
 * - **L1 模板**（本文件核心）：persona × 事件 → 槽位填充，<50ms、零成本、离线可用
 * - **L2 润色**（注入式钩子 `polish`）：可选异步 LLM 改写，失败/超时回退 L1 文案
 *
 * 防打扰三闸：触发器开关（persona.triggers）→ 冷却（全局 + 事件类型）→
 * 历史环形缓冲（memoryTurns 上限）。全部逻辑为纯函数 + 注入依赖，可完整单测。
 */

import {
  getActivePersonaId,
  getPersona,
  triggerEnabled,
  type CompanionPersona,
  type CompanionTriggerKey
} from './persona'

/** 游戏事件（由 Gaming 页 Live Client Data 事件流映射而来） */
export interface CompanionEvent {
  type: CompanionTriggerKey | 'assist'
  /** 事件发生时刻（毫秒）；测试可注入 */
  at: number
  championName?: string
  augmentName?: string
  /** 连败场数 / 多杀档位等数字槽位 */
  streak?: number
}

export interface CompanionLine {
  text: string
  source: 'template' | 'polished'
}

/** 冷却配置（毫秒）。 */
const COOLDOWNS_MS: Partial<Record<CompanionTriggerKey, number>> = {
  kill: 120_000,
  multikill: 90_000,
  death: 180_000,
  ace: 90_000,
  augmentPick: 30_000,
  victory: 0,
  defeat: 0,
  lossStreak: 0
}
const DEFAULT_COOLDOWN_MS = 90_000

// ---------------------------------------------------------------------------
// L1 模板库（按人设 id 前缀选择风格；未命中回退通用库）
// ---------------------------------------------------------------------------

type TemplateTable = Record<string, string[]>

const GENERIC_TEMPLATES: TemplateTable = {
  kill: ['{champion} 这波很稳！', '拿下！保持节奏'],
  multikill: ['{streak} 连杀！太秀了', '这波团战收割漂亮'],
  death: ['没事，下一波打回来', '稳住，别上头'],
  ace: ['团灭对面！乘胜追击', '漂亮团灭！推线别恋战'],
  augmentPick: ['拿到「{augment}」，按这个思路出装', '「{augment}」不错，围绕它打'],
  victory: ['赢了！数据回头复盘', '漂亮的一局'],
  defeat: ['输了不亏，看下复盘', '下一把调整过来'],
  lossStreak: ['连败 {streak} 场了…休息一下？', '状态低谷期，换个姿势再来']
}

/** 人设专属模板覆盖表（id 精确匹配；前缀匹配用于内置副本） */
const PERSONA_TEMPLATES: Record<string, TemplateTable> = {
  'builtin-xiaoman': {
    kill: ['{champion} 好样的！', '漂亮！节奏起来了'],
    multikill: ['{streak} 连杀！！开叠！', '收割机器上线！'],
    death: ['小失误！下波找回来', '没事没事，稳住'],
    ace: ['完美团灭！！', '这就是团队的力量！'],
    augmentPick: ['「{augment}」到手，成型了！', '好强化！按它出装准没错'],
    victory: ['赢啦！这把打得真好', '漂亮的胜利！'],
    defeat: ['可惜！下把一定行', '差一点点而已！'],
    lossStreak: ['连败 {streak} 场啦…喝口水缓缓', '低谷是反弹的前奏！']
  },
  'builtin-ruiping': {
    kill: ['{champion}？也就一般', '杀是杀了，走位拉胯'],
    multikill: ['{streak} 杀，对面送的吧', '行吧，这波算你秀'],
    death: ['又送？看下小地图', '这波死得不冤'],
    ace: ['团灭才像样', '总算打了波明白团'],
    augmentPick: ['「{augment}」？勉强能用', '拿是拿了，会用吗'],
    victory: ['赢了，但问题不少', '胜了，复盘见真章'],
    defeat: ['意料之中，看复盘去', '输了，锅在哪心里没数?'],
    lossStreak: ['{streak} 连败了，还来?', '建议先歇会再上头']
  },
  'builtin-ace': {
    kill: ['{champion} 保持压制', '优势在手，继续滚'],
    multikill: ['{streak} 连杀，转推塔', '团灭收益，吃资源'],
    death: ['复活后抱团走', '下次留一个技能保命'],
    ace: ['团灭后拿大龙资源', '趁团灭窗口推线'],
    augmentPick: ['「{augment}」优先补生存装', '围绕「{augment}」改出装'],
    victory: ['胜利。复盘看经济曲线', '拿下。保持参团率'],
    defeat: ['失利。下局先手更果断', '败因在团战站位，复盘'],
    lossStreak: ['连败 {streak} 局。建议暂停一局', '状态下滑，换英雄池试试']
  }
}

function templatesFor(personaId: string, type: string): string[] {
  const exact = PERSONA_TEMPLATES[personaId]?.[type]
  if (exact?.length) return exact
  const builtinBase = personaId.split('.')[0]
  return PERSONA_TEMPLATES[builtinBase]?.[type] ?? GENERIC_TEMPLATES[type] ?? []
}

/** 模板槽位填充：未知占位符原样保留（便于发现漏传字段）。 */
export function fillTemplate(tpl: string, event: CompanionEvent): string {
  return tpl.replace(/\{(\w+)\}/g, (raw, key: string) => {
    if (key === 'champion') return event.championName ?? raw
    if (key === 'augment') return event.augmentName ?? raw
    if (key === 'streak') return event.streak != null ? String(event.streak) : raw
    return raw
  })
}

/** 终局/关怀类事件：绕过全局冷却，必须开口。 */
const TERMINAL_TYPES = new Set<CompanionEvent['type']>(['victory', 'defeat', 'lossStreak'])

/** 冷却判定（纯函数）：终局类绕过全局冷却；其余按事件类型取值。 */
export function shouldSpeak(
  type: CompanionEvent['type'],
  lastSpokeAtByType: Readonly<Partial<Record<string, number>>>,
  now: number,
  globalLastAt: number,
  globalCooldownMs = DEFAULT_COOLDOWN_MS
): boolean {
  const lastType = lastSpokeAtByType[type] ?? -Infinity
  const cd = COOLDOWNS_MS[type as CompanionTriggerKey] ?? DEFAULT_COOLDOWN_MS
  if (now - lastType < cd) return false
  // 全局冷却：任意开口后短时间内不再接话（终局/关怀类除外）
  if (!TERMINAL_TYPES.has(type) && now - globalLastAt < globalCooldownMs) return false
  return true
}

export interface SpeakerDeps {
  /** 当前时间毫秒（默认 Date.now） */
  now?: () => number
  /** 模板随机选择器（默认 Math.random；测试注入确定性序列） */
  random?: () => number
  /**
   * L2 润色钩子：返回改写文本或 null（放弃润色）。实现方负责超时与错误兜底。
   */
  polish?: (text: string, history: CompanionEvent[]) => Promise<string | null>
}

export interface Speaker {
  readonly persona: CompanionPersona
  /** 处理一个游戏事件，返回要展示的台词；被开关/冷却拦下时返回 null */
  onEvent(event: CompanionEvent): Promise<CompanionLine | null>
  /** 近期已说事件的快照（供 L2 prompt 组装） */
  history(): CompanionEvent[]
}

export function createSpeaker(persona: CompanionPersona, deps: SpeakerDeps = {}): Speaker {
  const now = deps.now ?? (() => Date.now())
  void now // 预留：后续台词可能带时间戳槽位；当前事件自带 at
  const random = deps.random ?? Math.random
  const historyBuf: CompanionEvent[] = []
  const lastSpokeAtByType: Record<string, number> = {}
  let globalLastAt = -Infinity

  async function onEvent(event: CompanionEvent): Promise<CompanionLine | null> {
    if (!triggerEnabled(persona, event.type as CompanionTriggerKey)) return null
    if (!shouldSpeak(event.type, lastSpokeAtByType, event.at, globalLastAt)) return null

    const table = templatesFor(persona.id, event.type)
    if (!table.length) return null
    const tpl = table[Math.min(table.length - 1, Math.floor(random() * table.length))]
    const text = fillTemplate(tpl, event)

    // 先记历史与冷却再润色：润色耗时不应影响节流判定
    historyBuf.push(event)
    while (historyBuf.length > Math.max(persona.memoryTurns, 0)) historyBuf.shift()
    lastSpokeAtByType[event.type] = event.at
    globalLastAt = event.at

    if (deps.polish) {
      try {
        const polished = await deps.polish(text, [...historyBuf])
        if (polished && polished.trim()) return { text: polished.trim(), source: 'polished' }
      } catch {
        /* L2 失败静默回退 L1 */
      }
    }
    return { text, source: 'template' }
  }

  return { persona, onEvent, history: () => [...historyBuf] }
}

/** 用当前激活人设创建 speaker 的便捷入口。 */
export function createActiveSpeaker(deps: SpeakerDeps = {}): Speaker {
  return createSpeaker(getPersona(getActivePersonaId()), deps)
}
