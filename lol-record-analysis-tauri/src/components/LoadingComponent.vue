<template>
  <div class="loading-wrap">
    <div class="loading-content">
      <div class="loading-visual" aria-hidden="true">
        <div class="loading-ring" />
        <div class="loading-ring-inner" />
        <div class="loading-dots">
          <span class="loading-dot loading-dot--1" />
          <span class="loading-dot loading-dot--2" />
          <span class="loading-dot loading-dot--3" />
        </div>
      </div>
      <p class="loading-text"><slot /></p>
    </div>
  </div>
</template>
<script lang="ts" setup></script>

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
  gap: var(--space-24);
}

.loading-visual {
  position: relative;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 旋转渐变环：翠绿 → 青蓝 */
.loading-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, #3d9b7a, #22c3a6, #38bdf8, #0ea5e9, #3d9b7a);
  animation: loading-spin 1.6s linear infinite;
  filter: drop-shadow(0 0 10px rgba(61, 155, 122, 0.35))
    drop-shadow(0 0 20px rgba(56, 189, 248, 0.2));
}

.loading-ring-inner {
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-base);
  z-index: 1;
}

/* 中心三点，与环配色呼应 */
.loading-dots {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: loading-bounce 1.4s ease-in-out infinite both;
}

.loading-dot--1 {
  background: linear-gradient(135deg, #4ade80, #22c3a6);
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.5);
  animation-delay: 0s;
}

.loading-dot--2 {
  background: linear-gradient(135deg, #22c3a6, #38bdf8);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.4);
  animation-delay: 0.16s;
}

.loading-dot--3 {
  background: linear-gradient(135deg, #38bdf8, #0ea5e9);
  box-shadow: 0 0 8px rgba(14, 165, 233, 0.4);
  animation-delay: 0.32s;
}

.loading-text {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  animation: loading-text-pulse 2s ease-in-out infinite;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes loading-bounce {
  0%,
  80%,
  100% {
    transform: scale(0.75);
    opacity: 0.7;
  }
  40% {
    transform: scale(1.1);
    opacity: 1;
  }
}

@keyframes loading-text-pulse {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}

/* 亮色主题：降低亮度、保持对比 */
.theme-light .loading-ring {
  background: conic-gradient(from 0deg, #2d8a6c, #0d9668, #0284c7, #0369a1, #2d8a6c);
  filter: drop-shadow(0 0 8px rgba(45, 138, 108, 0.3)) drop-shadow(0 0 14px rgba(2, 132, 199, 0.2));
}

.theme-light .loading-dot--1 {
  background: linear-gradient(135deg, #0d9668, #0f766e);
  box-shadow: 0 0 6px rgba(13, 150, 104, 0.45);
}

.theme-light .loading-dot--2 {
  background: linear-gradient(135deg, #0f766e, #0284c7);
  box-shadow: 0 0 6px rgba(2, 132, 199, 0.35);
}

.theme-light .loading-dot--3 {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  box-shadow: 0 0 6px rgba(3, 105, 161, 0.35);
}
</style>
