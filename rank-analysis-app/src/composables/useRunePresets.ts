/**
 * 我的符文方案读写（配置 `settings.auto.runePresets` / `settings.auto.runeFallback`）
 *
 * 与 useRules.ts 同形：每次调用返回独立的响应式列表，调用方先 reload 再读写。
 * 方案进云同步——换设备跟着走；自动应用任务（Rust `apply_runes`）读同一份配置。
 *
 * @module composables/useRunePresets
 */

import { ref, type Ref } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import type { RuneFallback, RunePreset } from '@renderer/types/championBuild'

/** 三段数量必须是 4/2/3（与 Rust `RunePreset::is_valid` 一致），坏条目读时丢弃 */
function isValidPreset(p: RunePreset): boolean {
  return (
    !!p &&
    typeof p.champion_id === 'number' &&
    typeof p.position === 'string' &&
    p.primary_perk_ids?.length === 4 &&
    p.sub_perk_ids?.length === 2 &&
    p.stat_mod_ids?.length === 3
  )
}

/**
 * 我的符文方案
 * @returns presets（方案列表，新记住的在前）、fallback（兜底策略）、reload、
 *   find（按英雄 + 分路查）、remember（记住，覆盖同键）、forget（取消记住）、setFallback
 * @example
 * ```ts
 * const rp = useRunePresets()
 * await rp.reload()
 * await rp.remember(presetFromRune(157, 'middle', rune))
 * ```
 */
export function useRunePresets(): {
  presets: Ref<RunePreset[]>
  fallback: Ref<RuneFallback>
  reload: () => Promise<void>
  find: (championId: number, position: string) => RunePreset | null
  remember: (preset: RunePreset) => Promise<void>
  forget: (championId: number, position: string) => Promise<void>
  setFallback: (next: RuneFallback) => Promise<void>
} {
  const presets = ref<RunePreset[]>([])
  const fallback = ref<RuneFallback>('opgg')

  async function reload(): Promise<void> {
    try {
      const loaded = await getConfigByIpc<RunePreset[]>(CONFIG_KEYS.runePresets)
      presets.value = Array.isArray(loaded) ? loaded.filter(isValidPreset) : []
      // 只有明确的 none 才是不写；未配置（空串）默认用 OP.GG
      const fb = await getConfigByIpc<string>(CONFIG_KEYS.runeFallback)
      fallback.value = fb === 'none' ? 'none' : 'opgg'
    } catch (e) {
      console.debug('useRunePresets: not yet set', e)
      presets.value = []
      fallback.value = 'opgg'
    }
  }

  function find(championId: number, position: string): RunePreset | null {
    return presets.value.find(p => p.champion_id === championId && p.position === position) ?? null
  }

  async function save(next: RunePreset[]): Promise<void> {
    presets.value = next
    await putConfigByIpc(CONFIG_KEYS.runePresets, next)
  }

  async function remember(preset: RunePreset): Promise<void> {
    const rest = presets.value.filter(
      p => !(p.champion_id === preset.champion_id && p.position === preset.position)
    )
    await save([preset, ...rest])
  }

  async function forget(championId: number, position: string): Promise<void> {
    await save(
      presets.value.filter(p => !(p.champion_id === championId && p.position === position))
    )
  }

  async function setFallback(next: RuneFallback): Promise<void> {
    fallback.value = next
    await putConfigByIpc(CONFIG_KEYS.runeFallback, next)
  }

  return { presets, fallback, reload, find, remember, forget, setFallback }
}
