<template>
  <section class="matchup-explorer" aria-labelledby="matchup-explorer-title">
    <header class="matchup-explorer__header">
      <div>
        <span>LANE INTELLIGENCE</span>
        <h2 id="matchup-explorer-title">英雄对位数据</h2>
      </div>
      <div v-if="snapshot" class="matchup-explorer__patch">
        <span>{{ snapshot.patch }}</span>
        <small>{{ regionLabel }}</small>
      </div>
    </header>

    <div class="matchup-explorer__controls">
      <div class="matchup-explorer__control-group">
        <span>段位</span>
        <div role="group" aria-label="选择统计段位">
          <button
            v-for="option in tierOptions"
            :key="option.value"
            type="button"
            :class="{ active: activeTier === option.value }"
            :aria-pressed="activeTier === option.value"
            @click="$emit('update:tier', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="matchup-explorer__control-group">
        <span>分路</span>
        <div role="group" aria-label="选择统计分路">
          <button
            v-for="option in laneOptions"
            :key="option.value"
            type="button"
            :class="{ active: activeLane === option.value }"
            :aria-pressed="activeLane === option.value"
            @click="$emit('update:lane', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="matchup-explorer__loading" aria-live="polite">
      <i v-for="index in 5" :key="index" />
      <span>正在同步对位样本…</span>
    </div>

    <template v-else-if="snapshot">
      <div class="matchup-explorer__meta">
        <span><i />{{ snapshot.source }}</span>
        <span>{{ totalGames.toLocaleString('zh-CN') }} 场样本</span>
        <span>更新于 {{ formattedGeneratedAt }}</span>
        <strong v-if="snapshot.isPartial">部分数据</strong>
      </div>

      <div v-if="rows.length" class="matchup-explorer__table-scroll">
        <div class="matchup-explorer__table" role="table" aria-label="英雄对位统计">
          <div class="matchup-explorer__row matchup-explorer__row--heading" role="row">
            <span role="columnheader">对位英雄</span>
            <span role="columnheader">胜率</span>
            <span role="columnheader">场次</span>
            <span role="columnheader">15分经济差</span>
            <span role="columnheader">15分补刀差</span>
            <span role="columnheader">15分经验差</span>
            <span role="columnheader">单杀率</span>
          </div>

          <div v-for="row in rows" :key="row.opponentId" class="matchup-explorer__row" role="row">
            <button
              type="button"
              class="matchup-explorer__opponent"
              :aria-label="`查看${championFor(row.opponentId)?.name ?? `英雄${row.opponentId}`}详情`"
              @click="$emit('select-opponent', row.opponentId)"
            >
              <img :src="portraitFor(row.opponentId)" alt="" loading="lazy" />
              <span>
                <strong>{{ championFor(row.opponentId)?.name ?? `英雄 ${row.opponentId}` }}</strong>
                <small>{{ championFor(row.opponentId)?.title ?? '查看战术档案 →' }}</small>
              </span>
            </button>
            <span role="cell" class="matchup-explorer__winrate" :class="winRateTone(row.winRate)">
              {{ percent(row.winRate) }}
            </span>
            <span role="cell" class="matchup-explorer__games">
              {{ row.games.toLocaleString('zh-CN') }}
              <small v-if="isLowSample(row.games)">低样本</small>
            </span>
            <span role="cell" :class="deltaTone(row.goldDiffAt15)">{{
              delta(row.goldDiffAt15)
            }}</span>
            <span role="cell" :class="deltaTone(row.csDiffAt15)">{{ delta(row.csDiffAt15) }}</span>
            <span role="cell" :class="deltaTone(row.xpDiffAt15)">{{ delta(row.xpDiffAt15) }}</span>
            <span role="cell">{{ optionalPercent(row.soloKillRate) }}</span>
          </div>
        </div>
      </div>

      <p v-else class="matchup-explorer__empty">当前版本和筛选条件下暂无可信对位样本。</p>
    </template>

    <p v-else class="matchup-explorer__empty">选择英雄后查看该分路的对位情报。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { assetPrefix } from '@renderer/services/http'
import type {
  ChampionCollectionItem,
  ChampionLane,
  MatchupSnapshot,
  MatchupTier
} from '@renderer/types/domain/championCollection'

const props = defineProps<{
  snapshot: MatchupSnapshot | null
  champions: ChampionCollectionItem[]
  loading: boolean
}>()

defineEmits<{
  'select-opponent': [championId: number]
  'update:tier': [tier: MatchupTier]
  'update:lane': [lane: ChampionLane]
}>()

const tierOptions: ReadonlyArray<{ value: MatchupTier; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'gold_plus', label: '黄金+' },
  { value: 'platinum_plus', label: '铂金+' },
  { value: 'emerald_plus', label: '翡翠+' },
  { value: 'diamond_plus', label: '钻石+' },
  { value: 'master_plus', label: '大师+' }
]

const laneOptions: ReadonlyArray<{ value: ChampionLane; label: string }> = [
  { value: 'top', label: '上路' },
  { value: 'jungle', label: '打野' },
  { value: 'middle', label: '中路' },
  { value: 'bottom', label: '下路' },
  { value: 'support', label: '辅助' }
]

const championMap = computed(
  () => new Map(props.champions.map(champion => [champion.id, champion]))
)
const rows = computed(() => props.snapshot?.rows ?? [])
const activeTier = computed<MatchupTier>(() => props.snapshot?.tier ?? 'all')
const activeLane = computed<ChampionLane>(() => props.snapshot?.lane ?? 'middle')
const totalGames = computed(() => rows.value.reduce((total, row) => total + row.games, 0))
const regionLabel = computed(() => {
  const region = props.snapshot?.region
  if (!region || region.toLowerCase() === 'global') return '全球服'
  return region
})
const formattedGeneratedAt = computed(() => {
  const source = props.snapshot?.generatedAt
  if (!source) return '未知'
  const date = new Date(source)
  if (Number.isNaN(date.getTime())) return source
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
})

function championFor(id: number) {
  return championMap.value.get(id)
}

function portraitFor(id: number): string {
  return championFor(id)?.portraitUrl ?? `${assetPrefix}/champion/${id}`
}

function normalizedRate(rate: number): number {
  return rate <= 1 ? rate * 100 : rate
}

function percent(rate: number): string {
  return `${normalizedRate(rate).toFixed(1)}%`
}

function optionalPercent(rate?: number): string {
  return rate == null ? '—' : percent(rate)
}

function winRateTone(rate: number): string {
  const value = normalizedRate(rate)
  if (value >= 51) return 'positive'
  if (value <= 49) return 'negative'
  return ''
}

function delta(value?: number): string {
  if (value == null) return '—'
  const rounded = Math.round(value)
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

function deltaTone(value?: number): string {
  if (value == null || Math.abs(value) < 0.5) return ''
  return value > 0 ? 'positive' : 'negative'
}

function isLowSample(games: number): boolean {
  return games < 200
}
</script>

<style scoped>
.matchup-explorer {
  --tactics-panel: #10151a;
  --tactics-panel-raised: #151b20;
  --tactics-line: rgba(178, 190, 198, 0.16);
  --tactics-muted: #77838c;
  --tactics-text: #dce3e7;
  --tactics-accent: #c9aa71;
  --tactics-positive: #68a37b;
  --tactics-negative: #bb6d69;
  overflow: hidden;
  border: 1px solid var(--tactics-line);
  border-radius: 14px;
  background: var(--tactics-panel);
}

.matchup-explorer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 15px;
}

.matchup-explorer__header div:first-child > span {
  color: var(--tactics-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.matchup-explorer__header h2 {
  margin: 3px 0 0;
  color: var(--tactics-text);
  font-size: 17px;
}

.matchup-explorer__patch {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 2px;
}

.matchup-explorer__patch span {
  color: var(--tactics-accent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.matchup-explorer__patch small {
  color: var(--tactics-muted);
  font-size: 9px;
}

.matchup-explorer__controls {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.85fr);
  gap: 10px;
  padding: 11px 22px;
  border-top: 1px solid var(--tactics-line);
  border-bottom: 1px solid var(--tactics-line);
  background:
    linear-gradient(90deg, rgba(201, 170, 113, 0.028) 1px, transparent 1px) 0 0 / 24px 100%,
    #0d1115;
}

.matchup-explorer__control-group {
  min-width: 0;
}

.matchup-explorer__control-group > span {
  display: block;
  margin-bottom: 6px;
  color: var(--tactics-muted);
  font-size: 8px;
  letter-spacing: 0.11em;
}

.matchup-explorer__control-group > div {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.matchup-explorer__control-group button {
  flex: 0 0 auto;
  padding: 5px 8px;
  border: 1px solid var(--tactics-line);
  border-radius: 4px;
  background: #11161b;
  color: var(--tactics-muted);
  cursor: pointer;
  font-size: 9px;
}

.matchup-explorer__control-group button:hover,
.matchup-explorer__control-group button.active {
  border-color: rgba(201, 170, 113, 0.42);
  color: var(--tactics-text);
}

.matchup-explorer__control-group button.active {
  background: rgba(201, 170, 113, 0.11);
  color: var(--tactics-accent);
}

.matchup-explorer__control-group button:focus-visible,
.matchup-explorer__opponent:focus-visible {
  outline: 2px solid var(--tactics-accent);
  outline-offset: 2px;
}

.matchup-explorer__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 22px;
  border-bottom: 1px solid var(--tactics-line);
  color: var(--tactics-muted);
  font-size: 9px;
}

.matchup-explorer__meta span:first-child {
  margin-right: auto;
}

.matchup-explorer__meta i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--tactics-positive);
  box-shadow: 0 0 7px rgba(104, 163, 123, 0.65);
}

.matchup-explorer__meta strong {
  color: #c49563;
  font-weight: 600;
}

.matchup-explorer__table {
  min-width: 760px;
}

.matchup-explorer__table-scroll {
  overflow-x: auto;
}

.matchup-explorer__row {
  display: grid;
  grid-template-columns: minmax(190px, 1.6fr) repeat(2, minmax(64px, 0.55fr)) repeat(
      4,
      minmax(70px, 0.62fr)
    );
  align-items: center;
  min-height: 58px;
  padding: 0 22px;
  border-bottom: 1px solid rgba(178, 190, 198, 0.09);
  color: #89959d;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.matchup-explorer__row--heading {
  min-height: 31px;
  background: rgba(255, 255, 255, 0.018);
  color: #65717a;
  font-size: 8px;
  letter-spacing: 0.06em;
}

.matchup-explorer__row > :first-child {
  text-align: left;
}

.matchup-explorer__opponent {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.matchup-explorer__opponent img {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid var(--tactics-line);
  border-radius: 6px;
  object-fit: cover;
  filter: saturate(0.82);
}

.matchup-explorer__opponent span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.matchup-explorer__opponent strong {
  overflow: hidden;
  color: var(--tactics-text);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matchup-explorer__opponent small {
  overflow: hidden;
  color: var(--tactics-muted);
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matchup-explorer__opponent:hover small {
  color: var(--tactics-accent);
}

.matchup-explorer__winrate {
  color: var(--tactics-text);
  font-size: 11px;
  font-weight: 700;
}

.matchup-explorer__games {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 2px;
}

.matchup-explorer__games small {
  color: #b4895d;
  font-size: 7px;
}

.positive {
  color: var(--tactics-positive);
}

.negative {
  color: var(--tactics-negative);
}

.matchup-explorer__loading,
.matchup-explorer__empty {
  min-height: 220px;
  margin: 0;
  padding: 36px 22px;
  color: var(--tactics-muted);
  font-size: 11px;
  text-align: center;
}

.matchup-explorer__loading {
  display: grid;
  gap: 8px;
}

.matchup-explorer__loading i {
  display: block;
  height: 36px;
  border-radius: 5px;
  background: linear-gradient(90deg, #151b20, #1c2329, #151b20) 0 0 / 200% 100%;
  animation: matchup-shimmer 1.4s linear infinite;
}

@keyframes matchup-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 820px) {
  .matchup-explorer__controls {
    grid-template-columns: 1fr;
  }
}
</style>
