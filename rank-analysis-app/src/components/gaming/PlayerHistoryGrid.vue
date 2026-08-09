<template>
  <div class="history-grid">
    <div
      v-for="(game, index) in games"
      :key="index"
      class="history-item"
      :class="{ 'is-win': game.participants[0].stats.win }"
    >
      <div class="history-row">
        <span class="win-status" :class="{ 'is-win': game.participants[0].stats.win }">
          {{ game.participants[0].stats.win ? '胜' : '负' }}
        </span>
        <LazyImg
          :src="assetPrefix + '/champion/' + game.participants[0]?.championId"
          alt="champion"
          class="history-champ-img"
        />
        <!-- font-number: 与战绩页 RecordCard 同款 Oswald 数字字体；分隔符弱化不抢数字 -->
        <div class="kda-text font-number">
          <span class="kill">{{ game.participants[0].stats?.kills }}</span
          ><span class="kda-sep">/</span
          ><span class="death">{{ game.participants[0].stats?.deaths }}</span
          ><span class="kda-sep">/</span
          ><span class="assist">{{ game.participants[0].stats?.assists }}</span>
        </div>
        <n-tooltip trigger="hover">
          <template #trigger>
            <span class="queue-name">{{ game.queueName || '其他' }}</span>
          </template>
          {{ game.queueName || '其他' }}
        </n-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NTooltip } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'

defineProps<{ games: Game[] }>()
</script>

<style scoped>
.history-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* 行按内容高度，避免被 stretch 撑高 */
  grid-auto-rows: min-content;
  /* 行集合在 grid 容器内垂直居中 */
  align-content: center;
  /* 列间 3px 紧凑，行间 6px 配合 1 屏布局 */
  column-gap: 3px;
  row-gap: var(--space-6);
  flex: 1;
  overflow-y: auto;
  /* 锁住横向滚动 (内部 history-item 偶尔 min-content 超出, 不能让浏览器自动加 X 滚动条) */
  overflow-x: hidden;
  /* 1fr 1fr 想要平分 → item 必须能 shrink 到 fraction 单位下 */
  min-width: 0;
}

.history-item {
  /* 允许 grid 1fr 把 item 压到比 min-content 还小 (内部 KDA / queue 已有 ellipsis/clip 兜底) */
  min-width: 0;
}

.history-item {
  background: var(--glass-bg-low);
  border-radius: var(--radius-sm);
  /* P0 收紧到 4px 配合 1 屏 4 场布局 */
  padding: var(--space-4) 5px;
  font-size: var(--font-size-2xs);
  border: 1px solid var(--glass-border);
  /* P1: 左侧锚点 2px + 半透明，更轻盈 */
  border-left-width: 2px;
  border-left-color: color-mix(in srgb, var(--semantic-loss) 70%, transparent);
}

.history-item.is-win {
  border-left-color: color-mix(in srgb, var(--semantic-win) 70%, transparent);
}

/* 列宽策略：胜负(定宽) / 头像(自适应图) / KDA(max-content 永不裁数字) / 模式(弹性+省略号)。
   旧版 KDA 用 minmax(0,1fr)+nowrap，KDA 大数字(27/10/19)超出列宽时直接压到模式列上
  （「海克斯乱斗」等长模式名尤其明显）；数字必须完整，模式名可省略（有 hover tooltip 兜底） */
.history-row {
  display: grid;
  grid-template-columns: 18px auto max-content minmax(0, 1fr);
  align-items: center;
  gap: var(--space-6);
}

.win-status {
  /* 11→16px 随 viewport 平滑放大 (900→3000) */
  font-size: clamp(11px, calc(11px + (100vw - 900px) * 5 / 2100), 16px);
  font-weight: var(--font-weight-bold);
  color: var(--semantic-loss);
  text-align: center;
}

.win-status.is-win {
  color: var(--semantic-win);
}

/* 22→36px 随 viewport 平滑放大 (900→3000) */
.history-champ-img {
  width: clamp(22px, calc(22px + (100vw - 900px) * 14 / 2100), 36px);
  height: clamp(22px, calc(22px + (100vw - 900px) * 14 / 2100), 36px);
  border-radius: 50%;
}

.history-champ-img :deep(img) {
  object-fit: cover;
}

.kda-text {
  font-weight: var(--font-weight-bold);
  /* 12→18px 随 viewport 平滑放大 (900→3000) */
  font-size: clamp(12px, calc(12px + (100vw - 900px) * 6 / 2100), 18px);
  /* tabular-nums: 数字等宽，确保 5/17/20 与 23/12/39 的斜杠纵向对齐 */
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
}

/* 每个数字占 2ch 槽位居中：K/D/A 位数不同（4 vs 46）时斜杠位置仍逐行对齐，
   三位数极端值靠 min-width 自然撑开（只影响该行） */
.kill,
.death,
.assist {
  display: inline-block;
  min-width: 2ch;
  text-align: center;
}

.kill {
  color: var(--semantic-win);
}

.death {
  color: var(--semantic-loss);
}

.assist {
  color: var(--text-secondary);
}

.kda-sep {
  color: var(--text-tertiary);
  font-weight: var(--font-weight-normal, 400);
  margin: 0 1px;
}

.queue-name {
  /* 10→14px 随 viewport 平滑放大 (900→3000) */
  font-size: clamp(10px, calc(10px + (100vw - 900px) * 4 / 2100), 14px);
  color: var(--n-text-color-3);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
