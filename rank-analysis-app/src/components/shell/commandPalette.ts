/**
 * CommandPalette 的纯逻辑层（便于单测）。
 *
 * 命令模型刻意保持扁平：分组信息放在 group 字段里，过滤时只对
 * label + hint 做大小写不敏感的包含匹配，命中即保留原序。
 */

import type { Component } from 'vue'

export interface PaletteCommand {
  /** 稳定 key，供键盘导航 diff 用 */
  key: string
  /** 分组标题（页面 / 动作 / 查询…），仅展示用 */
  group: string
  /** 主文案 */
  label: string
  /** 右侧弱化提示（快捷键/说明） */
  hint?: string
  /** Lucide 图标组件（markRaw 包装，禁止响应式代理） */
  icon?: Component
  /** 执行动作 */
  run: () => void
}

/** 过滤命令：q 为空返回全部；否则 label/hint 包含（不区分大小写）即保留 */
export function filterCommands(list: PaletteCommand[], q: string): PaletteCommand[] {
  const query = q.trim().toLowerCase()
  if (!query) return list
  return list.filter(
    c => c.label.toLowerCase().includes(query) || (c.hint ?? '').toLowerCase().includes(query)
  )
}

/**
 * 最近使用排序：在「连续同分组」的段内按使用频次降序重排，
 * 分组边界与组内未使用条目的相对顺序保持不变（稳定）。
 * 仅浏览态（无搜索词）调用；有搜索词时保持相关度原序。
 */
export function sortByUsage(
  list: PaletteCommand[],
  usage: Record<string, number>
): PaletteCommand[] {
  const out: PaletteCommand[] = []
  let i = 0
  while (i < list.length) {
    let j = i
    while (j < list.length && list[j].group === list[i].group) j += 1
    const segment = list.slice(i, j)
    segment.sort((a, b) => (usage[b.key] ?? 0) - (usage[a.key] ?? 0))
    out.push(...segment)
    i = j
  }
  return out
}

const USAGE_KEY = 'palette.usage'
/** 持久化条目上限：防止长期使用后记录无限膨胀 */
const USAGE_MAX_ENTRIES = 20

export function loadUsage(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>
    return typeof v === 'object' && v ? v : {}
  } catch {
    return {}
  }
}

export function saveUsage(usage: Record<string, number>): void {
  // 只保留频次最高的前 N 条（0 计数剔除）
  const pruned = Object.entries(usage)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, USAGE_MAX_ENTRIES)
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries(pruned)))
  } catch {
    /* 隐私模式写失败静默 */
  }
}

/** 键盘上下移动：delta ±1，环形回绕；空列表返回 -1 表示无选中 */
export function nextIndex(current: number, length: number, delta: 1 | -1): number {
  if (length === 0) return -1
  return (current + delta + length) % length
}

/**
 * 把用户输入解析为「查询战绩」命令的参数。
 * 允许 `名称#tag`、纯名称、带空格变体；空串返回 null 表示不是查询意图。
 */
export function parsePlayerQuery(q: string): string | null {
  const s = q.trim()
  if (!s) return null
  return s.replace(/\s*#\s*/, '#')
}
