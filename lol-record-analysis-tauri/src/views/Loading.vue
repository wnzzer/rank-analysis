<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import router from '../router'
import LoadingComponent from '../components/LoadingComponent.vue'
import { useGameState } from '../composables/useGameState'
import { launchLeagueByIpc } from '../services/ipc'

const { reasonCode, reasonMessage, isConnected, summoner } = useGameState()

/**
 * 兜底跳转：已连接却仍停在本页时，主动跳转战绩页。
 *
 * 正常跳转在 useGameState 的连接事件里做，但「未连接→已连接」与「跳转 /Loading」
 * 两个异步动作存在竞态：若跳转 /Loading 的导航尚未落定就收到已连接事件，事件里读到
 * 的 currentPath 仍不是 /Loading，判断失败便漏跳，导致明明连上却卡在本页且无新事件
 * 纠正（一键启动后尤其容易触发）。本页只在 /Loading 挂载，故由它**响应式**监听连接
 * 状态兜底——不依赖事件那一刻的 currentPath，天然避开竞态；`immediate` 覆盖「进入
 * 本页时已是连接态」的情形。
 */
watch(
  isConnected,
  connected => {
    if (connected && summoner.value) {
      router.push({
        path: '/Record',
        query: { name: `${summoner.value.gameName}#${summoner.value.tagLine}` }
      })
    }
  },
  { immediate: true }
)

/** 检测到客户端但无权读取（典型：游戏以管理员身份运行，本工具没有）。 */
const isAccessDenied = computed(() => reasonCode.value === 'ACCESS_DENIED')

const mainText = computed(() => (isAccessDenied.value ? '需要管理员权限' : '等待连接客户端...'))

const launching = ref(false)
const launchError = ref<string | null>(null)

/** 副提示：权限不足给权限说明；启动失败给失败原因；否则用默认文案。 */
const hint = computed(() => {
  if (isAccessDenied.value) return reasonMessage.value ?? '请以管理员身份运行本工具'
  if (launchError.value) return launchError.value
  return undefined
})

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

/**
 * 免 WeGame 一键启动游戏。
 *
 * 拉起成功后保持"正在启动"，等 game_state_monitor 感知连接后自动跳转 Record；
 * 若 30s 内仍未连上（如用户关掉了登录窗），恢复按钮允许重试（连接成功会跳走，
 * 本组件卸载后该超时自然失效）。
 */
async function launchLeague() {
  if (launching.value) return
  launching.value = true
  launchError.value = null
  try {
    await launchLeagueByIpc()
    setTimeout(() => {
      launching.value = false
    }, 30000)
  } catch (e) {
    launchError.value = typeof e === 'string' ? e : '启动失败，请重试或手动打开游戏'
    launching.value = false
  }
}
</script>

<template>
  <LoadingComponent :hint="hint">
    {{ mainText }}
    <template #action>
      <button
        v-if="isAccessDenied"
        class="admin-btn"
        :disabled="relaunching"
        @click="relaunchAsAdmin"
      >
        {{ relaunching ? '正在重启...' : '以管理员身份重启' }}
      </button>
      <button v-else class="admin-btn" :disabled="launching" @click="launchLeague">
        {{ launching ? '正在启动游戏...' : '一键启动游戏' }}
      </button>
    </template>
  </LoadingComponent>
</template>

<style scoped>
.admin-btn {
  margin-top: var(--space-12, 12px);
  padding: var(--space-6) var(--space-16);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: #fff;
  background: var(--semantic-win, #3d9b7a);
  border: none;
  border-radius: var(--radius-md);
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
