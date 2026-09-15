<script setup lang="ts">
/**
 * 选人期推荐符文栏
 *
 * 单行：主系 + 基石 · 核心三件套 · 依据（出场率 / 胜率 / 样本量）。hover 符文块看完整
 * 9 个符文。依据永远带样本量——与项目「数据可验证」的一贯风格一致，样本不足时明说。
 *
 * 纯展示组件：取数与写入状态由 useChampionBuild 负责，点击只发出 `apply`。
 */
import { computed, watch } from 'vue'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import type { ApplyState } from '@renderer/composables/useChampionBuild'
import { pickRecommendedRune } from '@renderer/services/championBuild'
import type { ChampionBuild } from '@renderer/types/championBuild'

const props = withDefaults(
  defineProps<{
    /** 推荐构筑；null 且不在拉取中 = 无数据，整条栏不渲染 */
    build: ChampionBuild | null
    loading: boolean
    /** 符文写入状态 */
    applyState?: ApplyState
  }>(),
  { applyState: 'idle' }
)

defineEmits<{ (e: 'apply'): void }>()

const APPLY_LABELS: Record<ApplyState, string> = {
  idle: '应用符文',
  applying: '应用中…',
  applied: '已应用',
  failed: '应用失败，重试'
}

const assets = useRecordAssets()

const recommended = computed(() => pickRecommendedRune(props.build))
const rune = computed(() => recommended.value.rune)

/** 样本不足不让写；写入中防连点。已应用仍可再点（用户手动切走后想切回来） */
const applyDisabled = computed(
  () => !recommended.value.sufficient || props.applyState === 'applying'
)

/** 核心三件套：取出场率最高的那组核心装 */
const coreItems = computed(() => props.build?.core_items[0]?.ids.slice(0, 3) ?? [])

// 符文 / 符文系名字按需加载（图标走 asset 协议，不需要预取）
watch(
  rune,
  r => {
    if (!r) return
    assets.preload([
      {
        kind: 'perk',
        ids: [r.primary_style_id, r.sub_style_id, ...r.primary_perk_ids, ...r.sub_perk_ids]
      }
    ])
  },
  { immediate: true }
)

const perkName = (id: number) => assets.detailOf('perk', id)?.name ?? ''

const headline = computed(() => {
  const r = rune.value
  if (!r) return ''
  const style = perkName(r.primary_style_id)
  const keystone = perkName(r.primary_perk_ids[0])
  return style && keystone ? `${style} · ${keystone}` : style || keystone
})

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** 「2.4万」这种中文量级；不足一万按原数，避免 0.5万 这种反直觉写法 */
function formatPlay(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : `${n}`
}

const evidence = computed(() => {
  const r = rune.value
  if (!r) return ''
  const winRate = r.play > 0 ? r.win / r.play : 0
  return `${pct(r.pick_rate)} 出场 · ${pct(winRate)} 胜率 · ${formatPlay(r.play)}场`
})

/** 完整符文树：主系 4 / 副系 2 / 属性 3，供 hover 查看 */
const runeRows = computed(() => {
  const r = rune.value
  if (!r) return []
  return [
    { styleId: r.primary_style_id, perks: r.primary_perk_ids },
    { styleId: r.sub_style_id, perks: r.sub_perk_ids },
    { styleId: 0, perks: r.stat_mod_ids }
  ]
})
</script>

<template>
  <div v-if="loading" class="build-bar build-bar-loading">
    <span class="sk build-sk-icon" />
    <span class="sk build-sk-icon" />
    <span class="sk build-sk-line" />
  </div>
  <div v-else-if="build && rune" class="build-bar sk-reveal">
    <n-tooltip trigger="hover" placement="bottom-start">
      <template #trigger>
        <div class="build-runes">
          <img class="build-style-icon" :src="assets.srcOf('perk', rune.primary_style_id)" alt="" />
          <img
            class="build-keystone-icon"
            :src="assets.srcOf('perk', rune.primary_perk_ids[0])"
            alt=""
          />
          <span class="build-rune-name">{{ headline }}</span>
        </div>
      </template>
      <div class="build-rune-tree">
        <div v-for="(row, i) in runeRows" :key="i" class="build-rune-row">
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

    <div v-if="coreItems.length" class="build-items">
      <img
        v-for="id in coreItems"
        :key="id"
        class="build-item-icon"
        :src="assets.srcOf('item', id)"
        alt=""
      />
    </div>

    <span class="build-evidence">
      {{ evidence }}<template v-if="build.stale"> · 版本 {{ build.patch }}</template>
    </span>
    <span v-if="!recommended.sufficient" class="build-insufficient">样本不足，仅供参考</span>

    <button
      type="button"
      class="build-apply"
      :class="`build-apply-${applyState}`"
      :disabled="applyDisabled"
      @click="$emit('apply')"
    >
      {{ APPLY_LABELS[applyState] }}
    </button>
  </div>
</template>

<style scoped>
.build-bar {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-6) var(--space-12);
  margin-top: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--glass-bg-low);
  font-size: var(--font-size-sm);
  min-height: 36px;
  box-sizing: border-box;
}

.build-sk-icon {
  width: 22px;
  height: 22px;
}

.build-sk-line {
  width: 240px;
  height: 12px;
}

.build-runes {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  cursor: default;
}

.build-style-icon {
  width: 18px;
  height: 18px;
  opacity: 0.85;
}

.build-keystone-icon {
  width: 24px;
  height: 24px;
}

.build-rune-name {
  font-weight: 600;
  margin-left: var(--space-4);
  white-space: nowrap;
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
  color: var(--semantic-loss);
  white-space: nowrap;
}

.build-apply {
  margin-left: auto;
  padding: var(--space-2) var(--space-8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: var(--font-size-sm);
  white-space: nowrap;
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
