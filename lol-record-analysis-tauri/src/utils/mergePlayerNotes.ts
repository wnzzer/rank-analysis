/**
 * 玩家备注合并(云同步 / 手动导入共用)
 *
 * 纯函数:同 puuid 按 `updatedAt` 新者赢,相等保留本地;非法条目跳过。
 *
 * @module utils/mergePlayerNotes
 */
import type { PlayerNote, PlayerNotesMap } from '@renderer/types/domain/playerNote'

/**
 * 墓碑保留时长：30 天。
 *
 * 墓碑（`deleted: true` 条目）的唯一使命是把"删除"随合并传播到云端与其他
 * 设备，之后就是死重——不清理的话 map 只增不减。30 天窗口的取值权衡：
 * 太短则长期离线的设备错过删除传播（回线后其旧活备注会复活该条目）；
 * 太长则墓碑堆积。30 天足以覆盖绝大多数设备的回线周期。
 *
 * 过期裁决放在 {@link mergeNotesMaps}（所有外部数据的必经信任边界）：
 * 若只在加载时过滤内存，云端行里的老墓碑每次 pull 都会被当"新增"并入、
 * 落盘再推回云端，GC 永远无法收敛。
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 合并统计,供导入/同步完成后的 UI 反馈 */
export interface MergeStats {
  /** 本地原本没有、新增的条数 */
  added: number
  /** 传入更新、覆盖本地的条数 */
  replaced: number
  /** 本地更新(或同龄)、保持不变的条数 */
  kept: number
  /** 结构非法或键不安全、被跳过的条数 */
  invalid: number
  /** 过期墓碑(删除标记超过 {@link TOMBSTONE_TTL_MS})、被跳过的条数 */
  expired: number
}

/**
 * 最低限度的结构校验:对象 + 有限数值 updatedAt + 字符串 label(防导入损坏文件)。
 * 用 `Number.isFinite` 而非 `typeof === 'number'`:NaN 与任何数比较恒 false,
 * 一旦并入就永远无法被更新的时间戳替换。
 */
function isValidNote(v: unknown): v is PlayerNote {
  if (!v || typeof v !== 'object') return false
  const n = v as Partial<PlayerNote>
  return Number.isFinite(n.updatedAt) && typeof n.label === 'string'
}

/**
 * 合并两张备注表,不修改入参。
 * @param base - 本地表(冲突时的"守方")
 * @param incoming - 传入表(导入文件 / 云端拉取)
 * @param now - 当前时刻(毫秒),墓碑过期判定用;默认 `Date.now()`,测试可注入
 * @returns 合并结果与统计
 */
export function mergeNotesMaps(
  base: PlayerNotesMap,
  incoming: PlayerNotesMap,
  now: number = Date.now()
): { merged: PlayerNotesMap; stats: MergeStats } {
  const merged: PlayerNotesMap = { ...base }
  const stats: MergeStats = { added: 0, replaced: 0, kept: 0, invalid: 0, expired: 0 }
  const expireBefore = now - TOMBSTONE_TTL_MS
  for (const [puuid, note] of Object.entries(incoming)) {
    if (!isValidNote(note)) {
      stats.invalid++
      continue
    }
    // 过期墓碑不参与合并:它的"删除传播"使命早已完成,并入只会让加载时
    // 的 GC 白做(复活→落盘→推回云端的循环)。跳过即保持本地现状。
    if (note.deleted && note.updatedAt < expireBefore) {
      stats.expired++
      continue
    }
    // `__proto__` 是保留键:普通对象字面量上 `merged['__proto__'] = note` 走原型
    // setter,不会成为自有属性,直接拒绝(不可信输入不该有这种 puuid)。
    if (puuid === '__proto__') {
      stats.invalid++
      continue
    }
    // 用 hasOwnProperty 判断存在性:`toString` 等键会命中原型链继承属性,
    // 直接真值判断会把新条目误判为已存在而静默丢弃。
    // (不用 Object.hasOwn:那是 ES2022 API,项目 tsconfig target/lib 是 ES2020。)
    const existing = Object.prototype.hasOwnProperty.call(merged, puuid) ? merged[puuid] : undefined
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
