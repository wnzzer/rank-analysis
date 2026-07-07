/**
 * 玩家备注（本地标记）类型定义
 *
 * 用户可按 puuid 给碰到过的玩家留"备注 + 颜色标记"，在对局玩家卡、
 * 玩家详情页展示，并在设置页集中管理。纯本地存储（复用 config IPC，
 * key = `playerNotes`），换机 / 重装会丢失，不跨设备同步。
 *
 * @see issue #67
 * @module types/domain/playerNote
 */

import type { OneGamePlayer } from './analysis'

/**
 * 备注颜色标记档位
 * - `friendly` 友好（绿）
 * - `normal`   一般（灰）
 * - `careful`  小心（橙）
 * - `blacklist` 拉黑（红）
 */
export type NoteLabel = 'friendly' | 'normal' | 'careful' | 'blacklist'

/**
 * 单条玩家备注
 * @property note - 备注文本，可为空（只标颜色不写字）
 * @property label - 颜色档位
 * @property gameName - 冗余存一份游戏名，用于设置列表展示（puuid 不可读）
 * @property tagLine - 冗余存一份标签
 * @property updatedAt - 最后更新时间（毫秒时间戳）
 * @property encounters - 遇见记录（在哪些对局里标记/碰到过 ta），按 gameId 去重、
 *   最近在前，复刻"遇见过"效果。复用 {@link OneGamePlayer} 以便直接用 MettingPlayersCard 渲染。
 * @property deleted - 墓碑：删除标记。物理删除会被云同步的合并"复活"（云端/其他
 *   设备仍持有旧活备注，合并时被当成新增并回），所以删除改写成墓碑条目——
 *   随"updatedAt 新者赢"的合并自然传播，使删除在多设备间生效。墓碑的内容
 *   字段已清空（note 空串、encounters 丢弃），仅保留 gameName/tagLine 便于调试。
 *   store 的 getNote/count/list 对墓碑透明（视同不存在）。
 */
export interface PlayerNote {
  note: string
  label: NoteLabel
  gameName: string
  tagLine: string
  updatedAt: number
  encounters?: OneGamePlayer[]
  deleted?: true
}

/**
 * 持久化结构：puuid -> 备注
 */
export type PlayerNotesMap = Record<string, PlayerNote>

/**
 * naive-ui 标签 / 主题类型（用于 n-tag、n-button 的 type）
 */
export type NaiveLabelType = 'success' | 'default' | 'warning' | 'error'

/**
 * 颜色档位元信息
 * @property value - 档位 key
 * @property text - 中文文案
 * @property naiveType - 对应 naive-ui 的 type，复用其语义色
 * @property cssVar - 对应的 CSS 变量（用于自定义色块），无则回退主题色
 */
export interface NoteLabelMeta {
  value: NoteLabel
  text: string
  naiveType: NaiveLabelType
  cssVar: string
}

/**
 * 四档颜色映射，复用 `global.css` 中既有的语义色变量，保证明暗主题一致。
 */
export const NOTE_LABELS: readonly NoteLabelMeta[] = [
  { value: 'friendly', text: '友好', naiveType: 'success', cssVar: 'var(--semantic-win)' },
  { value: 'normal', text: '一般', naiveType: 'default', cssVar: 'var(--text-tertiary)' },
  {
    value: 'careful',
    text: '小心',
    naiveType: 'warning',
    cssVar: 'var(--semantic-warning, #e0a52e)'
  },
  { value: 'blacklist', text: '拉黑', naiveType: 'error', cssVar: 'var(--semantic-loss)' }
] as const

/**
 * 按 label 取元信息，找不到回退到 `normal`。
 * @param label - 颜色档位
 * @returns 对应的元信息
 */
export function getNoteLabelMeta(label: NoteLabel): NoteLabelMeta {
  return NOTE_LABELS.find(l => l.value === label) ?? NOTE_LABELS[1]
}
