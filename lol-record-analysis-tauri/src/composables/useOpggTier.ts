/**
 * OP.GG 段位读取与切换。
 *
 * 设置页与对局页两个入口共用同一份配置 `settings.opgg.tier`，
 * 因此「写配置 → 强制重拉 → 通知消费方 → 失败回滚」这套编排也只该有一份实现。
 */
import { ref, type Ref } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import {
  bumpOpggRevision,
  DEFAULT_OPGG_TIER,
  TIER_OPTIONS,
  type OpggTier
} from '@renderer/services/opgg'

const CONFIG_KEY = 'settings.opgg.tier'

export function useOpggTier(): {
  tier: Ref<OpggTier>
  loading: Ref<boolean>
  options: typeof TIER_OPTIONS
  loadTier: () => Promise<void>
  switchTier: (next: OpggTier) => Promise<boolean>
} {
  const tier = ref<OpggTier>(DEFAULT_OPGG_TIER)
  const loading = ref(false)

  /** 从配置读当前段位，未配置过时落到默认值。 */
  const loadTier = async (): Promise<void> => {
    const saved = await getConfigByIpc<string>(CONFIG_KEY)
    tier.value = (saved as OpggTier) ?? DEFAULT_OPGG_TIER
  }

  /**
   * 切换段位。
   *
   * 重拉失败时把 `tier` 回滚到切换前：配置已经写进去了，但快照没拿到，
   * 此刻卡片上显示的仍是旧段位数据（降级链保留最后已知快照）。
   * 下拉若停在新段位，界面就在撒谎。配置本身保留新值，不影响下次成功拉取。
   */
  const switchTier = async (next: OpggTier): Promise<boolean> => {
    if (next === tier.value) return true

    const previous = tier.value
    tier.value = next
    loading.value = true
    try {
      await putConfigByIpc(CONFIG_KEY, next)
      await invoke('update_opgg_data', { mode: 'ranked' })
      bumpOpggRevision()
      return true
    } catch (error) {
      console.warn('[opgg] 段位切换后重拉快照失败，显示值回滚:', error)
      tier.value = previous
      return false
    } finally {
      loading.value = false
    }
  }

  return { tier, loading, options: TIER_OPTIONS, loadTier, switchTier }
}
