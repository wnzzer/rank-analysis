<template>
  <n-card
    :content-style="contentStyleStr"
    class="record-card"
    :class="{ 'record-card-win': isWin, 'record-card-loss': !isWin }"
    role="button"
    tabindex="0"
    @click="openDetail"
    @keyup.enter="openDetail"
  >
    <!-- 固定列网格：所有卡片共用同一套列轨道，行与行严格对齐
         （旧 space-between 弹性布局会让列落点随内容漂移） -->
    <div class="record-card-grid">
      <n-flex vertical class="record-card-result">
        <span
          class="font-number record-card-result-label"
          :class="isWin ? 'record-card-text-win' : 'record-card-text-loss'"
        >
          {{ resultLabel }}
          <n-divider class="record-card-result-divider" />
        </span>

        <span class="record-card-meta">
          <n-icon class="record-card-meta-icon"><Time /></n-icon>
          {{ Math.ceil(games.gameDuration / 60) }}分
        </span>
      </n-flex>
      <div class="record-card-champion">
        <LazyImg
          class="record-card-champion-img"
          :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
          alt="champion"
        />
        <template v-if="!!games.mvp">
          <div
            class="record-card-mvp"
            :class="games.mvp === 'MVP' ? 'record-card-mvp-gold' : 'record-card-mvp-silver'"
          >
            {{ games.mvp == 'MVP' ? 'MVP' : 'SVP' }}
          </div>
        </template>
      </div>

      <n-flex vertical class="record-card-queue-block">
        <span class="font-number record-card-queue">{{ games.queueName }}</span>
        <n-tooltip trigger="hover" placement="top">
          <template #trigger>
            <span class="record-card-meta">
              <n-icon class="record-card-meta-icon">
                <CalendarNumber />
              </n-icon>
              {{ formattedDate }}
            </span>
          </template>
          {{ fullDateTime }}
        </n-tooltip>
      </n-flex>

      <n-flex justify="space-between" vertical class="record-card-kda-block">
        <!-- KDA + 技能/海克斯紧凑同组靠左（不再 space-between 把图标推到列右缘悬空） -->
        <n-flex justify="start" align="center" :size="10">
          <span class="font-number record-card-kda">
            <span class="record-card-kda-kill">
              {{ games.participants[0].stats?.kills }}
            </span>
            <span class="record-card-kda-sep">/</span>
            <span class="record-card-kda-death">
              {{ games.participants[0].stats?.deaths }}
            </span>
            <span class="record-card-kda-sep">/</span>
            <span class="record-card-kda-assist">
              {{ games.participants[0].stats?.assists }}
            </span>
          </span>
          <!-- 海克斯强化：斗魂(CHERRY，可能 5/6 个) + 海克斯大乱斗(2400)；3×2 网格 -->
          <div v-if="usesAugments" class="record-card-augments">
            <template
              v-for="(augmentId, _idx) in displayedAugmentIds"
              :key="`record-augment-${_idx}`"
            >
              <n-tooltip trigger="hover" placement="top">
                <template #trigger>
                  <span
                    :class="[
                      'record-card-augment-shell',
                      augmentRarityClass(
                        assets.detailOf('perk', augmentId)?.rarity,
                        'record-card-augment'
                      )
                    ]"
                  >
                    <LazyImg
                      :src="assets.srcOf('perk', augmentId)"
                      class="record-card-augment-icon"
                      alt="augment"
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
          </div>
          <!-- 普通模式：显示带tooltip的召唤师技能 -->
          <n-flex v-else class="record-card-spell-icons" :size="1">
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
                <LazyImg
                  :src="assets.srcOf('spell', spellId)"
                  class="record-card-icon-slot"
                  alt="spell"
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
        <!-- 装备区域（所有模式都显示）；空格渲染内凹暗槽而非黑块 -->
        <n-flex class="record-card-item-slots" :size="1">
          <template v-for="(itemId, index) in itemIds" :key="`record-item-${index}`">
            <n-tooltip
              v-if="itemId > 0"
              trigger="hover"
              placement="top"
              :disabled="!assets.detailOf('item', itemId)"
            >
              <template #trigger>
                <LazyImg
                  :src="assets.srcOf('item', itemId)"
                  class="record-card-icon-slot"
                  alt="item"
                />
              </template>
              <AssetTooltipContent
                v-if="assets.detailOf('item', itemId)"
                :icon-src="assets.srcOf('item', itemId)"
                :name="assets.detailOf('item', itemId)?.name ?? ''"
                :description="assets.detailOf('item', itemId)?.description ?? ''"
              />
            </n-tooltip>
            <span v-else class="record-card-icon-slot record-card-item-empty" />
          </template>
        </n-flex>
      </n-flex>

      <!-- 输出/承伤/治疗统计盒（原版观感：图标+圆点+数值+百分比）；列宽固定保证行间对齐 -->
      <div class="record-card-stats-block">
        <StatDots
          :icon="FlameOutline"
          tooltip="对英雄伤害 · 百分比 = 占全队伤害的比例"
          :color="otherColor(games.participants[0].stats?.damageDealtToChampionsRate, isDark)"
          :icon-background="isDark ? 'rgba(229, 167, 50, 0.18)' : 'rgba(229, 167, 50, 0.14)'"
          :value="
            formatCompactNumber(games.participants[0].stats?.totalDamageDealtToChampions ?? 0)
          "
          :percent="games.participants[0].stats?.damageDealtToChampionsRate ?? 0"
        />
        <StatDots
          :icon="ShieldOutline"
          tooltip="承受伤害 · 百分比 = 占全队承伤的比例"
          :color="healColorAndTaken(games.participants[0].stats?.damageTakenRate, isDark)"
          :icon-background="isDark ? 'rgba(92, 163, 234, 0.2)' : 'rgba(92, 163, 234, 0.12)'"
          :value="formatCompactNumber(games.participants[0].stats?.totalDamageTaken ?? 0)"
          :percent="games.participants[0].stats?.damageTakenRate ?? 0"
        />
        <StatDots
          :icon="HeartOutline"
          tooltip="治疗量 · 百分比 = 占全队治疗的比例"
          :color="healColorAndTaken(games.participants[0].stats?.healRate, isDark)"
          :icon-background="isDark ? 'rgba(88, 182, 109, 0.2)' : 'rgba(88, 182, 109, 0.14)'"
          :value="formatCompactNumber(games.participants[0].stats?.totalHeal ?? 0)"
          :percent="games.participants[0].stats?.healRate ?? 0"
        />
      </div>

      <div class="record-card-teams">
        <TeamAvatarGroup
          :identities="games.gameDetail.participantIdentities"
          :participants="games.gameDetail.participants"
          :team-offset="0"
          :current-player-key="currentPlayerKey"
          :is-dark="isDark"
          @nav-to-name="toNameRecord"
        />
        <!-- 第二队为空（人机/残缺数据）时不渲染，避免出现灰色空 pill -->
        <TeamAvatarGroup
          v-if="hasSecondTeam"
          :identities="games.gameDetail.participantIdentities"
          :participants="games.gameDetail.participants"
          :team-offset="5"
          :current-player-key="currentPlayerKey"
          :is-dark="isDark"
          @nav-to-name="toNameRecord"
        />
      </div>
    </div>
  </n-card>
</template>

<script lang="ts" setup>
import { Time, CalendarNumber, FlameOutline, ShieldOutline, HeartOutline } from '@vicons/ionicons5'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { formatCompactNumber } from '@renderer/utils/format'
import { healColorAndTaken, otherColor } from '@renderer/utils/colors'
import { assetPrefix } from '@renderer/services/http'
import { useTheme } from '@renderer/composables/useTheme'
import { augmentRarityClass } from '@renderer/utils/augment'
import type { Game } from '@renderer/types/domain/match'
import AssetTooltipContent from './AssetTooltipContent.vue'
import StatDots from './StatDots.vue'
import TeamAvatarGroup from './TeamAvatarGroup.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
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

const { isDark } = useTheme()

const isWin = computed(() => props.games.participants[0].stats.win)

// n-card content-style uses tokens via inline CSS string so naive-ui internals respect spacing scale
const contentStyleStr = 'padding: var(--space-8) var(--space-12);'

const isCherry = computed(() => props.games.gameMode === 'CHERRY')
// 海克斯强化局：斗魂竞技场所有变种（CHERRY，queueId 可能是 1700/1710/1810/1820...）
// 或海克斯大乱斗（2400，gameMode 仍是 ARAM 但用 augment 系统）
const usesAugments = computed(() => isCherry.value || props.games.queueId === 2400)
const placement = computed(() => props.games.participants[0]?.stats?.subteamPlacement ?? 0)
const resultLabel = computed(() => {
  if (isCherry.value && placement.value > 0) {
    return `第 ${placement.value} 名`
  }
  return isWin.value ? '胜利' : '失败'
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

/**
 * 折叠策略:augment 数量稳定占 ≤6 格。
 * - 1~6 个:全部展示,不出 +N 标签
 * - ≥7 个:前 5 个 + "+(N-5)" 折叠,总占 6 格,横向宽度恒定
 *
 * 海克斯/斗魂理论最多 6 个,但保留 ≥7 折叠作为防御性设计,
 * 避免 LCU 未来扩展时撑爆战绩卡布局。
 */
const displayedAugmentIds = computed(() => {
  const ids = augmentIds.value
  return ids.length <= 6 ? ids : ids.slice(0, 5)
})
const hiddenAugmentCount = computed(() =>
  Math.max(0, augmentIds.value.length - displayedAugmentIds.value.length)
)

const itemIds = computed(() => {
  const s = props.games.participants[0].stats
  return [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6]
})

/** 第二队是否有数据（人机/残缺对局只有一队，隐藏空组避免灰 pill） */
const hasSecondTeam = computed(
  () => (props.games.gameDetail?.participantIdentities?.length ?? 0) > 5
)

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

const router = useRouter()

const formattedDate = computed(() => {
  const date = new Date(props.games.gameCreationDate)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}/${day}`
})

/** 完整开局时间（hover 展示）：MM/DD 无法区分同日多局，也缺年份 */
const fullDateTime = computed(() => new Date(props.games.gameCreationDate).toLocaleString())

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
/* === 卡片容器 === */
.record-card {
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

.record-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  z-index: 1;
  transition:
    width var(--dur-fast) var(--ease-expo),
    filter var(--dur-fast) var(--ease-expo);
}

/* hover 微交互：胜负条增亮加宽，与卡片上浮联动 */
.record-card:hover::before {
  width: 4px;
  filter: brightness(1.25);
}

.record-card-win::before {
  background: var(--win-bar-gradient);
  box-shadow: var(--glow-win);
}

.record-card-loss::before {
  background: var(--loss-bar-gradient);
  box-shadow: var(--glow-loss);
}

/* 胜负色 wash：极淡的结果色从左向右渐隐铺满卡面——胜负情绪不再只挤在
   左缘 3px 里（op.gg/WeGame 的行业语言；详情页头部环境光同款手法） */
.record-card-win {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--semantic-win) 9%, transparent),
      color-mix(in srgb, var(--semantic-win) 3%, transparent) 34%,
      transparent 58%
    ),
    var(--glass-bg-mid) !important;
}

.record-card-loss {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--semantic-loss) 8%, transparent),
      color-mix(in srgb, var(--semantic-loss) 3%, transparent) 34%,
      transparent 58%
    ),
    var(--glass-bg-mid) !important;
}

/* 浅色：底必须是白纸（bg-elevated）而非灰玻璃——灰底叠胜负色渐变会发浊，
   白底上的色彩 wash 才干净（同报纸彩色套印的道理） */
.theme-light .record-card-win {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--semantic-win) 7%, transparent),
      transparent 55%
    ),
    var(--bg-elevated) !important;
}

.theme-light .record-card-loss {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--semantic-loss) 6%, transparent),
      transparent 55%
    ),
    var(--bg-elevated) !important;
}

/* 浅色：卡内嵌套容器（指标盒/队伍胶囊）用白色 scrim 而非灰玻璃——
   灰色压在胜负色调的卡面上是「脏」感的主要来源；白 scrim 读作磨砂纸层。
   另外内嵌层不该有投影（海拔语法：只有卡片本体浮起） */
.theme-light .record-card-stats-block {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(20, 30, 35, 0.07);
  box-shadow: none;
}

.theme-light .record-card-teams .n-tag {
  background-color: rgba(255, 255, 255, 0.6);
}

.record-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg), var(--glass-highlight) !important;
}

.record-card:active {
  transform: scale(0.995);
  transition-duration: var(--dur-instant);
}

/* === 固定列网格：结果 | 头像 | 队列 | KDA+装备 | 三色条 | 队伍头像 ===
   所有卡片共用同一套列轨道 → 行与行严格对齐 */
.record-card-grid {
  display: grid;
  /* 固定列轨道保证行间对齐；space-between 把富余空隙均摊到列间——
     还原原版的松弛呼吸感（1fr 会把空间全吞在一处，左侧显挤） */
  grid-template-columns:
    58px
    clamp(42px, calc(42px + (100vw - 1100px) * 10 / 1100), 52px)
    minmax(64px, 84px)
    minmax(174px, 216px)
    172px
    140px;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-8);
}

/* === 结果列（胜利/失败 + 时长） === */
.record-card-result {
  gap: 1px;
}

.record-card-result-label {
  font-weight: 700;
  font-size: var(--font-size-md);
  margin-left: var(--space-4);
  margin-top: var(--space-2);
}

.record-card-text-win {
  color: var(--semantic-win);
}

.record-card-text-loss {
  color: var(--semantic-loss);
}

.record-card-result-divider {
  margin: 1px 0;
  line-height: 1px;
}

.record-card-meta {
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
}

.record-card-meta-icon {
  margin-right: 1px;
}

/* === 英雄头像 + MVP 牌 === */
.record-card-champion {
  /* 42→52px 随 viewport 平滑放大 (1100→2200) */
  height: clamp(42px, calc(42px + (100vw - 1100px) * 10 / 1100), 52px);
  width: clamp(42px, calc(42px + (100vw - 1100px) * 10 / 1100), 52px);
  position: relative;
}

.record-card-champion-img {
  display: block;
  width: clamp(42px, calc(42px + (100vw - 1100px) * 10 / 1100), 52px);
  height: clamp(42px, calc(42px + (100vw - 1100px) * 10 / 1100), 52px);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  box-sizing: border-box;
}

/* 胜负色细环：呼应左侧胜负条，一眼扫过整列即读出胜负节奏 */
.record-card-win .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-win) 45%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--semantic-win) 16%, transparent);
}

.record-card-loss .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-loss) 40%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--semantic-loss) 14%, transparent);
}

/* MVP/SVP 徽章：金/银渐变 + 内高光 + 微光晕（替代平面色块贴纸） */
.record-card-mvp {
  position: absolute;
  left: -3px;
  bottom: -3px;
  display: inline-block;
  padding: 0 var(--space-4);
  height: 12px;
  font-weight: 800;
  font-style: italic;
  font-size: var(--font-size-3xs);
  line-height: 12px;
  letter-spacing: 0.03em;
  text-align: center;
  border-radius: var(--radius-pill);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    var(--shadow-sm);
}

.record-card-mvp-gold {
  color: #201500;
  background: linear-gradient(180deg, #f6d365, #d4a017);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 0 8px rgba(244, 198, 88, 0.35);
}

.record-card-mvp-silver {
  color: #1c232b;
  background: linear-gradient(180deg, #eef3f9, #aab8c8);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 0 8px rgba(190, 205, 222, 0.3);
}

/* === 队列名 === */
.record-card-queue {
  font-size: var(--font-size-md);
  font-weight: 700;
}

/* === KDA + 装备区块 === */
.record-card-kda-block {
  gap: 0;
}

.record-card-kda > span {
  /* KDA 是卡片核心数据，加重一档立住主角地位 */
  font-weight: 650;
  font-size: var(--font-size-base);
}

.record-card-kda-kill {
  color: var(--semantic-win);
}

.record-card-kda-death {
  color: var(--semantic-loss);
}

.record-card-kda-assist {
  /* 助攻金色：#b8860b 在暗底几乎不可读，提亮一档 */
  color: var(--accent-gold-deep);
}

/* 分隔符淡化：让三个数字成为主角（详情页同款纪律） */
.record-card-kda-sep {
  color: var(--text-tertiary);
}

/* === 输出/承伤/治疗统计盒（原版观感：带边框玻璃盒 + StatDots），定宽保对齐 === */
.record-card-stats-block {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: var(--space-4) var(--space-8);
  background: var(--glass-bg-low);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  min-width: 0;
  box-shadow: var(--shadow-sm);
}

/* === 队伍头像列：两行胶囊 = 我方/敌方，列宽足够 5 人单行排布 === */
.record-card-teams {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  justify-content: center;
}

/* === 装备/技能 图标槽（2px 缝隙缓解密压感） === */
.record-card-item-slots,
.record-card-spell-icons {
  gap: var(--space-2);
}

.record-card-item-slots :deep(.n-image),
.record-card-item-slots :deep(.n-image img),
.record-card-item-slots .record-card-icon-slot,
.record-card-spell-icons .record-card-icon-slot {
  /* 24→30px 随 viewport (1100→2200) */
  width: clamp(24px, calc(24px + (100vw - 1100px) * 6 / 1100), 30px);
  height: clamp(24px, calc(24px + (100vw - 1100px) * 6 / 1100), 30px);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--glass-border);
  box-sizing: border-box;
  object-fit: contain;
}

.record-card-spell-icons {
  display: inline-flex;
}

/* 空装备格：内凹暗槽，与实图标同尺寸——黑块像图片加载失败 */
.record-card-item-empty {
  display: inline-block;
  border-color: color-mix(in srgb, var(--glass-border) 55%, transparent) !important;
  background: color-mix(in srgb, var(--bg-elevated) 45%, transparent) !important;
}

/* === 海克斯强化 === */
.record-card-augments {
  /* 单行展示,最多 6 个 augment(新斗魂);不撑高度,横向占 ~106px。 */
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.record-card-augment-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 18→22px 随 viewport (1100→2200), 比装备槽小一圈 */
  width: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  height: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  border-radius: var(--radius-sm);
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
  box-sizing: border-box;
  overflow: hidden;
}

.record-card-augment-icon {
  display: block;
  width: 100%;
  height: 100%;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  /* meta-icon badge 16→20 随 viewport */
  min-width: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  height: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  padding: 0 var(--radius-xs);
}

:deep(.n-tag .n-avatar),
:deep(.n-button .n-avatar) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--dur-fast) var(--ease-expo);
  /* TeamAvatarGroup 头像 15→22px 随 viewport, 强制覆盖 n-avatar 默认尺寸 */
  width: clamp(15px, calc(15px + (100vw - 1100px) * 7 / 1100), 22px) !important;
  height: clamp(15px, calc(15px + (100vw - 1100px) * 7 / 1100), 22px) !important;
}

:deep(.n-tag .n-avatar:hover),
:deep(.n-button .n-avatar:hover) {
  box-shadow: var(--shadow-md);
}
</style>
