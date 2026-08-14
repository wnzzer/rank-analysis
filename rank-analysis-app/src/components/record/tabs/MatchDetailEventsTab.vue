<template>
  <!-- 事件 tab：SGP DETAILS 事件流（LCU 战绩无 timeline 端点，事件数据全部来自 SGP）。
       按分钟流式排布 + 类型筛选；击杀带伤害明细 tooltip，建筑/怪物/塔皮按类型着色。 -->
  <div class="match-detail-events-tab">
    <!-- 加载中 / 就绪前的兜底状态 -->
    <div v-if="loading" class="match-detail-events-state">
      <n-spin size="small" />
      <span>正在加载事件流…</span>
    </div>

    <!-- 拉取失败：网络/令牌/主机映射——错误态 + 重试 -->
    <div v-else-if="failed" class="match-detail-events-state">
      <span class="match-detail-events-state-title">事件流拉取失败</span>
      <span class="match-detail-events-state-desc">
        SGP 数据通道暂不可用（网络 / 令牌 / 大区支持），请重试。
      </span>
      <button type="button" class="match-detail-events-retry" @click="ctx.loadSgpDetail()">
        重试
      </button>
    </div>

    <!-- 无数据：拉取成功但该局无事件 -->
    <div v-else-if="events.length === 0" class="match-detail-events-state">
      <span class="match-detail-events-state-title">本局无事件数据</span>
      <span class="match-detail-events-state-desc">
        事件流来自 SGP 数据源；该局未返回事件数据（部分模式/数据缺失）。
      </span>
    </div>

    <template v-else>
      <!-- 类型筛选 -->
      <div class="match-detail-events-filters">
        <button
          v-for="opt in filterOptions"
          :key="opt.value"
          type="button"
          class="match-detail-events-filter"
          :class="{ 'match-detail-events-filter--active': filter === opt.value }"
          @click="filter = opt.value"
        >
          {{ opt.label }}
          <span class="match-detail-events-filter-count">{{ counts[opt.value] }}</span>
        </button>
      </div>

      <!-- 时间线 -->
      <n-scrollbar class="match-detail-events-scroll">
        <div class="match-detail-events-timeline">
          <div
            v-for="ev in visibleEvents"
            :key="ev.key"
            class="match-detail-events-item"
            :class="[`match-detail-events-item--${ev.kind}`]"
          >
            <div class="match-detail-events-time">{{ ev.minuteLabel }}</div>
            <div class="match-detail-events-node" />
            <div class="match-detail-events-card">
              <div class="match-detail-events-card-head">
                <span class="match-detail-events-kind">{{ ev.kindLabel }}</span>
                <span class="match-detail-events-team">{{ ev.teamLabel }}</span>
              </div>
              <div class="match-detail-events-text">{{ ev.text }}</div>
              <div v-if="ev.details?.length" class="match-detail-events-details">
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <span class="match-detail-events-details-toggle">{{ ev.detailsLabel }}</span>
                  </template>
                  <div class="match-detail-events-damage-pop">
                    <div
                      v-for="(row, i) in ev.details"
                      :key="i"
                      class="match-detail-events-damage-row"
                    >
                      <span class="match-detail-events-damage-src">{{ row.source }}</span>
                      <span class="match-detail-events-damage-bars">
                        <span
                          v-for="b in row.bars"
                          :key="b.type"
                          class="match-detail-events-damage-bar"
                          :class="`match-detail-events-damage-bar--${b.type}`"
                        >
                          {{ b.value }}
                        </span>
                      </span>
                    </div>
                  </div>
                </n-tooltip>
              </div>
            </div>
          </div>
        </div>
      </n-scrollbar>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject, onMounted, ref } from 'vue'
import { NScrollbar, NSpin, NTooltip } from 'naive-ui'
import type { SgpFrameEvent } from '@renderer/services/sgp'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'
import { matchDetailContextKey } from '../matchDetailContext'
import {
  EVENT_FILTER_OPTIONS,
  EVENT_KIND_LABEL,
  countEventKinds,
  kindOfEvent,
  type EventKind
} from './eventsTable'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailEventsTab 必须在 MatchDetailInline 容器内使用')
const ctx = injected as NonNullable<typeof injected>

onMounted(() => {
  void ctx.loadSgpDetail()
})

const loading = computed(
  () => ctx.sgpDetailStatus.value === 'loading' || ctx.sgpDetailStatus.value === 'idle'
)
/** 拉取失败（网络/令牌/主机映射）——展示错误态 + 重试按钮 */
const failed = computed(() => ctx.sgpDetailStatus.value === 'error')

/** 玩家 id → DetailPlayer 快速映射（事件归属/击杀方/受害者取名用） */
const playerById = computed(() => {
  const map = new Map<number, DetailPlayer>()
  for (const p of ctx.players.detailPlayers.value) map.set(p.participantId, p)
  return map
})

const playerLabel = (id?: number | null) =>
  id == null ? '未知' : (playerById.value.get(id)?.displayName ?? `玩家 ${id}`)

const teamLabel = (teamId?: number | null) =>
  teamId === 100 ? '蓝方' : teamId === 200 ? '红方' : ''

// ── 事件类型筛选（纯函数层 eventsTable.ts）──

const filterOptions = EVENT_FILTER_OPTIONS

const filter = ref<EventKind | 'all'>('all')

// ── 事件 → 可渲染行 ──

interface DamageBar {
  type: 'physical' | 'magic' | 'true'
  value: string
}

interface EventRow {
  key: string
  minuteLabel: string
  kind: EventKind
  rawType: string
  kindLabel: string
  teamLabel: string
  text: string
  details: { source: string; bars: DamageBar[] }[] | null
  detailsLabel: string
}

const BUILDING_LABEL: Record<string, string> = {
  TOWER_BUILDING: '防御塔',
  INHIBITOR_BUILDING: '水晶',
  NEXUS_BUILDING: '枢纽'
}

const TOWER_TYPE_LABEL: Record<string, string> = {
  OUTER_TURRET: '外塔',
  INNER_TURRET: '内塔',
  BASE_TURRET: '高地塔',
  NEXUS_TURRET: '门牙塔'
}

const LANE_LABEL: Record<string, string> = {
  TOP_LANE: '上路',
  MID_LANE: '中路',
  BOT_LANE: '下路',
  MIDDLE_LANE: '中路'
}

const MONSTER_LABEL: Record<string, string> = {
  BARON_NASHOR: '纳什男爵',
  DRAGON: '巨龙',
  RIFTHERALD: '峡谷先锋',
  VOIDGRUB: '虚空巢虫'
}

const MONSTER_SUB_LABEL: Record<string, string> = {
  FIRE_DRAGON: '火龙',
  WATER_DRAGON: '水龙',
  EARTH_DRAGON: '土龙',
  AIR_DRAGON: '风龙',
  HEX_DRAGON: '海克斯龙',
  CHEMTECH_DRAGON: '炼金龙',
  ELDER_DRAGON: '远古龙'
}

interface DamageDetailEntry {
  source: string
  physical: number
  magic: number
  true: number
}

/** 击杀事件的伤害明细聚合为「来源 → 三段伤害条」 */
function damageDetailRows(
  list?: SgpFrameEvent['victimDamageDealt'] | SgpFrameEvent['victimDamageReceived']
): { source: string; bars: DamageBar[] }[] | null {
  if (!list?.length) return null
  const rows: DamageDetailEntry[] = []
  for (const d of list) {
    if (!d || typeof d !== 'object') continue
    const srcId = d.participantId
    const src =
      srcId != null && srcId > 0
        ? playerLabel(srcId)
        : (d.spellName ?? d.name ?? (d.type === 'TOWER' ? '防御塔' : '其他'))
    const existing = rows.find(r => r.source === src)
    const phy = d.physicalDamage ?? 0
    const mag = d.magicDamage ?? 0
    const tru = d.trueDamage ?? 0
    if (existing) {
      existing.physical += phy
      existing.magic += mag
      existing.true += tru
    } else {
      rows.push({ source: src, physical: phy, magic: mag, true: tru })
    }
  }
  const bars = (n: number) => (n > 0 ? String(n) : '')
  return rows.map(r => ({
    source: r.source,
    bars: [
      { type: 'physical' as const, value: bars(r.physical) },
      { type: 'magic' as const, value: bars(r.magic) },
      { type: 'true' as const, value: bars(r.true) }
    ]
  }))
}

const SPECIAL_LABEL = (ev: SgpFrameEvent): string => {
  const t = ev.killType
  if (t === 'FIRST_BLOOD') return `一血 · ${playerLabel(ev.killerId)}`
  if (t === 'MULTI_KILL' && ev.multiKillLength) {
    const n =
      ['', '', '双杀', '三杀', '四杀', '五杀'][ev.multiKillLength] ?? `${ev.multiKillLength} 杀`
    return `${n} · ${playerLabel(ev.killerId)}`
  }
  if (t === 'ACE') return `团灭 · ${playerLabel(ev.killerId)} 完成`
  return `${t ?? '特殊击杀'} · ${playerLabel(ev.killerId)}`
}

function buildEventRow(ev: SgpFrameEvent, index: number, frameTs: number): EventRow {
  const minLabel =
    ev.timestamp != null
      ? `${Math.floor(ev.timestamp / 60000)}:${String(Math.round((ev.timestamp % 60000) / 1000)).padStart(2, '0')}`
      : `${Math.floor(frameTs / 60000)}:00`
  const kind = kindOfEvent(ev)
  const team = teamLabel(ev.teamId)

  let text = ''
  let details: EventRow['details'] = null
  let detailsLabel = ''

  switch (kind) {
    case 'kill': {
      const killer = playerLabel(ev.killerId)
      const victim = playerLabel(ev.victimId)
      const assists = (ev.assistingParticipantIds ?? [])
        .filter(id => id > 0)
        .map(id => playerLabel(id))
      text = `${killer} 击杀 ${victim}${assists.length ? `（助攻：${assists.join('、')}）` : ''}`
      details = damageDetailRows(ev.victimDamageReceived)
      detailsLabel = '伤害明细'
      break
    }
    case 'building': {
      const building = ev.buildingType
        ? (BUILDING_LABEL[ev.buildingType] ?? ev.buildingType)
        : '建筑'
      const tower = ev.towerType ? (TOWER_TYPE_LABEL[ev.towerType] ?? ev.towerType) : ''
      const lane = ev.laneType ? (LANE_LABEL[ev.laneType] ?? ev.laneType) : ''
      text = `${team || '某方'}摧毁${lane ? `${lane}` : ''}${tower || building}`
      break
    }
    case 'monster': {
      const type = ev.monsterType
        ? (MONSTER_LABEL[ev.monsterType] ?? ev.monsterType)
        : '大型中立生物'
      const sub = ev.monsterSubType ? (MONSTER_SUB_LABEL[ev.monsterSubType] ?? false) : false
      text = `${team || '某方'}击杀 ${sub || type}`
      break
    }
    case 'plate':
      text = `${team || '某方'}摧毁塔皮`
      break
    case 'special':
      text = SPECIAL_LABEL(ev)
      break
    default: {
      switch (ev.type) {
        case 'ITEM_PURCHASED':
          text = `${playerLabel(ev.participantId)} 购买装备`
          break
        case 'ITEM_SOLD':
          text = `${playerLabel(ev.participantId)} 出售装备`
          break
        case 'ITEM_UNDO':
          text = `${playerLabel(ev.participantId)} 撤销购买`
          break
        case 'SKILL_LEVEL_UP':
          text = `${playerLabel(ev.participantId)} 升级技能 ${ev.levelUpType ?? ''}`
          break
        case 'WARD_PLACED':
          text = `${playerLabel(ev.participantId)} 放置守卫`
          break
        case 'GAME_END':
          text = `游戏结束 · ${ev.gameEndResult ?? ''}`
          break
        default:
          text = `${ev.type ?? '未知事件'} · ${playerLabel(ev.participantId)}`
      }
      break
    }
  }

  return {
    key: `${frameTs}-${index}-${ev.type ?? ''}-${ev.timestamp ?? 0}`,
    minuteLabel: minLabel,
    kind,
    rawType: ev.type ?? '',
    kindLabel: EVENT_KIND_LABEL[kind],
    teamLabel: team,
    text,
    details,
    detailsLabel
  }
}

/** 全部事件（按时间排序的扁平流） */
const events = computed<EventRow[]>(() => {
  const detail = ctx.sgpDetail.value
  if (!detail?.frames?.length) return []
  let index = 0
  const rows: EventRow[] = []
  for (const frame of detail.frames) {
    const frameTs = frame.timestamp ?? 0
    for (const ev of frame.events ?? []) {
      if (!ev?.type) continue
      rows.push(buildEventRow(ev, index++, frameTs))
    }
  }
  return rows.sort((a, b) => {
    const [am, as] = a.minuteLabel.split(':').map(Number)
    const [bm, bs] = b.minuteLabel.split(':').map(Number)
    return am * 60 + as - (bm * 60 + bs)
  })
})

const counts = computed(() => {
  return countEventKinds(events.value.map(ev => ({ type: ev.rawType })))
})

const visibleEvents = computed(() => {
  const opt = filterOptions.find(o => o.value === filter.value) ?? filterOptions[0]
  return events.value.filter(ev => opt.match({ type: ev.rawType }))
})
</script>

<style scoped>
.match-detail-events-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
  padding: var(--space-8) var(--space-12) var(--space-10);
}

.match-detail-events-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-20) var(--space-12);
  flex-direction: column;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.match-detail-events-state-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-events-state-desc {
  max-width: 420px;
  text-align: center;
  line-height: 1.6;
}

.match-detail-events-retry {
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-10);
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--glass-bg-mid);
  color: var(--accent-blue);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-expo);
}

.match-detail-events-retry:hover {
  background: var(--glass-bg-high);
}

.match-detail-events-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.match-detail-events-filter {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: transparent;
  border-radius: var(--radius-pill);
  padding: var(--space-2) var(--space-10);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    background var(--dur-fast) var(--ease-expo);
}

.match-detail-events-filter:hover {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--text-secondary) 40%, transparent);
}

.match-detail-events-filter--active {
  color: var(--semantic-win-bright);
  border-color: color-mix(in srgb, var(--semantic-win) 55%, transparent);
  background: color-mix(in srgb, var(--semantic-win) 10%, transparent);
}

.match-detail-events-filter-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.match-detail-events-scroll {
  max-height: 520px;
}

.match-detail-events-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: var(--space-2) 0 var(--space-4);
}

.match-detail-events-item {
  display: grid;
  grid-template-columns: 44px 14px minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
  position: relative;
  padding-bottom: var(--space-8);
}

/* 纵向连接线（除最后一项外） */
.match-detail-events-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 51px;
  top: 18px;
  bottom: 0;
  width: 1px;
  background: var(--border-subtle);
}

.match-detail-events-time {
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  padding-top: var(--space-2);
  text-align: right;
  line-height: 1.4;
}

.match-detail-events-node {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: var(--space-4);
  border: 2px solid transparent;
  box-sizing: content-box;
}

.match-detail-events-item--kill .match-detail-events-node {
  background: var(--semantic-loss);
  border-color: color-mix(in srgb, var(--semantic-loss) 35%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--semantic-loss) 14%, transparent);
}

.match-detail-events-item--building .match-detail-events-node {
  background: var(--accent-blue);
  border-color: color-mix(in srgb, var(--accent-blue) 35%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-blue) 14%, transparent);
}

.match-detail-events-item--monster .match-detail-events-node {
  background: var(--text-secondary);
  border-color: color-mix(in srgb, var(--text-secondary) 35%, transparent);
}

.match-detail-events-item--plate .match-detail-events-node {
  background: var(--accent-gold);
  border-color: color-mix(in srgb, var(--accent-gold) 35%, transparent);
}

.match-detail-events-item--special .match-detail-events-node {
  background: var(--semantic-win);
  border-color: color-mix(in srgb, var(--semantic-win) 35%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--semantic-win) 16%, transparent);
}

.match-detail-events-item--other .match-detail-events-node {
  background: var(--border-subtle);
}

.match-detail-events-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-6) var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
}

.match-detail-events-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-events-kind {
  font-size: var(--font-size-2xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.match-detail-events-team {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

.match-detail-events-text {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  line-height: 1.5;
  overflow-wrap: break-word;
}

.match-detail-events-details-toggle {
  font-size: var(--font-size-2xs);
  color: var(--accent-blue);
  cursor: help;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

.match-detail-events-damage-pop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
}

.match-detail-events-damage-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-events-damage-src {
  min-width: 88px;
  font-size: var(--font-size-2xs);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-detail-events-damage-bars {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.match-detail-events-damage-bar {
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  padding: 1px var(--space-4);
  border-radius: var(--radius-control);
}

.match-detail-events-damage-bar--physical {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 14%, transparent);
}

.match-detail-events-damage-bar--magic {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 16%, transparent);
}

.match-detail-events-damage-bar--true {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--text-secondary) 10%, transparent);
}

.match-detail-events-damage-bar:empty {
  display: none;
}

.match-detail-events-bar-legend {
  text-align: right;
}
</style>
