<template>
  <n-modal
    :show="show"
    preset="card"
    title="新功能：备份与云同步"
    style="max-width: 420px"
    :mask-closable="false"
    :close-on-esc="false"
    :auto-focus="false"
  >
    <n-space vertical size="large">
      <!-- 两句拆成两个 n-text：避免单个长文本节点被 prettier 折行后，
           换行在 CJK 之间渲染成可见的半角空隙 -->
      <n-space vertical :size="4">
        <n-text>
          「我标记过的人」与应用设置现在支持导出/导入备份文件,以及可选的跨设备云同步(默认关闭)。
        </n-text>
        <n-text>可到 设置 → 数据与同步 里开启。</n-text>
      </n-space>
      <n-space justify="end">
        <n-button @click="emit('decide', false)">知道了</n-button>
        <n-button type="primary" @click="emit('decide', true)">去看看</n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * 云同步功能一次性告知弹窗（视觉组件）
 *
 * 只做"告知 + 导航"，不承担开启开关的职责——真正开启云同步必须经过设置页
 * （数据与同步）里的风险告知弹窗，所以这里的"去看看"只是跳转过去，不在此处
 * 触碰任何开关。是否已展示过、要不要跳转，均由父组件（Framework）编排与持久化。
 *
 * @property show - 是否展示
 * @emits decide - 用户选择；true=跳转设置页，false=仅关闭。两种选择都视为"已告知"
 */
import { NModal, NSpace, NText, NButton } from 'naive-ui'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ decide: [goto: boolean] }>()
</script>
