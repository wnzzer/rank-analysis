<template>
  <n-layout has-sider style="height: 100%" :collapsed="isMobile">
    <n-layout-sider
      :collapsed-width="isMobile ? '100%' : undefined"
      :width="isMobile ? '100%' : undefined"
    >
      <UserRecord></UserRecord>
    </n-layout-sider>
    <Transition name="slide-fade" mode="out-in">
      <n-layout-content v-if="!isMobile" class="record-content" style="flex: 3">
        <div>
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
.record-content {
  padding: var(--space-20);
  padding-top: var(--space-16);
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
