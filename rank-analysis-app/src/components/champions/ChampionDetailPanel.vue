<script setup lang="ts">
/**
 * 英雄详情面板（英雄榜抽屉里的内容）
 *
 * 头部是榜单那一行的统计（已经有了，不必等网络）；下面四块（符文 / 出装 / 加点 /
 * 召唤师技能）来自 `get_champion_build`，被克制对位来自列表快照的克制数据。
 * 构筑拉不到时只降级这四块，头部与被克制对位照常——数据缺失是常态，不该整块空白。
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

/** 胜率冷暖色，与榜单同一口径 */
function winClass(v: number): string {
  if (v >= 0.52) return 'stat-good'
  if (v < 0.48) return 'stat-bad'
  return ''
}

/**
 * 主升顺序：Q/W/E 按「点满（最后一点）的等级」先后排，R 不参与
 * @example skillPriority(['Q','E','W','Q',...]) → ['Q', 'E', 'W']
 */
function skillPriority(order: string[]): string[] {
  const last: Record<string, number> = {}
  order.forEach((k, i) => {
    if (k !== 'R') last[k] = i
  })
  return Object.keys(last).sort((a, b) => last[a] - last[b])
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
      <div class="detail-hero">
        <img class="detail-avatar" :src="`${assetPrefix}/champion/${row.championId}`" alt="" />
        <div class="detail-head-text">
          <div class="detail-name">{{ row.name }}</div>
          <div class="detail-chips">
            <span class="detail-chip">{{ POSITION_LABELS[row.position] ?? row.position }}</span>
            <span class="detail-chip detail-tier" :class="`tier-${row.tier}`">T{{ row.tier }}</span>
            <span class="detail-chip">第 {{ row.rank }} 名</span>
          </div>
        </div>
      </div>

      <div class="detail-stats">
        <div class="detail-stat" :class="winClass(row.winRate)">
          <span class="detail-stat-value">{{ pct(row.winRate) }}</span>
          <span class="detail-stat-label">胜率</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">{{ pct(row.pickRate) }}</span>
          <span class="detail-stat-label">登场率</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">{{ pct(row.banRate) }}</span>
          <span class="detail-stat-label">Ban 率</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="detail-loading">
      <span class="sk detail-sk-title" />
      <span v-for="i in 2" :key="i" class="sk detail-sk-card" />
      <span class="sk detail-sk-title" />
      <span class="sk detail-sk-card" />
    </div>

    <template v-else-if="build">
      <section class="detail-section">
        <h3 class="detail-section-title">符文</h3>
        <div v-for="(r, i) in build.runes" :key="i" class="detail-card detail-rune-row">
          <div class="detail-rune-top">
            <img
              class="detail-keystone"
              :src="assets.srcOf('perk', r.primary_perk_ids[0])"
              alt=""
            />
            <div class="detail-rune-text">
              <div class="detail-rune-name">
                {{ headlineOf(r) }}
                <span class="detail-rune-sub">+ {{ perkName(r.sub_style_id) }}</span>
              </div>
              <div class="detail-rune-stat">
                <span :class="winClass(winRateOf(r))">{{ pct(winRateOf(r)) }} 胜率</span>
                <span class="dot">·</span>{{ pct(r.pick_rate) }} 出场<span class="dot">·</span
                >{{ r.play }} 场
              </div>
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
          <div class="detail-rune-icons">
            <span class="rune-group">
              <img
                v-for="id in r.primary_perk_ids.slice(1)"
                :key="id"
                :src="assets.srcOf('perk', id)"
                alt=""
              />
            </span>
            <span class="rune-divider" />
            <span class="rune-group">
              <img v-for="id in r.sub_perk_ids" :key="id" :src="assets.srcOf('perk', id)" alt="" />
            </span>
            <span class="rune-divider" />
            <span class="rune-group rune-shards">
              <img
                v-for="(id, j) in r.stat_mod_ids"
                :key="j"
                :src="assets.srcOf('perk', id)"
                alt=""
              />
            </span>
          </div>
        </div>
      </section>

      <section class="detail-section detail-items">
        <h3 class="detail-section-title">出装</h3>
        <div class="detail-card detail-item-card">
          <div v-for="g in itemGroups" :key="g.label" class="detail-item-group">
            <span class="detail-item-label">{{ g.label }}</span>
            <div class="detail-item-entries">
              <span v-for="(e, i) in g.entries" :key="i" class="detail-item-entry">
                <span class="detail-item-icons">
                  <template v-for="(id, j) in e.ids" :key="id">
                    <span v-if="j > 0" class="item-arrow">›</span>
                    <img :src="assets.srcOf('item', id)" alt="" />
                  </template>
                </span>
                <em>{{ pct(e.pick_rate) }}</em>
              </span>
            </div>
          </div>
        </div>
      </section>

      <div class="detail-grid">
        <section v-if="build.spells.length" class="detail-section detail-spells">
          <h3 class="detail-section-title">召唤师技能</h3>
          <div class="detail-card">
            <div v-for="(s, i) in build.spells" :key="i" class="detail-spell-row">
              <img v-for="id in s.ids" :key="id" :src="assets.srcOf('spell', id)" alt="" />
              <em>{{ pct(s.pick_rate) }}</em>
            </div>
          </div>
        </section>

        <section v-if="build.skills.length" class="detail-section detail-skills">
          <h3 class="detail-section-title">加点</h3>
          <div class="detail-card">
            <div v-for="(s, i) in build.skills" :key="i" class="detail-skill-block">
              <div class="detail-skill-priority">
                <template v-for="(k, j) in skillPriority(s.order)" :key="k">
                  <span v-if="j > 0" class="skill-gt">›</span>
                  <span class="detail-skill-key" :class="`skill-${k}`">{{ k }}</span>
                </template>
                <em>{{ pct(s.pick_rate) }}</em>
              </div>
              <div class="detail-skill-row">
                <span
                  v-for="(k, j) in s.order"
                  :key="j"
                  class="detail-skill-cell"
                  :class="`skill-${k}`"
                  :title="`${j + 1} 级`"
                  >{{ k }}</span
                >
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <div v-else class="detail-card detail-missing">数据未取到，稍后重开这个英雄再试</div>

    <section v-if="counters.length" class="detail-section detail-counters">
      <h3 class="detail-section-title">克制它的英雄</h3>
      <div class="detail-card detail-counter-list">
        <div v-for="c in counters" :key="c.opponentId" class="detail-counter-row">
          <img :src="`${assetPrefix}/champion/${c.opponentId}`" alt="" />
          <span class="detail-counter-name">{{ nameOf(c.opponentId) }}</span>
          <span class="detail-counter-rate" :class="winClass(c.subjectWinRate)"
            >对位胜率 {{ pct(c.subjectWinRate) }}</span
          >
          <em>{{ c.play }} 场</em>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.champion-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
  font-size: var(--font-size-base);
}

/* ---------- 头部 ---------- */
.detail-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.detail-hero {
  display: flex;
  align-items: center;
  gap: var(--space-16);
}

.detail-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  box-shadow:
    0 0 0 1px var(--glass-border),
    var(--shadow-md);
}

.detail-name {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-primary);
}

.detail-chips {
  display: flex;
  gap: var(--space-6);
  margin-top: var(--space-8);
}

.detail-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 var(--space-8);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-high);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.tier-0 {
  background: var(--accent-gold);
  /* 金底配深字，与榜单徽章同一块金色 (theme-fixed) */
  color: #1b1205;
}
.tier-1 {
  background: color-mix(in srgb, var(--semantic-win) 18%, transparent);
  color: var(--semantic-win);
}
.tier-2 {
  background: color-mix(in srgb, var(--accent-sky) 16%, transparent);
  color: var(--accent-sky);
}

/* 三个核心数字各占一格，比一行「x 胜率 · y 登场」好扫 */
.detail-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-8);
}

.detail-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-10) var(--space-12);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  border: 1px solid var(--glass-border);
}

.detail-stat-value {
  font-size: var(--font-size-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.detail-stat-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.stat-good,
.stat-good .detail-stat-value {
  color: var(--semantic-win);
}
.stat-bad,
.stat-bad .detail-stat-value {
  color: var(--semantic-loss);
}

/* ---------- 区块 ---------- */
.detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
}

.detail-section-title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.detail-card {
  padding: var(--space-12) var(--space-16);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
}

/* ---------- 符文 ---------- */
.detail-rune-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.detail-rune-top {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.detail-keystone {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 50%;
  background: var(--glass-bg-high);
}

.detail-rune-text {
  flex: 1;
  min-width: 0;
}

.detail-rune-name {
  font-weight: 600;
  color: var(--text-primary);
}

.detail-rune-sub {
  margin-left: var(--space-4);
  color: var(--text-tertiary);
  font-weight: 400;
}

.detail-rune-stat {
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.dot {
  margin: 0 var(--space-6);
  opacity: 0.6;
}

/* 主系 / 副系 / 属性碎片三组分开摆，一整排 11 个小图标分不清谁是谁 */
.detail-rune-icons {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-12);
  margin-left: 52px;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.rune-group {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.rune-group img {
  width: 26px;
  height: 26px;
}

.rune-shards img {
  width: 18px;
  height: 18px;
  opacity: 0.85;
}

.rune-divider {
  width: 1px;
  height: 18px;
  background: var(--glass-border);
}

.detail-remember {
  flex: none;
  height: 28px;
  padding: 0 var(--space-12);
  border: 1px solid var(--border-control);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    background var(--dur-fast) var(--ease-expo);
}

.detail-remember:hover {
  border-color: var(--border-control-hover);
  color: var(--text-primary);
}

.detail-remember-on,
.detail-remember-on:hover {
  color: var(--accent-gold);
  border-color: color-mix(in srgb, var(--accent-gold) 60%, transparent);
  background: color-mix(in srgb, var(--accent-gold) 10%, transparent);
}

/* ---------- 出装 ---------- */
.detail-item-card {
  display: flex;
  flex-direction: column;
}

.detail-item-group {
  display: flex;
  align-items: flex-start;
  gap: var(--space-12);
  padding: var(--space-10) 0;
}

.detail-item-group + .detail-item-group {
  border-top: 1px solid var(--border-subtle);
}

.detail-item-label {
  flex: none;
  width: 44px;
  line-height: 32px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.detail-item-entries {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8) var(--space-16);
}

.detail-item-entry {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
}

.detail-item-icons {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.detail-item-icons img {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--glass-border);
}

.item-arrow,
.skill-gt {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  opacity: 0.7;
}

/* ---------- 召唤师技能 / 加点 ---------- */
.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-16);
}

.detail-spells .detail-card,
.detail-skills .detail-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
  flex: 1;
}

.detail-spell-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.detail-spell-row img {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--glass-border);
}

.detail-spell-row em {
  margin-left: var(--space-6);
}

.detail-skill-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.detail-skill-block + .detail-skill-block {
  padding-top: var(--space-10);
  border-top: 1px solid var(--border-subtle);
}

.detail-skill-priority {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.detail-skill-priority em {
  margin-left: auto;
}

.detail-skill-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 700;
  background: color-mix(in srgb, var(--skill-color) 18%, transparent);
  color: var(--skill-color);
}

/* 15 级逐级加点：同色小格连成一条，Q/W/E/R 各一色 */
.detail-skill-row {
  display: grid;
  grid-template-columns: repeat(15, 1fr);
  gap: 2px;
}

.detail-skill-cell {
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-size: var(--font-size-3xs);
  font-weight: 700;
  background: color-mix(in srgb, var(--skill-color) 16%, transparent);
  color: var(--skill-color);
}

.skill-Q {
  --skill-color: var(--accent-sky);
}
.skill-W {
  --skill-color: var(--semantic-win);
}
.skill-E {
  --skill-color: var(--accent-gold);
}
.skill-R {
  --skill-color: var(--semantic-loss);
}

/* ---------- 被克制对位 ---------- */
.detail-counter-list {
  padding-top: var(--space-4);
  padding-bottom: var(--space-4);
}

.detail-counter-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-8) 0;
}

.detail-counter-row + .detail-counter-row {
  border-top: 1px solid var(--border-subtle);
}

.detail-counter-row img {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--glass-border);
}

.detail-counter-name {
  flex: 1;
  font-weight: 600;
  color: var(--text-primary);
}

.detail-counter-rate {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.detail-counter-row em {
  min-width: 56px;
  text-align: right;
}

em {
  font-style: normal;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.detail-missing {
  color: var(--text-tertiary);
  text-align: center;
}

.detail-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.detail-sk-title {
  height: 12px;
  width: 64px;
  border-radius: var(--radius-xs);
}

.detail-sk-card {
  height: 96px;
  border-radius: var(--radius-lg);
}
</style>
