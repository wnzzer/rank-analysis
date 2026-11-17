<script setup lang="ts">
/**
 * 战报图本体：固定 360×480 排版，导出 ×3 得 1080×1440。
 *
 * 三层结构（spec §内容）：
 * 1. 标签 + 一句人话（缩略图里也看得清，收图的人不用懂工具）；
 * 2. 标题事实 + 两条支撑（归责 / 牵制 / 反差等，深度来源）；
 * 3. 分项等级条 + LP / 隐藏分；底部是工具名与「仅供参考」。
 *
 * 配色固定、不跟主题走：发出去的图在谁的屏幕上都该长一样。
 * 只展示本人；队友、对手一律不出现（不点名，避免引战）。
 * @property card - buildShareCard 的结果
 * @property angle - 第几个角度（换标题）
 * @property hideName - 隐藏召唤师名
 * @property iconUrl - 英雄头像 data URL；null 不画
 * @property meta - 时长 / LP / 隐藏分等一行小字
 */
import { computed } from 'vue'
import { pickAngle, type ShareCard } from '@renderer/services/ai/review/shareFacts'

const props = defineProps<{
  card: ShareCard
  angle: number
  hideName: boolean
  iconUrl: string | null
  meta: string[]
}>()

const view = computed(() => pickAngle(props.card.facts, props.angle))

/** 等级条：-3~3 映射到 0~100% 宽（中点 50%） */
const barWidth = (bar: number): string => `${Math.round(((bar + 3) / 6) * 100)}%`
const barTone = (bar: number): string => (bar >= 0.5 ? 'up' : bar <= -0.5 ? 'down' : 'even')
</script>

<template>
  <div class="share-card" :class="`tone-${card.copy.tone}`" data-test="share-card">
    <header class="sc-head">
      <div class="sc-label">{{ card.label }}</div>
      <div class="sc-result" :class="card.win ? 'is-win' : 'is-loss'">
        {{ card.win ? '胜利' : '失败' }}
      </div>
    </header>
    <div class="sc-tagline">{{ card.copy.tagline }}</div>

    <div class="sc-player">
      <img v-if="iconUrl" class="sc-icon" :src="iconUrl" :alt="card.champion" />
      <div class="sc-player-text">
        <div class="sc-champ">
          {{ card.champion }} · {{ card.roleCn }}
          <span class="sc-kda">{{ card.kda }}</span>
        </div>
        <div v-if="!hideName && card.name" class="sc-name" data-test="share-card-name">
          {{ card.name }}
        </div>
      </div>
    </div>

    <section v-if="view.headline" class="sc-facts">
      <div class="sc-headline" data-test="share-card-headline">{{ view.headline.headline }}</div>
      <div v-if="view.headline.detail" class="sc-detail">{{ view.headline.detail }}</div>
      <ul v-if="view.support.length" class="sc-support">
        <li v-for="f in view.support" :key="f.headline">{{ f.headline }}</li>
      </ul>
    </section>

    <section v-if="card.parts.length" class="sc-parts">
      <div v-for="p in card.parts" :key="p.cn" class="sc-part">
        <span class="sc-part-cn">{{ p.cn }}</span>
        <span class="sc-part-track">
          <span class="sc-part-fill" :class="barTone(p.bar)" :style="{ width: barWidth(p.bar) }" />
        </span>
        <span class="sc-part-level">{{ p.level }}</span>
      </div>
    </section>

    <div v-if="meta.length" class="sc-meta">{{ meta.join(' · ') }}</div>

    <footer class="sc-foot">
      <b>Rank Analysis</b>
      <span>AI 归责复盘 · 仅供参考 · GitHub / GitCode 搜 rank-analysis</span>
    </footer>
  </div>
</template>

<style scoped>
.share-card {
  /* 固定配色（不跟主题）：导出的图在任何人屏幕上一致 */
  --sc-bg: #12151c;
  --sc-panel: #1b2029;
  --sc-text: #eef1f6;
  --sc-sub: #9aa3b2;
  --sc-faint: #687082;
  --sc-win: #4cc38a;
  --sc-loss: #e5484d;
  --sc-accent: #f5b544;
  box-sizing: border-box;
  width: 360px;
  height: 480px;
  padding: 20px 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--sc-bg);
  color: var(--sc-text);
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  border-radius: 12px;
  overflow: hidden;
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
.sc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.sc-label {
  font-size: 40px;
  font-weight: 800;
  line-height: 1;
  color: var(--sc-accent);
  letter-spacing: 1px;
}
.sc-result {
  font-size: 15px;
  font-weight: 700;
}
.is-win {
  color: var(--sc-win);
}
.is-loss {
  color: var(--sc-loss);
}
.sc-tagline {
  font-size: 17px;
  font-weight: 600;
}
.sc-player {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sc-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}
.sc-champ {
  font-size: 14px;
}
.sc-kda {
  margin-left: 6px;
  font-weight: 700;
}
.sc-name {
  font-size: 12px;
  color: var(--sc-sub);
}
.sc-facts {
  padding: 12px;
  border-radius: 8px;
  background: var(--sc-panel);
  border-left: 3px solid var(--sc-accent);
}
.sc-headline {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
}
.sc-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--sc-sub);
}
.sc-support {
  margin: 8px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: var(--sc-sub);
  line-height: 1.6;
}
.sc-parts {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sc-part {
  display: grid;
  grid-template-columns: 56px 1fr 56px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.sc-part-cn {
  color: var(--sc-sub);
}
.sc-part-track {
  height: 6px;
  border-radius: 3px;
  background: var(--sc-panel);
  overflow: hidden;
}
.sc-part-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
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
.sc-part-level {
  text-align: right;
  color: var(--sc-sub);
}
.sc-meta {
  font-size: 12px;
  color: var(--sc-sub);
}
.sc-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--sc-panel);
  font-size: 10px;
  color: var(--sc-faint);
}
.sc-foot b {
  font-size: 12px;
  color: var(--sc-sub);
}
</style>
