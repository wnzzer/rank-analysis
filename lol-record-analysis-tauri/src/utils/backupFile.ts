/**
 * 备份文件格式(v2 全量):校验与类型。
 *
 * v2 = 玩家备注 + 黑名单过滤后的全量配置(appConfig,由 Rust export_backup 生成)。
 * v1(仅备注)未发版无存量,不做兼容——version !== 2 一律拒绝。
 */
import type { PlayerNotesMap } from '@renderer/types/domain/playerNote'

/** 当前备份文件格式版本;后续扩展时递增并做兼容分支 */
export const BACKUP_VERSION = 2

/** v2 全量备份文件结构 */
export interface BackupFileV2 {
  version: 2
  type: 'rank-analysis-backup'
  exportedAt: number
  playerNotes: PlayerNotesMap
  appConfig: Record<string, unknown>
}

/** 是否为普通对象(排除 null / 数组 / 原始值——JSON.parse 可产出任意形状) */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** v2 备份文件结构校验:type 标记 + version 精确匹配 + 两个容器都是普通对象 */
export function isBackupFileV2(v: unknown): v is BackupFileV2 {
  if (!isPlainObject(v)) return false
  return (
    v.type === 'rank-analysis-backup' &&
    v.version === BACKUP_VERSION &&
    typeof v.exportedAt === 'number' &&
    Number.isFinite(v.exportedAt) &&
    isPlainObject(v.playerNotes) &&
    isPlainObject(v.appConfig)
  )
}
