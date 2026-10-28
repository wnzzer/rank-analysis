<script setup lang="ts">
/** 英雄对位内页；不读取召唤师隐私，不触发选人或锁定动作。 */
import { computed, inject, onMounted, ref } from 'vue'
import { NButton, NSelect, NSkeleton, NTooltip } from 'naive-ui'
import { MATCHUP_API, MATCHUP_POSITIONS, matchupApi } from '@renderer/services/matchup'
import { TIER_OPTIONS, type OpggTier } from '@renderer/services/opgg'
import { useMatchup, MATCHUP_SMALL_SAMPLE } from '@renderer/composables/useMatchup'
import type { MatchupEnemy, MatchupPosition, MatchupSource } from '@renderer/types/matchup'
import MatchupAvatar from './MatchupAvatar.vue'

const props = withDefaults(
  defineProps<{
    /** 本局敌方公开英雄及稳定槽位。 */
    enemies: MatchupEnemy[]
    /** 当前选中的槽位。 */
    selectedSlot: number
    /** 与 Gaming 共用的当前统计段位。 */
    tier: OpggTier
    /** 段位切换期间禁止重复提交，暂停展示旧数据。 */
    tierLoading?: boolean
    /** 已禁用或已被选择的英雄 ID；只标记，不自动筛除。 */
    unavailableIds?: number[]
    /** 是否位于可见选人内页。 */
    active: boolean
  }>(),
  { tierLoading: false, unavailableIds: () => [] }
)
const emit = defineEmits<{
  /** 返回保留的玩家战绩页面。 */
  (event: 'back'): void
  /** 选择另一个敌方槽位。 */
  (event: 'select-slot', slot: number): void
  /** 请求父页面统一切换段位，不在本组件保存配置。 */
  (event: 'change-tier', tier: OpggTier): void
}>()
const api = inject(MATCHUP_API, matchupApi)
/** 浏览器打开失败时在来源区反馈，不依赖额外消息容器。 */
const sourceOpenError = ref('')
const namesRevision = ref(0)
const enemy = computed(() => props.enemies.find(item => item.slot === props.selectedSlot))
const model = useMatchup(
  () => ({
    slot: props.selectedSlot,
    enemyId: enemy.value?.championId ?? 0,
    tier: props.tier,
    active: props.active && !props.tierLoading
  }),
  api
)
const { position, manual, tab, page, list, loading, error, rows, sorted, totalPages } = model
const busy = computed(() => loading.value || props.tierLoading)
const tierOptions = [...TIER_OPTIONS]
const positionOptions = [...MATCHUP_POSITIONS]
const sourceText = computed(() => (list.value ? sourceTime(list.value) : ''))
/** 来源入口跟随当前英雄、分路、段位；未知别名时明确回退到英雄库。 */
const sourceUrl = computed(() => {
  void namesRevision.value
  return position.value
    ? api.sourceUrl?.(enemy.value?.championId ?? 0, position.value, props.tier)
    : null
})

/** 正式应用通过系统浏览器打开来源，避免 WebView 新窗口行为不一致。
 * @param event 来源链接点击事件；普通浏览器演示保持原链接行为。
 */
async function openSource(event: MouseEvent): Promise<void> {
  if (!api.openSource) return
  event.preventDefault()
  sourceOpenError.value = ''
  try {
    await api.openSource(sourceUrl.value || 'https://op.gg/lol/champions')
  } catch {
    sourceOpenError.value = '无法打开浏览器，请重试来源链接。'
  }
}

/** 响应中文名加载完成，重绘当前使用的占位名。
 * @param id 英雄 ID。
 * @returns 已加载中文名或 ID 占位。
 */
function name(id: number): string {
  void namesRevision.value
  return api.name(id)
}
/** 格式化有效比例，保留真实零胜率。
 * @param value 0..1 比例或缺失值。
 * @returns 百分比文本或暂无数据。
 */
function percent(value?: number | null): string {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 1
    ? `${(value * 100).toFixed(1)}%`
    : '暂无数据'
}
/** 展示来源时间与版本，不伪造服务器未提供的统计更新时间。
 * @param source 列表或详情自身的来源信息。
 * @returns 可读来源说明。
 */
function sourceTime(source: MatchupSource): string {
  const sourceDate = source.cachedAt ? new Date(source.cachedAt) : null
  const date =
    sourceDate && Number.isFinite(sourceDate.getTime())
      ? sourceDate.toLocaleString('zh-CN')
      : source.cachedAt || '源未提供更新时间'
  return `${source.version} · ${date}${source.stale ? ' · 过期缓存' : ''}`
}
/** 修正分路，不把空选项当成默认中路。
 * @param value 控件选择的分路。
 */
function changePosition(value: MatchupPosition): void {
  model.setPosition(value)
}
onMounted(async () => {
  await api.loadNames()
  namesRevision.value++
})
</script>

<template>
  <section class="matchup-panel" aria-label="英雄对位分析">
    <div class="matchup-breadcrumb">
      <n-button text size="tiny" data-back @click="emit('back')">← 返回玩家战绩</n-button>
      <span>/ 英雄对位</span><span v-if="api.demo" class="demo-label">演示数据</span>
    </div>
    <div class="matchup-enemies" aria-label="选择敌方英雄">
      <button
        v-for="item in enemies"
        :key="item.slot"
        type="button"
        class="enemy-choice"
        :aria-pressed="selectedSlot === item.slot"
        :aria-label="item.championId ? `分析${name(item.championId)}` : '尚未选择英雄'"
        :disabled="!item.championId"
        @click="emit('select-slot', item.slot)"
      >
        <MatchupAvatar
          v-if="item.championId"
          :src="api.icon(item.championId)"
          :name="name(item.championId)"
          :size="26"
        />
        <span>{{ item.championId ? name(item.championId) : '未选择' }}</span>
      </button>
    </div>
    <div class="matchup-target">
      <MatchupAvatar
        v-if="enemy?.championId"
        :src="api.icon(enemy.championId)"
        :name="name(enemy.championId)"
        :size="38"
      />
      <div class="target-copy">
        <strong>{{
          enemy?.championId ? `如何应对 ${name(enemy.championId)}` : '等待敌方选择英雄'
        }}</strong>
        <small
          >{{ manual ? '手动分路' : position ? '分路推测，可调整' : '无法推测时请手动选择分路'
          }}<template v-if="enemy?.pickState && enemy.pickState !== 'locked'">
            · 选择中</template
          ></small
        >
      </div>
      <n-select
        class="position-select"
        aria-label="对位分路"
        size="small"
        :value="position"
        :options="positionOptions"
        placeholder="选择分路"
        :disabled="!enemy?.championId"
        @update:value="changePosition"
      />
    </div>
    <div class="matchup-filters">
      <label>统计段位</label>
      <n-select
        class="tier-select"
        aria-label="对位统计段位"
        size="small"
        :value="tier"
        :options="tierOptions"
        :loading="tierLoading"
        :disabled="tierLoading"
        @update:value="emit('change-tier', $event)"
      />
      <n-tooltip
        ><template #trigger><span class="source-scope">OP.GG · 全球</span></template
        >与本页 OP.GG 段位同步；“以上”包含更高段位。</n-tooltip
      >
    </div>
    <div class="matchup-tabs" role="group" aria-label="推荐类型">
      <div class="tab-track" :class="{ 'show-bad': tab === 'bad' }">
        <span class="tab-indicator" aria-hidden="true"></span>
        <button type="button" :aria-pressed="tab === 'good'" @click="tab = 'good'">推荐应对</button>
        <button type="button" :aria-pressed="tab === 'bad'" @click="tab = 'bad'">谨慎选择</button>
      </div>
      <n-tooltip
        ><template #trigger><small class="sort-note">候选英雄视角 ⓘ</small></template
        >按敌方列表胜率排序；下方比率使用候选自身详情，源缓存时间可能不同。少于200局置后提示。</n-tooltip
      >
    </div>
    <div class="matchup-table-head">
      <span>候选英雄</span><span>对位胜率</span
      ><n-tooltip
        ><template #trigger><span tabindex="0">线杀率 ⓘ</span></template
        >对线阶段击杀或助攻相关比例，并非单杀率；打野不适用。</n-tooltip
      ><span>对局数</span>
    </div>
    <div class="matchup-results" :aria-busy="busy" :class="{ 'is-bad': tab === 'bad' }">
      <template v-if="busy"
        ><div v-for="i in 4" :key="i" class="row-skeleton">
          <n-skeleton width="32px" height="32px" /><n-skeleton text /><n-skeleton text /><n-skeleton
            text
          /></div
      ></template>
      <div v-else-if="error" class="matchup-state" role="status">
        <p>{{ error }}</p>
        <n-button size="small" @click="model.reload">重新获取</n-button>
      </div>
      <div v-else-if="!enemy?.championId || !position" class="matchup-state">
        {{ !enemy?.championId ? '敌方尚未选择英雄' : '请选择要分析的分路' }}
      </div>
      <div v-else-if="!rows.length" class="matchup-state">
        当前分路和段位暂无{{ tab === 'good' ? '推荐应对' : '谨慎选择' }}数据
      </div>
      <template v-else>
        <div
          v-for="row in rows"
          :key="`${list?.enemyId}-${list?.tier}-${list?.position}-${row.championId}`"
          class="matchup-row"
          :class="{ unavailable: unavailableIds.includes(row.championId) }"
        >
          <div class="candidate-name">
            <MatchupAvatar :src="api.icon(row.championId)" :name="name(row.championId)" />
            <div>
              <strong :title="name(row.championId)">{{ name(row.championId) }}</strong
              ><small v-if="unavailableIds.includes(row.championId)">已选 / 已禁用</small>
            </div>
          </div>
          <template v-if="row.loading"
            ><n-skeleton text /><n-skeleton text /><n-skeleton text
          /></template>
          <div v-else-if="row.error" class="row-error">
            <span>暂时无法获取</span
            ><n-button text size="tiny" @click="model.loadDetails">重试</n-button>
          </div>
          <template v-else
            ><n-tooltip
              ><template #trigger
                ><span class="candidate-rate" tabindex="0">{{
                  percent(row.data?.candidateWinRate)
                }}</span></template
              >{{ row.data ? sourceTime(row.data) : '暂无数据' }}</n-tooltip
            >
            <span>{{ position === 'jungle' ? '不适用' : percent(row.data?.laneKillRate) }}</span>
            <span class="sample-count"
              >{{ row.data?.play?.toLocaleString() ?? '—'
              }}<small v-if="row.data?.play != null && row.data.play < MATCHUP_SMALL_SAMPLE"
                >小样本</small
              ><small v-if="row.data?.stale">过期</small></span
            >
          </template>
        </div>
      </template>
    </div>
    <div v-if="sorted.length > 8 && !busy" class="matchup-pagination">
      <n-button size="tiny" :disabled="page <= 1" @click="page--">上一页</n-button
      ><span>{{ page }} / {{ totalPages }}</span
      ><n-button size="tiny" :disabled="page >= totalPages" @click="page++">下一页</n-button>
    </div>
    <footer class="matchup-footer">
      <span :title="sourceText" role="status">{{
        sourceOpenError || (api.demo ? '示例数据 · 非真实统计' : sourceText || '数据来源：OP.GG')
      }}</span
      ><a
        :href="sourceUrl || 'https://op.gg/lol/champions'"
        target="_blank"
        rel="noopener noreferrer"
        @click="openSource"
        >{{ sourceUrl ? 'OP.GG 对位页 ↗' : 'OP.GG 英雄库 ↗' }}</a
      >
    </footer>
  </section>
</template>

<style scoped>
.matchup-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  color: var(--text-primary);
}
.matchup-breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
}
.demo-label {
  margin-left: auto;
  color: var(--semantic-warn);
}
.matchup-enemies {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-8) var(--space-12);
}
.enemy-choice {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--dur-fast),
    border-color var(--dur-fast),
    color var(--dur-fast);
}
.enemy-choice span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-size-2xs);
}
.enemy-choice[aria-pressed='true'] {
  background: color-mix(in srgb, var(--semantic-win) 12%, transparent);
  border-color: var(--semantic-win);
  color: var(--text-primary);
}
.enemy-choice:hover:not(:disabled) {
  background: var(--bg-elevated);
}
.enemy-choice:disabled {
  opacity: 0.4;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--semantic-win);
  outline-offset: 2px;
}
.matchup-target {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-12) var(--space-8);
}
.target-copy {
  flex: 1;
  min-width: 0;
}
.target-copy strong {
  display: block;
  font-size: var(--font-size-md);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.target-copy small {
  display: block;
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  margin-top: var(--space-2);
}
.position-select {
  width: 88px;
  flex-shrink: 0;
}
.tier-select {
  width: 126px;
}
.matchup-filters {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-12);
  border-block: 1px solid var(--border-subtle);
  font-size: var(--font-size-xs);
}
.matchup-filters label {
  color: var(--text-secondary);
}
.source-scope {
  margin-left: auto;
  color: var(--text-tertiary);
  white-space: nowrap;
  font-size: var(--font-size-2xs);
}
.matchup-tabs {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-8) var(--space-12) var(--space-4);
  gap: var(--space-4);
}
.tab-track {
  position: relative;
  display: flex;
  padding: 3px;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.tab-track button {
  position: relative;
  z-index: 1;
  border: 0;
  background: none;
  color: var(--text-secondary);
  width: 86px;
  padding: 5px 4px;
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: color var(--dur-fast);
}
.tab-track button[aria-pressed='true'] {
  color: var(--semantic-win);
}
.tab-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: 86px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--semantic-win) 12%, transparent);
  transition: transform var(--dur-normal) var(--ease-out-expo);
}
.show-bad .tab-indicator {
  transform: translateX(86px);
}
.sort-note {
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}
.matchup-table-head,
.matchup-row {
  display: grid;
  grid-template-columns: minmax(90px, 1.5fr) 1fr 1fr 0.8fr;
  align-items: center;
  gap: var(--space-8);
  text-align: right;
}
.matchup-table-head {
  padding: var(--space-6) var(--space-12);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.matchup-table-head > span:first-child {
  text-align: left;
}
.matchup-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overflow-anchor: none;
  padding: 0 var(--space-12);
  scrollbar-width: thin;
}
.matchup-row {
  min-height: 54px;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  animation: matchup-row-in var(--dur-fast) ease-out;
}
.candidate-name {
  display: flex;
  gap: var(--space-8);
  align-items: center;
  text-align: left;
  min-width: 0;
}
.candidate-name > div {
  min-width: 0;
}
.candidate-name strong {
  display: block;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.candidate-name small {
  display: block;
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}
.candidate-rate {
  color: var(--semantic-win);
  font-weight: var(--font-weight-semibold);
}
.is-bad .candidate-rate {
  color: var(--semantic-loss);
}
.sample-count small {
  display: block;
  font-size: var(--font-size-2xs);
  color: var(--semantic-warn);
}
.unavailable .candidate-name {
  opacity: 0.6;
}
.row-error {
  grid-column: 2 / -1;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
  color: var(--text-tertiary);
}
.row-skeleton {
  display: grid;
  grid-template-columns: 32px 1fr 1fr 1fr;
  gap: var(--space-12);
  align-items: center;
  height: 54px;
}
.matchup-state {
  min-height: 130px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--space-12);
  color: var(--text-secondary);
  text-align: center;
  font-size: var(--font-size-sm);
}
.matchup-state p {
  margin: 0;
}
.matchup-footer,
.matchup-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.matchup-footer > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.matchup-footer a {
  color: var(--semantic-win);
  white-space: nowrap;
}
.matchup-pagination {
  justify-content: center;
}
.matchup-panel > *:not(.matchup-results) {
  flex-shrink: 0;
}
@keyframes matchup-row-in {
  from {
    opacity: 0.4;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 1100px) {
  .enemy-choice {
    flex-direction: column;
  }
  .source-scope,
  .sort-note {
    display: none;
  }
  .matchup-table-head,
  .matchup-row {
    gap: var(--space-4);
  }
  .candidate-name {
    gap: var(--space-4);
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
  .row-skeleton :deep(*) {
    animation: none !important;
  }
}
</style>
