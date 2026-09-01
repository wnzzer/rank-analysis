<template>
  <div class="super-search" @keydown="onKeydown">
    <n-input
      ref="inputRef"
      class="input-lolid header-search"
      type="text"
      size="small"
      placeholder="召唤师名#Tag / 描述战绩"
      v-model:value="searchValue"
      @focus="focused = true"
      @blur="focused = false"
    >
      <!-- 前缀:大区下拉(框内左侧,细分隔线隔开),整体仍是一个搜索框 -->
      <template #prefix>
        <n-dropdown
          trigger="click"
          size="small"
          :options="regionDropdownOptions"
          @select="onRegionSelect"
        >
          <button class="region-trigger" type="button" @mousedown.prevent>
            <span class="region-trigger-label">{{ selectedRegionLabel }}</span>
            <n-icon :size="11" class="region-trigger-caret"><ChevronDownOutline /></n-icon>
          </button>
        </n-dropdown>
        <span class="region-divider" />
      </template>
      <template #suffix>
        <n-button text quaternary @click="executeActive" class="header-icon-btn">
          <n-icon :component="Search" />
        </n-button>
      </template>
    </n-input>

    <!-- 候选面板:聚焦且有输入时展示;mousedown.prevent 防止点击前 input 先失焦 -->
    <Transition name="panel-fade">
      <div v-if="panelVisible" class="suggest-panel" @mousedown.prevent>
        <div
          v-for="(row, i) in rows"
          :key="row.key"
          class="suggest-row"
          :class="{ active: i === activeIndex, 'ai-row': row.kind === 'ai' }"
          @mouseenter="activeIndex = i"
          @click="executeRow(row)"
        >
          <n-icon :size="12" class="row-icon" :component="rowIcon(row)" />
          <span class="row-label">{{ row.label }}</span>
          <span v-if="row.badge" class="row-badge">{{ row.badge }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * Header 超级搜索(omnibox)
 *
 * 三种行为合一(issue #157):
 * - 精确查人:输入形似 Riot ID(名#tag)→ 现有 Record 查询流程
 * - 模糊查人:本地候选(好友/备注/搜索历史)子串匹配,点选即精确查询
 * - AI 搜战绩:任意自然语言 → 跳 Record 页 AI 解析(?aiq=)
 *
 * 回车执行当前高亮行,默认高亮:精确行 > 首个玩家候选 > AI 行。
 */

import { computed, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  Search,
  ChevronDownOutline,
  PersonOutline,
  TimeOutline,
  PricetagOutline,
  GameControllerOutline,
  SparklesOutline
} from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'
import router from '@renderer/router'
import { useGameState } from '@renderer/composables/useGameState'
import {
  useSearchSuggestions,
  recordSearchHistory,
  type PlayerSuggestion
} from '@renderer/composables/useSearchSuggestions'

/** 面板中的一行(精确查人 / 玩家候选 / AI 搜索) */
interface SuggestRow {
  kind: 'exact' | 'player' | 'ai'
  key: string
  label: string
  /** 来源角标(好友/备注/历史),仅 player 行 */
  badge?: string
  /** player 行携带的原始候选 */
  suggestion?: PlayerSuggestion
}

const message = useMessage()
const { summoner } = useGameState()

const searchValue = ref('')
const focused = ref(false)
const inputRef = ref()

// ─── 大区选择(从 Header 原样迁入) ──────────────────────────────────────────

/** 选中的大区 platformId(空 = 当前区,走本地 LCU;非空走 SGP 跨区查询) */
const selectedRegion = ref('')
const regionOptions = ref<{ label: string; value: string }[]>([{ label: '当前区', value: '' }])

onMounted(async () => {
  try {
    const regions = await invoke<{ label: string; value: string }[]>('get_sgp_regions')
    regionOptions.value = [{ label: '当前区', value: '' }, ...regions]
  } catch (e) {
    console.error('加载大区列表失败', e)
  }
})

const regionDropdownOptions = computed(() =>
  regionOptions.value.map(r => ({ label: r.label, key: r.value }))
)
const selectedRegionLabel = computed(
  () => regionOptions.value.find(r => r.value === selectedRegion.value)?.label ?? '当前区'
)
const onRegionSelect = (key: string): void => {
  selectedRegion.value = key
}

// ─── 候选行 ──────────────────────────────────────────────────────────────────

const { playerSuggestions, riotIdLike } = useSearchSuggestions(searchValue)

const SOURCE_BADGE: Record<PlayerSuggestion['source'], string> = {
  friend: '好友',
  note: '备注',
  history: '历史',
  played: '对局过'
}

const rows = computed<SuggestRow[]>(() => {
  const text = searchValue.value.trim()
  if (!text) return []
  const out: SuggestRow[] = []
  if (riotIdLike.value) {
    out.push({ kind: 'exact', key: 'exact', label: `搜索召唤师「${text}」` })
  }
  for (const s of playerSuggestions.value) {
    out.push({
      kind: 'player',
      key: `player:${s.source}:${s.name}`,
      label: s.name,
      badge: SOURCE_BADGE[s.source],
      suggestion: s
    })
  }
  out.push({ kind: 'ai', key: 'ai', label: `AI 搜战绩:「${text}」` })
  return out
})

const panelVisible = computed(() => focused.value && rows.value.length > 0)

const activeIndex = ref(0)
// 行集变化时重置默认高亮:精确行/首个候选都在 0 位;仅剩 AI 行时也是 0
watch(rows, () => {
  activeIndex.value = 0
})

function rowIcon(row: SuggestRow) {
  if (row.kind === 'ai') return SparklesOutline
  if (row.kind === 'exact') return Search
  if (row.suggestion?.source === 'history') return TimeOutline
  if (row.suggestion?.source === 'note') return PricetagOutline
  if (row.suggestion?.source === 'played') return GameControllerOutline
  return PersonOutline
}

// ─── 执行 ────────────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  if (!panelVisible.value) {
    if (e.key === 'Enter') executeActive()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % rows.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + rows.value.length) % rows.value.length
  } else if (e.key === 'Enter') {
    executeActive()
  } else if (e.key === 'Escape') {
    inputRef.value?.blur()
  }
}

function executeActive(): void {
  const row = rows.value[activeIndex.value]
  if (row) executeRow(row)
}

async function executeRow(row: SuggestRow): Promise<void> {
  const text = searchValue.value.trim()
  if (!text) return

  if (row.kind === 'ai') {
    await runAiSearch(text)
    return
  }

  // 精确查人:exact 行用原文,player 行用候选的完整名字与其自带大区
  const name = row.kind === 'player' ? row.suggestion!.name : text
  const region = row.kind === 'player' ? (row.suggestion!.region ?? '') : selectedRegion.value
  // fire-and-forget:候选行是已知玩家直接记;手输名字待验证成功后才入历史
  void recordSearchHistory(name, region, { known: row.kind === 'player' })
  searchValue.value = ''
  inputRef.value?.blur()
  await router.push({
    path: '/Record',
    query: { name, region: region || undefined, t: Date.now() }
  })
}

/** AI 行:解析当前登录玩家名后跳 Record 页(?aiq= 由结果页消费) */
async function runAiSearch(text: string): Promise<void> {
  let selfName = ''
  if (summoner.value?.gameName) {
    selfName = `${summoner.value.gameName}#${summoner.value.tagLine}`
  } else {
    try {
      const me = await invoke<{ gameName: string; tagLine: string }>('get_my_summoner')
      selfName = `${me.gameName}#${me.tagLine}`
    } catch {
      message.error('AI 搜战绩需要先启动并登录游戏客户端')
      return
    }
  }
  searchValue.value = ''
  inputRef.value?.blur()
  await router.push({
    path: '/Record',
    query: { name: selfName, aiq: text, t: Date.now() }
  })
}
</script>

<style lang="css" scoped>
.super-search {
  position: relative;
  width: 100%;
}

.input-lolid {
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

/* 单一搜索框:大区做成框内左侧下拉前缀,整体一个边框/背景/聚焦态 */
.header-search {
  width: 100%;
  border-radius: var(--radius-md);
}

.header-search :deep(.n-input-wrapper) {
  transition:
    box-shadow var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}

/* 未输入时的提示字调小一号并淡化:纯引导信息,不该有输入文字的视觉分量 */
.header-search :deep(.n-input__placeholder) {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

/* 聚焦时整框发光 */
.super-search:focus-within .header-search :deep(.n-input-wrapper) {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--semantic-win) 20%, transparent);
  border-color: color-mix(in srgb, var(--semantic-win) 35%, transparent) !important;
}

/* 前缀:大区下拉触发器(小号文字 + 箭头,hover 淡底) */
.region-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  -webkit-app-region: no-drag;
  transition:
    color var(--dur-fast) var(--ease-expo),
    background-color var(--dur-fast) var(--ease-expo);
}

.region-trigger:hover {
  color: var(--text-primary);
  background: var(--glass-bg-high);
}

.region-trigger-caret {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* 前缀与输入文本之间的细分隔线 */
.region-divider {
  width: 1px;
  height: 14px;
  margin: 0 var(--space-8) 0 5px;
  background: var(--glass-border);
  flex-shrink: 0;
}

.header-icon-btn {
  -webkit-app-region: no-drag;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

/* 候选面板:输入框正下方的玻璃下拉 */
.suggest-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 100;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--bg-elevated, var(--bg-base));
  border: 1px solid var(--glass-border);
  box-shadow: 0 8px 24px color-mix(in srgb, black 25%, transparent);
  -webkit-app-region: no-drag;
}

.suggest-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  /* 候选面板用小一号字:与 header 输入框的辅助层级一致,避免喧宾夺主 */
  font-size: var(--font-size-xs);
  line-height: 1.6;
  transition:
    background-color var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
}

.suggest-row.active {
  background: var(--glass-bg-high);
  color: var(--text-primary);
}

.row-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.suggest-row.ai-row .row-icon {
  color: var(--accent-gold, #c8aa6e);
}

.row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.row-badge {
  flex-shrink: 0;
  font-size: var(--font-size-2xs, 10px);
  color: var(--text-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  padding: 0 var(--space-6);
  line-height: 16px;
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-expo);
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
