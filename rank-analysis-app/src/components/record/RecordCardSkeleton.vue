<template>
  <!-- 与 RecordCard 同一套列轨道（--record-card-columns）+ 同款统计盒尺寸：
       数据到达原地替换，卡片高度不跳 -->
  <n-card class="record-card-skeleton" :content-style="contentStyleStr" aria-hidden="true">
    <div class="record-card-skeleton-grid">
      <div class="sk-stack">
        <span class="sk sk-result" />
        <span class="sk sk-meta" />
      </div>
      <span class="sk sk-champion" />
      <div class="sk-stack">
        <span class="sk sk-queue" />
        <span class="sk sk-meta" />
      </div>
      <div class="sk-stack">
        <span class="sk sk-kda" />
        <div class="sk-row">
          <span v-for="i in 7" :key="i" class="sk sk-icon" />
        </div>
      </div>
      <div class="record-card-skeleton-stats">
        <div v-for="i in 3" :key="i" class="sk-stat-row">
          <span class="sk sk-stat-icon" />
          <span class="sk sk-stat-bar" />
        </div>
      </div>
      <div class="sk-stack">
        <span class="sk sk-team" />
        <span class="sk sk-team" />
      </div>
    </div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 战绩卡骨架屏
 *
 * 列轨道与统计盒尺寸和 RecordCard 保持一致，保证骨架→真卡原地替换、高度不跳。
 */
import { NCard } from 'naive-ui'

/** 与 RecordCard 的 content-style 一致，保证内边距相同 */
const contentStyleStr = 'padding: var(--space-8) var(--space-12);'
</script>

<style scoped>
/* 卡底用 bg-elevated：暗色≈真卡的玻璃底，亮色=真卡的白纸底，两主题都不换色跳 */
.record-card-skeleton {
  border-radius: var(--radius-lg);
  background: var(--bg-elevated) !important;
  border: 1px solid var(--glass-border) !important;
}

.record-card-skeleton-grid {
  display: grid;
  grid-template-columns: var(--record-card-columns);
  justify-content: space-between;
  align-items: center;
  gap: var(--space-8);
}

.sk-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.sk-row {
  display: flex;
  gap: var(--space-2);
}

.sk-result {
  width: 40px;
  height: 14px;
}

.sk-meta {
  width: 32px;
  height: 10px;
}

.sk-champion {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-md);
}

.sk-queue {
  width: 56px;
  height: 14px;
}

.sk-kda {
  width: 96px;
  height: 14px;
}

.sk-icon {
  width: 24px;
  height: 24px;
}

/* 与 RecordCard .record-card-stats-block 同内边距/边框 + 3 行 × 18px（StatDots 图标高）
   → 同高，决定整张卡的高度 */
.record-card-skeleton-stats {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.sk-stat-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  height: 18px;
}

.sk-stat-icon {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-control);
}

.sk-stat-bar {
  flex: 1;
  height: 8px;
}

.sk-team {
  width: 100%;
  height: 20px;
  border-radius: var(--radius-pill);
}
</style>
