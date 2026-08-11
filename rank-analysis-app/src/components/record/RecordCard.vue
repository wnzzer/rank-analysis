<template>
  <div
    class="record-card"
    :class="{ 'record-card-win': isWin, 'record-card-loss': !isWin }"
    role="button"
    tabindex="0"
    @click="openDetail"
    @keyup.enter="openDetail"
  >
    <!-- 单行固定列网格：所有卡片共用同一套列轨道，行与行严格对齐 -->
    <div class="record-card-grid">
      <!-- 胜负标记 + 时长 -->
      <span
        class="record-card-result-label"
        :class="isWin ? 'record-card-text-win' : 'record-card-text-loss'"
      >
        {{ resultLabel }}
      </span>
      <span class="font-number record-card-duration">{{ durationText }}</span>

      <!-- 英雄头像 + MVP/SVP 角标 -->
      <div class="record-card-champion">
        <LazyImg
          class="record-card-champion-img"
          :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
          alt="champion"
        />
        <span
          v-if="games.mvp"
          class="record-card-mvp"
          :class="games.mvp === 'MVP' ? 'record-card-mvp-gold' : 'record-card-mvp-silver'"
        >
          {{ games.mvp }}
        </span>
      </div>

      <!-- 英雄名 -->
      <n-ellipsis class="record-card-champion-name">{{ championName }}</n-ellipsis>

      <!-- KDA -->
      <span class="font-number record-card-kda">
        <span class="record-card-kda-kill">{{ games.participants[0].stats?.kills }}</span>
        <span class="record-card-kda-sep">/</span>
        <span class="record-card-kda-death">{{ games.participants[0].stats?.deaths }}</span>
        <span class="record-card-kda-sep">/</span>
        <span class="record-card-kda-assist">{{ games.participants[0].stats?.assists }}</span>
      </span>

      <!-- 伤害 mini 条（伤害/承伤/治疗三段占全队比例）+ 伤害数值 -->
      <div class="record-card-damage">
        <div class="record-card-minibar">
          <span
            class="record-card-minibar-seg record-card-minibar-dmg"
            :style="{ width: `${minibarSegWidth(rate('damageDealtToChampionsRate'))}%` }"
          />
          <span
            class="record-card-minibar-seg record-card-minibar-taken"
            :style="{ width: `${minibarSegWidth(rate('damageTakenRate'))}%` }"
          />
          <span
            class="record-card-minibar-seg record-card-minibar-heal"
            :style="{ width: `${minibarSegWidth(rate('healRate'))}%` }"
          />
        </div>
        <span class="font-number record-card-damage-value">
          {{ formatCompactNumber(games.participants[0].stats?.totalDamageDealtToChampions ?? 0) }}
        </span>
      </div>

      <!-- 参团率 -->
      <span
        class="font-number record-card-group-rate"
        :style="{ color: groupRateColor(games.participants[0].stats?.groupRate ?? 0, isDark) }"
      >
        {{ Math.round(games.participants[0].stats?.groupRate ?? 0) }}%参团
      </span>

      <!-- 装备前 4 件（augment 局替换为海克斯强化图标） -->
      <div class="record-card-slots">
        <template v-if="usesAugments">
          <span
            v-for="(augmentId, index) in displayedAugmentIds.slice(0, 4)"
            :key="`record-augment-${index}`"
            :class="[
              'record-card-slot record-card-augment-shell',
              augmentRarityClass(assets.detailOf('perk', augmentId)?.rarity, 'record-card-augment')
            ]"
          >
            <LazyImg
              :src="assets.srcOf('perk', augmentId)"
              class="record-card-slot-img"
              alt="augment"
            />
          </span>
          <span
            v-for="i in Math.max(0, 4 - displayedAugmentIds.slice(0, 4).length)"
            :key="`aug-${i}`"
            class="record-card-slot record-card-slot-empty"
          />
        </template>
        <template v-else>
          <n-tooltip
            v-for="(itemId, index) in itemIds.slice(0, 4)"
            :key="`record-item-${index}`"
            trigger="hover"
            placement="top"
            :disabled="!assets.detailOf('item', itemId)"
          >
            <template #trigger>
              <span v-if="itemId > 0" class="record-card-slot">
                <LazyImg
                  :src="assets.srcOf('item', itemId)"
                  class="record-card-slot-img"
                  alt="item"
                />
              </span>
              <span v-else class="record-card-slot record-card-slot-empty" />
            </template>
            <AssetTooltipContent
              v-if="itemId > 0"
              :icon-src="assets.srcOf('item', itemId)"
              :name="assets.detailOf('item', itemId)?.name ?? ''"
              :description="assets.detailOf('item', itemId)?.description ?? ''"
            />
          </n-tooltip>
        </template>
      </div>

      <!-- 展开箭头 -->
      <n-icon class="record-card-chevron"><ChevronDownOutline /></n-icon>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ChevronDownOutline } from '@vicons/ionicons5'
import { computed, inject } from 'vue'
import { NEllipsis, NIcon, NTooltip } from 'naive-ui'
import { formatCompactNumber } from '@renderer/utils/format'
import { useTheme } from '@renderer/composables/useTheme'
import { groupRateColor } from '@renderer/utils/colors'
import { assetPrefix } from '@renderer/services/http'
import { augmentRarityClass } from '@renderer/utils/augment'
import type { Game } from '@renderer/types/domain/match'
import type { championOption } from '@renderer/types/domain/champion'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'
import AssetTooltipContent from './AssetTooltipContent.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'

const props = withDefaults(
  defineProps<{
    recordType?: boolean
    games: Game
    championOptions?: championOption[]
  }>(),
  { championOptions: () => [] }
)

const emit = defineEmits<{
  'open-detail': []
}>()

/** 优先使用父级（MatchHistory）批量预加载的资源；独立使用时退回自己的 preload */
const injected = inject(recordAssetsKey, null)
const assets = injected ?? useRecordAssets()

const isWin = computed(() => props.games.participants[0].stats.win)

const isCherry = computed(() => props.games.gameMode === 'CHERRY')
const usesAugments = computed(() => isCherry.value || props.games.queueId === 2400)
const placement = computed(() => props.games.participants[0]?.stats?.subteamPlacement ?? 0)

const resultLabel = computed(() => {
  if (isCherry.value && placement.value > 0) {
    return `第 ${placement.value} 名`
  }
  return isWin.value ? '胜' : '负'
})

const durationText = computed(() => {
  const totalSeconds = Math.round(props.games.gameDuration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const championName = computed(() => {
  const id = props.games.participants[0].championId
  return props.championOptions.find(option => option.value === id)?.label ?? `英雄 ${id}`
})

const augmentIds = computed(() => {
  const s = props.games.participants[0].stats
  return [
    s.playerAugment1,
    s.playerAugment2,
    s.playerAugment3,
    s.playerAugment4,
    s.playerAugment5,
    s.playerAugment6
  ].filter(id => id > 0)
})

const displayedAugmentIds = computed(() => {
  const ids = augmentIds.value
  return ids.length <= 6 ? ids : ids.slice(0, 5)
})

const itemIds = computed(() => {
  const s = props.games.participants[0].stats
  return [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6]
})

/** mini 条宽度：按全队比例 0-100 归一，直接映射为条内段宽 */
const rate = (key: 'damageDealtToChampionsRate' | 'damageTakenRate' | 'healRate') =>
  Math.max(0, Math.min(100, props.games.participants[0].stats?.[key] ?? 0))

const minibarSegWidth = (value: number) => (value >= 1 ? value : 0)

const { isDark } = useTheme()

function openDetail() {
  emit('open-detail')
}
</script>

<style scoped>
/* === 紧凑行卡：高 44px 级，信息密度对标 op.gg 行卡 === */
.record-card {
  cursor: pointer;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
  transition:
    transform var(--dur-fast) var(--ease-expo),
    box-shadow var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}

.record-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md), var(--glass-highlight);
  border-color: var(--glass-bg-high);
}

.record-card:active {
  transform: scale(0.998);
  transition-duration: var(--dur-instant);
}

.record-card-grid {
  display: grid;
  grid-template-columns:
    34px
    54px
    36px
    minmax(56px, 1fr)
    80px
    118px
    64px
    92px
    20px;
  align-items: center;
  justify-content: start;
  gap: var(--space-8);
  height: 100%;
  padding: 0 var(--space-12);
}

/* 胜负字 */
.record-card-result-label {
  font-weight: 800;
  font-size: var(--font-size-md);
  text-align: center;
}

.record-card-text-win {
  color: var(--semantic-win);
}

.record-card-text-loss {
  color: var(--semantic-loss);
}

/* 时长 */
.record-card-duration {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-weight: 600;
}

/* 英雄头像 + MVP */
.record-card-champion {
  position: relative;
  width: 36px;
  height: 36px;
}

.record-card-champion-img {
  display: block;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  box-sizing: border-box;
}

.record-card-win .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-win) 45%, transparent);
}

.record-card-loss .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-loss) 40%, transparent);
}

.record-card-mvp {
  position: absolute;
  left: -2px;
  bottom: -3px;
  display: inline-block;
  padding: 0 3px;
  height: 11px;
  font-weight: 800;
  font-size: 8px;
  line-height: 11px;
  border-radius: var(--radius-pill);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.record-card-mvp-gold {
  color: #201500;
  background: linear-gradient(180deg, #f6d365, #d4a017);
}

.record-card-mvp-silver {
  color: #1c232b;
  background: linear-gradient(180deg, #eef3f9, #aab8c8);
}

/* 英雄名 */
.record-card-champion-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* KDA */
.record-card-kda {
  font-weight: 650;
  font-size: var(--font-size-base);
  white-space: nowrap;
}

.record-card-kda-kill {
  color: var(--semantic-win);
}

.record-card-kda-death {
  color: var(--semantic-loss);
}

.record-card-kda-assist {
  color: var(--accent-gold-deep);
}

.record-card-kda-sep {
  color: var(--text-tertiary);
}

/* 伤害 mini 条 + 数值 */
.record-card-damage {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.record-card-minibar {
  display: flex;
  gap: 1px;
  width: 64px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--glass-bg-low);
  border: 1px solid var(--glass-border);
  overflow: hidden;
  flex-shrink: 0;
}

.record-card-minibar-seg {
  height: 100%;
}

.record-card-minibar-dmg {
  background: linear-gradient(90deg, #f59e0b, #f97316);
}

.record-card-minibar-taken {
  background: linear-gradient(90deg, #60a5fa, #3b82f6);
}

.record-card-minibar-heal {
  background: linear-gradient(90deg, #4ade80, #22c55e);
}

.record-card-damage-value {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

/* 参团率 */
.record-card-group-rate {
  font-size: var(--font-size-xs);
  font-weight: 650;
  white-space: nowrap;
}

.record-card-group-rate.good {
  color: var(--semantic-win);
}

.record-card-group-rate.bad {
  color: var(--semantic-loss);
}

/* 装备 / augment 槽 */
.record-card-slots {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.record-card-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--glass-border);
  background: var(--bg-elevated);
  box-sizing: border-box;
  overflow: hidden;
  flex-shrink: 0;
}

.record-card-slot-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.record-card-slot-empty {
  border-color: color-mix(in srgb, var(--glass-border) 55%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
}

/* augment 稀有度边框：复用既有外壳变量的四档渐变 + 反色滤镜 */
.record-card-augment-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
}

.record-card-augment-prismatic {
  --augment-border: rgba(187, 125, 255, 0.92);
  --augment-background: linear-gradient(180deg, rgba(123, 82, 214, 0.9), rgba(55, 34, 110, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(79%) sepia(31%) saturate(2173%)
    hue-rotate(225deg) brightness(102%) contrast(101%);
}

.record-card-augment-gold {
  --augment-border: rgba(244, 198, 88, 0.92);
  --augment-background: linear-gradient(180deg, rgba(121, 90, 18, 0.9), rgba(62, 46, 8, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(82%) sepia(51%) saturate(590%)
    hue-rotate(354deg) brightness(103%) contrast(104%);
}

.record-card-augment-silver {
  --augment-border: rgba(191, 205, 227, 0.88);
  --augment-background: linear-gradient(180deg, rgba(86, 103, 126, 0.9), rgba(39, 48, 61, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(418%)
    hue-rotate(176deg) brightness(103%) contrast(99%);
}

.record-card-augment-bronze {
  --augment-border: rgba(197, 132, 89, 0.9);
  --augment-background: linear-gradient(180deg, rgba(118, 67, 35, 0.9), rgba(59, 33, 17, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(76%) sepia(31%) saturate(740%)
    hue-rotate(338deg) brightness(98%) contrast(94%);
}

.record-card-augment-default {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
}

.record-card-slot :deep(.record-card-slot-img) {
  filter: var(--augment-filter);
}

/* 展开箭头 */
.record-card-chevron {
  color: var(--text-tertiary);
  font-size: var(--font-size-md);
  transition: transform var(--dur-fast) var(--ease-expo);
}

.record-card:hover .record-card-chevron {
  transform: translateY(1px);
  color: var(--text-secondary);
}
</style>
