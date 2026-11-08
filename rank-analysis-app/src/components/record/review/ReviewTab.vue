<template>
  <div class="review-tab" data-test="review-tab">
    <div v-if="isRemake" class="review-box review-empty" data-test="review-remake">
      本局为重开局（不足 5 分钟），没有可复盘的数据。
    </div>
    <div v-else-if="failed && !m" class="review-box review-empty" data-test="review-failed">
      复盘数据生成失败，可切回记分板查看本局数据。
    </div>
    <div v-else-if="!m" class="review-box review-loading" data-test="review-loading">
      <n-skeleton text :repeat="6" />
    </div>
    <template v-else>
      <header class="review-box review-header">
        <div class="review-header-main">
          <b :class="m.header.winner === 'red' ? 'is-red' : 'is-blue'">{{ winnerText }}</b>
          <span class="review-header-meta"
            >· {{ m.header.queueName }} · {{ m.header.durationText }} · 击杀
            {{ m.header.kills.blue }}:{{ m.header.kills.red }}</span
          >
        </div>
        <div class="review-header-reason" data-test="key-reason">
          胜负关键：{{ m.header.keyReason }}
        </div>
      </header>

      <div class="review-row">
        <MatchupBoard
          class="review-box review-box--wide"
          :matchup="m.matchup"
          :players="m.players"
          :selected="selectedPid"
          @select="selectPlayer"
        />
        <PlayerScoreCard
          v-if="selected"
          class="review-box"
          :player="selected"
          :has-baseline="m.hasBaseline"
        />
      </div>

      <div v-if="timelinePending" class="review-box" data-test="timeline-skeleton">
        <n-skeleton text :repeat="4" />
      </div>
      <GoldCurve
        v-else-if="m.goldCurve"
        ref="curveRef"
        v-model:open-id="openMarker"
        class="review-box"
        :curve="m.goldCurve"
        :deaths="selected?.deathList ?? null"
      />
      <div v-else class="review-box review-notice" data-test="timeline-notice">
        {{ timelineNotice }}
      </div>

      <div v-if="selected" class="review-row">
        <DeathList
          class="review-box review-box--wide"
          :deaths="selected.deathList"
          :summary="selected.deathSummary"
          :counts="selected.deathCounts"
          :loading="timelinePending"
          :hovered="hoverDeath"
          :focused="focusDeath"
          @hover="hoverDeath = $event"
        />
        <DeathMap
          v-if="showMap && selected.deathList"
          class="review-box"
          :deaths="selected.deathList"
          :hovered="hoverDeath"
          @hover="hoverDeath = $event"
        />
      </div>

      <ItemTimeline v-if="itemProps" class="review-box" v-bind="itemProps" />

      <AiCommentary
        class="review-box"
        :html="ai.renderedAiResult.value"
        :loading="ai.aiLoading.value"
        :state-label="ai.aiStateLabel.value"
        :title="aiTitle"
        :player-action-label="playerActionLabel"
        :show-overview-action="ai.aiMode.value === 'player'"
        @cite="onCite"
        @player="selectedPid !== null && ai.requestPlayer(selectedPid)"
        @overview="ai.ensureOverview()"
        @rerun="ai.runCurrentAiAnalysis()"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 对局详情「复盘」标签页容器：持有选中玩家与联动状态（悬停/定位的阵亡、展开的曲线标记），
 * 装配视图模型（useReviewModel）并驱动 AI 点评（useMatchAIAnalysis：打开即整局、单人按需）。
 * 图表全部由代码确定性生成，不依赖 AI；AI 引用 [D4]/[F2] 点击后定位到对应阵亡/团战。
 * @property game - 当前对局
 * @expose focusPlayer(pid, withAi) - 记分板行内入口：切到该玩家，可选同时生成单人点评
 */
import { computed, nextTick, ref, watch } from 'vue'
import { NSkeleton } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import { useMatchAIAnalysis } from '@renderer/composables/useMatchAIAnalysis'
import { useReviewModel } from '@renderer/composables/useReviewModel'
import { REMAKE_MAX_SECONDS } from '@renderer/services/ai/matchDetail'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import AiCommentary from './AiCommentary.vue'
import DeathList from './DeathList.vue'
import DeathMap from './DeathMap.vue'
import GoldCurve from './GoldCurve.vue'
import ItemTimeline from './ItemTimeline.vue'
import MatchupBoard from './MatchupBoard.vue'
import PlayerScoreCard from './PlayerScoreCard.vue'

const props = defineProps<{ game: Game }>()

const gameGetter = () => props.game
const { model, timelinePending, timelineStatus, isRemake, failed } = useReviewModel(gameGetter)
const ai = useMatchAIAnalysis(gameGetter)

const selectedPid = ref<number | null>(null)
const hoverDeath = ref<number | null>(null)
const focusDeath = ref<number | null>(null)
const openMarker = ref<string | null>(null)
const curveRef = ref<InstanceType<typeof GoldCurve> | null>(null)

const m = computed(() => model.value)
const selected = computed<PlayerView | null>(() => {
  const pid = selectedPid.value
  return m.value && pid !== null ? (m.value.players[pid] ?? null) : null
})

/** 阵亡地图只画召唤师峡谷（mapId 11）：需分路 + 时间线，与视图模型的 hasLanes/hasTimeline 同口径 */
const SUMMONERS_RIFT_MAP_ID = 11
const showMap = computed(
  () =>
    !!m.value && m.value.mapId === SUMMONERS_RIFT_MAP_ID && m.value.hasLanes && m.value.hasTimeline
)

/** 无时间线提示：区分用户主动关闭与拉取失败/地图不支持 */
const timelineNotice = computed(() => {
  const cause = timelineStatus.value === 'disabled' ? '已在设置中关闭时间线' : '本局时间线不可用'
  return `${cause}：经济曲线、阵亡地图与出装对比已隐藏，阵亡无法细分责任。`
})

const winnerText = computed(() => {
  const w = m.value?.header.winner
  return w === 'blue' ? '蓝方胜' : w === 'red' ? '红方胜' : '胜负未知'
})

// 换对局：清空联动状态，作废旧点评并自动生成整局点评
watch(
  () => props.game.gameId,
  () => {
    selectedPid.value = null
    hoverDeath.value = null
    focusDeath.value = null
    openMarker.value = null
    ai.resetOnGameChange()
    // 重开局没有可点评的数据（门面也会短路），不发请求
    if (props.game.gameDuration >= REMAKE_MAX_SECONDS) void ai.ensureOverview()
  },
  { immediate: true }
)

// 模型就绪后默认选中本人（用户已选过的保持不变；时间线到达重建模型时 pid 不变）
watch(
  () => m.value?.defaultPid,
  pid => {
    if (selectedPid.value === null && pid != null) selectedPid.value = pid
  },
  { immediate: true }
)

function selectPlayer(pid: number): void {
  selectedPid.value = pid
  hoverDeath.value = null
  focusDeath.value = null
}

const itemProps = computed(() => {
  const mm = m.value
  const p = selected.value
  if (!mm || !p || !mm.hasTimeline || !mm.hasItemBuild || p.items.length === 0) return null
  const opp = p.opponentId !== null ? mm.players[p.opponentId] : undefined
  return {
    mine: { label: p.champion, items: p.items },
    other: opp ? { label: opp.champion, items: opp.items } : null,
    medianMs: mm.hasLanes ? null : mm.medianFirstLegendaryMs,
    endMs: mm.durationMs
  }
})

const aiTitle = computed(() => {
  if (ai.aiMode.value !== 'player') return '整局点评'
  const pid = ai.aiTargetParticipantId.value
  const p = pid !== null ? m.value?.players[pid] : undefined
  return `${p?.champion ?? ''} 单人点评`
})

/** 切换玩家不自动重跑：当前点评不是该玩家的单人点评时给出按钮 */
const playerActionLabel = computed(() => {
  const p = selected.value
  if (!p) return null
  if (ai.aiMode.value === 'player' && ai.aiTargetParticipantId.value === p.participantId)
    return null
  return `生成${p.champion}的点评`
})

/**
 * AI 引用定位：D 卡 → 选中死者并高亮该次阵亡；F 卡 → 展开曲线上的团战弹出卡。
 * 只有 D / F 两类编号可跳转（死亡 / 团战）；其余前缀（技能、出装等）仅悬停看原文，点击无动作——
 * 过滤就在这里（函数内对 D、F 之外的前缀直接 return）。
 */
async function onCite(id: string): Promise<void> {
  const mm = m.value
  if (!mm) return
  if (id.startsWith('F')) {
    openMarker.value = id
    const el = curveRef.value?.$el as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    return
  }
  if (!id.startsWith('D')) return
  for (const p of Object.values(mm.players)) {
    const hit = p.deathList?.find(d => d.cardId === id)
    if (!hit) continue
    selectedPid.value = p.participantId
    hoverDeath.value = hit.index
    // DeathList 只在 focused 变化时滚动：重复点同一条引用要先复位再设值，才会再次滚动/高亮
    if (focusDeath.value === hit.index) {
      focusDeath.value = null
      await nextTick()
    }
    focusDeath.value = hit.index
    return
  }
}

defineExpose({
  /** 切到某玩家；withAi 时同时生成其单人点评 */
  focusPlayer(pid: number, withAi = false): void {
    selectPlayer(pid)
    if (withAi) void ai.requestPlayer(pid)
  }
})
</script>

<style scoped>
.review-tab {
  /* 责任配色：子组件统一读这些变量；阵营色 --side-blue/--side-red 见 global.css */
  --resp-self: var(--semantic-loss);
  --resp-partial: var(--semantic-warn);
  --resp-excused: var(--semantic-win);
  --resp-fight: var(--text-tertiary);
  --resp-other: var(--text-tertiary);
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.review-box {
  padding: var(--space-10) var(--space-12);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  min-width: 0;
}

.review-empty,
.review-notice {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.review-notice {
  border-style: dashed;
}

.review-row {
  display: flex;
  gap: var(--space-10);
  align-items: stretch;
}

.review-row > .review-box {
  flex: 1;
}

.review-row > .review-box--wide {
  flex: 1.25;
}

.review-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}

.review-header-main {
  font-size: var(--font-size-lg);
}

.review-header-main .is-blue {
  color: var(--side-blue);
}

.review-header-main .is-red {
  color: var(--side-red);
}

.review-header-meta {
  margin-left: var(--space-6);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.review-header-reason {
  max-width: 60%;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.review-tab :deep(.review-section-title) {
  margin-bottom: var(--space-6);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

/* 详情窗变窄时两列区改为纵向堆叠 */
@media (max-width: 980px) {
  .review-row {
    flex-direction: column;
  }

  .review-header-reason {
    max-width: none;
  }
}
</style>
