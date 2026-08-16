/**
 * 知识库数据访问封装
 *
 * 对应 Rust command/knowledge.rs 三命令的类型安全包装。
 * 网络型失败吞掉返回 null——数据缺失走内置兜底/降级是常态。
 */

import { invoke } from '@tauri-apps/api/core'

export interface KnowledgeCondition {
  metric: string
  /** lt | lte | gt | gte | eq */
  op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq'
  value: number
}

export interface KnowledgeSignalRule {
  id: string
  /** teammate | enemy | self */
  scope: 'self' | 'teammate' | 'enemy'
  position?: string
  whenAll: KnowledgeCondition[]
  whenAny: KnowledgeCondition[]
  text: string
  /** info | warn | danger */
  severity: 'info' | 'warn' | 'danger'
}

export interface KnowledgeBase {
  schemaVersion: number
  patch: string
  updatedAt: string
  patchNotes: Record<string, unknown>
  championNotes: Record<string, unknown>
  /** "ranked" | "aram" | "brawl" → 知识条目 */
  modeKnowledge: Record<string, string[]>
  signalRules: KnowledgeSignalRule[]
}

export interface KnowledgeStatus {
  patch: string
  updatedAt: string
  /** remote | fallback */
  source: string
  stale: boolean
}

/** 模块级内存缓存（TTL 10 分钟）：get_knowledge 高频调用时零往返 */
let baseCache: { data: KnowledgeBase | null; expireAt: number } | null = null
const BASE_TTL_MS = 10 * 60 * 1000

/**
 * 读取知识库（含内置兜底，通常不会为 null）
 * @param force - 跳过内存缓存强制刷新（设置页手动刷新时传 true）
 */
export async function getKnowledgeBase(force = false): Promise<KnowledgeBase | null> {
  const now = Date.now()
  if (!force && baseCache && baseCache.expireAt > now) {
    return baseCache.data
  }
  try {
    const data = (await invoke('get_knowledge')) as KnowledgeBase | null
    baseCache = { data, expireAt: now + BASE_TTL_MS }
    return data
  } catch (error) {
    console.warn('[knowledge] getKnowledgeBase failed:', error)
    baseCache = { data: null, expireAt: now + BASE_TTL_MS }
    return null
  }
}

/**
 * 强制刷新知识库（设置页手动刷新）
 * @returns 拉取到的数据或 null（失败/无数据）
 */
export async function forceUpdateKnowledge(): Promise<KnowledgeBase | null> {
  baseCache = null
  try {
    await invoke('update_knowledge')
    return await getKnowledgeBase(/** force */ true)
  } catch (error) {
    console.warn('[knowledge] forceUpdateKnowledge failed:', error)
    return getKnowledgeBase()
  }
}

/** 知识库状态（版本 / 更新时间 / 来源） */
export async function getKnowledgeStatus(): Promise<KnowledgeStatus | null> {
  try {
    const result = (await invoke('get_knowledge_status')) as KnowledgeStatus
    return result ?? null
  } catch (error) {
    console.warn('[knowledge] getKnowledgeStatus failed:', error)
    return null
  }
}

/** 清空内存缓存（测试用） */
export function __resetKnowledgeCacheForTests(): void {
  baseCache = null
}
