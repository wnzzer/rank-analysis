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
      <img class="intel-avatar" :src="getChampionUrl(championId)" :alt="name" />
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
import { getChampionMeta, getLaneCounters, findCounterHints } from '@renderer/services/opgg'
import type { ChampionMeta, CounterHint, OpggMode } from '@renderer/services/opgg'
import { pickStateClass, tierBadge, formatWinRate, isChampionSwap } from './championIntel'
import PatchNoteBadge from './PatchNoteBadge.vue'

const props = withDefaults(
  defineProps<{
    championId: number
    pickState?: string
    mode: OpggMode
    /** 我方已亮出的英雄（用于克制提示），可为空数组 */
    myChampionIds?: number[]
    density?: 'normal' | 'compact'
  }>(),
  { pickState: 'none', myChampionIds: () => [], density: 'normal' }
)

const { getChampionUrl } = useAssetUrl()
const name = ref('')
const meta = ref<ChampionMeta | null>(null)
const hints = ref<CounterHint[]>([])
const badge = computed(() => tierBadge(meta.value?.tier ?? 0))
/** 未亮出英雄：走占位分支（虚线卡 + 居中 ❓） */
const isEmpty = computed(() => !props.championId || props.championId <= 0)
/** 胜率语义色：>=52% 绿、<=48% 红，其余用默认色（模板里不设 class） */
const winRateClass = computed(() => {
  const rate = meta.value?.winRate
  if (rate === undefined || rate <= 0) return ''
  if (rate >= 0.52) return 'intel-winrate-good'
  if (rate <= 0.48) return 'intel-winrate-bad'
  return ''
})

/** 名字辅助：克制提示里显示我方英雄名 */
function counterText(h: CounterHint): string {
  const my = getChampionName(h.myChampionId)
  return h.myWinRate >= 0.5
    ? `怕你方${my} ${formatWinRate(h.myWinRate)}`
    : `克制你方${my} ${formatWinRate(1 - h.myWinRate)}`
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
  () => [props.championId, props.myChampionIds] as const,
  async ([id, myIds], oldSource) => {
    // 真换人检测：与请求去重 key 无关，仅比较 championId 本身（oldSource 首次触发为 undefined）
    if (isChampionSwap(oldSource?.[0], id)) {
      triggerSwapFlash()
    }
    // 内容级去重：id 与 myIds 拼接后的 key 未变化，说明本次触发只是引用抖动，直接跳过
    const requestKey = `${id}|${myIds.join(',')}`
    if (requestKey === lastRequestKey) return
    lastRequestKey = requestKey

    if (!id || id <= 0) {
      meta.value = null
      hints.value = []
      return
    }
    // 竞态守卫：选人阶段 championId/myChampionIds 快速变化时，旧请求晚到不得覆盖新数据。
    // 用 requestKey 而非单独的 championId 比较，可同时覆盖"同英雄但我方阵容变化"的窄竞态。
    const requestKeySnapshot = requestKey
    await loadChampionNames()
    if (lastRequestKey !== requestKeySnapshot) return
    name.value = getChampionName(id)
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
