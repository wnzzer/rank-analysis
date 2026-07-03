/**
 * 把玩家手动备注压缩成一行供 AI prompt 使用。
 *
 * 返回格式：`[色档中文] 备注文本(≤50字)`；无备注返回 undefined。
 * 截断到 50 字防 prompt 膨胀（一局最多 10 人都有备注）。
 *
 * 注意：调用方负责先检查 `CONFIG_KEYS.aiUsePlayerNotes` 开关，本函数不读配置。
 *
 * @module services/ai/shared/noteBrief
 */

import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import { getNoteLabelMeta } from '@renderer/types/domain/playerNote'

/** 备注文本注入 prompt 时的最大长度（字符数） */
const MAX_NOTE_LENGTH = 50

/**
 * 生成某玩家的备注速览（供 AI prompt 注入）
 * @param puuid - 玩家唯一标识
 * @returns `[色档] 文本` / 只标色不写字时 `[色档]` / 无备注时 undefined
 * @example
 * ```ts
 * buildNoteBrief('puuid-1') // => '[拉黑] 上局挂机'
 * ```
 */
export function buildNoteBrief(puuid: string): string | undefined {
  const note = usePlayerNotesStore().getNote(puuid)
  if (!note) return undefined
  const label = `[${getNoteLabelMeta(note.label).text}]`
  const text = note.note.trim().slice(0, MAX_NOTE_LENGTH)
  return text ? `${label} ${text}` : label
}
