<script setup lang="ts">
/**
 * 对局页「本局战报」：排位结束后显示胜负、KDA、LP 变化与隐藏分，右侧是标注卡与战报图。
 * 评分来自复盘视图模型（不依赖时间线）；「看完整复盘」打开对局详情窗口。
 *
 * 版式（2026-11-21）：顶部是英雄原画打底的结果横幅（与赛后弹卡、战报图同一套视觉），
 * 下面放交互。横幅高度固定——试过把结果区放左侧整列，战报图一展开那一列就被拉成
 * 一长条，原画被裁成看不出是什么的局部。横幅配色固定在深色、不跟主题：原画本身是
 * 深色图，亮色主题下用主题色压字会看不清。
 *
 * 先猜再揭晓（2026-11-17）：有标注卡时，战报图在标注提交后才出现——先让玩家凭自己判断标，
 * 再揭晓 AI 结论和战报图，揭晓那一刻顺手分享；标注数据也保持「未受模型影响」。
 * 不想标可以点「跳过，直接看战报图」。没有标注卡（无国服基准的队列）时直接显示。
 * @property report - 战报数据（usePostGameReport）
 * @emits dismiss - 玩家点「收起」
 */
import { computed, ref, watch } from 'vue'
import { NButton, NSkeleton } from 'naive-ui'
import {
  formatDuration,
  formatLp,
  formatMmr,
  reportMeta,
  type PostGameReport
} from '@renderer/composables/usePostGameReport'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { useReviewModel } from '@renderer/composables/useReviewModel'
import { openMatchDetailWindow } from '@renderer/components/record/detailWindow'
import LabelCard from '@renderer/components/record/review/LabelCard.vue'
import ShareCardPanel from './ShareCardPanel.vue'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'

const props = defineProps<{ report: PostGameReport }>()
const emit = defineEmits<{ (e: 'dismiss'): void }>()

const { model } = useReviewModel(() => props.report.game)
const { getChampionUrl, getSplashUrl } = useAssetUrl()

const players = computed<PlayerView[]>(() =>
  model.value
    ? Object.values(model.value.players).sort((a, b) => a.participantId - b.participantId)
    : []
)
const me = computed(() => players.value.find(p => p.isMe) ?? null)

const minutes = computed(() => formatDuration(props.report.game.gameDuration))
const lpText = computed(() => formatLp(props.report.lpDelta))
const mmrText = computed(() => formatMmr(props.report.mmr))

/** 原画加载失败（离线、镜像不可达）时退回头像 */
const splashBroken = ref(false)

/** 战报图已揭晓（标注提交 / 恢复已有标注 / 玩家跳过） */
const revealed = ref(false)
watch(
  () => props.report.game.gameId,
  () => {
    revealed.value = false
    splashBroken.value = false
  }
)

/** 战报图底部小字：时长、LP、隐藏分 */
const shareMeta = computed(() => reportMeta(props.report))

function openReview(): void {
  void openMatchDetailWindow(props.report.game)
}
</script>

<template>
  <section
    class="post-game-report"
    :class="me ? (me.win ? 'is-win' : 'is-loss') : ''"
    data-test="post-game-report"
  >
    <header class="pgr-hero">
      <template v-if="me">
        <img
          v-if="!splashBroken"
          class="pgr-splash"
          :src="getSplashUrl(me.championId)"
          alt=""
          @error="splashBroken = true"
        />
        <img v-else class="pgr-splash is-icon" :src="getChampionUrl(me.championId)" alt="" />
      </template>
      <div class="pgr-hero-shade" />
      <div class="pgr-hero-body">
        <template v-if="me">
          <span class="pgr-result">{{ me.win ? '胜利' : '失败' }}</span>
          <div class="pgr-kda font-number">
            {{ me.kills }}<i>/</i>{{ me.deaths }}<i>/</i>{{ me.assists }}
          </div>
          <div class="pgr-info">
            <div class="pgr-champ">{{ me.champion }} · {{ minutes }}</div>
            <div v-if="lpText || mmrText" class="pgr-chips">
              <span
                v-if="lpText"
                class="pgr-chip pgr-lp"
                :class="report.lpDelta! >= 0 ? 'is-up' : 'is-down'"
                >{{ lpText }}</span
              >
              <span v-if="mmrText" class="pgr-chip pgr-mmr">{{ mmrText }}</span>
            </div>
          </div>
        </template>
        <span v-else class="pgr-pending">本局战报生成中…</span>
        <div class="pgr-actions">
          <button type="button" class="pgr-btn" data-test="pgr-open" @click="openReview">
            看完整复盘 ›
          </button>
          <button type="button" class="pgr-btn" data-test="pgr-dismiss" @click="emit('dismiss')">
            收起
          </button>
        </div>
      </div>
    </header>

    <div class="pgr-main">
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
          <span class="pgr-lock" aria-hidden="true">?</span>
          先猜猜 AI 怎么判，提交后揭晓你的战报图
          <n-button text size="tiny" data-test="pgr-reveal-skip" @click="revealed = true"
            >跳过，直接看战报图</n-button
          >
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.post-game-report {
  --pgr-accent: var(--text-tertiary);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--pgr-accent) 30%, var(--border-subtle));
  overflow: hidden;
}
.post-game-report.is-win {
  --pgr-accent: var(--semantic-win);
}
.post-game-report.is-loss {
  --pgr-accent: var(--semantic-loss);
}

/* ── 结果横幅：原画打底，高度固定，配色固定在深色 ── */
.pgr-hero {
  --pgr-hero-bg: #0d1017;
  position: relative;
  flex: none;
  height: 84px;
  background: var(--pgr-hero-bg);
  color: #f1f3f8;
  overflow: hidden;
}
/* 原画只占右侧一段，左侧留给文字 */
.pgr-splash {
  position: absolute;
  top: 0;
  right: 0;
  width: min(62%, 720px);
  height: 100%;
  object-fit: cover;
  object-position: 50% 24%;
}
.pgr-splash.is-icon {
  filter: blur(8px) saturate(1.1);
  transform: scale(1.3);
}
.pgr-hero-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      90deg,
      var(--pgr-hero-bg) 34%,
      rgba(13, 16, 23, 0.72) 58%,
      rgba(13, 16, 23, 0.35) 100%
    ),
    linear-gradient(90deg, color-mix(in srgb, var(--pgr-accent) 30%, transparent), transparent 46%);
}
.pgr-hero-body {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  padding: 0 var(--space-12) 0 var(--space-16);
  display: flex;
  align-items: center;
  gap: var(--space-16);
}
.pgr-result {
  flex: none;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 2px;
  color: #fff;
  background: color-mix(in srgb, var(--pgr-accent) 60%, rgba(0, 0, 0, 0.35));
}
.pgr-kda {
  flex: none;
  font-size: 34px;
  line-height: 1;
  letter-spacing: 1px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}
.pgr-kda i {
  margin: 0 3px;
  font-style: normal;
  opacity: 0.45;
}
.pgr-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.pgr-champ {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
}
.pgr-chips {
  display: flex;
  gap: var(--space-6);
}
.pgr-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  color: rgba(241, 243, 248, 0.82);
  background: rgba(13, 16, 23, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.pgr-lp {
  font-weight: var(--font-weight-semibold);
}
.pgr-lp.is-up {
  color: #7be0b0;
  border-color: rgba(123, 224, 176, 0.4);
}
.pgr-lp.is-down {
  color: #ff9a9d;
  border-color: rgba(255, 154, 157, 0.4);
}
.pgr-pending {
  font-size: var(--font-size-sm);
  color: rgba(241, 243, 248, 0.7);
}
.pgr-actions {
  margin-left: auto;
  align-self: flex-start;
  padding-top: var(--space-8);
  display: flex;
  gap: var(--space-6);
}
/* 横幅上的按钮不用主题按钮：亮色主题下主题文字色是深色，压在深色原画上看不见 */
.pgr-btn {
  appearance: none;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(13, 16, 23, 0.5);
  color: rgba(241, 243, 248, 0.82);
  font: inherit;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition:
    background var(--dur-fast),
    color var(--dur-fast);
}
.pgr-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}
.pgr-btn:focus-visible {
  outline: 1px solid #fff;
  outline-offset: 1px;
}

/* ── 交互区 ── */
.pgr-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-12) var(--space-16) var(--space-16);
}
.pgr-reveal-hint {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.pgr-lock {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  background: var(--surface-group);
  border: 1px dashed var(--border-subtle);
}
</style>
