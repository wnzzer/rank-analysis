<!--
  模型名输入：可以从下拉里选（接入点提供了模型列表时），也可以直接手动输入。
  失焦或选中某项时才提交；提交空值表示「清除、恢复跟随」。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAutoComplete } from 'naive-ui'

/**
 * @property value - 当前已保存的模型名；没有为空串
 * @property options - 可选的模型名（接入点不提供列表时为空数组，此时就是一个普通输入框）
 * @property placeholder - 没填时显示的提示（通常是「实际会用哪个模型」）
 */
const props = defineProps<{
  value: string
  options: string[]
  placeholder?: string
}>()

const emit = defineEmits<{
  /** 用户改完了（失焦 / 选中 / 清空）；值与已保存的相同时不触发 */
  commit: [model: string]
  /** 正在输入的内容（还没提交），给「测试连接」取当前填的值用 */
  draft: [model: string]
}>()

const draft = ref(props.value)
watch(
  () => props.value,
  v => (draft.value = v)
)
watch(draft, v => emit('draft', v.trim()))

/** 下拉项：按已输入的内容过滤；输入内容与某项完全相同时仍显示全部，方便换一个 */
const shown = computed(() => {
  const q = draft.value.trim().toLowerCase()
  const exact = props.options.some(o => o.toLowerCase() === q)
  const list = !q || exact ? props.options : props.options.filter(o => o.toLowerCase().includes(q))
  return list.map(o => ({ label: o, value: o }))
})

function commit(next = draft.value): void {
  const model = next.trim()
  draft.value = model
  if (model !== props.value) emit('commit', model)
}
</script>

<template>
  <n-auto-complete
    v-model:value="draft"
    :options="shown"
    :placeholder="placeholder"
    :get-show="() => true"
    clearable
    blur-after-select
    @select="(v: string | number) => commit(String(v))"
    @blur="commit()"
    @clear="commit('')"
  />
</template>
