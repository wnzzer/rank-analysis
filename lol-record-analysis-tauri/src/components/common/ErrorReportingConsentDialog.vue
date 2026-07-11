<template>
  <n-modal
    :show="show"
    :mask-closable="false"
    :close-on-esc="false"
    :auto-focus="false"
    transform-origin="center"
    @update:show="$emit('update:show', $event)"
  >
    <div class="consent-card" role="dialog" aria-labelledby="consent-title">
      <!-- 顶部柔光 -->
      <div class="consent-glow" aria-hidden="true" />

      <!-- 图标光环 -->
      <div class="consent-icon-halo">
        <n-icon class="consent-icon"><ShieldCheckmarkOutline /></n-icon>
      </div>

      <h2 id="consent-title" class="consent-title">帮助改进应用？</h2>
      <p class="consent-lead">崩溃和报错自动上报，让我能更快修掉你遇到的问题。</p>

      <!-- 隐私要点 -->
      <ul class="consent-points">
        <li class="consent-point" style="--i: 0">
          <span class="consent-point-icon"
            ><n-icon><LockClosedOutline /></n-icon
          ></span>
          <span class="consent-point-text">
            <span class="consent-point-title">只发报错堆栈</span>
            <span class="consent-point-sub">不含召唤师名 / puuid / 任何对局数据</span>
          </span>
        </li>
        <li class="consent-point" style="--i: 1">
          <span class="consent-point-icon"
            ><n-icon><CodeSlashOutline /></n-icon
          ></span>
          <span class="consent-point-text">
            <span class="consent-point-title">开源可查</span>
            <span class="consent-point-sub">上报了什么，代码里都能看到</span>
          </span>
        </li>
        <li class="consent-point" style="--i: 2">
          <span class="consent-point-icon"
            ><n-icon><ToggleOutline /></n-icon
          ></span>
          <span class="consent-point-text">
            <span class="consent-point-title">默认关闭，随时可关</span>
            <span class="consent-point-sub">设置 → 常规设置 里随时改</span>
          </span>
        </li>
      </ul>

      <div class="consent-actions">
        <n-button class="consent-btn-ghost" size="medium" @click="$emit('decide', false)">
          不，保持关闭
        </n-button>
        <n-button
          type="primary"
          size="medium"
          class="consent-btn-primary"
          @click="$emit('decide', true)"
        >
          好，帮忙改进
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * 错误上报首次同意弹窗（视觉组件）
 *
 * 只负责展示与发出用户选择，不读写配置——由父组件（Framework）持久化。
 * 视觉风格对齐应用的玻璃暗色 + 绿色品牌调，强调"隐私可控 / 开源透明"的信任感。
 *
 * @see commit 6163f86（Sentry opt-in 接入）
 */
import { NModal, NIcon, NButton } from 'naive-ui'
import {
  ShieldCheckmarkOutline,
  LockClosedOutline,
  CodeSlashOutline,
  ToggleOutline
} from '@vicons/ionicons5'

defineProps<{
  /** 是否显示 */
  show: boolean
}>()

defineEmits<{
  /** 受控显隐 */
  (e: 'update:show', value: boolean): void
  /** 用户选择：true = 启用上报，false = 保持关闭 */
  (e: 'decide', enabled: boolean): void
}>()
</script>

<style scoped>
.consent-card {
  position: relative;
  width: 408px;
  max-width: calc(100vw - 48px);
  padding: var(--space-28, 28px) var(--space-24, 24px) var(--space-24, 24px);
  background: var(--bg-surface, #141418);
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.09));
  border-radius: var(--radius-xl, 16px);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.55));
  overflow: hidden;
  animation: consent-pop var(--dur-normal, 0.28s) var(--ease-expo, cubic-bezier(0.16, 1, 0.3, 1))
    both;
}

/* 顶部品牌柔光 */
.consent-glow {
  position: absolute;
  top: -90px;
  left: 50%;
  transform: translateX(-50%);
  width: 260px;
  height: 180px;
  background: radial-gradient(
    ellipse at center,
    color-mix(in srgb, var(--semantic-win) 26%, transparent) 0%,
    transparent 70%
  );
  pointer-events: none;
}

.consent-icon-halo {
  position: relative;
  width: 56px;
  height: 56px;
  margin: 0 auto var(--space-16, 16px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--semantic-win) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--semantic-win) 36%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--semantic-win) 7%, transparent);
  animation: consent-halo var(--dur-slow, 0.45s) var(--ease-expo, cubic-bezier(0.16, 1, 0.3, 1))
    both;
}
.consent-icon {
  font-size: var(--font-size-3xl);
  color: var(--semantic-win);
}

.consent-title {
  margin: 0 0 var(--space-6, 6px);
  text-align: center;
  font-size: var(--font-size-xl);
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--text-primary);
}
.consent-lead {
  margin: 0 auto var(--space-20, 20px);
  max-width: 320px;
  text-align: center;
  font-size: var(--font-size-base, 13px);
  line-height: 1.6;
  color: var(--text-secondary);
}

.consent-points {
  list-style: none;
  margin: 0 0 var(--space-24, 24px);
  padding: var(--space-12, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--space-12, 12px);
  background: var(--glass-bg-low, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.09));
  border-radius: var(--radius-lg, 12px);
}
.consent-point {
  display: flex;
  align-items: center;
  gap: var(--space-10, 10px);
  animation: consent-rise var(--dur-normal, 0.28s) var(--ease-expo, cubic-bezier(0.16, 1, 0.3, 1))
    both;
  animation-delay: calc(0.06s * var(--i) + 0.1s);
}
.consent-point-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--semantic-win) 12%, transparent);
  color: var(--semantic-win);
  font-size: var(--font-size-lg);
}
.consent-point-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.consent-point-title {
  font-size: var(--font-size-base, 13px);
  font-weight: 600;
  color: var(--text-primary);
}
.consent-point-sub {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-tertiary);
  line-height: 1.4;
}

.consent-actions {
  display: flex;
  gap: var(--space-10, 10px);
}
.consent-btn-ghost,
.consent-btn-primary {
  flex: 1;
  height: 38px;
  font-weight: 600;
  border-radius: var(--radius-md, 8px);
}
/* 否定项：真实可点的中性按钮，不弱化到看不见，但不与主操作争视觉 */
.consent-btn-ghost {
  background: var(--glass-bg-low, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
}
.consent-btn-primary {
  box-shadow: 0 4px 14px color-mix(in srgb, var(--semantic-win) 30%, transparent);
}

@keyframes consent-pop {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes consent-halo {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes consent-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 降低动态偏好时关闭入场动画 */
@media (prefers-reduced-motion: reduce) {
  .consent-card,
  .consent-icon-halo,
  .consent-point {
    animation: none;
  }
}
</style>
