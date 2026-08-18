<template>
  <div class="player-profile-card">
    <template v-if="loading">
      <div class="profile-loading">
        <n-spin size="small" />
        <span class="profile-loading-text">加载近期画像…</span>
      </div>
    </template>

    <template v-else-if="error || !profile">
      <div class="profile-empty">暂无近期战绩数据</div>
    </template>

    <template v-else>
      <!-- 头部：名字 + 近期胜率 / KDA / 连胜连败 -->
      <div class="profile-header">
        <div class="profile-name-line">
          <n-ellipsis class="profile-name" style="max-width: 160px">{{ displayName }}</n-ellipsis>
          <span
            v-if="profile.streak"
            class="profile-streak"
            :class="profile.streak.kind === 'win' ? 'streak-win' : 'streak-loss'"
          >
            {{ profile.streak.kind === 'win' ? '连胜' : '连败' }}{{ profile.streak.count }}
          </span>
        </div>
        <div class="profile-metrics">
          <span class="profile-metric">近{{ recentGamesCount }}场胜率</span>
          <strong class="profile-metric-value">{{ winRateText }}</strong>
          <span class="profile-metric-sep">·</span>
          <span class="profile-metric">KDA</span>
          <strong class="profile-metric-value">{{ kdaText }}</strong>
        </div>
      </div>

      <!-- 主玩位置 -->
      <div v-if="profile.positionDistribution.length > 0" class="profile-section">
        <div class="profile-section-title">位置</div>
        <div class="profile-positions">
          <span
            v-for="p in profile.positionDistribution.slice(0, 3)"
            :key="p.pos"
            class="profile-position-chip"
            :class="{ 'chip-main': p.pos === profile.mainPosition }"
          >
            {{ positionLabel(p.pos) }}
            <em>{{ Math.round(p.ratio * 100) }}%</em>
          </span>
          <span v-if="profile.isOffRole" class="profile-offrole">
            {{ profile.offRoleSeverity === 'severe' ? '本局严重补位' : '本局补位' }}
          </span>
        </div>
      </div>

      <!-- 本局英雄熟练度（有上下文时） -->
      <div v-if="championId > 0 && profile.currentChampionMastery" class="profile-section">
        <div class="profile-section-title">本局英雄</div>
        <div class="profile-mastery">
          <template v-if="profile.currentChampionMastery.gamesInRecent > 0">
            <span
              class="profile-mastery-badge"
              :class="{ 'badge-onetrick': profile.currentChampionMastery.isOnetrick }"
            >
              {{ profile.currentChampionMastery.isOnetrick ? '绝活' : '近期使用' }}
            </span>
            <span class="profile-mastery-metric"
              >{{ profile.currentChampionMastery.gamesInRecent }} 场</span
            >
            <span class="profile-mastery-metric">胜率 {{ masteryWinRateText }}</span>
            <span class="profile-mastery-metric"
              >KDA {{ profile.currentChampionMastery.avgKda.toFixed(2) }}</span
            >
          </template>
          <template v-else>
            <span class="profile-mastery-badge badge-first">近期首次使用</span>
          </template>
        </div>
      </div>

      <!-- 英雄池（分位置口径：只看玩家在这场位置上打过的英雄，防位置切换误导） -->
      <div v-if="profile.positionChampionDistribution.length > 0" class="profile-section">
        <div class="profile-section-title">常用英雄</div>
        <div class="profile-heroes">
          <div
            v-for="c in profile.positionChampionDistribution"
            :key="c.championId"
            class="profile-hero"
            :class="{ 'hero-current': c.championId === championId }"
            :title="`${c.name}：${c.games} 场 / 胜率 ${(c.winRate * 100).toFixed(0)}% / KDA ${c.avgKda.toFixed(2)}`"
          >
            <LazyImg
              class="profile-hero-img"
              :src="`${assetPrefix}/champion/${c.championId}`"
              alt="champion"
            />
            <span class="profile-hero-name">{{ c.name }}</span>
            <span class="profile-hero-stats"
              >{{ c.games }}场 {{ Math.round(c.winRate * 100) }}%</span
            >
          </div>
        </div>
      </div>

      <!-- 遇见过（本机 meet.db 累计相遇，无记录不显示） -->
      <div v-if="meet" class="profile-section profile-meet">
        <span class="profile-note-label">遇见过</span>
        <span class="profile-note-text"
          >{{ meet.total }} 次 · 同队{{ meet.myTeamWins }}/{{ meet.myTeamMeets }}胜 · 最近
          {{ meet.lastSeenAt }}</span
        >
      </div>

      <!-- 手动备注（隐私开关开启且有备注时） -->
      <div v-if="profile.note" class="profile-section profile-note">
        <span class="profile-note-label">备注</span>
        <span class="profile-note-text">{{ profile.note }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 玩家近期画像卡（hover/点击弹层内容）：
 * 结构化展示 RecentPlayerProfile——主玩位置 / 近期胜率 / KDA / 连胜连败 /
 * 本局英雄熟练度 / 常用英雄池 / 手动备注。
 *
 * 数据走 fetchPlayerProfile（批量链路 LRU 缓存 + 备注注入），
 * 无上下文时（不传 championId）自动跳过「本局英雄」小节。
 */
import { computed, ref, watchEffect } from 'vue'
import { NEllipsis, NSpin } from 'naive-ui'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import { fetchPlayerProfile } from '@renderer/services/ai/shared/recentProfile.batch'
import { queryMeetSummary } from '@renderer/features/settings/services/meet'
import type { MeetSummary } from '@renderer/types/domain/meet'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'

const props = withDefaults(
  defineProps<{
    puuid: string
    /** 展示名（缺省时用 puuid 前 8 位） */
    name?: string
    /** 本局英雄 id（有则显示熟练度小节） */
    championId?: number
    /** 跨区大区 platformId：本区无战绩时画像走 SGP 战绩兜底（需配合 name） */
    region?: string
  }>(),
  { name: '', championId: 0, region: '' }
)

const profile = ref<RecentPlayerProfile | null>(null)
const loading = ref(true)
const error = ref(false)
/** 遇见过摘要（meet.db 查询失败/无记录为 null，不阻塞画像卡） */
const meet = ref<MeetSummary | null>(null)

/**
 * 请求序号竞态保护：hover 快速滑过多个玩家名时，慢的旧请求结果不得
 * 覆盖新玩家（watcher 重新执行时丢弃过期 resolve）。
 */
let requestSeq = 0
watchEffect(async () => {
  if (!props.puuid) return
  const seq = ++requestSeq
  loading.value = true
  error.value = false
  try {
    const p = await fetchPlayerProfile({
      puuid: props.puuid,
      championId: props.championId,
      region: props.region,
      name: props.name
    })
    if (seq !== requestSeq) return
    profile.value = p
  } catch {
    if (seq !== requestSeq) return
    error.value = true
    profile.value = null
  } finally {
    if (seq === requestSeq) loading.value = false
  }
  // 遇见过摘要独立降级：失败/无记录不阻断画像
  try {
    const m = await queryMeetSummary(props.puuid)
    if (seq !== requestSeq) return
    meet.value = m
  } catch {
    if (seq !== requestSeq) return
    meet.value = null
  }
})

const displayName = computed(() => props.name || props.puuid.slice(0, 8))

const recentGamesCount = computed(() =>
  (profile.value?.positionDistribution ?? []).reduce((acc, p) => acc + p.games, 0)
)

const winRateText = computed(() => {
  if (profile.value === null) return '--'
  return `${Math.round((profile.value.recentWinRate ?? 0) * 100)}%`
})

const kdaText = computed(() => {
  if (profile.value === null) return '--'
  const kda = profile.value.recentKda ?? 0
  return Number.isFinite(kda) ? kda.toFixed(2) : '--'
})

const masteryWinRateText = computed(() => {
  const m = profile.value?.currentChampionMastery
  if (!m) return '--'
  return `${Math.round(m.winRate * 100)}%`
})

const POSITION_LABEL: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助',
  UNKNOWN: '其他'
}

function positionLabel(pos: string): string {
  return POSITION_LABEL[pos] ?? pos
}
</script>

<style scoped>
.player-profile-card {
  min-width: 220px;
  max-width: 280px;
  padding: 12px;
  font-size: 12px;
  color: var(--text-primary);
}

.profile-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  justify-content: center;
}

.profile-loading-text {
  color: var(--text-tertiary);
}

.profile-empty {
  padding: 16px 0;
  text-align: center;
  color: var(--text-tertiary);
}

.profile-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.profile-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-name {
  font-size: 13px;
  font-weight: 600;
}

.profile-streak {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
}

.streak-win {
  color: var(--semantic-win-bright);
  background: color-mix(in srgb, var(--semantic-win) 15%, transparent);
}

.streak-loss {
  color: var(--semantic-loss-bright);
  background: color-mix(in srgb, var(--semantic-loss) 15%, transparent);
}

.profile-metrics {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--text-tertiary);
}

.profile-metric-value {
  color: var(--text-primary);
}

.profile-section {
  margin-top: 8px;
}

.profile-section-title {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.profile-positions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.profile-position-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 8px;
  background: var(--glass-bg-mid);
  color: var(--text-secondary);
}

.profile-position-chip em {
  font-style: normal;
  color: var(--text-tertiary);
}

.profile-position-chip.chip-main {
  background: color-mix(in srgb, var(--accent-gold) 20%, transparent);
  color: var(--accent-gold);
  font-weight: 600;
}

.profile-offrole {
  color: var(--semantic-warn);
  font-size: 11px;
}

.profile-mastery {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.profile-mastery-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 8px;
  background: var(--glass-bg-mid);
  color: var(--text-secondary);
}

.badge-onetrick {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 20%, transparent);
}

.badge-first {
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 15%, transparent);
}

.profile-mastery-metric {
  color: var(--text-tertiary);
}

.profile-heroes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-hero {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px;
  border-radius: 6px;
}

.profile-hero:hover {
  background: var(--glass-bg-mid);
}

.hero-current {
  outline: 1px solid color-mix(in srgb, var(--accent-gold) 50%, transparent);
}

.profile-hero-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
}

.profile-hero-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-hero-stats {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.profile-note {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--glass-bg-mid);
}

.profile-note-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.profile-note-text {
  color: var(--text-secondary);
}
</style>
