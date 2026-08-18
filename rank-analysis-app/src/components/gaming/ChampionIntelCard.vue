<template>
  <div
    class="intel-card"
    :class="[
      pickStateClass(pickState),
      `intel-${density}`,
      isEmpty && 'intel-empty',
      justSwapped && 'intel-swapped'
    ]"
  >
    <!-- 未亮英雄：占位（虚线边框 + 居中提示，picking 态同样吃 intel-picking 动画） -->
    <template v-if="isEmpty">
      <div class="intel-placeholder">
        <span class="intel-placeholder-icon">❓</span>
        <span class="intel-placeholder-text">{{
          pickState === 'picking' ? '正在选择…' : pickState === 'banning' ? '禁用中…' : '尚未选择'
        }}</span>
      </div>
    </template>
    <template v-else>
      <CounterHover
        v-if="props.mode === 'ranked'"
        :champion-id="championId"
        :position="meta?.position ?? ''"
        :tier="tier"
      >
        <img class="intel-avatar" :src="getChampionUrl(championId)" :alt="name" />
      </CounterHover>
      <img v-else class="intel-avatar" :src="getChampionUrl(championId)" :alt="name" />
      <div class="intel-body">
        <div class="intel-row">
          <span class="intel-name">{{ name }}</span>
          <span
            v-if="badge.label"
            class="intel-tier"
            :style="{ color: badge.color, backgroundColor: badge.bg }"
            >{{ badge.label }}</span
          >
          <span class="intel-winrate" :class="winRateClass">{{
            formatWinRate(meta?.winRate)
          }}</span>
          <PatchNoteBadge :champion-id="championId" :mode="mode" />
        </div>
        <div class="intel-row intel-sub">
          <span v-if="pickState === 'intent'" class="intel-state-tag">意向</span>
          <span v-else-if="pickState === 'picking'" class="intel-state-tag">选择中</span>
          <span
            v-for="h in hints"
            :key="h.myChampionId"
            class="intel-counter"
            :class="h.myWinRate >= 0.5 ? 'intel-counter-good' : 'intel-counter-bad'"
          >
            {{ counterText(h) }}
          </span>
          <button v-if="canShowBuild" class="intel-build-toggle" @click="buildOpen = !buildOpen">
            {{ buildOpen ? '收起出装' : '出装/符文' }}
            <span v-if="buildLoading" class="intel-build-spinner" />
          </button>
        </div>
        <div v-if="buildOpen && canShowBuild" class="intel-build">
          <div class="intel-build-pos" role="group" aria-label="分路筛选">
            <button
              v-for="c in POSITION_CHIPS"
              :key="c.value"
              type="button"
              class="intel-build-chip"
              :class="{ 'intel-build-chip-active': effectiveBuildPosition === c.value }"
              @click="buildPositionOverride = c.value"
            >
              {{ c.label }}
            </button>
          </div>
          <template v-if="recommendation">
            <div class="intel-build-row">
              <img
                v-for="(slot, i) in recommendation.items"
                :key="i"
                class="intel-build-item"
                :src="slot ? getItemUrl(slot.itemId) : ''"
                :alt="slot ? `装备${i + 1}` : '空'"
                loading="lazy"
              />
            </div>
            <div class="intel-build-row intel-build-runes">
              <img
                v-if="recommendation.runes.keystone"
                class="intel-build-rune"
                :src="getRuneUrl(recommendation.runes.keystone.id)"
                :alt="`基石 ${recommendation.runes.keystone.id}`"
                loading="lazy"
              />
              <span class="intel-build-style">
                {{ primaryStyleName(recommendation) }}
              </span>
              <template v-for="s in recommendation.spells" :key="`spell-${s?.spellId ?? 'null'}`">
                <img
                  v-if="s"
                  class="intel-build-spell"
                  :src="getSpellUrl(s.spellId)"
                  loading="lazy"
                />
              </template>
            </div>
            <div class="intel-build-note">{{ recommendation.note }}</div>
            <div class="intel-build-import">
              <button
                type="button"
                class="intel-build-import-btn"
                :disabled="importingRune"
                @click="onImportRune"
              >
                {{ importingRune ? '导入中…' : '一键导入符文' }}
              </button>
              <button
                type="button"
                class="intel-build-import-btn"
                :disabled="importingSpells"
                @click="onImportSpells"
              >
                {{ importingSpells ? '导入中…' : '导入技能' }}
              </button>
              <span
                v-if="importNote"
                class="intel-build-import-note"
                :class="{ 'is-error': importError }"
                >{{ importNote }}</span
              >
            </div>
            <div v-if="!buildLoading && buildDegraded" class="intel-build-degraded">
              该分路样本不足（&lt;5 场），已回退显示全部分路统计
            </div>
          </template>
          <div v-else-if="!buildLoading" class="intel-build-empty">
            暂无推荐（样本不足或无战绩）
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 选人阶段英雄情报卡：无玩家身份时替代 PlayerCard。
 * 展示英雄头像/名字 + OP.GG T级/胜率 + 对我方阵容的克制提示，
 * pick-state 驱动三态动画（intent 呼吸 / picking 边框脉冲 / locked 定格入场）。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import {
  getChampionMeta,
  getLaneCounters,
  findCounterHints,
  opggRevision
} from '@renderer/services/opgg'
import type { ChampionMeta, CounterHint, OpggMode } from '@renderer/services/opgg'
import { pickStateClass, tierBadge, formatWinRate, isChampionSwap } from './championIntel'
import { getBuildStats, toBuildRecommendation } from '@renderer/services/builds'
import type { BuildRecommendation } from '@renderer/services/builds'
import { importRunePage, importSummonerSpells } from '@renderer/services/importRunes'
import PatchNoteBadge from './PatchNoteBadge.vue'
import CounterHover from './CounterHover.vue'

const props = withDefaults(
  defineProps<{
    championId: number
    pickState?: string
    mode: OpggMode
    /** 我方已亮出的英雄（用于克制提示），可为空数组 */
    myChampionIds?: number[]
    density?: 'normal' | 'compact'
    /** 当前登录玩家 puuid（PUGG 出装聚合的统计主体）；空串 = 不展示出装面板 */
    myPuuid?: string
    /** 我本局分路（小写 LCU 命名 top/jungle/...；空 = 未知），出装面板分路筛选默认跟随 */
    myPosition?: string
    /** 本局 queueId（模式过滤）；0 = 不限模式 */
    queueId?: number
    /** OP.GG 段位分段（透传给 CounterHover 对位弹窗） */
    tier?: string
  }>(),
  {
    pickState: 'none',
    myChampionIds: () => [],
    density: 'normal',
    myPuuid: '',
    myPosition: '',
    queueId: 0,
    tier: 'emerald_plus'
  }
)

const { getChampionUrl, getItemUrl, getRuneUrl, getSpellUrl } = useAssetUrl()
const name = ref('')
const meta = ref<ChampionMeta | null>(null)
const hints = ref<CounterHint[]>([])
const badge = computed(() => tierBadge(meta.value?.tier ?? 0))
/** 未亮出英雄：走占位分支（虚线卡 + 居中 ❓） */
const isEmpty = computed(() => !props.championId || props.championId <= 0)
/** 是否有 PUGG 统计主体（需要「我」的 puuid 才能聚合历史战绩） */
const canShowBuild = computed(() => !isEmpty.value && !!props.myPuuid)
/** 胜率语义色：>=52% 绿、<=48% 红，其余用默认色（模板里不设 class） */
const winRateClass = computed(() => {
  const rate = meta.value?.winRate
  if (rate === undefined || rate <= 0) return ''
  if (rate >= 0.52) return 'intel-winrate-good'
  if (rate <= 0.48) return 'intel-winrate-bad'
  return ''
})

// ---- 出装/符文面板（方向 C，C-2-UI）----
const buildOpen = ref(false)
const buildLoading = ref(false)
const recommendation = ref<BuildRecommendation | null>(null)

/** 分路筛选项：value 为 LCU 大写命名（与后端 `position` 参数一致），空串 = 全部分路。 */
const POSITION_CHIPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'TOP', label: '上单' },
  { value: 'JUNGLE', label: '打野' },
  { value: 'MIDDLE', label: '中单' },
  { value: 'BOTTOM', label: '下路' },
  { value: 'UTILITY', label: '辅助' }
]

/**
 * 用户手动选择的分路（'' = 全部）。null = 跟随当前对局位置（`myPosition`，
 * 会话数据可能晚到，用 null 占位让「跟随」在数据到达后自然生效）；一旦手动
 * 点过 chip 就固定，不再跟随位置变动。
 */
const buildPositionOverride = ref<string | null>(null)
const effectiveBuildPosition = computed(() => {
  if (buildPositionOverride.value !== null) return buildPositionOverride.value
  const p = props.myPosition?.trim().toUpperCase()
  return p === 'TOP' || p === 'JUNGLE' || p === 'MIDDLE' || p === 'BOTTOM' || p === 'UTILITY'
    ? p
    : ''
})

/**
 * 降级标注：手动/跟随指定了分路，但后端返回的生效分路为空串（指定分路样本
 * <5 已自动回退全部分路）或与请求不一致（竞态残余）时提示用户。
 */
const buildDegraded = computed(() => {
  if (!effectiveBuildPosition.value || !recommendation.value) return false
  return recommendation.value.position !== effectiveBuildPosition.value
})

/** 主系风格名：风格 id → 中文名（8100=精密/8200=主宰/8300=巫术/8400=坚决/8000=启迪）。 */
function primaryStyleName(rec: BuildRecommendation): string {
  switch (rec.runes.main?.id) {
    case 8000:
      return '启迪'
    case 8100:
      return '精密'
    case 8200:
      return '主宰'
    case 8300:
      return '巫术'
    case 8400:
      return '坚决'
    default:
      return ''
  }
}

/** 名字辅助：克制提示里显示我方英雄名 */
function counterText(h: CounterHint): string {
  const my = getChampionName(h.myChampionId)
  return h.myWinRate >= 0.5
    ? `怕你方${my} ${formatWinRate(h.myWinRate)}`
    : `克制你方${my} ${formatWinRate(1 - h.myWinRate)}`
}

/**
 * 一键导入：把本机历史最流行的完整符文页/召唤师技能对写进客户端。
 * 反馈内联展示（成功中性色 / 失败红色），不弹窗不打断。
 */
const importingRune = ref(false)
const importingSpells = ref(false)
const importNote = ref('')
const importError = ref(false)

async function onImportRune(): Promise<void> {
  if (importingRune.value) return
  importingRune.value = true
  importNote.value = ''
  importError.value = false
  try {
    const r = await importRunePage(props.championId)
    importNote.value = r.created ? `已新建并启用「${r.pageName}」` : `已覆盖并启用「${r.pageName}」`
  } catch (err) {
    importError.value = true
    importNote.value = String(err)
  } finally {
    importingRune.value = false
  }
}

async function onImportSpells(): Promise<void> {
  if (importingSpells.value) return
  importingSpells.value = true
  importNote.value = ''
  importError.value = false
  try {
    const [s1, s2] = await importSummonerSpells()
    importNote.value = `技能已写入（${s1}/${s2}）`
  } catch (err) {
    importError.value = true
    importNote.value = String(err)
  } finally {
    importingSpells.value = false
  }
}

/**
 * 换人一次性闪烁反馈：旧值>0 且新值>0 且不等（真换人，非首次亮出）时点亮 `intel-swapped`，
 * ~600ms 后自动移除。触发时先归零一帧（nextTick）再点亮，保证连续快速换人也能重播动画。
 */
const justSwapped = ref(false)
let swapFlashTimer: ReturnType<typeof setTimeout> | null = null

function triggerSwapFlash(): void {
  if (swapFlashTimer) clearTimeout(swapFlashTimer)
  justSwapped.value = false
  void nextTick(() => {
    justSwapped.value = true
    swapFlashTimer = setTimeout(() => {
      justSwapped.value = false
      swapFlashTimer = null
    }, 600)
  })
}

onUnmounted(() => {
  if (swapFlashTimer) clearTimeout(swapFlashTimer)
})

/**
 * 上一次实际发起处理的请求标识（championId + myChampionIds 内容拼接）。
 * Gaming.vue 的 computed 每次会话事件都会重新生成 myChampionIds 数组，
 * 引用必变但内容常不变；watch 用 `[championId, myChampionIds]` 数组做浅比较
 * 必然每次触发。这里做内容级去重：内容不变则整个回调直接跳过，避免每事件重拉。
 */
let lastRequestKey = ''

watch(
  () =>
    [
      props.championId,
      props.myChampionIds,
      opggRevision.value,
      // NOTE: 函数源 getter 返回的数组不会被 Vue 逐元素解包，必须显式 .value
      effectiveBuildPosition.value
    ] as const,
  async ([id, myIds, rev, pos], oldSource) => {
    // 真换人检测：与请求去重 key 无关，仅比较 championId 本身（oldSource 首次触发为 undefined）
    if (isChampionSwap(oldSource?.[0], id)) {
      triggerSwapFlash()
    }
    // 内容级去重：id 与 myIds 拼接后的 key 未变化，说明本次触发只是引用抖动，直接跳过
    // rev 必须进 key：段位切换时 id 与 myIds 都没变，
    // 不带上它就会被内容级去重当成引用抖动而跳过，卡片永远停在旧段位数据
    // pos 必须进 key：切分路 chip 要重查 PUGG 出装（聚合结果按分路分桶）
    const requestKey = `${id}|${myIds.join(',')}|${rev}|${pos}`
    if (requestKey === lastRequestKey) return
    lastRequestKey = requestKey

    if (!id || id <= 0) {
      meta.value = null
      hints.value = []
      recommendation.value = null
      buildOpen.value = false
      return
    }
    // 竞态守卫：选人阶段 championId/myChampionIds 快速变化时，旧请求晚到不得覆盖新数据。
    // 用 requestKey 而非单独的 championId 比较，可同时覆盖"同英雄但我方阵容变化"的窄竞态。
    const requestKeySnapshot = requestKey
    await loadChampionNames()
    if (lastRequestKey !== requestKeySnapshot) return
    name.value = getChampionName(id)
    if (props.myPuuid) {
      buildLoading.value = true
      const build = await getBuildStats(props.myPuuid, id, props.queueId ?? 0, pos)
      if (lastRequestKey !== requestKeySnapshot) {
        buildLoading.value = false
        return
      }
      recommendation.value = toBuildRecommendation(build, name.value)
      buildLoading.value = false
    }
    const fetchedMeta = await getChampionMeta(props.mode, id)
    if (lastRequestKey !== requestKeySnapshot) return
    meta.value = fetchedMeta
    if (props.mode === 'ranked' && myIds.length > 0) {
      const counters = await getLaneCounters(props.mode, [id, ...myIds])
      if (lastRequestKey !== requestKeySnapshot) return
      hints.value = findCounterHints(id, [...myIds], counters)
    } else {
      hints.value = []
    }
  },
  { immediate: true, deep: true }
)
</script>

<style scoped>
.intel-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
  border-radius: 10px;
  background: var(--n-color, transparent);
  min-height: 56px;
  /* 入场：自有 intel-enter keyframe，比全局 fade-up 更大幅度（+scale）更易察觉 */
  animation: intel-enter 0.32s var(--ease-expo) both;
  animation-delay: calc(55ms * var(--stagger-i, 0));
}
.intel-compact {
  padding: 6px 8px;
  min-height: 44px;
}
.intel-avatar {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 2px solid transparent;
  flex-shrink: 0;
  transition: border-color var(--dur-normal) var(--ease-expo);
}
.intel-compact .intel-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}
.intel-body {
  flex: 1;
  min-width: 0;
}
.intel-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.intel-name {
  font-weight: 600;
}
/* T 级徽章：pill chip，颜色/背景来自 tierBadge() 的 color/bg 字段 */
.intel-tier {
  font-weight: 700;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  line-height: 1.5;
  white-space: nowrap;
}
.intel-winrate {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  text-align: right;
  opacity: 0.85;
}
.intel-winrate-good {
  color: var(--semantic-win, #18a058);
  opacity: 1;
  font-weight: 600;
}
.intel-winrate-bad {
  color: var(--semantic-loss, #d03050);
  opacity: 1;
  font-weight: 600;
}
.intel-sub {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.8;
}
.intel-state-tag {
  opacity: 0.7;
}
/* 克制提示：小 pill，背景用语义色 8% 透明度 */
.intel-counter {
  padding: 1px 6px;
  border-radius: 999px;
}
.intel-counter-good {
  color: var(--semantic-win, #18a058);
  background: color-mix(in srgb, var(--semantic-win, #18a058) 8%, transparent);
}
.intel-counter-bad {
  color: var(--semantic-loss, #d03050);
  background: color-mix(in srgb, var(--semantic-loss, #d03050) 8%, transparent);
}
.intel-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.55;
}
.intel-placeholder-icon {
  font-size: 16px;
}

/* ---- 出装/符文面板（方向 C，C-2-UI）---- */
.intel-build-toggle {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.25));
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.2s;
}
.intel-build-toggle:hover {
  opacity: 1;
}
.intel-build-spinner {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-left: 6px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: intel-build-spin 0.8s linear infinite;
}
@keyframes intel-build-spin {
  to {
    transform: rotate(360deg);
  }
}
.intel-build {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
}
.intel-build-pos {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.intel-build-chip {
  padding: 1px 8px;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.25));
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  line-height: 1.7;
  cursor: pointer;
  opacity: 0.65;
  transition:
    opacity 0.2s,
    background 0.2s;
}
.intel-build-chip:hover {
  opacity: 1;
}
.intel-build-chip-active {
  opacity: 1;
  background: rgba(128, 128, 128, 0.18);
}
.intel-build-degraded {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.75;
}
.intel-build-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.intel-build-item {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  background: rgba(128, 128, 128, 0.15);
  border: 1px solid rgba(128, 128, 128, 0.2);
}
.intel-build-runes {
  margin-top: 5px;
  gap: 6px;
}
.intel-build-rune {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: rgba(128, 128, 128, 0.15);
}
.intel-build-spell {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: rgba(128, 128, 128, 0.15);
  margin-left: 2px;
}
.intel-build-style {
  font-size: 11px;
  opacity: 0.75;
}
.intel-build-note {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.65;
  line-height: 1.5;
}
.intel-build-import {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.intel-build-import-btn {
  padding: 3px 10px;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.1);
  color: inherit;
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
  transition:
    opacity 0.2s,
    background 0.2s;
}
.intel-build-import-btn:hover:not(:disabled) {
  background: rgba(128, 128, 128, 0.2);
}
.intel-build-import-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.intel-build-import-note {
  font-size: 11px;
  opacity: 0.8;
}
.intel-build-import-note.is-error {
  color: var(--semantic-loss, #d03050);
  opacity: 1;
}
.intel-build-empty {
  font-size: 11px;
  opacity: 0.55;
  padding: 2px 0;
}
/* 未锁定占位卡：虚线边框 + 居中内容（picking 态被下方 .intel-picking 的实线+脉冲覆盖） */
.intel-empty {
  border-style: dashed;
  justify-content: center;
}

/* ---- 入场 + 三态动画 ----
 * intel-enter 恒为逗号组合里的第一个 animation-name（位序对齐 delay 列表的第一项），
 * 各 pick-state 类在此基础上追加第二段动画承载状态本身的效果；三态的 animation 简写
 * 会整体覆盖 .intel-card 上的入场声明（同特异性下后声明整体替换而非合并），所以这里
 * 都显式把 intel-enter 复合进去。
 */
@keyframes intel-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.975);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 意向：半透明呼吸 + 琥珀光晕 + 琥珀细边框，比旧版明显得多 */
.intel-intent {
  border-color: rgba(230, 193, 90, 0.55);
  animation:
    intel-enter 0.32s var(--ease-expo) both,
    intel-breathe 2s ease-in-out infinite;
  animation-delay: calc(55ms * var(--stagger-i, 0)), 0s;
}
.intel-intent .intel-avatar {
  border-color: rgba(230, 193, 90, 0.7);
}
@keyframes intel-breathe {
  0%,
  100% {
    opacity: 0.82;
    box-shadow: 0 0 0 0 transparent;
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 9px 1px rgba(230, 193, 90, 0.22);
  }
}

/* 正在选：绿色粗边框 + 外扩 ring 呼吸 + 极淡绿 tint，头像同步脉冲 */
.intel-picking {
  border: 2px solid var(--semantic-win, #18a058);
  background: rgba(24, 160, 88, 0.06);
  animation:
    intel-enter 0.32s var(--ease-expo) both,
    intel-pulse 1.1s ease-in-out infinite;
  animation-delay: calc(55ms * var(--stagger-i, 0)), 0s;
}
.intel-picking .intel-avatar {
  border-color: var(--semantic-win, #18a058);
  animation: intel-avatar-pulse 1.1s ease-in-out infinite;
}
@keyframes intel-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0.1);
  }
  50% {
    box-shadow: 0 0 0 3px rgba(24, 160, 88, 0.1);
  }
}
@keyframes intel-avatar-pulse {
  0%,
  100% {
    border-color: var(--semantic-win, #18a058);
  }
  50% {
    border-color: rgba(24, 160, 88, 0.7);
  }
}

/* 禁用中：ban 阶段全队（含对面 5 个占位）同时点亮，红色必须克制——
   1px 半透明边框 + 慢速微呼吸，仅提示状态；威胁感交给文案「禁用中…」 */
.intel-banning {
  border: 1px solid color-mix(in srgb, var(--semantic-loss, #d03050) 45%, transparent);
  background: rgba(208, 48, 80, 0.04);
  animation:
    intel-enter 0.32s var(--ease-expo) both,
    intel-ban-pulse 2s ease-in-out infinite;
  animation-delay: calc(55ms * var(--stagger-i, 0)), 0s;
}
.intel-banning .intel-avatar {
  border-color: color-mix(in srgb, var(--semantic-loss, #d03050) 55%, transparent);
}
@keyframes intel-ban-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(208, 48, 80, 0.08);
  }
  50% {
    box-shadow: 0 0 0 2px rgba(208, 48, 80, 0.08);
  }
}

/* 锁定：定格入场，bounce 过冲 + 一次性 ring 闪光收敛，仅播一次 */
.intel-locked {
  animation:
    intel-enter 0.32s var(--ease-expo) both,
    intel-lock-in 0.28s var(--ease-expo) both;
  animation-delay: calc(55ms * var(--stagger-i, 0)), 0s;
}
.intel-locked .intel-avatar {
  border-color: var(--semantic-win, #18a058);
}
@keyframes intel-lock-in {
  0% {
    transform: scale(0.92);
    opacity: 0.6;
    box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.28);
  }
  55% {
    transform: scale(1.015);
    box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.12);
  }
  100% {
    transform: scale(1);
    opacity: 1;
    box-shadow: 0 0 0 0 transparent;
  }
}

/* 换人闪烁：一次性反馈，动画只落在头像元素上（用卡片级 .intel-swapped 修饰类做触发开关），
 * 不往 .intel-card 的入场/三态逗号动画列表里加第三项，避免破坏既有组合规则。
 */
.intel-card.intel-swapped .intel-avatar {
  animation: intel-swap-flash 0.5s ease-out;
}
@keyframes intel-swap-flash {
  0% {
    filter: brightness(1);
    box-shadow: 0 0 0 0 transparent;
  }
  40% {
    filter: brightness(1.6);
    box-shadow: 0 0 10px 2px rgba(230, 193, 90, 0.55);
  }
  100% {
    filter: brightness(1);
    box-shadow: 0 0 0 0 transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .intel-card,
  .intel-intent,
  .intel-picking,
  .intel-banning,
  .intel-locked,
  .intel-picking .intel-avatar,
  .intel-banning .intel-avatar,
  .intel-card.intel-swapped .intel-avatar {
    animation: none;
  }
}
</style>
