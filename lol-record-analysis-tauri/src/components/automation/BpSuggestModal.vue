<script setup lang="ts">
/**
 * BP 智能推荐面板
 *
 * 基于近期战绩（常用英雄 / 常输给的英雄）与 OP.GG 版本强势英雄（按主打分路 + 熟练度分流）
 * 三分区展示候选，逐张卡片可一键采纳进「英雄池」或「Ban 池」兜底配置。
 * 后端 `get_bp_suggest` 可能让同一个英雄同时出现在 frequent 与 hot_t0 两张卡里——
 * 采用任一张后，另一张靠共享的 `adopted` Set（key `pool:championId`）一起变灰，
 * 不需要额外去重逻辑。
 */
import { ref, watch, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  NModal,
  NCard,
  NButton,
  NSpace,
  NText,
  NTag,
  NEmpty,
  NSpin,
  NSelect,
  NAvatar
} from 'naive-ui'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { assetPrefix } from '@renderer/services/http'
import type { championOption } from '@renderer/types/domain/champion'
import type { BpSuggestResult, BpSuggestItem, SuggestedPool } from '@renderer/types/bpSuggest'

const props = defineProps<{ show: boolean; championOptions: championOption[] }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'adopted', pool: SuggestedPool): void
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<BpSuggestResult | null>(null)
/** 分路下拉当前值（'' = 全部/后端推断） */
const selectedPosition = ref<string>('')
/** 本次会话内已采用的 (pool:championId) 集合，驱动灰态 */
const adopted = ref<Set<string>>(new Set())
/** 正在提交中的 (pool:championId) 集合，防连点 + 驱动按钮 loading */
const adoptingKeys = ref<Set<string>>(new Set())

const POSITION_OPTIONS = [
  { label: '全部分路', value: '' },
  { label: '上单', value: 'TOP' },
  { label: '打野', value: 'JUNGLE' },
  { label: '中单', value: 'MIDDLE' },
  { label: '下路', value: 'BOTTOM' },
  { label: '辅助', value: 'UTILITY' }
]

/**
 * 拉取一次推荐结果
 * @param position - 大写分路名，不传/空串时由后端推断主打分路
 */
async function load(position?: string) {
  loading.value = true
  error.value = null
  try {
    result.value = await invoke<BpSuggestResult>('get_bp_suggest', {
      position: position || null
    })
    if (!position) selectedPosition.value = result.value.main_position
  } catch (e) {
    error.value = (e as Error).message ?? String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  isShown => {
    if (isShown && result.value === null) void load()
  },
  { immediate: true }
)

const insufficient = computed(() => result.value !== null && result.value.sample_games < 10)

/** 三分区（标题 + 候选 + 空文案） */
const sections = computed(() => {
  if (!result.value) return []
  return [
    {
      key: 'frequent',
      title: '常用英雄 → 英雄池',
      items: result.value.frequent,
      emptyText: '近期没有 3 场以上的英雄'
    },
    {
      key: 'nemesis',
      title: '常输给的英雄 → Ban 池',
      items: result.value.nemesis,
      emptyText: '败局里没有高频出现的敌方英雄'
    },
    {
      key: 'hot_t0',
      title: '版本 T0（按熟练度分流）',
      items: result.value.hot_t0,
      emptyText: result.value.opgg_ok ? '所选分路没有 T0 候选' : 'OP.GG 数据暂不可用'
    }
  ]
})

function championName(id: number): string {
  return props.championOptions.find(o => o.value === id)?.label ?? `英雄 ${id}`
}

/** 依据文案：按 evidence 里有什么拼什么 */
function evidenceText(item: BpSuggestItem): string {
  const e = item.evidence
  const parts: string[] = []
  if (e.games !== undefined) parts.push(`${e.games} 场`)
  if (e.win_rate !== undefined) parts.push(`胜率 ${(e.win_rate * 100).toFixed(0)}%`)
  if (e.losses_against !== undefined && e.loss_games !== undefined)
    parts.push(`${e.loss_games} 场败局中出现 ${e.losses_against} 次`)
  if (e.opgg_tier !== undefined) parts.push(`T${e.opgg_tier}`)
  if (e.position) {
    const label = POSITION_OPTIONS.find(p => p.value === e.position)?.label
    if (label) parts.push(label)
  }
  if (e.opgg_win_rate !== undefined) parts.push(`OP.GG 胜率 ${(e.opgg_win_rate * 100).toFixed(1)}%`)
  return parts.join(' · ')
}

function adoptKey(pool: SuggestedPool, id: number): string {
  return `${pool}:${id}`
}

function isAdopted(item: BpSuggestItem, pool: SuggestedPool): boolean {
  return (
    (pool === item.suggested_pool && item.already_in_pool) ||
    adopted.value.has(adoptKey(pool, item.champion_id))
  )
}

/** 是否正在提交该 (pool, championId)——驱动按钮 loading/disabled，防连点 */
function isAdopting(item: BpSuggestItem, pool: SuggestedPool): boolean {
  return adoptingKeys.value.has(adoptKey(pool, item.champion_id))
}

/**
 * 采用：读现有池 → 去重 append → 写回 → 灰态 + 通知父组件
 *
 * 用 `adoptingKeys` 在 (pool, championId) 粒度防重入：同一张卡片的按钮在
 * 请求完成前再次点击会被直接忽略；IPC 失败时吞掉异常仅打日志，不置灰、不
 * emit，避免用户零反馈或双击竞态下两次都读到旧池子。
 */
async function adopt(item: BpSuggestItem, pool: SuggestedPool) {
  const aKey = adoptKey(pool, item.champion_id)
  if (adoptingKeys.value.has(aKey)) return
  adoptingKeys.value.add(aKey)
  try {
    const key =
      pool === 'pick' ? 'settings.auto.pickChampionSlice' : 'settings.auto.banChampionSlice'
    const existing = (await getConfigByIpc<number[]>(key)) ?? []
    if (!existing.includes(item.champion_id)) {
      await putConfigByIpc(key, [...existing, item.champion_id])
    }
    adopted.value = new Set(adopted.value).add(aKey)
    emit('adopted', pool)
  } catch (e) {
    console.error('采用推荐失败', e)
  } finally {
    adoptingKeys.value.delete(aKey)
  }
}

async function onPositionChange(pos: string) {
  selectedPosition.value = pos
  await load(pos || undefined)
}

/** 头像加载失败时回退到占位英雄图（id -1） */
function onAvatarError(e: Event) {
  const img = e.target as HTMLImageElement
  img.src = `${assetPrefix}/champion/-1`
}

function close() {
  emit('update:show', false)
}
</script>

<template>
  <n-modal :show="show" @update:show="close">
    <n-card
      style="width: 760px; max-height: 80vh; overflow: auto"
      title="智能推荐（基于近期战绩与 OP.GG）"
    >
      <template #header-extra>
        <n-space>
          <n-select
            :options="POSITION_OPTIONS"
            :value="selectedPosition"
            style="width: 120px"
            @update:value="onPositionChange"
          />
          <n-button size="small" :loading="loading" @click="load(selectedPosition || undefined)">
            🔄 重新生成
          </n-button>
        </n-space>
      </template>

      <div v-if="loading" style="padding: 40px; text-align: center">
        <n-spin />
        <div style="margin-top: var(--space-12); color: var(--n-text-color-disabled)">
          正在计算推荐（约数秒）
        </div>
      </div>

      <div v-else-if="error">
        <n-empty description="推荐生成失败">
          <template #extra>
            <n-button @click="load(selectedPosition || undefined)">重试</n-button>
            <n-text
              depth="3"
              style="display: block; margin-top: var(--space-8); font-size: var(--font-size-sm)"
            >
              {{ error }}
            </n-text>
          </template>
        </n-empty>
      </div>

      <div v-else-if="insufficient">
        <n-empty :description="`近期对局太少（${result!.sample_games} 局），打几局再来`" />
      </div>

      <template v-else-if="result">
        <template v-for="section in sections" :key="section.key">
          <div class="section-title" :style="{ marginTop: 'var(--space-16)' }">
            {{ section.title }}
          </div>
          <n-space v-if="section.items.length > 0">
            <n-card
              v-for="item in section.items"
              :key="`${section.key}-${item.champion_id}`"
              size="small"
              style="width: 220px"
              :style="isAdopted(item, item.suggested_pool) ? 'opacity: 0.5' : ''"
            >
              <n-space align="center">
                <n-avatar
                  :src="`${assetPrefix}/champion/${item.champion_id}`"
                  size="small"
                  @error="onAvatarError"
                />
                <n-tag
                  :type="item.suggested_pool === 'pick' ? 'success' : 'error'"
                  size="small"
                  round
                >
                  {{ championName(item.champion_id) }}
                </n-tag>
              </n-space>
              <div
                style="
                  margin-top: var(--space-8);
                  font-size: var(--font-size-sm);
                  color: var(--n-text-color-2);
                "
              >
                {{ evidenceText(item) }}
              </div>
              <n-button
                size="small"
                type="primary"
                style="margin-top: var(--space-8); width: 100%"
                :disabled="
                  isAdopted(item, item.suggested_pool) || isAdopting(item, item.suggested_pool)
                "
                :loading="isAdopting(item, item.suggested_pool)"
                @click="adopt(item, item.suggested_pool)"
              >
                {{
                  isAdopted(item, item.suggested_pool)
                    ? '已加入'
                    : item.suggested_pool === 'pick'
                      ? '加入英雄池'
                      : '加入 Ban 池'
                }}
              </n-button>
              <n-button
                v-if="section.key === 'hot_t0'"
                quaternary
                size="small"
                style="margin-top: var(--space-4); width: 100%"
                :disabled="
                  isAdopted(item, item.suggested_pool === 'pick' ? 'ban' : 'pick') ||
                  isAdopting(item, item.suggested_pool === 'pick' ? 'ban' : 'pick')
                "
                :loading="isAdopting(item, item.suggested_pool === 'pick' ? 'ban' : 'pick')"
                @click="adopt(item, item.suggested_pool === 'pick' ? 'ban' : 'pick')"
              >
                {{ item.suggested_pool === 'pick' ? '转入 Ban 池' : '转入英雄池' }}
              </n-button>
            </n-card>
          </n-space>
          <div v-else style="color: var(--n-text-color-disabled); font-size: var(--font-size-sm)">
            {{ section.emptyText }}
          </div>
        </template>
      </template>
    </n-card>
  </n-modal>
</template>

<style scoped>
.section-title {
  font-weight: 600;
  margin-bottom: var(--space-8);
}
</style>
