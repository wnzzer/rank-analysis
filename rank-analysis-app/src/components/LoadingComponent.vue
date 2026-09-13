<template>
  <div class="loading-wrap">
    <div class="loading-content">
      <!-- 只保留一个转圈：原中心 ⚔ emoji 跨系统渲染不一致，下方扫光条与转圈是重复的加载指示 -->
      <div class="loading-visual" aria-hidden="true">
        <div class="loading-track" />
        <div class="loading-ring" />
      </div>
      <div class="loading-text-block">
        <p class="loading-text"><slot /></p>
        <p class="loading-hint">{{ hint ?? '请确保英雄联盟客户端已启动' }}</p>
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
/**
 * 加载/等待态展示组件
 * @property hint - 覆盖默认副提示文案（如权限不足时的具体说明）
 * @slot default - 主提示文案
 * @slot action - 副提示下方的操作区（如"以管理员身份重启"按钮）
 */
defineProps<{ hint?: string }>()
</script>

<style lang="css" scoped>
.loading-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;
  min-height: 160px;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-20);
}

.loading-visual {
  position: relative;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-track {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--border-subtle);
}

.loading-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--semantic-win);
  border-right-color: color-mix(in srgb, var(--semantic-win) 35%, transparent);
  animation: loading-spin 1.2s cubic-bezier(0.6, 0.2, 0.4, 0.9) infinite;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--semantic-win) 40%, transparent));
}

.loading-text-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}

.loading-text {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}

.loading-hint {
  margin: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 亮色主题 */
.theme-light .loading-ring {
  border-right-color: color-mix(in srgb, var(--semantic-win) 30%, transparent);
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--semantic-win) 35%, transparent));
}
</style>
