<template>
  <div class="match-detail-score">
    <div v-if="scoresByTeam.length === 0" class="match-detail-score-empty">
      {{ scoreError || '评分暂不可用（对局数据缺失）' }}
    </div>

    <div v-else class="match-detail-score-teams">
      <section
        v-for="team in scoresByTeam"
        :key="team.teamId"
        class="match-detail-score-team"
        :class="team.win ? 'match-detail-score-team--win' : 'match-detail-score-team--lose'"
      >
        <header class="match-detail-score-team-header">
          <span class="match-detail-score-team-title">{{ team.title }}</span>
          <span class="match-detail-score-team-result" :class="team.win ? 'is-win' : 'is-lose'">{{
            team.win ? '胜' : '负'
          }}</span>
        </header>

        <div
          v-for="(row, i) in team.rows"
          :key="row.score.participantId"
          class="match-detail-score-row"
          :class="{ 'match-detail-score-row--open': selectedPid === row.score.participantId }"
          @click="toggleSelect(row.score.participantId)"
        >
          <span class="match-detail-score-rank font-number">{{ i + 1 }}</span>
          <span
            v-if="row.mvpTag"
            class="match-detail-score-mvp"
            :class="{ 'is-svp': row.mvpTag === 'SVP' }"
            >{{ row.mvpTag }}</span
          >
          <div class="match-detail-score-player">
            <span class="match-detail-score-name" :class="{ 'is-me': row.isMe }">{{
              row.displayName
            }}</span>
          </div>
          <span class="match-detail-score-total font-number" :class="scoreLevel(row.score.total)">{{
            row.score.total.toFixed(1)
          }}</span>
          <div class="match-detail-score-bars">
            <div
              v-for="d in DIMENSIONS"
              :key="d.key"
              class="match-detail-score-bar"
              :title="`${d.label}：${row.score.breakdown[d.key].toFixed(1)} / ${d.full}（${d.hint}）`"
            >
              <span class="match-detail-score-bar-label">{{ d.label }}</span>
              <span class="match-detail-score-bar-track"
                ><span
                  class="match-detail-score-bar-fill"
                  :style="{
                    width: barWidth(row.score.breakdown[d.key], d.full),
                    animationDelay: `${i * 60 + 120}ms`
                  }"
                ></span
              ></span>
              <span class="match-detail-score-bar-value font-number">{{
                row.score.breakdown[d.key].toFixed(1)
              }}</span>
            </div>
          </div>
          <span class="match-detail-score-drill-hint"><ChevronDown /></span>
        </div>

        <div
          v-if="selectedPid !== null && team.rows.some(r => r.score.participantId === selectedPid)"
          class="match-detail-score-drilldown"
        >
          <div v-if="drilldownLoading" class="match-detail-score-drilldown-note">
            L3 事件归因加载中…
          </div>
          <div v-else-if="!drilldowns" class="match-detail-score-drilldown-note">
            事件归因暂不可用（timeline 未就绪）
          </div>
          <template v-else>
            <div
              v-for="dd in team.rows
                .filter(r => r.score.participantId === selectedPid)
                .map(r => drilldownOf(r.score.participantId))
                .filter((d): d is NonNullable<typeof d> => !!d)"
              :key="dd.participantId"
            >
              <div v-if="!dd.timelineAvailable" class="match-detail-score-drilldown-note">
                timeline 不可用（LCU→SGP→OP.GG 四级链均未取到），仅展示 L1/L2 汇总分
              </div>
              <div v-else-if="dd.events.length === 0" class="match-detail-score-drilldown-note">
                本局无显著事件（或事件数超上限被截断）
              </div>
              <ul v-else class="match-detail-score-drilldown-list">
                <li
                  v-for="(ev, idx) in dd.events"
                  :key="idx"
                  class="match-detail-score-drilldown-item"
                >
                  <span class="match-detail-score-drilldown-time font-number">{{
                    formatClock(ev.timestampSecs)
                  }}</span>
                  <span class="match-detail-score-drilldown-dim">{{
                    DIMENSION_LABELS[ev.dimension] ?? ev.dimension
                  }}</span>
                  <span class="match-detail-score-drilldown-desc">{{ ev.description }}</span>
                  <span
                    class="match-detail-score-drilldown-delta font-number"
                    :class="ev.delta < 0 ? 'is-neg' : 'is-pos'"
                    >{{ ev.delta > 0 ? `+${ev.delta.toFixed(2)}` : ev.delta.toFixed(2) }}</span
                  >
                </li>
              </ul>
            </div>
          </template>
        </div>
      </section>
    </div>

    <p class="match-detail-score-note">
      确定性评分（Rust 侧计算，Akari 式 17 分制）：KDA / 胜场 / 输出伤害 / 承伤 / 治疗 / 补刀 / 经济
      / 参团率 / 视野 九维加权，缺字段记 0 不编造。
    </p>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject, onMounted, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { matchDetailContextKey } from '../matchDetailContext'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'
import {
  buildScoreInputsFromGame,
  computePlayerScores,
  fetchScoreDrilldown,
  sortScoresDesc,
  PLAYER_SCORE_MAX,
  type PlayerScore,
  type PlayerScoreBreakdown,
  type ScoreBreakdownDrilldown,
  type ScoreDimension
} from '@renderer/features/record/services/playerScore'

const DIMENSION_LABELS: Partial<Record<ScoreDimension, string>> = {
  kda: 'KDA',
  win: '胜场',
  damage: '输出',
  damageTaken: '承伤',
  heal: '治疗',
  cs: '补刀',
  gold: '经济',
  participation: '参团',
  vision: '视野'
}

const DIMENSIONS: { key: keyof PlayerScoreBreakdown; label: string; full: number; hint: string }[] =
  [
    { key: 'kda', label: 'KDA', full: 1, hint: 'kda≥9 满分' },
    { key: 'win', label: '胜', full: 1, hint: '赢局记 1 分' },
    { key: 'damage', label: '输出', full: 3, hint: '达 2 倍人均贡献满分' },
    { key: 'damageTaken', label: '承伤', full: 2, hint: '达 2 倍人均贡献满分' },
    { key: 'heal', label: '治疗', full: 2, hint: '达队均承伤 1.4 倍满分' },
    { key: 'cs', label: '补刀', full: 2, hint: '10 补刀/分满分' },
    { key: 'gold', label: '经济', full: 2, hint: '达 1.5 倍人均经济满分' },
    { key: 'participation', label: '参团', full: 2, hint: '参团率 100% 满分' },
    { key: 'vision', label: '视野', full: 2, hint: '达 2 倍人均视野满分' }
  ]

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailScoreTab 必须在 MatchDetailInline 容器内使用')
const ctx = injected as NonNullable<typeof injected>

const scores = ref<PlayerScore[] | null>(null)
const scoreError = ref('')
const drilldowns = ref<ScoreBreakdownDrilldown[] | null>(null)
const drilldownLoading = ref(false)
const selectedPid = ref<number | null>(null)

onMounted(async () => {
  const game = ctx.game.value
  if (!game) return
  const result = await computePlayerScores(buildScoreInputsFromGame(game)).catch((err: unknown) => {
    console.warn('[score] compute failed', err)
    scoreError.value = '评分服务不可用'
    return null
  })
  scores.value = result && result.length > 0 ? result : null
  if (result && result.length === 0) scoreError.value = '对局无参与者数据'

  drilldownLoading.value = true
  const dd = await fetchScoreDrilldown(game.gameId).catch((err: unknown) => {
    console.warn('[score] drilldown failed', err)
    return null
  })
  drilldowns.value = dd && dd.length > 0 ? dd : null
  drilldownLoading.value = false
})

function toggleSelect(pid: number) {
  selectedPid.value = selectedPid.value === pid ? null : pid
}

function drilldownOf(pid: number) {
  return drilldowns.value?.find(d => d.participantId === pid) ?? null
}

function formatClock(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface ScoreRow {
  score: PlayerScore
  detail: DetailPlayer
  displayName: string
  isMe: boolean
  mvpTag: string
}

const scoresByTeam = computed(() => {
  const detailById = new Map(ctx.players.detailPlayers.value.map(p => [p.participantId, p]))
  const list = (scores.value ?? []).map(score => {
    const detail = detailById.get(score.participantId)
    return {
      score,
      detail,
      displayName: detail?.displayName ?? (score.summonerName || `玩家${score.participantId}`),
      isMe: detail?.isMe ?? false,
      mvpTag: detail?.mvpTag ?? ''
    } as ScoreRow
  })
  const byTeam = new Map<number, ScoreRow[]>()
  for (const row of list) {
    const arr = byTeam.get(row.score.teamId) ?? []
    arr.push(row)
    byTeam.set(row.score.teamId, arr)
  }
  return [...byTeam.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([teamId, rows]) => {
      const sorted = sortScoresDesc(rows.map(r => r.score))
      const first = sorted[0]
      return {
        teamId,
        title: detailOf(teamId)?.length ? '' : `队伍 ${teamId}`,
        win: first?.win ?? false,
        rows: sorted.map(s => rows.find(r => r.score.participantId === s.participantId)!)
      }
    })
})

function detailOf(teamId: number) {
  return ctx.players.detailPlayers.value.filter(p => p.teamId === teamId)
}

function barWidth(value: number, full: number) {
  if (full <= 0) return '0%'
  return `${Math.min(100, Math.max(2, Math.round((value / full) * 100)))}%`
}

function scoreLevel(total: number) {
  if (total >= PLAYER_SCORE_MAX * 0.8) return 'match-detail-score-total--s'
  if (total >= PLAYER_SCORE_MAX * 0.6) return 'match-detail-score-total--a'
  if (total >= PLAYER_SCORE_MAX * 0.4) return 'match-detail-score-total--b'
  return 'match-detail-score-total--c'
}
</script>

<style scoped>
.match-detail-score {
  padding: 8px 4px;
}
.match-detail-score-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--n-text-color-3, #999);
}
.match-detail-score-teams {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.match-detail-score-team {
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
}
.match-detail-score-team--win {
  box-shadow: inset 2px 0 0 rgba(80, 180, 120, 0.55);
}
.match-detail-score-team--lose {
  box-shadow: inset 2px 0 0 rgba(220, 90, 90, 0.55);
}
.match-detail-score-team-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-weight: 600;
}
.match-detail-score-team-result {
  font-size: 11px;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  padding: 1px 8px;
  clip-path: var(--clip-notch, polygon(4px 0, 100% 0, 100% 100%, 0 100%, 0 4px));
}
.match-detail-score-team-result.is-win {
  color: var(--win);
  background: var(--win-soft);
}
.match-detail-score-team-result.is-lose {
  color: var(--loss);
  background: var(--loss-soft);
}
.match-detail-score-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
  cursor: pointer;
}
.match-detail-score-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.match-detail-score-row--open {
  background: rgba(99, 226, 183, 0.06);
}
.match-detail-score-row:last-child {
  border-bottom: none;
}
.match-detail-score-drill-hint {
  flex: 0 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--n-text-color-3, #999);
  text-align: center;
}
.match-detail-score-row--open .match-detail-score-drill-hint {
  color: var(--n-primary-color, #63e2b7);
}
.match-detail-score-drill-hint svg {
  width: 10px;
  height: 10px;
}
.match-detail-score-drilldown {
  margin: 2px 0 8px 24px;
  padding: 6px 10px;
  border-left: 2px solid rgba(99, 226, 183, 0.4);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 0 6px 6px 0;
}
.match-detail-score-drilldown-note {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
  padding: 2px 0;
}
.match-detail-score-drilldown-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.match-detail-score-drilldown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
}
.match-detail-score-drilldown-time {
  flex: 0 0 42px;
  color: var(--n-text-color-3, #999);
}
.match-detail-score-drilldown-dim {
  flex: 0 0 34px;
  color: var(--n-primary-color, #63e2b7);
}
.match-detail-score-drilldown-desc {
  flex: 1;
  min-width: 0;
}
.match-detail-score-drilldown-delta {
  flex: 0 0 46px;
  text-align: right;
}
.match-detail-score-drilldown-delta.is-neg {
  color: #e07a7a;
}
.match-detail-score-drilldown-delta.is-pos {
  color: #57d9a3;
}
.match-detail-score-rank {
  width: 16px;
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}
.match-detail-score-mvp {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: linear-gradient(135deg, var(--hx-gold-300), var(--hx-gold-500));
  color: var(--text-on-brand);
  font-weight: 700;
  letter-spacing: 0.04em;
  box-shadow: var(--glow-brand);
}
.match-detail-score-mvp.is-svp {
  background: var(--bg-active);
  color: var(--text-secondary);
  box-shadow: none;
}
.match-detail-score-player {
  flex: 0 0 128px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-detail-score-name.is-me {
  color: var(--n-primary-color, #63e2b7);
  font-weight: 600;
}
.match-detail-score-total {
  flex: 0 0 34px;
  font-size: 17px;
  font-weight: 700;
  text-align: right;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
}
.match-detail-score-total--s {
  color: #ffd76b;
}
.match-detail-score-total--a {
  color: #57d9a3;
}
.match-detail-score-total--b {
  color: #e8c06583;
}
.match-detail-score-total--c {
  color: var(--n-text-color-3, #999);
}
.match-detail-score-bars {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 3px;
  min-width: 0;
}
.match-detail-score-bar {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.match-detail-score-bar-label {
  font-size: 9px;
  color: var(--n-text-color-3, #999);
  text-align: center;
}
.match-detail-score-bar-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.match-detail-score-bar-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--hx-cyan-600), var(--hx-gold-300));
  transform-origin: left;
  animation: score-bar-in 0.55s var(--ease-expo, cubic-bezier(0.16, 1, 0.3, 1)) both;
}
@keyframes score-bar-in {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .match-detail-score-bar-fill {
    animation: none;
  }
}
.match-detail-score-bar-value {
  font-size: 9px;
  text-align: center;
  color: var(--n-text-color-2, #ccc);
}
.match-detail-score-note {
  margin-top: 10px;
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}
</style>
