<template>
  <div class="ai-search-wrap">
    <!-- 原始描述 + 解析出的条件 chips(可删,删后本地重筛) -->
    <div class="ai-query-bar">
      <n-icon :size="15" class="ai-icon" :component="SparklesOutline" />
      <span class="ai-query-text">「{{ queryText }}」</span>
    </div>

    <n-flex v-if="chips.length > 0" class="chips-row" :size="6" align="center">
      <n-tag
        v-for="chip in chips"
        :key="chip.key"
        closable
        size="small"
        round
        @close="removeChip(chip.key)"
      >
        {{ chip.label }}
      </n-tag>
    </n-flex>

    <!-- 阶段态 -->
    <div v-if="phase === 'parsing'" class="phase-hint">
      <n-spin size="small" />
      <span>AI 正在理解你的描述…</span>
    </div>
    <div v-else-if="phase === 'fetching'" class="phase-hint">
      <n-spin size="small" />
      <span>
        正在检索战绩,已翻 {{ progress.fetched }} 局<template v-if="oldestDateCn"
          >,覆盖至 {{ oldestDateCn }}</template
        >…
      </span>
    </div>
    <n-empty v-else-if="phase === 'error'" :description="error" class="phase-empty">
      <template #extra>
        <n-button size="small" @click="retry">重试</n-button>
      </template>
    </n-empty>

    <template v-else-if="phase === 'done'">
      <!-- 搜索范围说明 -->
      <div class="meta-line">{{ metaLineCn }}</div>

      <!-- 相遇统计答案卡(count 意图) -->
      <div v-if="encounterStats" class="encounter-card">
        <div class="encounter-total">共相遇 {{ encounterStats.total }} 局</div>
        <div v-for="(c, name) in encounterStats.perName" :key="name" class="encounter-row">
          <span class="encounter-name">{{ name }}</span>
          <span>同队 {{ c.ally }} 次 / 对面 {{ c.enemy }} 次</span>
        </div>
      </div>

      <!-- 结果列表(复用战绩卡) -->
      <n-empty
        v-if="results.length === 0 && !encounterStats"
        description="没有找到匹配的对局"
        class="phase-empty"
      />
      <TransitionGroup v-else name="list" tag="div" class="ai-result-list">
        <div
          v-for="(game, index) in results"
          :key="game.gameId"
          :style="{ '--stagger-i': index }"
          class="list-item"
        >
          <RecordCard :record-type="true" :games="game" @open-detail="openDetail(game)" />
        </div>
      </TransitionGroup>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 自然语言搜战绩的结果视图(issue #157)
 *
 * Record 页在 route.query.aiq 存在时渲染本组件替代 MatchHistory。
 * 管线状态由 useAiMatchSearch 驱动;条件 chips 可删除(本地重筛),
 * 让用户看见并能修正 AI 的理解。
 */

import { computed, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { SparklesOutline } from '@vicons/ionicons5'
import RecordCard from './RecordCard.vue'
import { openMatchDetailWindow } from './detailWindow'
import { collectAssetIds } from './collectAssetIds'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'
import { useAiMatchSearch } from '@renderer/composables/useAiMatchSearch'
import { initModeOptions } from '@renderer/composables/useGameModes'
import { clearParseCache } from '@renderer/services/ai/matchSearch/parse'
import type { Game } from '@renderer/types/domain/match'

const route = useRoute()
const queryText = computed(() => (route.query.aiq as string) ?? '')

const { phase, error, progress, chips, results, encounterStats, meta, run, removeChip } =
  useAiMatchSearch()

// 与 MatchHistory 相同的父级资产预载模式
const recordAssets = useRecordAssets()
provide(recordAssetsKey, recordAssets)
watch(results, games => {
  const { items, spells, perks } = collectAssetIds(games)
  recordAssets.preload([
    { kind: 'item', ids: items },
    { kind: 'spell', ids: spells },
    { kind: 'perk', ids: perks }
  ])
})

/** 拉取进度里最旧对局日期的短格式(几月几日) */
const oldestDateCn = computed(() => {
  if (!progress.value.oldestDate) return ''
  const d = new Date(progress.value.oldestDate)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}月${d.getDate()}日`
})

/** done 态的搜索范围整句文案(computed 拼接,避免模板断行产生多余空格) */
const metaLineCn = computed(() => {
  const scope =
    meta.value?.source === 'lcu'
      ? '最近 50 局(跨区服务不可用,已降级)'
      : `最近 ${meta.value?.searchedCount ?? 0} 局`
  const truncated = meta.value?.truncated ? ';已达检索上限,更早的对局未包含' : ''
  return `已在${scope}中搜索,命中 ${results.value.length} 局${truncated}`
})

async function openDetail(game: Game): Promise<void> {
  await openMatchDetailWindow(game)
}

/** 错误重试:清掉这句的解析缓存(坏缓存会让重试原地失败)再跑一遍 */
function retry(): void {
  clearParseCache(queryText.value)
  if (queryText.value) run(queryText.value)
}

// aiq 变化(新搜索)即重跑;initModeOptions 为 chips 的队列名兜底
watch(
  queryText,
  async text => {
    if (!text) return
    await initModeOptions()
    run(text)
  },
  { immediate: true }
)
</script>

<style lang="css" scoped>
.ai-search-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  width: 100%;
}

.ai-query-bar {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  color: var(--text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.ai-icon {
  color: var(--accent-gold, #c8aa6e);
  flex-shrink: 0;
}

.ai-query-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chips-row {
  flex-wrap: wrap;
}

.phase-hint {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  padding: var(--space-16) 0;
}

.phase-empty {
  padding: var(--space-24) 0;
}

.meta-line {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.encounter-card {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-low);
  padding: var(--space-12) var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.encounter-total {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
}

.encounter-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-12);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.encounter-name {
  font-weight: 600;
  color: var(--text-primary);
}

.ai-result-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.list-enter-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
  transition-delay: calc(var(--stagger) * var(--stagger-i, 0));
}

.list-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.list-move {
  transition: transform var(--dur-normal) var(--ease-expo);
}
</style>
