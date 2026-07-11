<template>
  <n-layout class="record-page" has-sider style="height: 100%" :collapsed="isMobile">
    <n-layout-sider
      :collapsed-width="isMobile ? '100%' : undefined"
      :width="isMobile ? '100%' : undefined"
    >
      <UserRecord></UserRecord>
    </n-layout-sider>
    <Transition name="slide-fade" mode="out-in">
      <n-layout-content v-if="!isMobile" class="record-content" style="flex: 3">
        <div class="record-content-inner">
          <MatchHistory />
        </div>
      </n-layout-content>
    </Transition>
  </n-layout>
</template>
<script lang="ts" setup>
import MatchHistory from '../components/record/MatchHistory.vue'
import UserRecord from '../components/record/UserRecord.vue'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'

const { isMobile } = useBreakpoint()
</script>
<style scoped>
/* 整页 token 覆盖:所有子组件 var(--font-size-*) 自动跟随 viewport 缩放 (1100→2200) */
.record-page {
  --font-size-2xs: clamp(10px, calc(10px + (100vw - 1100px) * 2 / 1100), 12px);
  --font-size-xs: clamp(11px, calc(11px + (100vw - 1100px) * 2 / 1100), 13px);
  --font-size-sm: clamp(12px, calc(12px + (100vw - 1100px) * 2 / 1100), 14px);
  --font-size-base: clamp(13px, calc(13px + (100vw - 1100px) * 3 / 1100), 16px);
  --font-size-md: clamp(14px, calc(14px + (100vw - 1100px) * 4 / 1100), 18px);
  --font-size-lg: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  --font-size-xl: clamp(18px, calc(18px + (100vw - 1100px) * 5 / 1100), 23px);
}

.record-content {
  padding: var(--space-20);
  padding-top: var(--space-16);
}

/* 宽屏 (>1400) 时内容居中,上限 1280 防过宽稀疏 */
.record-content-inner {
  max-width: 1280px;
  margin: 0 auto;
}

/* 战绩列表滚动条细化：6px 圆角细条替代系统默认宽条（与详情页一致） */
.record-content :deep(.n-layout-scroll-container)::-webkit-scrollbar {
  width: 6px;
}

.record-content :deep(.n-layout-scroll-container)::-webkit-scrollbar-thumb {
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--text-tertiary) 35%, transparent);
}

.record-content :deep(.n-layout-scroll-container)::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-tertiary) 55%, transparent);
}

.record-content :deep(.n-layout-scroll-container)::-webkit-scrollbar-track {
  background: transparent;
}

/* UserRecord 面板隐藏滚动条 */
:deep(.n-layout-sider .n-layout-scroll-container),
:deep(.n-layout-sider .n-scrollbar-container) {
  scrollbar-width: none;
}

:deep(.n-layout-sider .n-layout-scroll-container::-webkit-scrollbar),
:deep(.n-layout-sider .n-scrollbar-container::-webkit-scrollbar) {
  display: none;
}

/* 内容区切换动画：右侧 MatchHistory 在断点切换时滑入/淡出 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

/* sider 宽度过渡（手机/桌面之间的展开/收起动画） */
:deep(.n-layout-sider) {
  transition: width var(--dur-spring) var(--ease-expo);
}
</style>
