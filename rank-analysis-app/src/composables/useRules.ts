/**
 * Pick/Ban 规则 CRUD composable
 * 包装 put_config / get_config Tauri 命令，提供响应式的规则列表读写。
 */

import { ref } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import type { PickRule, BanRule } from '@renderer/types/rules'

const PICK_KEY = 'settings.auto.pickRules'
const BAN_KEY = 'settings.auto.banRules'
const RUNE_KEY = 'settings.auto.runeRules'

/**
 * Pick 规则列表的响应式读写。
 * - `rules`: 当前规则列表（ref，可直接绑定模板）
 * - `reload()`: 从持久化存储加载规则，键不存在时静默返回空数组
 * - `save(next)`: 更新 rules 并持久化到存储
 */
export function usePickRules() {
  const rules = ref<PickRule[]>([])

  const reload = async () => {
    try {
      const loaded = await getConfigByIpc<PickRule[]>(PICK_KEY)
      rules.value = Array.isArray(loaded) ? loaded : []
    } catch (e) {
      console.debug('usePickRules: pickRules not yet set', e)
      rules.value = []
    }
  }

  const save = async (next: PickRule[]) => {
    rules.value = next
    await putConfigByIpc(PICK_KEY, next)
  }

  return { rules, reload, save }
}

/**
 * Ban 规则列表的响应式读写。
 * - `rules`: 当前规则列表（ref，可直接绑定模板）
 * - `reload()`: 从持久化存储加载规则，键不存在时静默返回空数组
 * - `save(next)`: 更新 rules 并持久化到存储
 */
export function useBanRules() {
  const rules = ref<BanRule[]>([])

  const reload = async () => {
    try {
      const loaded = await getConfigByIpc<BanRule[]>(BAN_KEY)
      rules.value = Array.isArray(loaded) ? loaded : []
    } catch (e) {
      console.debug('useBanRules: banRules not yet set', e)
      rules.value = []
    }
  }

  const save = async (next: BanRule[]) => {
    rules.value = next
    await putConfigByIpc(BAN_KEY, next)
  }

  return { rules, reload, save }
}

/**
 * 符文页规则（P1-3）：英雄 → 符文页名映射，与 Rust `RuneRule` 同构。
 *
 * 序列化规范：字段保持 camelCase（championId / pageName），与前端
 * putConfigByIpc 直接存储的 JSON 一致（Rust 端 parse_rune_rules_value 读取同键）。
 */
export interface RuneRule {
  championId: number
  pageName: string
}

/**
 * 符文页规则列表的响应式读写。
 * - `rules`: 当前规则列表（ref）
 * - `reload()`: 从持久化存储加载，键不存在时静默返回空数组
 * - `save(next)`: 更新 rules 并持久化
 */
export function useRuneRules() {
  const rules = ref<RuneRule[]>([])

  const reload = async () => {
    try {
      const loaded = await getConfigByIpc<RuneRule[]>(RUNE_KEY)
      rules.value = Array.isArray(loaded) ? loaded : []
    } catch (e) {
      console.debug('useRuneRules: runeRules not yet set', e)
      rules.value = []
    }
  }

  const save = async (next: RuneRule[]) => {
    rules.value = next
    await putConfigByIpc(RUNE_KEY, next)
  }

  return { rules, reload, save }
}
