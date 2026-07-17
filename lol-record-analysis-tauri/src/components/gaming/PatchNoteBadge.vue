<!-- 版本趋势/补丁改动徽章（双数据源）：
     1. 保底：OP.GG 跨版本排名变化（国内网络常年可用）——「版本走强/走弱」
     2. 增强：LoL Wiki 官方补丁条目（网络可达时）——方向改为官方改动判定，
        popover 追加改动明细
     两者都无 → 不渲染（零占位）。 -->
<template>
  <n-popover v-if="display" trigger="hover" placement="top" :style="{ maxWidth: '340px' }">
    <template #trigger>
      <span class="patch-badge" :class="`patch-badge-${display.kind}`">
        {{ display.label }}
      </span>
    </template>
    <div class="patch-pop">
      <div class="patch-pop-title">{{ display.title }}</div>
      <div v-if="display.trendText" class="patch-pop-trend">{{ display.trendText }}</div>
      <ul v-if="note?.lines.length" class="patch-pop-lines">
        <li v-for="(line, i) in note.lines" :key="i">{{ line }}</li>
      </ul>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NPopover } from 'naive-ui'
import {
  getChampionPatchNote,
  getCurrentPatch,
  type ChampionPatchNote
} from '@renderer/services/patchNotes'
import { getChampionMeta, type ChampionMeta, type OpggMode } from '@renderer/services/opgg'

const props = withDefaults(
  defineProps<{
    championId: number
    /** OP.GG 模式（趋势保底数据源用），默认 ranked */
    mode?: OpggMode
  }>(),
  { mode: 'ranked' }
)

/** 排名变动超过该幅度才视为「版本走强/走弱」（同分路约 60~160 个英雄） */
const RANK_DELTA_THRESHOLD = 10

const note = ref<ChampionPatchNote | null>(null)
const meta = ref<ChampionMeta | null>(null)
const patch = ref('')

async function load() {
  const id = props.championId
  if (!id || id <= 0) {
    note.value = null
    meta.value = null
    return
  }
  const [n, m, p] = await Promise.all([
    getChampionPatchNote(id),
    getChampionMeta(props.mode, id),
    getCurrentPatch()
  ])
  // 防竞态：选人期换英雄时丢弃过期结果
  if (id === props.championId) {
    note.value = n
    meta.value = m
    patch.value = p ?? ''
  }
}

watch(() => props.championId, load)
onMounted(load)

/** OP.GG 排名变动：负数 = 排名上升（走强） */
const rankDelta = computed(() => {
  const m = meta.value
  if (!m || !m.rank || !m.rankPrevPatch) return 0
  return m.rank - m.rankPrevPatch
})

interface DisplayState {
  kind: 'buff' | 'nerf' | 'adjusted'
  label: string
  title: string
  trendText: string
}

const display = computed<DisplayState | null>(() => {
  const v = patch.value ? `V${patch.value}` : '本版本'
  const trendText =
    rankDelta.value !== 0 && meta.value
      ? `OP.GG 排名 ${meta.value.rankPrevPatch} → ${meta.value.rank}（较上版本）`
      : ''

  // 官方补丁条目优先：方向可信度更高，popover 带明细
  if (note.value) {
    const kind = note.value.direction
    const label = kind === 'buff' ? '版本↑' : kind === 'nerf' ? '版本↓' : '版本改动'
    return { kind, label, title: `${v} · ${note.value.champion} · 官方改动`, trendText }
  }

  // 保底：OP.GG 跨版本排名趋势
  if (Math.abs(rankDelta.value) >= RANK_DELTA_THRESHOLD) {
    const stronger = rankDelta.value < 0
    return {
      kind: stronger ? 'buff' : 'nerf',
      label: stronger ? '版本走强' : '版本走弱',
      title: `${v} · 强度趋势`,
      trendText
    }
  }
  return null
})
</script>

<style scoped>
.patch-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-4);
  height: 16px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  cursor: default;
}

.patch-badge-buff {
  color: var(--semantic-win);
  background: color-mix(in srgb, var(--semantic-win) 14%, transparent);
}

.patch-badge-nerf {
  color: var(--semantic-loss);
  background: color-mix(in srgb, var(--semantic-loss) 12%, transparent);
}

.patch-badge-adjusted {
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 14%, transparent);
}

.patch-pop-title {
  font-weight: var(--font-weight-semibold);
  margin-bottom: var(--space-4);
}

.patch-pop-trend {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--space-4);
}

.patch-pop-lines {
  margin: 0;
  padding-left: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
}
</style>
