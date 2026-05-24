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
        <div class="kda-text">
          <span class="kill">{{ game.participants[0].stats?.kills }}</span>
          / <span class="death">{{ game.participants[0].stats?.deaths }}</span> /
          <span class="assist">{{ game.participants[0].stats?.assists }}</span>
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

/* 固定列宽 grid：胜负 / 头像 / KDA / 模式 —— 跨行跨卡片严格对齐 */
/* 模式列宽也随 viewport 平滑放大 (60→80px), 配合 queue-name 字号 10→14px 容纳 5 字"海克斯乱斗" */
/* minmax(0, 1fr) 阻止 KDA 大数字 (15/10/33) 把 1fr 列撑大挤掉 queue 列 */
.history-row {
  display: grid;
  grid-template-columns: 18px 24px minmax(0, 1fr) clamp(60px, calc(60px + (100vw - 900px) * 20 / 2100), 80px);
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
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-weight: var(--font-weight-bold);
  /* 12→18px 随 viewport 平滑放大 (900→3000) */
  font-size: clamp(12px, calc(12px + (100vw - 900px) * 6 / 2100), 18px);
  /* tabular-nums: 数字等宽，确保 5/17/20 与 23/12/39 的斜杠纵向对齐 */
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
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
