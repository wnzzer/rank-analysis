<script setup lang="ts">
/**
 * 对局页「本局战报」：排位结束后显示胜负、KDA、LP 变化与隐藏分，下面是标注卡。
 * 评分来自复盘视图模型（不依赖时间线）；「看完整复盘」打开对局详情窗口。
 *
 * 先猜再揭晓（2026-11-17）：有标注卡时，战报图在标注提交后才出现——先让玩家凭自己判断标，
 * 再揭晓 AI 结论和战报图，揭晓那一刻顺手分享；标注数据也保持「未受模型影响」。
 * 不想标可以点「跳过，直接看战报图」。没有标注卡（无国服基准的队列）时直接显示。
 * @property report - 战报数据（usePostGameReport）
 * @emits dismiss - 玩家点「跳过」
 */
import { computed, ref, watch } from 'vue'
import { NButton, NSkeleton } from 'naive-ui'
import type { PostGameReport } from '@renderer/composables/usePostGameReport'
import { useReviewModel } from '@renderer/composables/useReviewModel'
import { openMatchDetailWindow } from '@renderer/components/record/detailWindow'
import LabelCard from '@renderer/components/record/review/LabelCard.vue'
import ShareCardPanel from './ShareCardPanel.vue'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'

const props = defineProps<{ report: PostGameReport }>()
const emit = defineEmits<{ (e: 'dismiss'): void }>()

const { model } = useReviewModel(() => props.report.game)

const players = computed<PlayerView[]>(() =>
  model.value
    ? Object.values(model.value.players).sort((a, b) => a.participantId - b.participantId)
    : []
)
const me = computed(() => players.value.find(p => p.isMe) ?? null)

const minutes = computed(() => {
  const s = props.report.game.gameDuration
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

const lpText = computed(() => {
  const d = props.report.lpDelta
  if (d === null) return null
  return `${d > 0 ? '+' : ''}${d} LP`
})

const mmrText = computed(() => {
  const m = props.report.mmr
  if (m?.status !== 'ready') return null
  const dir = m.direction === 'up' ? '高于段位' : m.direction === 'down' ? '低于段位' : '持平'
  return `隐藏分 ≈ ${m.equivalentShort} · ${dir}`
})

/** 战报图已揭晓（标注提交 / 恢复已有标注 / 玩家跳过） */
const revealed = ref(false)
watch(
  () => props.report.game.gameId,
  () => (revealed.value = false)
)

/** 战报图底部小字：时长、LP、隐藏分 */
const shareMeta = computed(() =>
  [`${minutes.value}`, lpText.value, mmrText.value].filter((x): x is string => !!x)
)

function openReview(): void {
  void openMatchDetailWindow(props.report.game)
}
</script>

<template>
  <section class="post-game-report" data-test="post-game-report">
    <header class="pgr-head">
      <div class="pgr-title">
        <b>本局战报</b>
        <template v-if="me">
          <span class="pgr-result" :class="me.win ? 'is-win' : 'is-loss'">{{
            me.win ? '胜利' : '失败'
          }}</span>
          <span class="pgr-meta"
            >{{ me.champion }} {{ me.kills }}/{{ me.deaths }}/{{ me.assists }} · {{ minutes
            }}<template v-if="lpText"> · </template></span
          >
          <span v-if="lpText" class="pgr-lp" :class="report.lpDelta! >= 0 ? 'is-win' : 'is-loss'">{{
            lpText
          }}</span>
        </template>
      </div>
      <div class="pgr-actions">
        <n-button text size="small" data-test="pgr-open" @click="openReview">看完整复盘 ›</n-button>
        <n-button text size="small" data-test="pgr-dismiss" @click="emit('dismiss')">跳过</n-button>
      </div>
    </header>
    <div v-if="mmrText" class="pgr-mmr">{{ mmrText }}</div>

    <n-skeleton v-if="!model" text :repeat="3" />
    <template v-else>
      <LabelCard
        v-if="model.hasBaseline"
        :key="report.game.gameId"
        :players="players"
        :game-id="report.game.gameId"
        :platform="report.game.platformId"
        :queue-id="report.game.queueId"
        @done="revealed = true"
      />
      <ShareCardPanel
        v-if="revealed || !model.hasBaseline"
        :key="`share-${report.game.gameId}`"
        :model="model"
        :meta="shareMeta"
      />
      <div v-else class="pgr-reveal-hint">
        先猜猜 AI 怎么判，提交后揭晓你的战报图 ·
        <n-button text size="tiny" data-test="pgr-reveal-skip" @click="revealed = true"
          >跳过，直接看战报图</n-button
        >
      </div>
    </template>
  </section>
</template>

<style scoped>
.post-game-report {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12);
  border-radius: var(--radius-md);
  background: var(--surface-group);
  border: 1px solid var(--border-subtle);
}
.pgr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}
.pgr-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
  font-size: var(--font-size-md);
}
.pgr-result {
  font-weight: var(--font-weight-semibold);
}
.pgr-meta {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.pgr-lp {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}
.is-win {
  color: var(--semantic-win);
}
.is-loss {
  color: var(--semantic-loss);
}
.pgr-actions {
  display: flex;
  gap: var(--space-12);
}
.pgr-reveal-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.pgr-mmr {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
</style>
