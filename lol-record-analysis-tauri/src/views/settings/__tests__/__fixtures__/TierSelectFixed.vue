<template>
  <n-select
    :value="opggTier"
    :options="[...TIER_OPTIONS]"
    :loading="opggTierLoading"
    :disabled="opggTierLoading"
    size="small"
    style="width: 130px"
    @update:value="updateOpggTier"
  />
</template>
<script setup lang="ts">
/**
 * 段位下拉最小复现组件——修复后接线（单向绑定）。
 *
 * 只保留 Automation.vue 中触发「段位切换失效」缺陷所需的最小上下文：
 * 真实的 useOpggTier() 组合式函数 + 与生产代码完全一致的 <n-select> 接线方式。
 * 用于 Automation.tierSelect.spec.ts 回归测试。
 *
 * `:value="opggTier"` 是唯一读路径，`@update:value="updateOpggTier"` 是唯一写路径，
 * 让 useOpggTier().switchTier 内部的赋值/回滚成为 tier 的唯一写者。
 *
 * 注：Automation.vue 里 <n-select> 靠 main.ts 的 `app.use(naive)` 全局注册解析，
 * 这里为了在孤立挂载（无全局 naive 插件）下仍能被 vue-test-utils 的 stubs 正确拦截，
 * 改成显式 `import { NSelect } from 'naive-ui'`（与 BpSuggestModal.vue 的写法一致）。
 * 这不影响本测试要验证的 v-model/@update:value 编译语义。
 */
import { NSelect } from 'naive-ui'
import { useOpggTier } from '@renderer/composables/useOpggTier'
import type { OpggTier } from '@renderer/services/opgg'

const {
  tier: opggTier,
  loading: opggTierLoading,
  options: TIER_OPTIONS,
  switchTier
} = useOpggTier()

const updateOpggTier = async (next: OpggTier) => {
  await switchTier(next)
}
</script>
