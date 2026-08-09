/**
 * OP.GG 段位读取与切换。
 *
 * 设置页与对局页两个入口共用同一份配置 `settings.opgg.tier`，
 * 因此「写配置 → 强制重拉 → 通知消费方 → 失败回滚」这套编排也只该有一份实现。
 *
 * 隐含依赖（易碎，无测试守护）：两个入口各自调用 `useOpggTier()`，各持一份独立的
 * `tier` ref——不是同一个响应式对象。当前两边显示不会不同步，靠的是两件事同时成立：
 * 1. `Framework.vue`（对局页所在壳）与 `Settings.vue` 的 `<router-view>` 均未加
 *    `<keep-alive>`，路由切走会整个卸载组件树；
 * 2. 每次 mount 都会调一次 `loadTier()` 重新读配置，把两边拉回配置里的最新值。
 * 日后若给这些页面加 `keep-alive`（常见的性能优化）， mount 只发生一次，
 * `loadTier()` 不会在路由切回时重跑，两边的 `tier` ref 就可能静默漂移不同步——
 * 且这条路径目前没有任何测试覆盖。若要加 keep-alive，需要先把 tier 提升为
 * 模块级共享状态（同 `opggRevision` 的做法），而不是两份独立 ref。
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

  /**
   * 从配置读当前段位，未配置过时落到默认值。
   *
   * 校验而非无条件强转：配置文件可能被外部改坏（手改 json、旧版本遗留的非法值等）。
   * Rust 侧 `sanitize_tier` 遇到非法值会静默回落到 `emerald_plus` 再去请求数据，
   * 但前端这个下拉是独立读的这份配置——如果不校验直接 `as OpggTier`，下拉会显示
   * 一个不在 TIER_OPTIONS 里的非法值，naive-ui 找不到匹配选项，直接渲染成空白。
   * 界面显示的段位和实际请求数据用的段位对不上，是与「重拉后校验 status.tier」
   * （src-tauri/src/command/opgg.rs 的 OpggStatus.tier）同一类「界面撒谎」。
   */
  const loadTier = async (): Promise<void> => {
    const saved = await getConfigByIpc<string>(CONFIG_KEY)
    tier.value = TIER_OPTIONS.some(o => o.value === saved) ? (saved as OpggTier) : DEFAULT_OPGG_TIER
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
