<template>
  <n-popover
    trigger="hover"
    placement="right-start"
    :width="360"
    :show-arrow="false"
    :disabled="disabled"
  >
    <template #trigger>
      <slot />
    </template>
    <div class="counter-hover">
      <div class="counter-hover-header">
        <span class="counter-hover-title">{{ title }}</span>
      </div>

      <div v-if="isLoading" class="counter-hover-hint counter-hover-loading">正在加载对位数据…</div>
      <div v-else-if="error" class="counter-hover-hint counter-hover-error">
        OP.GG 数据未就绪（需联网拉取或等待重试）
      </div>
      <div v-else-if="rows.length === 0 && synergyRows.length === 0" class="counter-hover-hint">
        该分路对位样本不足（OP.GG 暂无数据）
      </div>
      <n-scrollbar
        v-else
        max-height="400px"
        class="counter-hover-scroll"
        :class="{ 'counter-hover-scroll-split': rows.length > 0 && synergyRows.length > 0 }"
      >
        <table v-if="rows.length > 0" class="counter-hover-table">
          <thead>
            <tr>
              <th class="ch-col">英雄</th>
              <th
                v-for="col in sortableCols"
                :key="col.key"
                class="sort-col"
                :class="{ 'sort-active': sortKey === col.key }"
                @click="toggleSort(col.key)"
              >
                {{ col.label
                }}<span v-if="sortKey === col.key" class="sort-arrow">{{
                  sortDir === 'desc' ? ' ▼' : ' ▲'
                }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in rows" :key="c.championId">
              <td class="ch-col">
                <img class="ch-avatar" :src="getChampionUrl(c.championId)" alt="" />
                <span class="ch-name">{{ championName(c.championId) }}</span>
              </td>
              <td :class="wrClass(c.winRate)">{{ formatWinRate(c.winRate) }}</td>
              <td>{{ c.play }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="synergyRows.length > 0" class="counter-hover-section">
          <div class="counter-hover-subtitle">最佳搭档</div>
          <table class="counter-hover-table">
            <thead>
              <tr>
                <th class="ch-col">英雄</th>
                <th
                  v-for="col in synergySortableCols"
                  :key="col.key"
                  class="sort-col"
                  :class="{ 'sort-active': synergySortKey === col.key }"
                  @click="toggleSynergySort(col.key)"
                >
                  {{ col.label
                  }}<span v-if="synergySortKey === col.key" class="sort-arrow">{{
                    synergySortDir === 'desc' ? ' ▼' : ' ▲'
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in synergyRows" :key="s.synergyChampionId">
                <td class="ch-col">
                  <img class="ch-avatar" :src="getChampionUrl(s.synergyChampionId)" alt="" />
                  <span class="ch-name">{{ championName(s.synergyChampionId) }}</span>
                </td>
                <td :class="wrClass(s.winRate)">{{ formatWinRate(s.winRate) }}</td>
                <td>{{ s.play }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </n-scrollbar>

      <div class="counter-hover-footer">
        OP.GG {{ intel?.region ?? '—' }} · {{ intel?.tier ?? '—' }} · {{ patchText
        }}<span v-if="intel?.stale" class="footer-stale"> · 数据可能过期</span>
      </div>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
/**
 * 选人期对位弹窗（P1）：悬浮任意已见英雄头像，展示该英雄该位置的全量对位列表
 * 与最佳搭档节（V1.1，synergies 数据同源同命令返回）。
 *
 * 数据来自后端 `get_champion_intel`（Akari 端点直连，磁盘 12h 缓存 + stale 降级），
 * 取数细节见 `useCounterIntel`（150ms 防抖 + 模块级缓存 + `opggRevision` 失效）。
 * 对位与搭档两个表格各自独立排序：胜率/场次表头可点击，当前列显示箭头，
 * 点击未排序列默认降序。
 * 底部固定来源标注（region · tier · patch · stale 标记），防数据口径误导。
 */
import { computed, onMounted, ref, toRef } from 'vue'
import { NPopover, NScrollbar } from 'naive-ui'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import {
  DEFAULT_COUNTER_SORT,
  DEFAULT_SYNERGY_SORT,
  type CounterSortDir,
  type CounterSortKey,
  type SynergySortDir,
  type SynergySortKey
} from '@renderer/services/counterIntel'
import {
  sortedCounters,
  sortedSynergies,
  useCounterIntel
} from '@renderer/composables/useCounterIntel'
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import { formatWinRate } from './championIntel'
import { getOpggStatus } from '@renderer/services/opgg'

const props = withDefaults(
  defineProps<{
    championId: number
    /** LCU 分路命名（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）；空 = 未知，不发请求 */
    position?: string
    /** OP.GG 段位分段（emerald_plus 等），来自 useOpggTier */
    tier: string
  }>(),
  { position: '' }
)

const { getChampionUrl } = useAssetUrl()
const { intel, isLoading, error } = useCounterIntel(
  toRef(props, 'championId'),
  toRef(props, 'position'),
  toRef(props, 'tier')
)

/** 位置未知或英雄无效时禁用弹窗（不产出空壳） */
const disabled = computed(() => !props.championId || props.championId <= 0 || !props.position)

const sortKey = ref<CounterSortKey>(DEFAULT_COUNTER_SORT.key)
const sortDir = ref<CounterSortDir>(DEFAULT_COUNTER_SORT.dir)

const rows = computed(() => sortedCounters(intel.value, sortKey.value, sortDir.value))

const sortableCols: { key: CounterSortKey; label: string }[] = [
  { key: 'winRate', label: '胜率' },
  { key: 'play', label: '场次' }
]

/** 点击表头：同列翻转方向，未排序列默认降序 */
function toggleSort(key: CounterSortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

const synergySortKey = ref<SynergySortKey>(DEFAULT_SYNERGY_SORT.key)
const synergySortDir = ref<SynergySortDir>(DEFAULT_SYNERGY_SORT.dir)

const synergyRows = computed(() =>
  sortedSynergies(intel.value, synergySortKey.value, synergySortDir.value)
)

const synergySortableCols: { key: SynergySortKey; label: string }[] = [
  { key: 'winRate', label: '胜率' },
  { key: 'play', label: '场次' }
]

/** 搭档表头点击：同列翻转方向，未排序列默认降序 */
function toggleSynergySort(key: SynergySortKey): void {
  if (synergySortKey.value === key) {
    synergySortDir.value = synergySortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    synergySortKey.value = key
    synergySortDir.value = 'desc'
  }
}

/** 胜率着色：>52% 绿 / 48-52% 中性 / <48% 红 */
function wrClass(rate: number): string {
  if (rate > 0.52) return 'wr-good'
  if (rate < 0.48) return 'wr-bad'
  return ''
}

/** 弹窗标题：英雄名 · 分路（无名字时退回英雄 ID） */
const title = computed(() => {
  const name = championName(props.championId)
  return `${name} · ${props.position}`
})

/** 英雄名缓存：接口列表可能含不在快照里的英雄，防白名 */
const namesLoaded = ref(false)

function championName(id: number): string {
  if (!namesLoaded.value) return `${id}`
  return getChampionName(id) || `英雄 ${id}`
}

/** 来源标注的 patch：复用 OP.GG 快照的 patch 字段（拉取失败显示占位符） */
const patchText = ref('—')

onMounted(async () => {
  const [status] = await Promise.all([getOpggStatus('ranked'), loadChampionNames()])
  namesLoaded.value = true
  patchText.value = status?.patch ?? '—'
})
</script>

<style scoped>
.counter-hover {
  font-size: 12px;
  color: var(--text-primary, inherit);
}

.counter-hover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.counter-hover-title {
  font-weight: 700;
}

.counter-hover-hint {
  padding: 10px 0;
  color: var(--text-tertiary, rgba(128, 128, 128, 0.8));
}

.counter-hover-loading {
  color: var(--text-tertiary, rgba(128, 128, 128, 0.8));
}

.counter-hover-error {
  color: var(--semantic-loss, #d03050);
}

.counter-hover-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.counter-hover-section {
  margin-top: 10px;
}

.counter-hover-scroll-split .counter-hover-section {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.18);
}

.counter-hover-subtitle {
  font-weight: 700;
  margin-bottom: 4px;
}

.counter-hover-table th,
.counter-hover-table td {
  padding: 4px 6px;
  text-align: right;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
  white-space: nowrap;
}

.counter-hover-table .ch-col {
  text-align: left;
}

.counter-hover-table th {
  font-weight: 600;
  opacity: 0.75;
}

.sort-col {
  cursor: pointer;
  user-select: none;
}

.sort-active {
  opacity: 1;
  font-weight: 700;
}

.sort-arrow {
  font-size: 10px;
}

.ch-col {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ch-avatar {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  flex-shrink: 0;
}

.ch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.wr-good {
  color: var(--semantic-win, #18a058);
  font-weight: 600;
}

.wr-bad {
  color: var(--semantic-loss, #d03050);
  font-weight: 600;
}

.counter-hover-footer {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  font-size: 11px;
  opacity: 0.6;
}

.footer-stale {
  color: var(--semantic-warn, #d08770);
  opacity: 1;
}
</style>
