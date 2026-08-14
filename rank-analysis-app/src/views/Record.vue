<template>
  <div class="record-page">
    <PlayerBar
      :summoner="summoner"
      :rank="rank"
      :solo5v5="solo5v5"
      :flex="flex"
      :recent-data="recentData"
      :tags="tags"
      :platform-id-cn="platformIdCn"
      :is-cross-region="isCrossRegion"
    />
    <div class="record-main">
      <aside v-if="!isMobile" class="record-side">
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
          @mode-change="updateMode"
        />
      </aside>
      <main class="record-content">
        <div class="record-content-inner">
          <MatchHistory
            @hover-champion="hoveredChampion = $event"
            @leave-champion="hoveredChampion = null"
            @pool-change="championPool = $event"
            @games-change="games = $event"
          />
        </div>
      </main>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { ref } from 'vue'
import MatchHistory from '../components/record/MatchHistory.vue'
import PlayerBar from '../components/record/PlayerBar.vue'
import UserSidePanel from '../components/record/UserSidePanel.vue'
import type { Game } from '../types/domain/match'
import type { ChampionPoolEntry } from '../components/record/championPool'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'
import { usePlayerRecordData } from '@renderer/composables/usePlayerRecordData'

const { isMobile } = useBreakpoint()
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
