<template>
  <div class="settings">
    <!-- v3：单层顶 tab（原内嵌 sider 已拆除，全局舰桥是唯一侧栏） -->
    <div class="tabs" role="tablist">
      <button
        v-for="opt in visibleOptions"
        :key="opt.key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': route.name === opt.key }"
        :aria-selected="route.name === opt.key"
        @click="go(opt.key)"
      >
        {{ opt.label }}
        <span
          v-if="opt.key === 'DataSync' && cloudStore.pendingCloudConfig"
          class="pending-badge-dot"
          aria-hidden="true"
        ></span>
      </button>
    </div>

    <div class="pane" :class="{ 'pane--flush': isGeneral }">
      <router-view v-slot="{ Component }">
        <Transition name="settings-content" mode="out-in">
          <component :is="Component" :key="route.name" />
        </Transition>
      </router-view>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置页（设计系统 v3 §C6）：单层顶 tab。
 * 原内嵌 240/64px sider 已拆除——全局舰桥是唯一侧栏，路径深度减一层。
 * 「标签管理 / 我标记过的人」升格为独立「资产库」页（/Library），
 * 两个子路由保留以兼容深链，但不再出现在设置导航里。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'

const route = useRoute()
const router = useRouter()
const cloudStore = useCloudSyncStore()

const options = [
  { key: 'General', label: '常规设置' },
  { key: 'Automation', label: '自动化' },
  { key: 'DataSync', label: '数据与同步' },
  { key: 'About', label: '关于我们' }
]
const visibleOptions = options

/** General 子页自带 CornerCard 分组，容器不再额外加内边距 */
const isGeneral = computed(() => route.name === 'General')

function go(key: string) {
  router.push({ name: key })
}
</script>

<style scoped>
.settings {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-20);
  flex-shrink: 0;
}
.tab {
  position: relative;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  padding: var(--space-8) var(--space-16);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}
.tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}
.tab--on {
  color: var(--brand);
  border-bottom-color: var(--brand);
  text-shadow: var(--glow-brand);
}
/* 待裁决呼吸角标：本体动画/配色沿用 global.css .pending-badge-dot，这里只占位 */
.pending-badge-dot {
  display: inline-block;
}

.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-4) var(--space-24) 0;
}
.pane--flush {
  overflow: visible;
}

.settings-content-enter-active,
.settings-content-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}
.settings-content-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.settings-content-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
