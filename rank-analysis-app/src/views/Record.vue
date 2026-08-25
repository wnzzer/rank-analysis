<template>
  <div class="record-page">
    <PlayerBar
      :summoner="summoner"
      :rank="rank"
      :recent-data="recentData"
      :tags="tags"
      :platform-id-cn="platformIdCn"
      :is-cross-region="isCrossRegion"
    />
    <div class="record-main" :class="{ 'record-main--focus': focusMode }">
      <!-- 宽窗（>=1064）：左栏常驻；窄窗：隐藏并改用 NDrawer 抽屉 -->
      <aside v-if="!isMobile && !isCompact" class="record-side">
        <UserSidePanel
          :rank="rank"
          :solo5v5="solo5v5"
          :flex="flex"
          :recent-data="recentData"
          :mode="mode"
          :is-cross-region="isCrossRegion"
          :champion-pool="championPool"
          :hovered-champion="hoveredChampion"
          :games="games"
          :my-puuid="summoner.puuid"
          :active-champion="activeChampion"
          @mode-change="updateMode"
          @select-champion="championFilterCmd = $event"
          @open-game="focusGameId = $event"
        />
      </aside>
      <!-- 窄窗抽屉触发：内容区左上角悬浮按钮（左栏入口） -->
      <n-button
        v-if="isCompact"
        circle
        quaternary
        class="record-side-trigger"
        :title="sideOpen ? '收起侧栏' : '打开侧栏'"
        @click="sideOpen = !sideOpen"
      >
        <template #icon>
          <n-icon><Menu /></n-icon>
        </template>
      </n-button>
      <n-drawer
        v-if="isCompact"
        v-model:show="sideOpen"
        placement="left"
        :width="320"
        :auto-focus="false"
        :show-mask="false"
      >
        <n-drawer-content closable :native-scrollbar="false" class="record-side-drawer">
          <UserSidePanel
            :rank="rank"
            :solo5v5="solo5v5"
            :flex="flex"
            :recent-data="recentData"
            :mode="mode"
            :is-cross-region="isCrossRegion"
            :champion-pool="championPool"
            :hovered-champion="hoveredChampion"
            :games="games"
            :my-puuid="summoner.puuid"
            :active-champion="activeChampion"
            @mode-change="updateMode"
            @select-champion="championFilterCmd = $event"
            @open-game="focusGameId = $event"
          />
        </n-drawer-content>
      </n-drawer>
      <main :ref="el => bindContentScroll(el)" class="record-content">
        <div class="record-content-inner">
          <MatchHistory
            :focus-game-id="focusGameId"
            :champion-filter="championFilterCmd"
            :v2-wide="widePane"
            :selected-id="selectedGameId"
            @select="onSelectGame"
            @hover-champion="hoveredChampion = $event"
            @leave-champion="hoveredChampion = null"
            @pool-change="championPool = $event"
            @games-change="games = $event"
            @focus-handled="focusGameId = null"
            @champion-filter-handled="championFilterCmd = 0"
            @filter-change="activeChampion = $event.championId"
          />
        </div>
      </main>

      <!-- v3 宽屏右侧详情栏：选中对局在此展示，列表保持节奏（<1064 回退内嵌展开） -->
      <aside v-if="widePane && selectedGame" class="record-dpane">
        <MatchDetailInline
          :game="selectedGame"
          :region="regionQuery"
          @close="selectedGame = null"
        />
      </aside>
      <!-- 回到顶部 FAB：内容区滚动超过阈值后显示，点击平滑回顶 -->
      <Transition name="fab">
        <n-button
          v-if="showBackTop && !focusMode"
          circle
          class="record-back-top"
          title="回到顶部"
          @click="scrollToTop"
        >
          <template #icon>
            <n-icon><ArrowUp /></n-icon>
          </template>
        </n-button>
      </Transition>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { onBeforeUnmount, computed, ref, watch, type ComponentPublicInstance } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NDrawer, NDrawerContent } from 'naive-ui'
import { ArrowUp, Menu } from 'lucide-vue-next'
import MatchHistory from '../components/record/MatchHistory.vue'
import MatchDetailInline from '../components/record/MatchDetailInline.vue'
import PlayerBar from '../components/record/PlayerBar.vue'
import UserSidePanel from '../components/record/UserSidePanel.vue'
import type { Game } from '../types/domain/match'
import type { ChampionPoolEntry } from '../components/record/championPool'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'
import { usePlayerRecordData } from '@renderer/composables/usePlayerRecordData'

const route = useRoute()
const { isMobile, isCompact } = useBreakpoint()

/** v3 宽屏双栏：详情走右侧常驻栏；窄窗自动回退内嵌展开 */
const widePane = computed(() => !isCompact.value && !isMobile.value)
const selectedGameId = ref<number | null>(null)
const selectedGame = ref<Game | null>(null)
function onSelectGame(g: Game | null) {
  selectedGame.value = g
  selectedGameId.value = g?.gameId ?? null
}
/** 聚焦模式：宽屏详情展开时隐藏左栏与列表，整页只留详情（收回恢复） */
const focusMode = computed(() => widePane.value && !!selectedGame.value)
const regionQuery = computed(() => (route.query.region as string) ?? '')
/** 窄窗左栏抽屉开关（进入宽窗时自动关闭，避免跨断点残留） */
const sideOpen = ref(false)

/** 断点回到宽窗（左栏常驻）时关闭抽屉，避免残留遮罩/状态 */
watch(isCompact, compact => {
  if (!compact) sideOpen.value = false
})

/** 回到顶部 FAB：内容区滚动超过阈值显示，点击平滑回顶 */
const BACK_TOP_THRESHOLD = 400
const showBackTop = ref(false)
const contentEl = ref<HTMLElement | null>(null)

function onContentScroll() {
  showBackTop.value = (contentEl.value?.scrollTop ?? 0) > BACK_TOP_THRESHOLD
}

function scrollToTop() {
  contentEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function bindContentScroll(el: Element | ComponentPublicInstance | null) {
  const target = el instanceof HTMLElement ? el : null
  if (contentEl.value === target) return
  contentEl.value?.removeEventListener('scroll', onContentScroll)
  contentEl.value = target
  target?.addEventListener('scroll', onContentScroll)
  showBackTop.value = (target?.scrollTop ?? 0) > BACK_TOP_THRESHOLD
}

onBeforeUnmount(() => {
  contentEl.value?.removeEventListener('scroll', onContentScroll)
})
const {
  summoner,
  rank,
  solo5v5,
  flex,
  recentData,
  tags,
  platformIdCn,
  mode,
  isCrossRegion,
  updateMode
} = usePlayerRecordData()

/** 左栏英雄池数据与当前 hover 高亮（由 MatchHistory 上抛） */
const championPool = ref<ChampionPoolEntry[]>([])
const hoveredChampion = ref<number | null>(null)
/** 近期对局全量（由 MatchHistory 上抛，D-P3 分时曲线数据源） */
const games = ref<Game[]>([])
/** 好友/宿敌弹窗点击对局：交给 MatchHistory 定位并就地展开（处理后清空） */
const focusGameId = ref<number | null>(null)
/** 英雄池点击：作为一次性命令下发给 MatchHistory 设置英雄筛选（处理后清空） */
const championFilterCmd = ref(0)
/** 战绩列表当前生效的英雄筛选（MatchHistory 上抛，用于英雄池选中态） */
const activeChampion = ref(0)
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
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--space-12);
}

.record-main {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: var(--space-16);
  position: relative;
}

/* 左栏：独立滚动 + sticky 聚合内容（长列表滚动时左栏不丢） */
.record-side {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: var(--space-4);
  scrollbar-width: none;
}

.record-side::-webkit-scrollbar {
  display: none;
}

/* 窄窗左栏抽屉：与常驻左栏同宽、同视觉（glass 卡片列） */
.record-side-drawer :deep(.n-drawer-body) {
  padding: var(--space-12);
}

.record-side-drawer :deep(.n-drawer-content-wrapper) {
  background: color-mix(in srgb, var(--bg-base) 96%, transparent);
}

/* 窄窗抽屉触发按钮：内容区左上角悬浮，hover 高亮 */
.record-side-trigger {
  position: absolute;
  top: var(--space-8);
  left: var(--space-8);
  z-index: 20;
  color: var(--text-secondary);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}

.record-side-trigger:hover {
  color: var(--text-primary);
  border-color: var(--accent-gold-deep);
  transform: scale(1.05);
}

/* 回到顶部 FAB：右下角悬浮，glass 视觉与抽屉触发钮一致 */
.record-back-top {
  position: absolute;
  right: var(--space-8);
  bottom: var(--space-16);
  z-index: 30;
  color: var(--text-secondary);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-md), var(--glass-highlight);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}

.record-back-top:hover {
  color: var(--text-primary);
  border-color: var(--accent-gold-deep);
  transform: translateY(-2px);
}

.fab-enter-active,
.fab-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.record-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0 var(--space-8) var(--space-20) var(--space-8);
}

/* 宽屏 (>1400) 时内容居中,上限 1280 防过宽稀疏 */
.record-content-inner {
  max-width: 1280px;
  margin: 0 auto;
}

/* v3 宽屏右侧详情栏：独立滚动 + 切角容器视觉 */
.record-dpane {
  width: 400px;
  flex-shrink: 0;
  overflow-y: auto;
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--space-12);
  scrollbar-width: none;
}
.record-dpane::-webkit-scrollbar {
  display: none;
}

/* 聚焦模式：宽屏详情展开时隐藏左栏与列表，整页只留详情（收回即恢复） */
.record-main--focus .record-side,
.record-main--focus .record-content {
  display: none;
}
.record-main--focus .record-dpane {
  flex: 1;
  width: auto;
  max-width: 1080px;
  margin: 0 auto;
  border-left: none;
  padding-left: var(--space-8);
}
.record-main--focus .record-dpane::-webkit-scrollbar {
  width: 6px;
}

/* 战绩列表滚动条细化：6px 圆角细条替代系统默认宽条（与详情页一致） */
.record-content::-webkit-scrollbar {
  width: 6px;
}

.record-content::-webkit-scrollbar-thumb {
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--text-tertiary) 35%, transparent);
}

.record-content::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-tertiary) 55%, transparent);
}

.record-content::-webkit-scrollbar-track {
  background: transparent;
}
</style>
