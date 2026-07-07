/**
 * 玩家备注合并(云同步 / 手动导入共用)
 *
 * 纯函数:同 puuid 按 `updatedAt` 新者赢,相等保留本地;非法条目跳过。
 *
 * @module utils/mergePlayerNotes
 */
import type { PlayerNote, PlayerNotesMap } from '@renderer/types/domain/playerNote'

/** 合并统计,供导入/同步完成后的 UI 反馈 */
export interface MergeStats {
  /** 本地原本没有、新增的条数 */
  added: number
  /** 传入更新、覆盖本地的条数 */
  replaced: number
  /** 本地更新(或同龄)、保持不变的条数 */
  kept: number
  /** 结构非法被跳过的条数 */
  invalid: number
}

/** 最低限度的结构校验:对象 + 数值 updatedAt + 字符串 label(防导入损坏文件) */
function isValidNote(v: unknown): v is PlayerNote {
  if (!v || typeof v !== 'object') return false
  const n = v as Partial<PlayerNote>
  return typeof n.updatedAt === 'number' && typeof n.label === 'string'
}

/**
 * 合并两张备注表,不修改入参。
 * @param base - 本地表(冲突时的"守方")
 * @param incoming - 传入表(导入文件 / 云端拉取)
 * @returns 合并结果与统计
 */
export function mergeNotesMaps(
  base: PlayerNotesMap,
  incoming: PlayerNotesMap
): { merged: PlayerNotesMap; stats: MergeStats } {
  const merged: PlayerNotesMap = { ...base }
  const stats: MergeStats = { added: 0, replaced: 0, kept: 0, invalid: 0 }
  for (const [puuid, note] of Object.entries(incoming)) {
    if (!isValidNote(note)) {
      stats.invalid++
      continue
    }
    const existing = merged[puuid]
    if (!existing) {
      merged[puuid] = note
      stats.added++
    } else if (note.updatedAt > existing.updatedAt) {
      merged[puuid] = note
      stats.replaced++
    } else {
      stats.kept++
    }
  }
  return { merged, stats }
}
