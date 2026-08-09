<template>
  <n-select
    v-model:value="opggTier"
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
 * 段位下拉最小复现组件——修复前接线（v-model + @update:value 双写同一 ref）。
 *
 * 刻意保留 Automation.vue 修复前的缺陷接线：`v-model:value="opggTier"` 与
 * `@update:value="updateOpggTier"` 同时写在同一个 <n-select> 上。Vue 3 会把二者编译进
 * 同一个 onUpdate:value 处理器数组并按下标顺序同步派发——下标 0 是 v-model 的自动赋值，
 * 下标 1 才是 updateOpggTier。等 updateOpggTier 内部调用 switchTier(next) 时，
 * tier.value 早已被 v-model 写成了 next，命中 useOpggTier 里的 no-op 守卫
 * （`if (next === tier.value) return true`），写配置 / 重拉快照 / bump 版本号全部被跳过。
 *
 * 只用于 Automation.tierSelect.spec.ts 的回归防护测试：证明「如果接线改回这个样子，
 * 测试会失败」，从而反证「修复后的接线」测试确实钉住了这个缺陷，而非碰巧通过。
 * 不要把这个组件用在别处，也不要"修好"它——它就是要复现缺陷。
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
