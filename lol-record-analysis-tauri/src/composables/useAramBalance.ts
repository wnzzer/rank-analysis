/**
 * ARAM（极地大乱斗）英雄平衡性数据加载与标签计算
 * queueId 450 = 极地大乱斗, 2400 = 海克斯大乱斗
 */

import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface AramBalanceData {
  dmg_dealt?: number
  dmg_taken?: number
  healing?: number
  shielding?: number
  ability_haste?: number
  mana_regen?: number
  energy_regen?: number
  attack_speed?: number
  movement_speed?: number
  tenacity?: number
}

export interface BalanceTag {
  label: string
  desc: string
  type: 'success' | 'error'
  isBuff: boolean
}

export type BalanceStatus =
  | { label: '平衡'; type: 'default' }
  | { label: '增强'; type: 'success' }
  | { label: '削弱'; type: 'error' }
  | { label: '调整'; type: 'warning' }

const ARAM_QUEUE_IDS = new Set([450, 2400])

/**
 * 模块级缓存：同一 championId 的平衡性数据只请求一次
 * 多个 PlayerCard 在同一场对局中查同一英雄 / ChampSelect 反复切英雄的场景共享
 */
const aramCache = new Map<number, Promise<AramBalanceData | null>>()

function getAramBalance(id: number) {
  let cached = aramCache.get(id)
  if (!cached) {
    cached = invoke<AramBalanceData | null>('get_aram_balance', { id }).catch(error => {
      console.error('Failed to fetch ARAM balance:', error)
      aramCache.delete(id) // 失败时清除，允许下次重试
      return null
    })
    aramCache.set(id, cached)
  }
  return cached
}

export function useAramBalance(championId: Ref<number>, queueId: Ref<number>) {
  const aramBalance = ref<AramBalanceData | null>(null)
  const isAramMode = computed(() => ARAM_QUEUE_IDS.has(queueId.value))

  async function fetchAramBalance() {
    if (!championId.value || !isAramMode.value) {
      aramBalance.value = null
      return
    }
    const id = championId.value
    const result = await getAramBalance(id)
    // 防止竞态：若 championId 在 await 期间变了，放弃本次结果
    if (id === championId.value) {
      aramBalance.value = result
    }
  }

  watch(championId, fetchAramBalance)
  watch(isAramMode, fetchAramBalance)
  onMounted(fetchAramBalance)

  const balanceTags = computed<BalanceTag[]>(() => {
    if (!aramBalance.value) return []
    const b = aramBalance.value
    const tags: BalanceTag[] = []

    const formatPct = (val: number) => {
      const diff = val - 1
      return (diff > 0 ? '+' : '') + Math.round(diff * 100) + '%'
    }

    const pushPercent = (
      value: number | undefined,
      label: string,
      desc: string,
      buffWhenGreater: boolean
    ) => {
      if (typeof value !== 'number' || Math.abs(value - 1.0) <= 0.001) return
      const isBuff = buffWhenGreater ? value > 1 : value < 1
      tags.push({
        label: `${label} ${formatPct(value)}`,
        desc,
        type: isBuff ? 'success' : 'error',
        isBuff
      })
    }

    pushPercent(b.dmg_dealt, '输出', '造成伤害修正', true)
    pushPercent(b.dmg_taken, '承伤', '承受伤害修正', false)
    pushPercent(b.healing, '治疗', '治疗效果修正', true)
    pushPercent(b.shielding, '护盾', '护盾效果修正', true)

    if (typeof b.ability_haste === 'number' && b.ability_haste !== 0) {
      tags.push({
        label: `急速 ${b.ability_haste > 0 ? '+' : ''}${b.ability_haste}`,
        desc: '技能急速修正',
        type: b.ability_haste > 0 ? 'success' : 'error',
        isBuff: b.ability_haste > 0
      })
    }

    return tags
  })

  const overallBalanceStatus = computed<BalanceStatus>(() => {
    const tags = balanceTags.value
    if (tags.length === 0) return { label: '平衡', type: 'default' }

    let buffCount = 0
    let nerfCount = 0
    for (const tag of tags) {
      if (tag.isBuff) buffCount++
      else nerfCount++
    }

    if (buffCount > nerfCount) return { label: '增强', type: 'success' }
    if (nerfCount > buffCount) return { label: '削弱', type: 'error' }
    return { label: '调整', type: 'warning' }
  })

  return {
    aramBalance,
    isAramMode,
    balanceTags,
    overallBalanceStatus
  }
}
