<script setup lang="ts">
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import LoadingComponent from '../components/LoadingComponent.vue'
import { useGameState } from '../composables/useGameState'

const { reasonCode, reasonMessage } = useGameState()

/** 检测到客户端但无权读取（典型：游戏以管理员身份运行，本工具没有）。 */
const isAccessDenied = computed(() => reasonCode.value === 'ACCESS_DENIED')

const mainText = computed(() => (isAccessDenied.value ? '需要管理员权限' : '等待连接客户端...'))
const hint = computed(() =>
  isAccessDenied.value ? (reasonMessage.value ?? '请以管理员身份运行本工具') : undefined
)

const relaunching = ref(false)

async function relaunchAsAdmin() {
  if (relaunching.value) return
  relaunching.value = true
  try {
    await invoke('relaunch_as_admin')
  } catch (e) {
    console.error('以管理员身份重启失败:', e)
    relaunching.value = false
  }
}
</script>

<template>
  <LoadingComponent :hint="hint">
    {{ mainText }}
    <template v-if="isAccessDenied" #action>
      <button class="admin-btn" :disabled="relaunching" @click="relaunchAsAdmin">
        {{ relaunching ? '正在重启...' : '以管理员身份重启' }}
      </button>
    </template>
  </LoadingComponent>
</template>

<style scoped>
.admin-btn {
  margin-top: var(--space-12, 12px);
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--semantic-win, #3d9b7a);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition:
    filter 0.15s ease,
    opacity 0.15s ease;
}

.admin-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.admin-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
