<script setup lang="ts">
/**
 * 战报图本体：固定 360×480 排版，导出 ×3 得 1080×1440。
 *
 * 版式（2026-11-19 视觉升级，见 spec 2026-11-19-postgame-toast-design.md §视觉）：
 * 1. 顶部原画区：本局英雄原画打底，压暗渐变，大号标签 + 一句人话（缩略图里也看得清）；
 *    至少 172px，正文用不完的高度都给它；
 * 2. 本人一行：头像、英雄 · 位置、大号 KDA 数字；
 * 3. 事实面板：标题事实 + 依据 + 支撑（归责 / 牵制 / 反差等，深度来源）；
 *    有依据时支撑只留 1 条——标题折行 + 依据 + 2 条支撑会把底部挤出 480 高度；
 * 4. 分项双列单行：名称 + 以中线为基准左右伸展的等级条（领先往右、落后往左）+ 等级词；
 * 5. 时长 / LP / 隐藏分胶囊，底部工具名与「仅供参考」。
 *
 * 配色固定、不跟主题走：发出去的图在谁的屏幕上都该长一样；口吻色与赛后弹卡一致。
 * 只展示本人；队友、对手一律不出现（不点名，避免引战）。
 * @property card - buildShareCard 的结果
 * @property angle - 第几个角度（换标题）
 * @property hideName - 隐藏召唤师名
 * @property iconUrl - 英雄头像 data URL；null 不画
 * @property splashUrl - 英雄原画 data URL；null 时原画区退回口吻色渐变
 * @property meta - 时长 / LP / 隐藏分等小字
 */
import { computed } from 'vue'
import { pickAngle, type ShareCard } from '@renderer/services/ai/review/shareFacts'

const props = withDefaults(
  defineProps<{
    card: ShareCard
    angle: number
    hideName: boolean
    iconUrl: string | null
    splashUrl?: string | null
    meta: string[]
  }>(),
  { splashUrl: null }
)

const view = computed(() => pickAngle(props.card.facts, props.angle))

/** 有依据时支撑只留 1 条，保证 7 个分项 + 胶囊 + 页脚仍在卡内 */
const support = computed(() =>
  view.value.headline?.detail ? view.value.support.slice(0, 1) : view.value.support
)

/** 等级条最大幅度（bar 取值 -3~3），半边轨道对应 3 */
const BAR_MAX = 3

/**
 * 以中线为基准的等级条：领先从中线往右伸，落后往左伸
 * @returns left / width 百分比
 */
function barStyle(bar: number): { left: string; width: string } {
  const v = Math.max(-BAR_MAX, Math.min(BAR_MAX, bar))
  const half = (Math.abs(v) / BAR_MAX) * 50
  return v >= 0 ? { left: '50%', width: `${half}%` } : { left: `${50 - half}%`, width: `${half}%` }
}
const barTone = (bar: number): string => (bar >= 0.5 ? 'up' : bar <= -0.5 ? 'down' : 'even')
</script>

<template>
  <div class="share-card" :class="`tone-${card.copy.tone}`" data-test="share-card">
    <header class="sc-hero">
      <img
        v-if="splashUrl"
        class="sc-splash"
        :src="splashUrl"
        alt=""
        data-test="share-card-splash"
      />
      <div class="sc-hero-shade" />
      <div class="sc-hero-top">
        <span class="sc-result" :class="card.win ? 'is-win' : 'is-loss'">
          {{ card.win ? '胜利' : '失败' }}
        </span>
        <span class="sc-brand">RANK ANALYSIS</span>
      </div>
      <div class="sc-hero-text">
        <div class="sc-label" :class="{ 'is-carry': card.label === 'Carry' }">
          {{ card.label }}
        </div>
        <div class="sc-tagline">{{ card.copy.tagline }}</div>
      </div>
    </header>

    <div class="sc-body">
      <div class="sc-player">
        <img v-if="iconUrl" class="sc-icon" :src="iconUrl" :alt="card.champion" />
        <div class="sc-player-text">
          <div class="sc-champ">{{ card.champion }} · {{ card.roleCn }}</div>
          <div v-if="!hideName && card.name" class="sc-name" data-test="share-card-name">
            {{ card.name }}
          </div>
        </div>
        <div class="sc-kda">{{ card.kda }}</div>
      </div>

      <section v-if="view.headline" class="sc-facts">
        <div class="sc-headline" data-test="share-card-headline">
          {{ view.headline.headline }}
        </div>
        <div v-if="view.headline.detail" class="sc-detail">{{ view.headline.detail }}</div>
        <ul v-if="support.length" class="sc-support">
          <li v-for="f in support" :key="f.headline">{{ f.headline }}</li>
        </ul>
      </section>

      <section v-if="card.parts.length" class="sc-parts">
        <div v-for="p in card.parts" :key="p.cn" class="sc-part">
          <span class="sc-part-cn">{{ p.cn }}</span>
          <span class="sc-part-track">
            <span class="sc-part-fill" :class="barTone(p.bar)" :style="barStyle(p.bar)" />
          </span>
          <span class="sc-part-level" :class="barTone(p.bar)">{{ p.level }}</span>
        </div>
      </section>

      <div v-if="meta.length" class="sc-meta">
        <span v-for="m in meta" :key="m" class="sc-chip">{{ m }}</span>
      </div>

      <footer class="sc-foot">
        <span>AI 归责复盘 · 仅供参考</span>
        <span>GitHub / GitCode 搜 rank-analysis</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.share-card {
  /* 固定配色（不跟主题）：导出的图在任何人屏幕上一致 */
  --sc-bg: #0d1017;
  --sc-panel: rgba(255, 255, 255, 0.05); /* theme-fixed：战报图配色固定，不跟主题 */
  --sc-line: rgba(255, 255, 255, 0.08); /* theme-fixed */
  --sc-brand: rgba(255, 255, 255, 0.7); /* theme-fixed */
  --sc-midline: rgba(255, 255, 255, 0.25); /* theme-fixed */
  --sc-text: #f1f3f8;
  --sc-sub: #a3abba;
  --sc-faint: #6b7385;
  --sc-win: #4cc38a;
  --sc-loss: #f0595e;
  --sc-accent: #f5b544;
  --sc-num: 'Oswald', 'Bahnschrift', 'DIN Alternate', sans-serif;
  position: relative;
  box-sizing: border-box;
  width: 360px;
  height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--sc-bg);
  color: var(--sc-text);
  font-family: 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif;
  border-radius: 14px;
  overflow: hidden;
  /* 口吻色细描边：发到群里在白底聊天背景上也有边界 */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 28%, transparent);
}
.tone-brag {
  --sc-accent: #f5b544;
}
.tone-vindicate {
  --sc-accent: #6cb6ff;
}
.tone-neutral {
  --sc-accent: #b4bccb;
}
.tone-roast {
  --sc-accent: #ff7a59;
}

/* ── 原画区 ── */
.sc-hero {
  position: relative;
  /* 原画区吃掉正文用不完的高度：事实少的卡原画更大，底部不留白 */
  flex: 1 0 172px;
  overflow: hidden;
  /* 原画缺失时的兜底：口吻色斜向光晕 */
  background:
    radial-gradient(
      120% 90% at 85% 10%,
      color-mix(in srgb, var(--sc-accent) 38%, transparent),
      transparent 60%
    ),
    linear-gradient(160deg, #1a2030, var(--sc-bg));
}
.sc-splash {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 60% 25%;
}
.sc-hero-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(13, 16, 23, 0.55) 0%, rgba(13, 16, 23, 0) 30%),
    linear-gradient(0deg, var(--sc-bg) 0%, rgba(13, 16, 23, 0.6) 38%, rgba(13, 16, 23, 0) 70%);
}
.sc-hero-top {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sc-result {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
  backdrop-filter: blur(6px);
}
.sc-result.is-win {
  color: #d9ffe9;
  background: color-mix(in srgb, var(--sc-win) 45%, rgba(0, 0, 0, 0.35));
}
.sc-result.is-loss {
  color: #ffe1e2;
  background: color-mix(in srgb, var(--sc-loss) 45%, rgba(0, 0, 0, 0.35));
}
.sc-brand {
  font-family: var(--sc-num);
  font-size: 10px;
  letter-spacing: 2.5px;
  color: var(--sc-brand);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
.sc-hero-text {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 12px;
}
.sc-label {
  font-size: 44px;
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 2px;
  color: var(--sc-accent);
  text-shadow:
    0 2px 18px color-mix(in srgb, var(--sc-accent) 45%, transparent),
    0 2px 2px rgba(0, 0, 0, 0.5);
}
.sc-label.is-carry {
  background: linear-gradient(180deg, #fff1c9 0%, #f5b544 55%, #c98a1c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: none;
  filter: drop-shadow(0 2px 12px rgba(245, 181, 68, 0.45));
}
.sc-tagline {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--sc-text);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
}

/* ── 正文 ── */
.sc-body {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 18px 10px;
}
.sc-player {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sc-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--sc-accent) 60%, transparent);
}
.sc-player-text {
  flex: 1;
  min-width: 0;
}
.sc-champ {
  font-size: 13px;
  font-weight: 600;
}
.sc-name {
  font-size: 11px;
  color: var(--sc-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-kda {
  font-family: var(--sc-num);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 1px;
  font-variant-numeric: tabular-nums;
}
.sc-facts {
  padding: 8px 12px;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--sc-accent) 14%, transparent),
    var(--sc-panel) 60%
  );
  border-left: 3px solid var(--sc-accent);
}
.sc-headline {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}
.sc-detail {
  margin-top: 3px;
  font-size: 11px;
  color: var(--sc-sub);
}
.sc-support {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
  line-height: 1.55;
  color: var(--sc-sub);
}
.sc-support li::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 4px;
  margin: 0 6px 2px 0;
  border-radius: 50%;
  background: var(--sc-accent);
}
.sc-parts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 14px;
}
.sc-part {
  display: grid;
  grid-template-columns: 46px 1fr 46px;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 16px;
}
.sc-part-cn {
  color: var(--sc-sub);
  white-space: nowrap;
}
.sc-part-level {
  text-align: right;
  white-space: nowrap;
}
.sc-part-level.up {
  color: var(--sc-win);
}
.sc-part-level.down {
  color: var(--sc-loss);
}
.sc-part-level.even {
  color: var(--sc-faint);
}
.sc-part-track {
  position: relative;
  display: block;
  height: 4px;
  border-radius: 2px;
  background: var(--sc-line);
}
/* 中线：0 = 同位置平均水平 */
.sc-part-track::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -2px;
  width: 1px;
  height: 8px;
  background: var(--sc-midline);
}
.sc-part-fill {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 2px;
}
.sc-part-fill.up {
  background: var(--sc-win);
}
.sc-part-fill.even {
  background: var(--sc-faint);
}
.sc-part-fill.down {
  background: var(--sc-loss);
}
.sc-meta {
  display: flex;
  gap: 6px;
  overflow: hidden;
}
.sc-chip {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  font-size: 11px;
  color: var(--sc-sub);
  background: var(--sc-panel);
  border: 1px solid var(--sc-line);
}
.sc-foot {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  padding-top: 6px;
  border-top: 1px solid var(--sc-line);
  font-size: 10px;
  color: var(--sc-faint);
}
</style>
