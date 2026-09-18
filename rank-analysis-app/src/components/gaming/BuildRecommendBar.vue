<script setup lang="ts">
/**
 * 选人期推荐符文栏：多方案卡片
 *
 * 第一行是方案卡（OP.GG 至多 3 套 + 我的方案），点选切换、hover 看完整 9 个符文；
 * 第二行是选中方案的依据（出场率 / 胜率 / 样本量，永远带样本量）、核心装与操作按钮。
 *
 * 纯展示组件：方案、选中、写入状态都由 useChampionBuild 给出，交互只发事件。
 */
import { computed, watch } from 'vue'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import type { ApplyState } from '@renderer/composables/useChampionBuild'
import type { ChampionBuild, RuneBuild, RuneOption } from '@renderer/types/championBuild'

const props = withDefaults(
  defineProps<{
    /** OP.GG 构筑（核心装 / 版本提示用）；只有我的方案时为 null */
    build: ChampionBuild | null
    loading: boolean
    /** 方案卡，顺序即展示顺序；为空且不在拉取中 = 整条栏不渲染 */
    options: RuneOption[]
    selectedKey: string | null
    /** 选中方案的写入状态 */
    applyState?: ApplyState
    /** 是否开启了自动应用符文 */
    autoApply?: boolean
    /** 我是否已锁定英雄——自动应用只在锁定后写入 */
    locked?: boolean
    /** 选中的正是自动任务会写的那张（且未被手动接管） */
    isAutoTarget?: boolean
    /** 选中的是我的方案 */
    remembered?: boolean
  }>(),
  { applyState: 'idle', autoApply: false, locked: false, isAutoTarget: false, remembered: false }
)

defineEmits<{
  (e: 'select', key: string): void
  (e: 'apply'): void
  (e: 'toggle-remember'): void
}>()

const assets = useRecordAssets()

const selected = computed(() => props.options.find(o => o.key === props.selectedKey) ?? null)

/** 核心三件套：取出场率最高的那组核心装 */
const coreItems = computed(() => props.build?.core_items[0]?.ids.slice(0, 3) ?? [])

// 所有方案的符文 / 符文系名字按需加载（图标走 asset 协议，不需要预取）
watch(
  () => props.options,
  opts => {
    const ids = new Set<number>()
    for (const { rune } of opts) {
      ids.add(rune.primary_style_id)
      ids.add(rune.sub_style_id)
      for (const id of [...rune.primary_perk_ids, ...rune.sub_perk_ids, ...rune.stat_mod_ids]) {
        ids.add(id)
      }
    }
    if (ids.size) assets.preload([{ kind: 'perk', ids: [...ids] }])
  },
  { immediate: true }
)

const perkName = (id: number) => assets.detailOf('perk', id)?.name ?? ''

/** 「精密 · 致命节奏」 */
function headlineOf(rune: RuneBuild): string {
  const style = perkName(rune.primary_style_id)
  const keystone = perkName(rune.primary_perk_ids[0])
  return style && keystone ? `${style} · ${keystone}` : style || keystone
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const winRateOf = (r: RuneBuild) => (r.play > 0 ? r.win / r.play : 0)

/** 「2.4万」这种中文量级；不足一万按原数，避免 0.5万 这种反直觉写法 */
function formatPlay(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : `${n}`
}

/** 卡片第二行：OP.GG 方案给出场 · 胜率；我的方案没有样本数据 */
function cardStatOf(o: RuneOption): string {
  return o.source === 'preset' ? '我的方案' : `${pct(o.rune.pick_rate)} · ${pct(winRateOf(o.rune))}`
}

/** 选中方案的依据：OP.GG 方案永远带样本量 */
const evidence = computed(() => {
  const o = selected.value
  if (!o) return ''
  if (o.source === 'preset') return '我的方案'
  const r = o.rune
  return `${pct(r.pick_rate)} 出场 · ${pct(winRateOf(r))} 胜率 · ${formatPlay(r.play)}场`
})

/** 完整符文树：主系 4 / 副系 2 / 属性 3，供 hover 查看 */
function runeRowsOf(r: RuneBuild) {
  return [
    { styleId: r.primary_style_id, perks: r.primary_perk_ids },
    { styleId: r.sub_style_id, perks: r.sub_perk_ids },
    { styleId: 0, perks: r.stat_mod_ids }
  ]
}

const APPLY_LABELS: Record<ApplyState, string> = {
  idle: '应用符文',
  applying: '应用中…',
  applied: '已应用',
  failed: '应用失败，重试'
}

/**
 * 自动应用会写的正是选中这张、且还没写：按钮退化为状态指示。还没锁定就说明「锁定后」
 * 才写，不给一个此刻不会兑现的「应用中」。选了别的卡则恢复为可点——点了即手动接管。
 */
const autoWaiting = computed(
  () => props.autoApply && props.isAutoTarget && props.applyState === 'idle'
)
const applyLabel = computed(() => {
  if (autoWaiting.value) return props.locked ? '自动应用中…' : '锁定后自动应用'
  return APPLY_LABELS[props.applyState]
})
/** 写入中防连点；自动模式等待写入时是状态指示不可点。已应用仍可再点，失败永远可重试 */
const applyDisabled = computed(() => props.applyState === 'applying' || autoWaiting.value)
</script>

<template>
  <div v-if="loading" class="build-bar build-bar-loading">
    <span class="sk build-sk-card" />
    <span class="sk build-sk-card" />
    <span class="sk build-sk-card" />
  </div>
  <div v-else-if="options.length" class="build-bar sk-reveal">
    <div class="build-cards">
      <n-tooltip v-for="o in options" :key="o.key" trigger="hover" placement="bottom-start">
        <template #trigger>
          <button
            type="button"
            class="build-card"
            :class="{
              'build-card-selected': o.key === selectedKey,
              'build-card-low': !o.sufficient
            }"
            @click="$emit('select', o.key)"
          >
            <img
              class="build-card-keystone"
              :src="assets.srcOf('perk', o.rune.primary_perk_ids[0])"
              alt=""
            />
            <span class="build-card-text">
              <span class="build-card-name">
                <span v-if="o.starred" class="build-card-star">★</span>{{ headlineOf(o.rune) }}
              </span>
              <span class="build-card-stat">
                {{ cardStatOf(o)
                }}<span v-if="!o.sufficient" class="build-card-low-tag"> · 样本少</span>
              </span>
            </span>
          </button>
        </template>
        <div class="build-rune-tree">
          <div v-for="(row, i) in runeRowsOf(o.rune)" :key="i" class="build-rune-row">
            <img
              v-if="row.styleId"
              class="build-tree-style"
              :src="assets.srcOf('perk', row.styleId)"
              alt=""
            />
            <span v-for="id in row.perks" :key="id" class="build-tree-perk">
              <img :src="assets.srcOf('perk', id)" alt="" />
              <span v-if="perkName(id)">{{ perkName(id) }}</span>
            </span>
          </div>
        </div>
      </n-tooltip>
    </div>

    <div class="build-info">
      <div v-if="coreItems.length && selected?.source === 'opgg'" class="build-items">
        <img
          v-for="id in coreItems"
          :key="id"
          class="build-item-icon"
          :src="assets.srcOf('item', id)"
          alt=""
        />
      </div>
      <span class="build-evidence">
        {{ evidence }}<template v-if="build?.stale"> · 版本 {{ build.patch }}</template>
      </span>
      <span v-if="selected && !selected.sufficient" class="build-insufficient">
        样本少，仅供参考
      </span>

      <div class="build-actions">
        <button
          type="button"
          class="build-remember"
          :class="{ 'build-remember-on': remembered }"
          @click="$emit('toggle-remember')"
        >
          {{ remembered ? '★ 已记住' : '☆ 记住' }}
        </button>
        <button
          type="button"
          class="build-apply"
          :class="`build-apply-${applyState}`"
          :disabled="applyDisabled"
          @click="$emit('apply')"
        >
          {{ applyLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.build-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  margin-top: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--glass-bg-low);
  font-size: var(--font-size-sm);
}

.build-bar-loading {
  flex-direction: row;
}

.build-sk-card {
  width: 180px;
  height: 40px;
}

/* ---- 方案卡 ---- */
.build-cards {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
}

.build-card {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 168px;
  padding: var(--space-4) var(--space-12) var(--space-4) var(--space-6);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-control);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--dur-fast) var(--ease-expo),
    opacity var(--dur-fast) var(--ease-expo);
}

.build-card:hover {
  border-color: var(--glass-border);
}

.build-card-selected,
.build-card-selected:hover {
  border-color: var(--semantic-win);
}

/* 样本少：变淡但仍可点——用户主动选即是知情选择 */
.build-card-low {
  opacity: 0.6;
}

.build-card-low.build-card-selected {
  opacity: 1;
}

.build-card-keystone {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.build-card-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.build-card-name {
  font-weight: 600;
  white-space: nowrap;
}

.build-card-star {
  color: var(--accent-gold);
  margin-right: var(--space-4);
}

.build-card-stat {
  color: var(--n-text-color-3);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.build-card-low-tag {
  color: var(--semantic-warn);
}

/* ---- 第二行：依据 + 核心装 + 操作 ---- */
.build-info {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  min-height: 28px;
}

.build-items {
  display: flex;
  gap: var(--space-4);
}

.build-item-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.build-evidence {
  color: var(--n-text-color-3);
  white-space: nowrap;
}

.build-insufficient {
  color: var(--semantic-warn);
  white-space: nowrap;
}

.build-actions {
  display: flex;
  gap: var(--space-8);
  margin-left: auto;
}

.build-remember,
.build-apply {
  padding: var(--space-2) var(--space-8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.build-remember-on {
  color: var(--accent-gold);
  border-color: var(--accent-gold);
}

.build-apply:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.build-apply-applied {
  color: var(--semantic-win);
  border-color: var(--semantic-win);
}

.build-apply-failed {
  color: var(--semantic-loss);
  border-color: var(--semantic-loss);
}

/* ---- hover 浮层：完整符文树 ---- */
.build-rune-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.build-rune-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-8);
}

.build-tree-style {
  width: 18px;
  height: 18px;
}

.build-tree-perk {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--font-size-sm);
}

.build-tree-perk img {
  width: 20px;
  height: 20px;
}
</style>
