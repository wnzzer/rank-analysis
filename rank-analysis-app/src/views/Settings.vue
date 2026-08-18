<template>
  <n-layout>
    <n-layout has-sider>
      <n-layout-sider
        bordered
        collapse-mode="width"
        :collapsed-width="64"
        :width="240"
        :show-trigger="false"
        :collapsed="collapsed"
      >
        <n-menu
          :value="router.currentRoute.value.name"
          :collapsed="collapsed"
          :collapsed-width="64"
          :collapsed-icon-size="22"
          :options="menuOptions"
          @update:value="handleMenuSelect"
        />
      </n-layout-sider>
      <n-layout-content :content-style="contentStyle">
        <n-notification-provider>
          <router-view v-slot="{ Component }">
            <Transition name="settings-content" mode="out-in">
              <component :is="Component" :key="route.name" />
            </Transition>
          </router-view>
        </n-notification-provider>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { h, ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NIcon } from 'naive-ui'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'
import {
  FlashOutline,
  // BulbOutline
  AlertCircleOutline,
  SettingsOutline,
  PricetagOutline,
  BookmarksOutline,
  CloudOutline
} from '@vicons/ionicons5'
import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'

const collapsed = ref(false)
const router = useRouter()
const route = useRoute()
const cloudStore = useCloudSyncStore()

/** 窄窗（<1064）自动折叠侧栏，避免 240px 常驻挤压内容区 */
const { isCompact } = useBreakpoint()
watch(
  isCompact,
  compact => {
    if (compact) collapsed.value = true
  },
  { immediate: true }
)

const contentStyle = computed(() => ({
  padding: 'var(--space-24)',
  height: '100%'
}))

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

/**
 * 「数据与同步」菜单项标签：有云端配置待裁决时挂一枚呼吸角标，一路把用户从
 * 左侧导航「设置」引到这里能实际处理的地方（角标本体见 global.css
 * .pending-badge-dot，裁决入口在 DataSync.vue）。
 */
function renderDataSyncLabel() {
  return h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, [
    '数据与同步',
    cloudStore.pendingCloudConfig !== null
      ? h('span', { class: 'pending-badge-dot', 'aria-hidden': 'true' })
      : null
  ])
}

function handleMenuSelect(key: string) {
  router.push({ name: key })
}

const menuOptions = computed(() => [
  {
    label: '常规设置',
    key: 'General',
    icon: renderIcon(SettingsOutline)
  },
  {
    label: '自动化',
    key: 'Automation',
    icon: renderIcon(FlashOutline)
  },
  {
    label: '标签管理',
    key: 'Tags',
    icon: renderIcon(PricetagOutline)
  },
  {
    label: '我标记过的人',
    key: 'PlayerNotes',
    icon: renderIcon(BookmarksOutline)
  },
  {
    label: renderDataSyncLabel,
    key: 'DataSync',
    icon: renderIcon(CloudOutline)
  },
  // {
  //     label: 'AI能力',
  //     key: 'ai-capabilities',
  //     icon: renderIcon(BulbOutline)
  // }
  {
    label: '关于我们',
    key: 'About',
    icon: renderIcon(AlertCircleOutline)
  }
])
</script>

<style scoped>
.n-layout {
  height: 100%;
}

/* 仅右侧内容区做过渡，左侧菜单保持静态 */
.settings-content-enter-active,
.settings-content-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}

.settings-content-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.settings-content-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

:deep(.n-layout-sider) {
  background: var(--glass-bg-low) !important;
  border-right: 1px solid var(--glass-border) !important;
}

:deep(.n-menu) {
  background: transparent !important;
}

:deep(.n-menu-item-content--selected) {
  background: rgba(61, 155, 122, 0.13) !important;
  color: var(--semantic-win) !important;
  font-weight: 700 !important;
  border-radius: var(--radius-md) !important;
}
</style>
