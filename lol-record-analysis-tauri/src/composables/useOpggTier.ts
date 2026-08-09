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
  type OpggStatus,
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
   * 写配置、强制重拉，两步中任一步失败都把 `tier` 回滚到切换前：
   * 无论是配置压根没能落盘，还是配置写成功了但快照没拿到，
   * 此刻卡片上显示的都还是旧段位数据（降级链保留最后已知快照）。
   * 下拉若停在新段位，而卡片还是旧数据，界面就在撒谎。
   * 若失败发生在重拉阶段，配置本身仍保留新值，不影响下次成功拉取。
   *
   * 「重拉」不是「invoke 没抛错」：`update_opgg_data` 内部走降级链
   * （src-tauri/src/command/opgg.rs 的 `ensure_snapshot_impl`），HTTP 拉取失败但
   * 内存或磁盘还有旧段位缓存时会 `Ok` 返回那份旧数据，而不是 `Err`。国服网络不稳时
   * 这种情况远比「invoke 直接抛错」常见——如果只认 invoke 是否 resolve，就会出现
   * 下拉停在新段位、卡片却还是旧段位数据的「说的是钻石、显示的是翡翠」状态，且
   * 概率远高于本函数原本要防的那个场景。所以这里显式比较 `status.tier` 与目标
   * 段位是否一致，不一致按失败处理（回滚 + 不 bump）。
   */
  const switchTier = async (next: OpggTier): Promise<boolean> => {
    if (next === tier.value) return true

    const previous = tier.value
    tier.value = next
    loading.value = true
    try {
      await putConfigByIpc(CONFIG_KEY, next)
      const status = (await invoke('update_opgg_data', { mode: 'ranked' })) as OpggStatus
      if (status.tier !== next) {
        throw new Error(`opgg tier mismatch: expected ${next}, got ${status.tier}`)
      }
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
