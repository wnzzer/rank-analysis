<template>
  <n-modal
    :show="show"
    preset="card"
    title="云端已有一份配置"
    style="max-width: 420px"
    :mask-closable="false"
    :close-on-esc="false"
    :auto-focus="false"
  >
    <n-space vertical size="large">
      <n-space vertical :size="4">
        <n-text>云端存在一份配置(更新于 {{ updatedAtText }}),与本机当前配置不一致。</n-text>
        <n-text :depth="3" style="font-size: var(--font-size-sm)">
          「使用云端配置」会覆盖本机的设置与标记;「保留本机」会把本机配置推送覆盖云端。
        </n-text>
      </n-space>
      <n-space justify="end">
        <n-button @click="emit('decide', false)">保留本机</n-button>
        <n-button type="primary" @click="emit('decide', true)">使用云端配置</n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * 首次配置同步确认弹窗(视觉组件)
 *
 * 只在"本设备首次同步 && 云端已有配置 && 与本地不一致"时出现一次(spec:
 * 拉取覆盖必须经用户确认兜底)。裁决逻辑在 cloudSync store 的
 * resolveCloudConfig,本组件只做展示;编排由 Framework 承担。
 *
 * @property show - 是否展示
 * @property updatedAt - 云端配置的更新时刻(毫秒)
 * @emits decide - true=用云端覆盖本机;false=保留本机并推送覆盖云端
 */
import { computed } from 'vue'
import { NModal, NSpace, NText, NButton } from 'naive-ui'

const props = defineProps<{ show: boolean; updatedAt: number }>()
const emit = defineEmits<{ decide: [useCloud: boolean] }>()

const updatedAtText = computed(() => new Date(props.updatedAt).toLocaleString())
</script>
