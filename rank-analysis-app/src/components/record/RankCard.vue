<template>
  <n-card
    class="rank-card record-panel-card panel-glass"
    :bordered="false"
    size="small"
    :content-style="cardContentStyle"
  >
    <div v-if="loading" class="rank-card-content" aria-hidden="true">
      <span class="sk sk-circle rank-card-sk-ring" />
      <div class="rank-card-text">
        <span class="sk rank-card-sk-label" />
        <span class="sk rank-card-sk-tier" />
        <span class="sk rank-card-sk-record" />
      </div>
    </div>
    <div v-else class="rank-card-content sk-reveal">
      <div class="rank-card-ring" data-test="tier-ring" :style="{ '--tier-color': tierColor }">
        <svg class="rank-card-ring-svg" viewBox="0 0 60 60" aria-hidden="true">
          <circle
            class="rank-card-ring-track"
            cx="30"
            cy="30"
            :r="RING_RADIUS"
            :stroke-dasharray="`${ARC_LENGTH} ${RING_CIRCUMFERENCE}`"
            transform="rotate(135 30 30)"
          />
          <circle
            v-if="progress !== null"
            class="rank-card-ring-progress"
            data-test="tier-progress"
            :data-progress="progress"
            cx="30"
            cy="30"
            :r="RING_RADIUS"
            :stroke-dasharray="`${ARC_LENGTH * progress} ${RING_CIRCUMFERENCE}`"
            transform="rotate(135 30 30)"
          />
        </svg>
        <img :src="tierImage(queueInfo.tier)" class="rank-card-img" alt="" />
        <div v-if="hasTier" class="rank-card-tier-lp" data-test="tier-lp">
          {{ queueInfo.leaguePoints }} LP
        </div>
      </div>
      <div class="rank-card-text">
        <div class="rank-card-type-label">{{ label }}</div>
        <div class="rank-card-tier-text">{{ tierText }}</div>
        <n-tooltip
          trigger="manual"
          placement="bottom-start"
          :show="hasGames && (tipActive.record.hover || tipActive.record.focus)"
        >
          <template #trigger>
            <div
              class="rank-card-record"
              data-test="recent-record"
              :tabindex="hasGames ? 0 : undefined"
              @mouseenter="tipActive.record.hover = true"
              @mouseleave="tipActive.record.hover = false"
              @focus="tipActive.record.focus = true"
              @blur="tipActive.record.focus = false"
            >
              <template v-if="hasGames">
                <b class="wr" :class="winRateClass">{{ recent.winRate }}%</b>
                <span class="rank-card-record-detail">
                  · {{ recent.wins }}胜{{ recent.losses }}负
                </span>
              </template>
              <span v-else class="rank-card-record-detail">暂无对局</span>
            </div>
          </template>
          <template v-if="hasGames">
            近期 {{ recent.wins + recent.losses }} 场：{{ recent.wins }} 胜
            {{ recent.losses }} 负，胜率 {{ recent.winRate }}%
          </template>
        </n-tooltip>
        <n-tooltip
          v-if="ready || collecting"
          trigger="manual"
          placement="bottom-start"
          :show="tipActive.mmr.hover || tipActive.mmr.focus"
        >
          <template #trigger>
            <div
              class="rank-card-mmr"
              data-test="hidden-mmr"
              tabindex="0"
              @mouseenter="tipActive.mmr.hover = true"
              @mouseleave="tipActive.mmr.hover = false"
              @focus="tipActive.mmr.focus = true"
              @blur="tipActive.mmr.focus = false"
            >
              <span class="rank-card-mmr-label">隐藏分</span>
              <span class="rank-card-mmr-value">
                <template v-if="ready">
                  <img
                    :src="tierImage(ready.equivalentTier)"
                    class="rank-card-mmr-tier"
                    data-test="hidden-mmr-tier"
                    alt=""
                  />
                  <span class="rank-card-mmr-rank">{{ ready.equivalentShort }}</span>
                  <n-icon :size="12" class="rank-card-mmr-trend" :class="ready.direction">
                    <TrendingUp v-if="ready.direction === 'up'" />
                    <TrendingDown v-else-if="ready.direction === 'down'" />
                    <Remove v-else />
                  </n-icon>
                </template>
                <template v-else-if="collecting">
                  <span class="rank-card-mmr-dots">
                    <span
                      v-for="i in collecting.need"
                      :key="i"
                      class="rank-card-mmr-dot"
                      :class="{ filled: i <= collecting.have }"
                    />
                  </span>
                  <span class="rank-card-mmr-collecting">记录中</span>
                </template>
              </span>
            </div>
          </template>
          <div class="rank-card-mmr-tip">
            <template v-if="ready">
              <div>≈ {{ ready.equivalent }}，{{ tierCompare }}</div>
              <div>最近 {{ ready.recent.length }} 局：{{ recentText }}</div>
              <div>平均赢 +{{ ready.avgWin }} / 平均输 −{{ ready.avgLoss }}</div>
            </template>
            <div v-else-if="collecting">
              已记录 {{ collecting.have }} 局有效排位，至少需要 {{ collecting.need }} 局且有胜有负
            </div>
            <div class="rank-card-mmr-rules">
              <div class="rank-card-mmr-rules-title">计算规则</div>
              <div>1. 每局排位结束后记录 LP 加减分（挂机、定级赛、掉段保护、安慰分等不计入）</div>
              <!-- 10 / 3 与后端 hidden_mmr/estimate.rs 的 WINDOW / MIN_RECORDS 对应，需同步修改 -->
              <div>2. 取最近 10 局：隐藏分 ≈ 当前段位 +（平均赢分 − 平均输分）× 10 LP</div>
              <div>3. 赢得多输得少 → 隐藏分高于段位</div>
              <div>4. 双倍胜点局（赢分约为平时 2 倍）按一半计</div>
            </div>
            <div class="rank-card-mmr-disclaimer">估算值，非官方 MMR</div>
          </div>
        </n-tooltip>
      </div>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { NCard, NIcon, NTooltip } from 'naive-ui'
import { Remove, TrendingDown, TrendingUp } from '@vicons/ionicons5'
import type { HiddenMmr } from '@renderer/services/hiddenMmr'
import type { QueueInfo } from '@renderer/types/domain/player'
import type { RecentWinRate } from '@renderer/types/domain/player'
import { formatTierText, hasRealTier, isHighTier } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'

const props = defineProps<{
  label: string
  queueInfo: QueueInfo
  recent: RecentWinRate
  /** 数据未到：渲染骨架而非「无段位 / 暂无对局 / 0 胜 0 负」假值 */
  loading?: boolean
  /** 隐藏分估算；仅查看自己时由 UserRecord 传入，null / 缺省 / hidden 时不显示这一行 */
  hiddenMmr?: HiddenMmr | null
}>()

/**
 * 各段位的代表色（键为小写 tier）。
 * 这些是段位徽章本身的主色调，属于段位的身份色而非主题色，所以直接用字面量 hex，
 * 不随亮/暗主题变化。
 */
const TIER_COLORS: Record<string, string> = {
  iron: '#8a7f7a',
  bronze: '#b0794f',
  silver: '#9aa8b5',
  gold: '#d9b45a',
  platinum: '#4cb8b0',
  emerald: '#34c58a',
  diamond: '#6f8cff',
  master: '#b05bdf',
  grandmaster: '#e0504f',
  challenger: '#f0c75e'
}

/** 环半径（viewBox 60×60，圆心 30,30） */
const RING_RADIUS = 26
/** 整圆周长 */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** 环只画 270°，缺口留在底部放 LP 文字 */
const ARC_LENGTH = RING_CIRCUMFERENCE * 0.75

/** 是否有有效段位（未定级时不画进度弧、不显示 LP） */
const hasTier = computed(() => hasRealTier(props.queueInfo))

/** 环的段位色；未定级退回三级文字色 */
const tierColor = computed(
  () => TIER_COLORS[(props.queueInfo.tier ?? '').toLowerCase()] ?? 'var(--text-tertiary)'
)

/**
 * 两个 tooltip 的悬浮 / 聚焦状态：naive-ui 的 trigger 不能同时 hover + focus，
 * 所以用 manual 模式，由触发元素的鼠标与焦点事件共同驱动 show
 */
const tipActive = reactive({
  record: { hover: false, focus: false },
  mmr: { hover: false, focus: false }
})

/**
 * 进度弧占 270° 的比例：钻石及以下按胜点 /100（至少 0.02 保证可见），
 * 大师及以上无 100 点上限，画满；未定级返回 null（只留底环）
 */
const progress = computed(() => {
  if (!hasTier.value) return null
  if (isHighTier(props.queueInfo.tier)) return 1
  return Math.min(1, Math.max(0.02, props.queueInfo.leaguePoints / 100))
})

/** 段位文案：大师及以上胜点已在环下方显示，这里只留段位名避免重复 */
const tierText = computed(() =>
  hasTier.value && isHighTier(props.queueInfo.tier)
    ? props.queueInfo.tierCn
    : formatTierText(props.queueInfo)
)

/** 0 胜 0 负说明该队列没打过，红色「0%」会被误读成连败 */
const hasGames = computed(() => props.recent.wins + props.recent.losses > 0)

/** 近期胜率着色：≥58 好，≤49 差，其余中性 */
const winRateClass = computed(() => {
  if (props.recent.winRate >= 58) return 'good'
  if (props.recent.winRate <= 49) return 'bad'
  return 'normal'
})

/** status 为 ready 时的估算（模板里用它做类型收窄） */
const ready = computed(() => (props.hiddenMmr?.status === 'ready' ? props.hiddenMmr : null))

/** status 为 collecting 时的进度（模板里用它做类型收窄） */
const collecting = computed(() =>
  props.hiddenMmr?.status === 'collecting' ? props.hiddenMmr : null
)

/** tooltip 里隐藏分相对当前段位的 LP 差距 */
const tierCompare = computed(() => {
  const offset = ready.value?.offset ?? 0
  if (offset === 0) return '与当前段位持平'
  return `比当前段位${offset > 0 ? '高' : '低'} ${Math.abs(offset)} LP`
})

/**
 * 带符号数字：正数加 `+`，负数用 U+2212 减号（与「平均输 −」一致），零原样输出
 */
function formatSigned(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${-n}`
  return '0'
}

/** tooltip 里的逐局加减分，新 → 旧 */
const recentText = computed(
  () =>
    ready.value?.recent
      // 双倍胜点局标出来：估算按一半计，不标会让人对不上平均赢分
      .map(r => (r.doubled ? `${formatSigned(r.delta)}（双倍）` : formatSigned(r.delta)))
      .join(' / ') ?? ''
)

// n-card 的 content-style 需要字符串/对象,这里用 token 占位以避免 inline 字面量
const cardContentStyle = 'padding: var(--space-10)'
</script>

<style scoped>
.rank-card-content {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

/* 段位色环：60×60，徽章居中偏上，环缺口（底部）放 LP */
.rank-card-ring {
  position: relative;
  flex: none;
  width: 60px;
  height: 60px;
}

.rank-card-ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.rank-card-ring-track,
.rank-card-ring-progress {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}

.rank-card-ring-track {
  stroke: color-mix(in srgb, var(--tier-color) 14%, transparent);
}

.rank-card-ring-progress {
  stroke: color-mix(in srgb, var(--tier-color) 75%, var(--text-tertiary));
}

.rank-card-img {
  position: absolute;
  top: 9px;
  left: 12px;
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.rank-card-tier-lp {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  text-align: center;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  line-height: var(--line-height-tight);
}

.rank-card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.rank-card-type-label {
  font-size: var(--font-size-2xs);
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.rank-card-tier-text {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  line-height: var(--line-height-tight);
  margin-top: var(--space-2);
}

.rank-card-record {
  font-size: var(--font-size-xs);
  margin-top: var(--space-4);
  white-space: nowrap;
}

.rank-card-record:focus-visible,
.rank-card-mmr:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.rank-card-record .wr {
  font-weight: 700;
}

.rank-card-record .wr.good {
  color: var(--semantic-win);
}

.rank-card-record .wr.bad {
  color: var(--semantic-loss);
}

.rank-card-record .wr.normal {
  color: var(--text-primary);
}

.rank-card-record-detail {
  color: var(--text-tertiary);
}

/* 隐藏分行：发丝线分隔，不加边框盒子 */
.rank-card-mmr {
  display: flex;
  align-items: center;
  margin-top: var(--space-8);
  padding-top: 7px;
  border-top: 1px solid color-mix(in srgb, var(--text-tertiary) 14%, transparent);
  font-size: var(--font-size-2xs);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.rank-card-mmr-label {
  color: var(--text-tertiary);
}

.rank-card-mmr-value {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  margin-left: auto;
  padding-left: var(--space-10);
}

.rank-card-mmr-tier {
  width: 15px;
  height: 15px;
  object-fit: contain;
}

.rank-card-mmr-rank {
  font-weight: 600;
  color: var(--text-secondary);
}

.rank-card-mmr-trend.up {
  color: var(--semantic-win);
}

.rank-card-mmr-trend.down {
  color: var(--semantic-loss);
}

.rank-card-mmr-trend.flat,
.rank-card-mmr-collecting {
  color: var(--text-tertiary);
}

.rank-card-mmr-dots {
  display: inline-flex;
  gap: 3px;
}

/* 5px 圆点：已收集的用胜利色，其余用弱化的三级文字色
   （不用 --sunken-border：亮色主题下它是透明的，空点会消失） */
.rank-card-mmr-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-tertiary) 35%, transparent);
}

.rank-card-mmr-dot.filled {
  background: var(--semantic-win);
}

.rank-card-mmr-tip {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
}

.rank-card-mmr-rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: var(--font-size-2xs);
}

.rank-card-mmr-rules-title {
  font-weight: 600;
}

.rank-card-mmr-disclaimer {
  color: var(--text-tertiary);
}

/* 骨架尺寸对齐真实内容（环 60px、文字三行），揭晓时不跳 */
.rank-card-sk-ring {
  flex: none;
  width: 60px;
  height: 60px;
}

.rank-card-sk-label {
  width: 40px;
  height: 10px;
}

.rank-card-sk-tier {
  width: 90px;
  height: 16px;
  margin-top: var(--space-4);
}

.rank-card-sk-record {
  width: 110px;
  height: 12px;
  margin-top: var(--space-6);
}
</style>
