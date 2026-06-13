<template>
  <div class="loading-wrap">
    <div class="loading-content">
      <div class="loading-visual" aria-hidden="true">
        <div class="loading-track" />
        <div class="loading-ring" />
        <div class="loading-center">⚔</div>
      </div>
      <div class="loading-text-block">
        <p class="loading-text"><slot /></p>
        <p class="loading-hint">{{ hint ?? '请确保英雄联盟客户端已启动' }}</p>
        <slot name="action" />
      </div>
      <div class="loading-shimmer-bar" />
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
  border-right-color: rgba(61, 155, 122, 0.35);
  animation: loading-spin 1.2s cubic-bezier(0.6, 0.2, 0.4, 0.9) infinite;
  filter: drop-shadow(0 0 6px rgba(61, 155, 122, 0.4));
}

.loading-center {
  position: relative;
  z-index: 1;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(61, 155, 122, 0.08);
  border: 1px solid rgba(61, 155, 122, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  animation: loading-pulse 2s ease-in-out infinite;
}

.loading-text-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.loading-text {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}

.loading-hint {
  margin: 0;
  font-size: 10px;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

.loading-shimmer-bar {
  width: 120px;
  height: 2px;
  border-radius: 99px;
  background: linear-gradient(
    90deg,
    rgba(61, 155, 122, 0) 0%,
    rgba(61, 155, 122, 0.5) 40%,
    rgba(61, 155, 122, 0.7) 50%,
    rgba(61, 155, 122, 0.5) 60%,
    rgba(61, 155, 122, 0) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes loading-pulse {
  0%,
  100% {
    transform: scale(0.95);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
}

/* 亮色主题 */
.theme-light .loading-ring {
  border-right-color: rgba(45, 138, 108, 0.3);
  filter: drop-shadow(0 0 5px rgba(45, 138, 108, 0.35));
}

.theme-light .loading-center {
  background: rgba(45, 138, 108, 0.08);
  border-color: rgba(45, 138, 108, 0.2);
}

.theme-light .loading-shimmer-bar {
  background: linear-gradient(
    90deg,
    rgba(45, 138, 108, 0) 0%,
    rgba(45, 138, 108, 0.4) 40%,
    rgba(45, 138, 108, 0.6) 50%,
    rgba(45, 138, 108, 0.4) 60%,
    rgba(45, 138, 108, 0) 100%
  );
  background-size: 200% 100%;
}
</style>
