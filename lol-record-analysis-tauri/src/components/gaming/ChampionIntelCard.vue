<template>
  <div class="intel-card" :class="[pickStateClass(pickState), `intel-${density}`]">
    <!-- 未亮英雄：占位（picking 态高亮呼吸） -->
    <template v-if="!championId || championId <= 0">
      <div class="intel-placeholder">
        <span class="intel-placeholder-icon">❓</span>
        <span class="intel-placeholder-text">{{
          pickState === 'picking' ? '正在选择…' : '尚未选择'
        }}</span>
      </div>
    </template>
    <template v-else>
      <img class="intel-avatar" :src="getChampionUrl(championId)" :alt="name" />
      <div class="intel-body">
        <div class="intel-row">
          <span class="intel-name">{{ name }}</span>
          <span v-if="badge.label" class="intel-tier" :style="{ color: badge.color }">{{
            badge.label
          }}</span>
          <span class="intel-winrate">{{ formatWinRate(meta?.winRate) }}</span>
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
import { computed, ref, watch } from 'vue'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import { getChampionMeta, getLaneCounters, findCounterHints } from '@renderer/services/opgg'
import type { ChampionMeta, CounterHint, OpggMode } from '@renderer/services/opgg'
import { pickStateClass, tierBadge, formatWinRate } from './championIntel'

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

/** 名字辅助：克制提示里显示我方英雄名 */
function counterText(h: CounterHint): string {
  const my = getChampionName(h.myChampionId)
  return h.myWinRate >= 0.5
    ? `怕你方${my} ${formatWinRate(h.myWinRate)}`
    : `克制你方${my} ${formatWinRate(1 - h.myWinRate)}`
}

watch(
  () => [props.championId, props.myChampionIds] as const,
  async ([id, myIds]) => {
    if (!id || id <= 0) {
      meta.value = null
      hints.value = []
      return
    }
    // 竞态守卫：选人阶段 championId 快速变化时，旧请求晚到不得覆盖新英雄数据
    const requestChampionId = id
    await loadChampionNames()
    if (props.championId !== requestChampionId) return
    name.value = getChampionName(id)
    const fetchedMeta = await getChampionMeta(props.mode, id)
    if (props.championId !== requestChampionId) return
    meta.value = fetchedMeta
    if (props.mode === 'ranked' && myIds.length > 0) {
      const counters = await getLaneCounters(props.mode, [id, ...myIds])
      if (props.championId !== requestChampionId) return
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
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
  border-radius: 10px;
  background: var(--n-color, transparent);
  min-height: 56px;
}
.intel-compact {
  padding: 6px 8px;
  min-height: 44px;
}
.intel-avatar {
  width: 40px;
  height: 40px;
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
.intel-tier {
  font-weight: 700;
  font-size: 12px;
}
.intel-winrate {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.intel-sub {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.8;
}
.intel-state-tag {
  opacity: 0.7;
}
.intel-counter-good {
  color: var(--semantic-win, #18a058);
}
.intel-counter-bad {
  color: var(--semantic-loss, #d03050);
}
.intel-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.55;
}

/* ---- 三态动画 ---- */
/* 意向：亮出未锁 → 半透明 + 呼吸 */
.intel-intent {
  opacity: 0.8;
  animation: intel-breathe 2s ease-in-out infinite;
}
@keyframes intel-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
  50% {
    box-shadow: 0 0 10px 1px rgba(99, 226, 183, 0.35);
  }
}
/* 正在选：边框脉冲高亮 */
.intel-picking {
  border-color: var(--semantic-win, #18a058);
  animation: intel-pulse 1.2s ease-in-out infinite;
}
@keyframes intel-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0.45);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(24, 160, 88, 0.12);
  }
}
/* 锁定：定格入场（scale + fade），仅播一次 */
.intel-locked {
  animation: intel-lock-in var(--dur-normal, 0.25s) var(--ease-expo, ease-out) both;
}
@keyframes intel-lock-in {
  from {
    transform: scale(0.88);
    opacity: 0.4;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .intel-intent,
  .intel-picking,
  .intel-locked {
    animation: none;
  }
}
</style>
