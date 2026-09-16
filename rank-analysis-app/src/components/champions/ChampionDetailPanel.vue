<script setup lang="ts">
/**
 * 英雄详情面板（英雄榜抽屉里的内容）
 *
 * 头部是榜单那一行的统计（已经有了，不必等网络）；下面四块（符文 / 出装 / 加点 /
 * 召唤师技能）来自 `get_champion_build`，苦手对位来自列表快照的克制数据。
 * 构筑拉不到时只降级这四块，头部与苦手照常——数据缺失是常态，不该整块空白。
 *
 * 只提供「记住」：不在选人期写客户端符文页会把用户当前选中的页换掉，收益不值当。
 */
import { computed, ref, watch } from 'vue'
import { assetPrefix } from '@renderer/services/http'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { useRunePresets } from '@renderer/composables/useRunePresets'
import { fetchChampionBuild, presetFromRune } from '@renderer/services/championBuild'
import { getLaneCounters, type LaneCounter } from '@renderer/services/opgg'
import type { ChampionBuild, RuneBuild } from '@renderer/types/championBuild'
import type { TierRow } from './championTier'

const props = defineProps<{ row: TierRow | null; nameOf: (id: number) => string }>()

const assets = useRecordAssets()
const presetsApi = useRunePresets()
void presetsApi.reload()

const build = ref<ChampionBuild | null>(null)
const counters = ref<LaneCounter[]>([])
const loading = ref(false)

const POSITION_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/** 方案与构筑请求都用 LCU 小写分路 */
const lane = computed(() => (props.row?.position ?? '').toLowerCase())

/** 请求序号：连点不同英雄时旧响应可能后到，只认最后一次 */
let seq = 0

watch(
  () => props.row,
  async row => {
    const mine = ++seq
    build.value = null
    counters.value = []
    if (!row) return
    loading.value = true
    const [b, c] = await Promise.all([
      fetchChampionBuild(row.championId, 'CLASSIC', row.position.toLowerCase()),
      getLaneCounters('ranked', [row.championId])
    ])
    if (mine !== seq) return
    build.value = b
    counters.value = (c[row.championId] ?? []).filter(x => x.position === row.position)
    loading.value = false
  },
  { immediate: true }
)

// 符文 / 装备 / 技能名字按需加载
watch(build, b => {
  if (!b) return
  const perks = new Set<number>()
  for (const r of b.runes) {
    perks.add(r.primary_style_id)
    perks.add(r.sub_style_id)
    for (const id of [...r.primary_perk_ids, ...r.sub_perk_ids, ...r.stat_mod_ids]) perks.add(id)
  }
  const items = [...b.starter_items, ...b.boots, ...b.core_items, ...b.last_items].flatMap(
    e => e.ids
  )
  assets.preload([
    { kind: 'perk', ids: [...perks] },
    { kind: 'item', ids: items },
    { kind: 'spell', ids: b.spells.flatMap(s => s.ids) }
  ])
})

const perkName = (id: number) => assets.detailOf('perk', id)?.name ?? ''
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const winRateOf = (r: { play: number; win: number }) => (r.play > 0 ? r.win / r.play : 0)

function headlineOf(rune: RuneBuild): string {
  const style = perkName(rune.primary_style_id)
  const keystone = perkName(rune.primary_perk_ids[0])
  return style && keystone ? `${style} · ${keystone}` : style || keystone
}

/** 该套是否已是这个英雄这条路的方案 */
function remembered(rune: RuneBuild): boolean {
  const p = presetsApi.find(props.row?.championId ?? 0, lane.value)
  if (!p) return false
  const mine = [...rune.primary_perk_ids, ...rune.sub_perk_ids, ...rune.stat_mod_ids]
  const saved = [...p.primary_perk_ids, ...p.sub_perk_ids, ...p.stat_mod_ids]
  return mine.length === saved.length && mine.every((id, i) => id === saved[i])
}

async function toggleRemember(rune: RuneBuild): Promise<void> {
  const row = props.row
  if (!row) return
  if (remembered(rune)) await presetsApi.forget(row.championId, lane.value)
  else await presetsApi.remember(presetFromRune(row.championId, lane.value, rune))
}

/** 出装分组：出门装 / 鞋 / 核心 / 后期，各取出场率最高的几条 */
const itemGroups = computed(() => {
  const b = build.value
  if (!b) return []
  return [
    { label: '出门装', entries: b.starter_items.slice(0, 2) },
    { label: '鞋', entries: b.boots.slice(0, 3) },
    { label: '核心', entries: b.core_items.slice(0, 3) },
    { label: '后期', entries: b.last_items.slice(0, 4) }
  ].filter(g => g.entries.length > 0)
})
</script>

<template>
  <div v-if="row" class="champion-detail">
    <div class="detail-head">
      <img class="detail-avatar" :src="`${assetPrefix}/champion/${row.championId}`" alt="" />
      <div class="detail-head-text">
        <div class="detail-name">
          {{ row.name }}
          <span class="detail-position">{{ POSITION_LABELS[row.position] ?? row.position }}</span>
          <span class="detail-tier">T{{ row.tier }}</span>
        </div>
        <div class="detail-stats">
          {{ pct(row.winRate) }} 胜率 · {{ pct(row.pickRate) }} 登场 · {{ pct(row.banRate) }} Ban
        </div>
      </div>
    </div>

    <div v-if="loading" class="detail-loading">
      <span v-for="i in 4" :key="i" class="sk detail-sk-row" />
    </div>

    <template v-else-if="build">
      <section class="detail-section">
        <div class="detail-section-title">符文</div>
        <div v-for="(r, i) in build.runes" :key="i" class="detail-rune-row">
          <img class="detail-keystone" :src="assets.srcOf('perk', r.primary_perk_ids[0])" alt="" />
          <div class="detail-rune-text">
            <div class="detail-rune-name">
              {{ headlineOf(r) }}
              <span class="detail-rune-sub">/ {{ perkName(r.sub_style_id) }}</span>
            </div>
            <div class="detail-rune-stat">
              {{ pct(r.pick_rate) }} 出场 · {{ pct(winRateOf(r)) }} 胜率 · {{ r.play }}场
            </div>
          </div>
          <div class="detail-rune-icons">
            <img
              v-for="id in [...r.primary_perk_ids, ...r.sub_perk_ids, ...r.stat_mod_ids]"
              :key="id"
              :src="assets.srcOf('perk', id)"
              alt=""
            />
          </div>
          <button
            type="button"
            class="detail-remember"
            :class="{ 'detail-remember-on': remembered(r) }"
            @click="toggleRemember(r)"
          >
            {{ remembered(r) ? '★ 已记住' : '☆ 记住' }}
          </button>
        </div>
      </section>

      <section class="detail-section detail-items">
        <div class="detail-section-title">出装</div>
        <div v-for="g in itemGroups" :key="g.label" class="detail-item-group">
          <span class="detail-item-label">{{ g.label }}</span>
          <span v-for="(e, i) in g.entries" :key="i" class="detail-item-entry">
            <img v-for="id in e.ids" :key="id" :src="assets.srcOf('item', id)" alt="" />
            <em>{{ pct(e.pick_rate) }}</em>
          </span>
        </div>
      </section>

      <section v-if="build.skills.length" class="detail-section detail-skills">
        <div class="detail-section-title">加点</div>
        <div v-for="(s, i) in build.skills" :key="i" class="detail-skill-row">
          <span v-for="(k, j) in s.order" :key="j" class="detail-skill-key">{{ k }}</span>
          <em>{{ pct(s.pick_rate) }}</em>
        </div>
      </section>

      <section v-if="build.spells.length" class="detail-section detail-spells">
        <div class="detail-section-title">召唤师技能</div>
        <div v-for="(s, i) in build.spells" :key="i" class="detail-spell-row">
          <img v-for="id in s.ids" :key="id" :src="assets.srcOf('spell', id)" alt="" />
          <em>{{ pct(s.pick_rate) }}</em>
        </div>
      </section>
    </template>

    <div v-else class="detail-section detail-missing">数据未取到，稍后重开这个英雄再试</div>

    <section v-if="counters.length" class="detail-section detail-counters">
      <div class="detail-section-title">苦手对位</div>
      <div v-for="c in counters" :key="c.opponentId" class="detail-counter-row">
        <img :src="`${assetPrefix}/champion/${c.opponentId}`" alt="" />
        <span class="detail-counter-name">{{ nameOf(c.opponentId) }}</span>
        <span>对位胜率 {{ pct(c.subjectWinRate) }}</span>
        <em>{{ c.play }} 场</em>
      </div>
    </section>
  </div>
</template>

<style scoped>
.champion-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  font-size: var(--font-size-sm);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.detail-avatar {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
}

.detail-name {
  font-size: var(--font-size-lg);
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.detail-position,
.detail-tier {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.detail-stats {
  color: var(--text-tertiary);
  margin-top: var(--space-4);
}

.detail-section-title {
  font-weight: 600;
  margin-bottom: var(--space-8);
  color: var(--text-secondary);
}

.detail-rune-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.detail-keystone {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}

.detail-rune-text {
  min-width: 150px;
}

.detail-rune-name {
  font-weight: 600;
}

.detail-rune-sub,
.detail-rune-stat {
  color: var(--text-tertiary);
  font-weight: 400;
  font-size: var(--font-size-xs);
}

.detail-rune-icons {
  display: flex;
  gap: 2px;
  flex: 1;
}

.detail-rune-icons img {
  width: 18px;
  height: 18px;
}

.detail-remember {
  padding: var(--space-2) var(--space-8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.detail-remember-on {
  color: var(--accent-gold);
  border-color: var(--accent-gold);
}

.detail-item-group,
.detail-skill-row,
.detail-spell-row,
.detail-counter-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4) 0;
  flex-wrap: wrap;
}

.detail-item-label {
  min-width: 48px;
  color: var(--text-tertiary);
}

.detail-item-entry {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: var(--space-12);
}

/* 一件套的图标贴紧，出场率要离开图标，否则数字像是图标的一部分 */
.detail-item-entry em,
.detail-spell-row em {
  margin-left: var(--space-4);
}

.detail-counter-name {
  min-width: 72px;
  color: var(--text-secondary);
}

.detail-item-entry img,
.detail-spell-row img,
.detail-counter-row img {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}

.detail-skill-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-xs);
  background: var(--surface-control);
  font-size: var(--font-size-xs);
}

em {
  font-style: normal;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.detail-missing {
  color: var(--text-tertiary);
}

.detail-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.detail-sk-row {
  height: 32px;
}
</style>
