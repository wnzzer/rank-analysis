<template>
  <div class="player-meet-detail">
    <div v-if="state === undefined" class="meet-loading">
      <n-spin size="small" />
      <span class="meet-loading-text">遇见过数据加载中…</span>
    </div>

    <template v-else-if="state">
      <div class="meet-stats-row">
        <span class="stat-item">
          共遇见过
          <b class="stat-val">{{ state.total }}</b>
          场
        </span>
        <span class="stat-item"
          >同队 <b class="stat-val">{{ state.myTeamMeets }}</b></span
        >
        <span class="stat-item"
          >敌方 <b class="stat-val">{{ state.enemyMeets }}</b></span
        >
        <span class="stat-item"
          >同队胜 <b class="stat-val">{{ state.myTeamWins }}</b></span
        >
        <span v-if="lastSeenLabel" class="stat-item stat-last-seen"
          >最近相遇 {{ lastSeenLabel }}</span
        >
      </div>
      <MettingPlayersCard :meet-games="state.recent" :meet-total="state.total" />
    </template>

    <MettingPlayersCard v-else :meet-games="fallbackGames" />
  </div>
</template>

<script setup lang="ts">
/**
 * 设置页「我标记过的人」行展开内容：优先展示 meet.db 全量相遇台账
 * （含标记之前的历史），库无记录/查询失败时回退到本地备注抓取的 encounters。
 */
import { onMounted, ref } from 'vue'
import { NSpin } from 'naive-ui'
import type { MeetSummary } from '@renderer/types/domain/meet'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import { queryMeetSummary } from '@renderer/services/meet'
import MettingPlayersCard from '@renderer/components/gaming/MettingPlayersCard.vue'

const props = defineProps<{
  /** 目标玩家 puuid（查询 meet.db 用） */
  puuid: string
  /** 本地备注携带的遇见记录（不作为主源，仅回退用） */
  fallbackGames: OneGamePlayer[]
}>()

/** undefined = 查询中；null = 库无记录/失败（走回退）；MeetSummary = 命中 */
const state = ref<MeetSummary | null | undefined>(undefined)

const lastSeenLabel = ref('')
function formatLastSeen(raw: string): string {
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  return `${mm}-${dd}`
}

onMounted(async () => {
  try {
    const summary = await queryMeetSummary(props.puuid)
    state.value = summary
    lastSeenLabel.value = summary ? formatLastSeen(summary.lastSeenAt) : ''
  } catch (error) {
    // 防御：查询路径异常（含测试 mock 直抛）一律按「无台账」回退本地 encounters
    console.error('[PlayerMeetDetail] 查询遇见过数据失败:', error)
    state.value = null
  }
})
</script>

<style scoped>
.player-meet-detail {
  padding: var(--space-4) 0 var(--space-8);
  max-width: 540px;
}

.meet-loading {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) 0;
}

.meet-loading-text {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.meet-stats-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-16);
  margin-bottom: var(--space-8);
  padding: var(--space-6) var(--space-10);
  border-radius: var(--radius-md);
  background-color: var(--glass-bg-high);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.stat-item b {
  color: var(--text-primary);
  margin: 0 var(--space-2);
}

.stat-last-seen {
  color: var(--text-secondary);
}
</style>
