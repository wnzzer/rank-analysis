/**
 * 习惯标签（M3 战场三）：跨局聚合「本机玩家」持续落后同局同位置对手的
 * L2 维度短板（vision / cs / deaths / kills / assists / damage），
 * 附连续落后局数 streak 与首/末检出时间；另含可勾选、跨局追踪的改错清单。
 *
 * 纪律：数据源全本地（meet_db 收集结果），拿不到本机召唤师或不足 5 局
 * 如实返回错误/空，不静默捏造。
 */

import { invoke } from '@tauri-apps/api/core'

/** 一条习惯标签（与 Rust `HabitTag` 对齐，camelCase） */
export interface HabitTag {
  dimension: string
  /** 平均相对同局同位置对手的差值（负 = 持续低于对手） */
  avgVsPeer: number
  /** 连续低于对手的局数（近因） */
  streak: number
  firstSeen: string
  lastSeen: string
}

/** 一条改错清单目标 */
export interface HabitGoal {
  id: number
  dimension: string
  title: string
  done: boolean
}

/** 维度 → 中文名/图标说明 */
export const DIMENSION_LABELS: Record<string, string> = {
  vision: '视野',
  cs: '补刀',
  deaths: '阵亡',
  kills: '击杀',
  assists: '助攻',
  damage: '伤害'
}

/** 维度 → 建议动作（改错清单的默认目标文案） */
export const DIMENSION_FIX_HINTS: Record<string, string> = {
  vision: '对局中每 2 分钟买一个真眼',
  cs: '前 10 分钟补刀落后时清线再支援',
  deaths: '阵亡前先看小地图，看到 2+ 人靠近就撤',
  kills: '换血前确认打野位置再上',
  assists: '团战先到，别让队友 4v5',
  damage: '团战前先消耗一轮再进场'
}

/** 重算并读取全部习惯标签（后端一站式：聚合 → 落库 → 返回） */
export async function getHabitTags(): Promise<HabitTag[]> {
  return await invoke<HabitTag[]>('get_habit_tags')
}

export async function listHabitGoals(): Promise<HabitGoal[]> {
  return await invoke<HabitGoal[]>('list_habit_goals')
}

export async function addHabitGoal(dimension: string, title: string): Promise<number> {
  return await invoke<number>('add_habit_goal_cmd', { dimension, title })
}

export async function toggleHabitGoal(id: number): Promise<void> {
  await invoke('toggle_habit_goal_cmd', { id })
}
