/**
 * Pick/Ban 规则 CRUD composable
 * 包装 put_config / get_config Tauri 命令，提供响应式的规则列表读写。
 * 配置层以 `{ value: <list> }` 格式存储；读取由 getConfigByIpc 自动解包。
 */

import { ref } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import type { PickRule, BanRule } from '@renderer/types/rules'

const PICK_KEY = 'settings.auto.pickRules'
const BAN_KEY = 'settings.auto.banRules'

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
    await putConfigByIpc(PICK_KEY, { value: next })
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
    await putConfigByIpc(BAN_KEY, { value: next })
  }

  return { rules, reload, save }
}
