/**
 * Growth 目标备份（纯本地）：目标 + 本地备注序列化为 JSON，
 * 还原时按「维度+标题」匹配回填，缺失目标经 addHabitGoal 重建。
 */
import type { HabitGoal } from '../services/insight'

export interface GoalsBackup {
  version: 1
  exportedAt: string
  /** 导出时应用版本（getVersion 取值，旧备份/取不到时缺省） */
  appVersion?: string
  goals: HabitGoal[]
  notes: Record<string, string>
}

export function serializeGoalsBackup(
  goals: HabitGoal[],
  notes: Record<string, string>,
  appVersion?: string
): string {
  const backup: GoalsBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...(appVersion ? { appVersion } : {}),
    goals,
    notes
  }
  return JSON.stringify(backup, null, 2)
}

/** 解析并校验备份文本；结构不符抛错（调用方给用户明确失败提示） */
export function parseGoalsBackup(text: string): GoalsBackup {
  const raw = JSON.parse(text) as Partial<GoalsBackup> | null
  if (!raw || raw.version !== 1 || !Array.isArray(raw.goals)) {
    throw new Error('不是有效的成长目标备份文件')
  }
  const goals = raw.goals.filter(
    g =>
      g &&
      typeof g.id === 'number' &&
      typeof g.dimension === 'string' &&
      typeof g.title === 'string' &&
      typeof g.done === 'boolean'
  )
  const notes: Record<string, string> = {}
  if (raw.notes && typeof raw.notes === 'object') {
    for (const [k, v] of Object.entries(raw.notes)) {
      if (typeof v === 'string' && v.trim()) notes[k] = v
    }
  }
  return {
    version: 1,
    exportedAt: String(raw.exportedAt ?? ''),
    ...(raw.appVersion ? { appVersion: String(raw.appVersion) } : {}),
    goals,
    notes
  }
}

/**
 * 把备份中的备注按「维度+标题」映射到现有目标 id 上。
 * 备份里的旧 id 与本地 id 不同源，键必须重算。
 */
export function remapNotesByTitleKey(
  imported: GoalsBackup,
  currentGoals: HabitGoal[]
): Record<string, string> {
  const keyOf = (g: { dimension: string; title: string }) => `${g.dimension}::${g.title}`
  const oldNoteByKey = new Map<string, string>()
  for (const g of imported.goals) {
    const note = imported.notes[String(g.id)]
    if (note) oldNoteByKey.set(keyOf(g), note)
  }
  const out: Record<string, string> = {}
  for (const g of currentGoals) {
    const note = oldNoteByKey.get(keyOf(g))
    if (note) out[String(g.id)] = note
  }
  return out
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  // 精确到秒：同分钟内连续备份不再生成同名文件
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function goalsBackupFileName(): string {
  return `growth-goals-${stamp()}.json`
}
