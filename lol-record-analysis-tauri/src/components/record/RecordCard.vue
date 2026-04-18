<template>
  <n-card
    content-style="padding: 8px 12px;"
    class="win-class"
    :class="{ 'defeat-class': !games.participants[0].stats.win }"
    :style="cardStyle"
    role="button"
    tabindex="0"
    @click="openDetail"
    @keyup.enter="openDetail"
  >
    <n-flex align="center" justify="space-between">
      <n-flex vertical style="gap: 1px">
        <span
          class="font-number"
          :style="{
            fontWeight: '700',
            fontSize: '14px',
            color: games.participants[0].stats.win ? themeColors.win : themeColors.loss,
            marginLeft: '4px',
            marginTop: '2px'
          }"
        >
          {{ games.participants[0].stats.win ? '胜利' : '失败' }}
          <n-divider style="margin: 1px 0; line-height: 1px" />
        </span>

        <span class="record-card-meta">
          <n-icon style="margin-right: 1px"><Time /></n-icon>
          {{ Math.ceil(games.gameDuration / 60) }}分
        </span>
      </n-flex>
      <div style="height: 42px; position: relative">
        <img
          style="height: 42px"
          :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
          loading="lazy"
          decoding="async"
        />
        <template v-if="!!games.mvp">
          <div
            style="position: absolute; left: 0; bottom: 0"
            class="mvp-box"
            :style="{ backgroundColor: games.mvp == 'MVP' ? '#FFD700' : '#FFFFFF' }"
          >
            {{ games.mvp == 'MVP' ? 'MVP' : 'SVP' }}
          </div>
        </template>
      </div>

      <n-flex vertical>
        <span class="font-number" style="font-size: 14px; font-weight: 700">{{
          games.queueName
        }}</span>
        <span class="record-card-meta">
          <n-icon style="margin-right: 1px">
            <CalendarNumber />
          </n-icon>
          {{ formattedDate }}
        </span>
      </n-flex>

      <n-flex justify="space-between" vertical style="gap: 0px">
        <n-flex justify="space-between">
          <span class="font-number">
            <span :style="{ fontWeight: '500', fontSize: '13px', color: themeColors.kill }">
              {{ games.participants[0].stats?.kills }}
            </span>
            /
            <span :style="{ fontWeight: '500', fontSize: '13px', color: themeColors.death }">
              {{ games.participants[0].stats?.deaths }}
            </span>
            /
            <span :style="{ fontWeight: '500', fontSize: '13px', color: themeColors.assist }">
              {{ games.participants[0].stats?.assists }}
            </span>
          </span>
          <!-- 海克斯模式：显示海克斯符文（最多4个） -->
          <n-flex v-if="usesAugments" class="record-card-augments" style="gap: 2px">
            <template
              v-for="(augmentId, _idx) in displayedAugmentIds"
              :key="`record-augment-${_idx}`"
            >
              <n-tooltip trigger="hover" placement="top">
                <template #trigger>
                  <span :class="['record-card-augment-shell', augmentRarityClass(augmentId)]">
                    <img
                      :src="assets.srcOf('perk', augmentId)"
                      class="record-card-augment-icon"
                      alt="augment"
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                </template>
                <AssetTooltipContent
                  :icon-src="assets.srcOf('perk', augmentId)"
                  :name="assets.detailOf('perk', augmentId)?.name ?? `海克斯 #${augmentId}`"
                  :description="assets.detailOf('perk', augmentId)?.description ?? ''"
                  :rarity="assets.detailOf('perk', augmentId)?.rarity"
                />
              </n-tooltip>
            </template>
            <span v-if="hiddenAugmentCount > 0" class="record-card-augments-more">
              +{{ hiddenAugmentCount }}
            </span>
          </n-flex>
          <!-- 普通模式：显示带tooltip的召唤师技能 -->
          <n-flex v-else class="record-card-spell-icons" style="gap: 2px">
            <n-tooltip
              v-for="(spellId, index) in [
                games.participants[0].spell1Id,
                games.participants[0].spell2Id
              ]"
              :key="`record-spell-${index}`"
              trigger="hover"
              placement="top"
              :disabled="!assets.detailOf('spell', spellId)"
            >
              <template #trigger>
                <img
                  :src="assets.srcOf('spell', spellId)"
                  class="record-card-icon-slot"
                  alt="spell"
                  loading="lazy"
                  decoding="async"
                />
              </template>
              <AssetTooltipContent
                v-if="assets.detailOf('spell', spellId)"
                :icon-src="assets.srcOf('spell', spellId)"
                :name="assets.detailOf('spell', spellId)?.name ?? ''"
                :description="assets.detailOf('spell', spellId)?.description ?? ''"
              />
            </n-tooltip>
          </n-flex>
        </n-flex>
        <!-- 装备区域（所有模式都显示） -->
        <n-flex class="record-card-item-slots" style="gap: 2px">
          <n-tooltip
            v-for="(itemId, index) in itemIds"
            :key="`record-item-${index}`"
            trigger="hover"
            placement="top"
            :disabled="!assets.detailOf('item', itemId)"
          >
            <template #trigger>
              <img
                :src="assets.srcOf('item', itemId)"
                class="record-card-icon-slot"
                alt="item"
                loading="lazy"
                decoding="async"
              />
            </template>
            <AssetTooltipContent
              v-if="assets.detailOf('item', itemId)"
              :icon-src="assets.srcOf('item', itemId)"
              :name="assets.detailOf('item', itemId)?.name ?? ''"
              :description="assets.detailOf('item', itemId)?.description ?? ''"
            />
          </n-tooltip>
        </n-flex>
      </n-flex>
      <div class="record-card-stats-block">
        <StatDots
          :icon="FlameOutline"
          tooltip="对英雄伤害占比"
          :color="otherColor(games.participants[0].stats?.damageDealtToChampionsRate, isDark)"
          :icon-background="isDark ? 'rgba(229, 167, 50, 0.18)' : 'rgba(229, 167, 50, 0.14)'"
          :value="
            formatCompactNumber(games.participants[0].stats?.totalDamageDealtToChampions ?? 0)
          "
          :percent="games.participants[0].stats?.damageDealtToChampionsRate ?? 0"
        />
        <StatDots
          :icon="ShieldOutline"
          tooltip="承伤占比"
          :color="healColorAndTaken(games.participants[0].stats?.damageTakenRate, isDark)"
          :icon-background="isDark ? 'rgba(92, 163, 234, 0.2)' : 'rgba(92, 163, 234, 0.12)'"
          :value="formatCompactNumber(games.participants[0].stats?.totalDamageTaken ?? 0)"
          :percent="games.participants[0].stats?.damageTakenRate ?? 0"
        />
        <StatDots
          :icon="HeartOutline"
          tooltip="治疗占比"
          :color="healColorAndTaken(games.participants[0].stats?.healRate, isDark)"
          :icon-background="isDark ? 'rgba(88, 182, 109, 0.2)' : 'rgba(88, 182, 109, 0.14)'"
          :value="formatCompactNumber(games.participants[0].stats?.totalHeal ?? 0)"
          :percent="games.participants[0].stats?.healRate ?? 0"
        />
      </div>
      <n-flex vertical justify="space-between" style="gap: 0px">
        <TeamAvatarGroup
          :identities="games.gameDetail.participantIdentities"
          :participants="games.gameDetail.participants"
          :team-offset="0"
          :current-player-key="currentPlayerKey"
          :is-dark="isDark"
          @nav-to-name="toNameRecord"
        />
        <TeamAvatarGroup
          :identities="games.gameDetail.participantIdentities"
          :participants="games.gameDetail.participants"
          :team-offset="5"
          :current-player-key="currentPlayerKey"
          :is-dark="isDark"
          @nav-to-name="toNameRecord"
        />
      </n-flex>
    </n-flex>
  </n-card>
</template>

<script lang="ts" setup>
import { Time, CalendarNumber, FlameOutline, ShieldOutline, HeartOutline } from '@vicons/ionicons5'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { formatCompactNumber } from '@renderer/utils/format'
import { healColorAndTaken, otherColor } from '@renderer/utils/colors'
import { assetPrefix } from '@renderer/services/http'
import { useSettingsStore } from '@renderer/pinia/setting'
import type { Game } from '@renderer/types/domain/match'
import AssetTooltipContent from './AssetTooltipContent.vue'
import StatDots from './StatDots.vue'
import TeamAvatarGroup from './TeamAvatarGroup.vue'
import { inject } from 'vue'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'

const props = defineProps<{
  recordType?: boolean
  games: Game
}>()

const emit = defineEmits<{
  'open-detail': []
}>()

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

/** 海克斯乱斗模式 queueId: 1700(斗魂竞技场), 2400(海克斯大乱斗) */
const augmentQueueIds = new Set([1700, 2400])
const usesAugments = computed(() => augmentQueueIds.has(props.games.queueId))

const augmentIds = computed(() => {
  const s = props.games.participants[0].stats
  return [s.playerAugment1, s.playerAugment2, s.playerAugment3, s.playerAugment4].filter(
    id => id > 0
  )
})

const displayedAugmentIds = computed(() => augmentIds.value.slice(0, 4))
const hiddenAugmentCount = computed(() => Math.max(0, augmentIds.value.length - 4))

const itemIds = computed(() => {
  const s = props.games.participants[0].stats
  return [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6]
})

/**
 * 优先使用父级（MatchHistory）批量预加载的资源 —— 同一页 N 张卡共享一次 IPC
 * 独立使用时（无 inject）退回自己的 preload
 */
const injected = inject(recordAssetsKey, null)
const assets = injected ?? useRecordAssets()

onMounted(() => {
  if (injected) return
  assets.preload([
    { kind: 'perk', ids: augmentIds.value },
    {
      kind: 'spell',
      ids: [props.games.participants[0].spell1Id, props.games.participants[0].spell2Id]
    },
    { kind: 'item', ids: itemIds.value }
  ])
})

/** 海克斯符文稀有度样式类 */
function augmentRarityClass(augmentId: number) {
  const rarity = assets.detailOf('perk', augmentId)?.rarity ?? ''
  switch (rarity) {
    case 'kPrismatic':
      return 'record-card-augment-prismatic'
    case 'kGold':
      return 'record-card-augment-gold'
    case 'kSilver':
      return 'record-card-augment-silver'
    case 'kBronze':
      return 'record-card-augment-bronze'
    default:
      return 'record-card-augment-default'
  }
}

const themeColors = computed(() => {
  if (isDark.value) {
    return { win: '#3d9b7a', loss: '#c45c5c', kill: '#3d9b7a', death: '#c45c5c', assist: '#b8860b' }
  }
  return { win: '#2d8a6c', loss: '#b84242', kill: '#2d8a6c', death: '#b84242', assist: '#b8860b' }
})

const cardStyle = computed(() => {
  const isWin = props.games.participants[0].stats.win
  return {
    '--left-bar-bg': isWin
      ? 'linear-gradient(180deg, #5ecfa4, #2d7a5e)'
      : 'linear-gradient(180deg, #e07070, #994444)',
    '--left-bar-glow': isWin
      ? '2px 0 10px rgba(61,155,122,0.45)'
      : '2px 0 10px rgba(196,92,92,0.35)',
    position: 'relative' as const
  }
})

const router = useRouter()

const formattedDate = computed(() => {
  const date = new Date(props.games.gameCreationDate)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}/${day}`
})

const currentPlayerKey = computed(() => {
  const p = props.games.participantIdentities[0].player
  return `${p.gameName}#${p.tagLine}`
})

function toNameRecord(name: string) {
  return router.push({
    path: '/Record',
    query: { name, t: Date.now() }
  })
}

function openDetail() {
  emit('open-detail')
}
</script>

<style scoped>
.record-card {
  background: linear-gradient(120deg, rgb(133, 133, 133) 30%, rgba(44, 44, 44, 0.5));
}

.win-font {
  color: #03c2f7;
  font-weight: 300;
  font-size: small;
}

.responsive-img {
  width: auto;
  object-fit: contain;
}

.win-class,
.defeat-class {
  cursor: pointer;
  overflow: hidden;
  position: relative;
  animation: fade-up var(--dur-normal) var(--ease-expo) both;
  animation-delay: calc(var(--stagger) * var(--stagger-i, 0));
  transition:
    transform var(--dur-normal) var(--ease-expo),
    box-shadow var(--dur-normal) var(--ease-expo);
  background: var(--glass-bg-mid) !important;
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--shadow-md), var(--glass-highlight) !important;
}

.win-class::before,
.defeat-class::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--left-bar-bg);
  box-shadow: var(--left-bar-glow);
  border-radius: 10px 0 0 10px;
  z-index: 1;
}

.win-class:hover,
.defeat-class:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg), var(--glass-highlight) !important;
}

.win-class:active,
.defeat-class:active {
  transform: scale(0.995);
  transition-duration: var(--dur-instant);
}

.mvp-box {
  display: inline-block;
  width: 20px;
  height: 11px;
  color: #000;
  font-weight: bold;
  font-size: 8px;
  line-height: 11px;
  text-align: center;
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.record-card-stats-block {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 8px 5px;
  background: var(--glass-bg-low);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  min-width: 0;
  box-shadow: var(--shadow-sm);
}

.record-card-meta {
  color: var(--text-secondary);
  font-size: 11px;
}

.record-card-item-slots :deep(.n-image),
.record-card-item-slots :deep(.n-image img),
.record-card-spell-icons .record-card-icon-slot {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--glass-border);
  box-sizing: border-box;
  object-fit: contain;
}

.record-card-item-slots .record-card-icon-slot {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--glass-border);
  box-sizing: border-box;
  object-fit: contain;
}

.record-card-spell-icons {
  display: inline-flex;
  gap: 2px;
}

.record-card-augments {
  display: flex;
  align-items: center;
  gap: 2px;
}

.record-card-augment-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
  box-sizing: border-box;
  overflow: hidden;
}

.record-card-augment-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: var(--augment-filter);
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

.record-card-augments-more {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 0 4px;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

:deep(.n-tag .n-avatar),
:deep(.n-button .n-avatar) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: box-shadow var(--dur-fast) var(--ease-expo);
}

:deep(.n-tag .n-avatar:hover),
:deep(.n-button .n-avatar:hover) {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.18);
}
</style>
