<template>
  <!-- Team Sections -->
  <!--
  首屏分批渲染：胜方先入场（~50 张图先 race），败方延迟 80ms。
  浏览器对 asset.localhost 并发限制 ~6/host，一次性 100+ 图同时请求会
  排队拖慢首屏；错峰让胜方先抢满 channel，败方再补位。
-->
  <div class="match-detail-body">
    <section
      v-for="team in ctx.players.teamSections.value"
      :key="team.teamId"
      class="match-detail-team-section"
    >
      <div class="match-detail-team-header" :class="team.headerClass">
        <div class="match-detail-team-title-wrap">
          <span class="match-detail-team-accent" />
          <span class="match-detail-team-title">{{ team.title }}</span>
          <span class="match-detail-team-pill font-number">
            ⚔️ {{ team.kills }} 击杀
          </span>
          <span class="match-detail-team-pill font-number">
            💰 {{ formatCompactNumber(team.gold) }}
          </span>
        </div>
        <div class="match-detail-team-stats-right font-number">
          <span class="match-detail-team-stat-chip match-detail-team-stat-chip--dmg">
            💥 输出 {{ formatCompactNumber(team.damage) }}
          </span>
          <span class="match-detail-team-stat-chip match-detail-team-stat-chip--taken">
            🛡️ 承伤 {{ formatCompactNumber(team.taken) }}
          </span>
        </div>
      </div>

      <div class="match-detail-team-card">
        <div class="match-detail-column-header">
          <span>玩家</span>
          <span>技能 / {{ ctx.usesAugments.value ? '海克斯' : '符文' }} / 装备</span>
          <span class="match-detail-header-right">KDA</span>
          <span class="match-detail-header-right">金钱</span>
          <span class="match-detail-header-right">补兵</span>
          <span class="match-detail-header-right">推塔</span>
          <span class="match-detail-bars-header">输出 / 承伤 / 治疗</span>
        </div>

        <div class="match-detail-team-rows">
          <div
            v-for="player in team.players"
            :key="player.participantId"
            class="match-detail-row"
            :class="{ 'match-detail-row-me': player.isMe }"
          >
            <div class="match-detail-player-cell">
              <div class="match-detail-player-main">
                <LazyImg
                  class="match-detail-player-avatar"
                  :src="assetPrefix + '/champion/' + player.championId"
                  alt="champion"
                />
                <!-- 段位：固定宽度占位——即便无数据/未定级/请求失败也不渲染内容，
                   但槽位一直在，避免十行名字因为有的有段位、有的没有而参差不齐 -->
                <div class="match-detail-player-rank">
                  <n-tooltip v-if="playerTier(player)" trigger="hover" placement="top">
                    <template #trigger>
                      <span class="match-detail-rank-badge">
                        <img
                          :src="playerTier(player)?.imgUrl"
                          class="match-detail-rank-icon"
                          alt="段位"
                        />
                        <span class="match-detail-rank-text">{{
                          playerTier(player)?.shortText
                        }}</span>
                      </span>
                    </template>
                    {{ playerTier(player)?.tooltipText }}
                  </n-tooltip>
                </div>
                <div class="match-detail-player-text">
                  <div class="match-detail-player-text-row">
                    <n-tooltip v-if="player.mvpTag" trigger="hover" placement="top">
                      <template #trigger>
                        <span
                          class="match-detail-mvp-chip"
                          :class="
                            player.mvpTag === 'MVP'
                              ? 'match-detail-mvp-chip--mvp'
                              : 'match-detail-mvp-chip--svp'
                          "
                          >{{ player.mvpTag }}</span
                        >
                      </template>
                      综合评分 {{ player.score.toFixed(1) }} · KDA/输出/参团/承伤/经济/补刀/推塔
                      七维加权
                    </n-tooltip>
                    <span
                      v-if="player.gameName"
                      class="match-detail-player-display match-detail-player-link"
                      role="link"
                      tabindex="0"
                      @click="searchSummoner(`${player.gameName}#${player.tagLine}`)"
                      @keydown.enter="searchSummoner(`${player.gameName}#${player.tagLine}`)"
                    >
                      <PlayerProfilePopover
                        :puuid="player.puuid"
                        :name="player.displayName"
                        :champion-id="player.championId"
                        :region="ctx.region.value"
                      >
                        {{ player.displayName }}
                      </PlayerProfilePopover>
                    </span>
                    <span v-else class="match-detail-player-display">{{ player.displayName }}</span>
                    <n-button
                      text
                      size="tiny"
                      class="match-detail-player-copy"
                      @click.stop="ctx.copy(player.displayName)"
                    >
                      <template #icon>
                        <n-icon><Copy /></n-icon>
                      </template>
                    </n-button>
                    <span v-if="player.puuid" @click.stop>
                      <PlayerNoteBadge
                        :puuid="player.puuid"
                        :game-name="player.gameName"
                        :tag-line="player.tagLine"
                        :encounter="ctx.buildEncounter(player)"
                        size="normal"
                      />
                    </span>
                    <n-tag v-if="player.isMe" size="small" :bordered="false" type="success"
                      >我</n-tag
                    >
                    <n-tooltip trigger="hover" placement="top">
                      <template #trigger>
                        <n-button
                          quaternary
                          circle
                          size="tiny"
                          class="match-detail-player-ai-trigger"
                          :class="{
                            'match-detail-player-ai-trigger--busy':
                              ctx.ai.aiLoading.value &&
                              ctx.ai.aiMode.value === 'player' &&
                              ctx.ai.aiTargetParticipantId.value === player.participantId
                          }"
                          @click.stop="ctx.ai.openPlayerAnalysis(player.participantId)"
                        >
                          <template #icon>
                            <n-spin
                              v-if="
                                ctx.ai.aiLoading.value &&
                                ctx.ai.aiMode.value === 'player' &&
                                ctx.ai.aiTargetParticipantId.value === player.participantId
                              "
                              :size="12"
                            />
                            <n-icon v-else><Sparkles /></n-icon>
                          </template>
                        </n-button>
                      </template>
                      AI 单人分析
                    </n-tooltip>
                  </div>
                  <div class="match-detail-badge-row">
                    <n-tooltip
                      v-for="badge in player.badges"
                      :key="badge.key"
                      trigger="hover"
                      placement="top"
                    >
                      <template #trigger>
                        <span class="match-detail-badge-icon" :class="badge.className">
                          <n-icon :size="10">
                            <component :is="badge.icon" />
                          </n-icon>
                        </span>
                      </template>
                      {{ badge.label }}
                    </n-tooltip>
                  </div>
                </div>
              </div>
            </div>

            <div class="match-detail-build-cell">
              <div class="match-detail-build-topline">
                <div class="match-detail-spells">
                  <n-tooltip
                    v-for="(spellId, index) in [player.spell1Id, player.spell2Id]"
                    :key="`${player.participantId}-spell-${spellId}-${index}`"
                    trigger="hover"
                    placement="top"
                    :disabled="!ctx.assets.detailOf('spell', spellId)"
                  >
                    <template #trigger>
                      <img
                        :src="ctx.assets.srcOf('spell', spellId)"
                        class="match-detail-spell-icon"
                        alt="spell"
                        loading="lazy"
                        decoding="async"
                      />
                    </template>
                    <AssetTooltipContent
                      v-if="ctx.assets.detailOf('spell', spellId)"
                      :icon-src="ctx.assets.srcOf('spell', spellId)"
                      :name="ctx.assets.detailOf('spell', spellId)?.name ?? ''"
                      :description="ctx.assets.detailOf('spell', spellId)?.description ?? ''"
                    />
                  </n-tooltip>
                </div>
                <!-- 符文/海克斯都跟 spells 同行 (密集布局) -->
                <div class="match-detail-perks">
                  <n-tooltip
                    v-for="(perkId, index) in displayedPerkIds(player.stats)"
                    :key="`${player.participantId}-perk-${perkId}-${index}`"
                    trigger="hover"
                    placement="top"
                    :disabled="!ctx.usesAugments.value && !ctx.assets.detailOf('perk', perkId)"
                  >
                    <template #trigger>
                      <span
                        v-if="ctx.usesAugments.value"
                        :class="[
                          'match-detail-augment-icon-shell',
                          augmentRarityClass(
                            ctx.assets.detailOf('perk', perkId)?.rarity,
                            'match-detail-augment'
                          )
                        ]"
                      >
                        <img
                          :src="ctx.assets.srcOf('perk', perkId)"
                          class="match-detail-augment-icon"
                          alt="augment"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                      <img
                        v-else
                        :src="ctx.assets.srcOf('perk', perkId)"
                        :class="[
                          'match-detail-perk-icon',
                          { 'match-detail-perk-icon-sub': index === 1 }
                        ]"
                        alt="perk"
                        loading="lazy"
                        decoding="async"
                      />
                    </template>
                    <AssetTooltipContent
                      :icon-src="ctx.assets.srcOf('perk', perkId)"
                      :name="
                        ctx.assets.detailOf('perk', perkId)?.name ??
                        (ctx.usesAugments.value ? `海克斯 #${perkId}` : `符文 #${perkId}`)
                      "
                      :description="ctx.assets.detailOf('perk', perkId)?.description ?? ''"
                      :rarity="ctx.assets.detailOf('perk', perkId)?.rarity"
                    />
                  </n-tooltip>
                </div>
              </div>
              <div class="match-detail-items">
                <template
                  v-for="(itemId, index) in itemIds(player.stats)"
                  :key="`${player.participantId}-${index}`"
                >
                  <n-tooltip
                    v-if="itemId > 0"
                    trigger="hover"
                    placement="top"
                    :disabled="!ctx.assets.detailOf('item', itemId)"
                  >
                    <template #trigger>
                      <img
                        :src="ctx.assets.srcOf('item', itemId)"
                        class="match-detail-item-icon"
                        :class="{ 'match-detail-item-trinket': index === 6 }"
                        alt="item"
                        loading="lazy"
                        decoding="async"
                      />
                    </template>
                    <AssetTooltipContent
                      v-if="ctx.assets.detailOf('item', itemId)"
                      :icon-src="ctx.assets.srcOf('item', itemId)"
                      :name="ctx.assets.detailOf('item', itemId)?.name ?? ''"
                      :description="ctx.assets.detailOf('item', itemId)?.description ?? ''"
                    />
                  </n-tooltip>
                  <!-- 空装备格：内凹暗槽占位，而非黑块（黑块像图片加载失败） -->
                  <span
                    v-else
                    class="match-detail-item-empty"
                    :class="{ 'match-detail-item-trinket': index === 6 }"
                  />
                </template>
              </div>
            </div>

            <div class="match-detail-value-cell match-detail-kda-value-cell">
              <div class="match-detail-kda-line font-number">
                <span>{{ player.stats.kills }}</span>
                <span class="match-detail-kda-separator">/</span>
                <span :style="{ color: deathsColor(player.stats.deaths, ctx.isDark.value) }">{{
                  player.stats.deaths
                }}</span>
                <span class="match-detail-kda-separator">/</span>
                <span>{{ player.stats.assists }}</span>
              </div>
              <div
                class="match-detail-cell-sub font-number"
                :style="{ color: kdaColor(kdaRatio(player.stats), ctx.isDark.value) }"
              >
                {{ kdaRatio(player.stats).toFixed(1) }} KDA
              </div>
            </div>
            <div class="match-detail-value-cell">
              <div class="font-number">
                {{ formatCompactNumber(player.stats.goldEarned) }}
              </div>
              <div class="match-detail-cell-sub font-number">{{ goldPerMin(player.stats) }}/分</div>
            </div>
            <div class="match-detail-value-cell">
              <div class="font-number">{{ totalCs(player.stats) }}</div>
              <div class="match-detail-cell-sub font-number">{{ csPerMin(player.stats) }}/分</div>
            </div>
            <div class="match-detail-value-cell">
              <div class="font-number">
                {{ formatCompactNumber(player.stats.damageDealtToTurrets) }}
              </div>
              <!-- 占位副行：撑出与相邻双行列一致的高度，主数值基线全表拉直 -->
              <div class="match-detail-cell-sub match-detail-cell-sub--ghost font-number">0</div>
            </div>

            <!-- 输出/承伤/治疗：按全场最大值刻度的横向对比条（一眼看出谁 carry） -->
            <div class="match-detail-bars-cell">
              <n-tooltip
                v-for="bar in playerBars(player)"
                :key="`${player.participantId}-${bar.key}`"
                trigger="hover"
                placement="left"
              >
                <template #trigger>
                  <div class="match-detail-bar-row">
                    <span class="match-detail-bar-value font-number">{{ bar.valueText }}</span>
                    <span class="match-detail-bar-track">
                      <span
                        class="match-detail-bar-fill"
                        :class="bar.fillClass"
                        :style="{ width: bar.width }"
                      />
                    </span>
                  </div>
                </template>
                {{ bar.tooltip }}
              </n-tooltip>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject } from 'vue'
import { Copy, Sparkles } from 'lucide-vue-next'
import { NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import { searchSummoner } from '@renderer/utils/navigation'
import { assetPrefix } from '@renderer/services/http'
import type { ParticipantStats } from '@renderer/types/domain/match'
import AssetTooltipContent from '../AssetTooltipContent.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import PlayerProfilePopover from '@renderer/components/common/PlayerProfilePopover.vue'
import { deathsColor, kdaColor } from '@renderer/utils/colors'
import { formatCompactNumber } from '@renderer/utils/format'
import { augmentRarityClass } from '@renderer/utils/augment'
import { matchDetailContextKey } from '../matchDetailContext'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailSummaryTab 必须在 MatchDetailInline 容器内使用')
/** 注入非空：上方守卫保证容器内使用（模板中直接读 .value，避免 TS 收窄失效的 null 判定） */
const ctx = injected as NonNullable<typeof injected>
function totalCs(stats: ParticipantStats) {
  return stats.totalMinionsKilled + stats.neutralMinionsKilled
}
function kdaRatio(stats: ParticipantStats) {
  return (stats.kills + stats.assists) / Math.max(1, stats.deaths)
}
function itemIds(stats: ParticipantStats) {
  return ctx.itemIds(stats)
}

/** 每分钟补兵（一位小数）；时长缺失时按 1 分钟兜底避免除零 */
function csPerMin(stats: ParticipantStats) {
  const minutes = Math.max(1, (ctx.game.value?.gameDuration ?? 60) / 60)
  return (totalCs(stats) / minutes).toFixed(1)
}

/** 每分钟金钱（整数）；与补兵/分同一口径 */
function goldPerMin(stats: ParticipantStats) {
  const minutes = Math.max(1, (ctx.game.value?.gameDuration ?? 60) / 60)
  return Math.round(stats.goldEarned / minutes)
}

/** 全场（双方 10 人）各项最大值——对比条的刻度，谁 carry 一眼可见 */
const gameMax = computed(() => {
  let damage = 1
  let taken = 1
  let heal = 1
  for (const p of ctx.players.detailPlayers.value) {
    damage = Math.max(damage, p.stats.totalDamageDealtToChampions)
    taken = Math.max(taken, p.stats.totalDamageTaken)
    heal = Math.max(heal, p.stats.totalHeal)
  }
  return { damage, taken, heal }
})

/** 单名玩家的三根对比条（输出/承伤/治疗）：宽度按全场最大值刻度，占比进 tooltip */
function playerBars(player: DetailPlayer) {
  const s = player.stats
  const m = gameMax.value
  const mk = (
    key: string,
    label: string,
    value: number,
    max: number,
    fillClass: string,
    teamPct: number
  ) => ({
    key,
    label,
    valueText: formatCompactNumber(value),
    width: `${Math.max(3, Math.round((value / max) * 100))}%`,
    fillClass,
    tooltip: `${label} ${value.toLocaleString()} · 占己方 ${teamPct}%`
  })
  return [
    mk(
      'damage',
      '输出',
      s.totalDamageDealtToChampions,
      m.damage,
      'match-detail-bar-fill--damage',
      player.teamRelative.damage
    ),
    mk(
      'taken',
      '承伤',
      s.totalDamageTaken,
      m.taken,
      'match-detail-bar-fill--taken',
      player.teamRelative.taken
    ),
    mk('heal', '治疗', s.totalHeal, m.heal, 'match-detail-bar-fill--heal', player.teamRelative.heal)
  ]
}
function displayedPerkIds(stats: ParticipantStats) {
  return ctx.displayedPerkIds(stats)
}

/** 某玩家的段位展示数据；无数据/未定级/请求失败/加载中统一返回 null（模板据此不渲染，只占位） */
function playerTier(player: DetailPlayer) {
  return ctx.ranks.tiersByPuuid.value[player.puuid] ?? null
}
</script>

<style scoped>
/* 行内展开：body 自然撑开（整页滚动由外层滚动容器负责），不再内部滚动 */
.match-detail-body {
  padding: var(--space-8) var(--space-12) var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

/* 区块 = 排版式标签 + 卡片（去一层盒子：标题悬于卡片之上，不再是"卡片里的色条"） */
.match-detail-team-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex-shrink: 0;
}

.match-detail-team-card {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 90%, transparent);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(18, 22, 28, 0.45);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.theme-light .match-detail-team-card {
  background: var(--bg-elevated);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

/* 队伍标签行：色点 + 色字 + 数据胶囊 */
.match-detail-team-header {
  --team-color: var(--semantic-win);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-4);
}

.match-detail-team-header-win {
  --team-color: var(--semantic-win);
}

.match-detail-team-header-loss {
  --team-color: var(--semantic-loss);
}

.match-detail-team-accent {
  width: 4px;
  height: 18px;
  border-radius: var(--radius-xs);
  background: var(--team-color);
  box-shadow: 0 0 10px color-mix(in srgb, var(--team-color) 65%, transparent);
  flex-shrink: 0;
}

.match-detail-team-title-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.match-detail-team-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--team-color);
  letter-spacing: 0.02em;
}

.match-detail-team-pill {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--team-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--team-color) 30%, transparent);
  padding: 1px var(--space-6);
  border-radius: var(--radius-pill);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.match-detail-team-stats-right {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-team-stat-chip {
  font-size: var(--font-size-2xs);
  padding: 2px var(--space-8);
  border-radius: var(--radius-pill);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.match-detail-team-stat-chip--dmg {
  color: var(--accent-gold-deep);
  background: color-mix(in srgb, var(--accent-gold-deep) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-gold-deep) 32%, transparent);
}

.match-detail-team-stat-chip--taken {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-blue) 32%, transparent);
}

.match-detail-column-header,
.match-detail-row {
  display: grid;
  /* build 列锁定 216px：弹性只留给玩家列，避免中部出现大片死空间；
     数字列全部右对齐双行，主数值基线全表一条直线 */
  grid-template-columns: minmax(188px, 1fr) 216px 84px 78px 72px 68px 180px;
  gap: var(--space-6);
  align-items: center;
}

.match-detail-column-header {
  /* 水平 padding 与数据行统一 12px；透明底 + 发丝线，弱化表头存在感 */
  padding: var(--space-4) var(--space-12);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  background: transparent;
  border-bottom: 1px solid var(--border-subtle);
  text-transform: none;
}

/* 表头数字列与数据行 text-align 对齐 */
.match-detail-header-right {
  text-align: right;
}

/* 条形区列头与条形区内容同步左缩进 */
.match-detail-bars-header {
  padding-left: var(--space-8);
}

.theme-light .match-detail-column-header {
  background: var(--glass-bg-low);
}

.match-detail-team-rows {
  display: flex;
  flex-direction: column;
}

.match-detail-row {
  /* 垂直 6px 呼吸感 + 水平 12px 与列头统一 */
  padding: var(--space-6) var(--space-12);
  border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  transition: background var(--dur-fast) var(--ease-expo);
  position: relative;
}

.match-detail-row:hover {
  background: var(--glass-bg-mid);
}

.match-detail-row:last-child {
  border-bottom: none;
}

/* "我" 行高亮：与主题 accent 同色系（wash + 左条），不再蓝绿混用 */
.match-detail-row-me {
  background: color-mix(in srgb, var(--semantic-win) 10%, transparent);
  box-shadow: inset 3px 0 0 0 var(--semantic-win);
}

.match-detail-row-me:hover {
  background: color-mix(in srgb, var(--semantic-win) 16%, transparent);
}

.theme-light .match-detail-row-me {
  background: color-mix(in srgb, var(--semantic-win) 8%, transparent);
}

.match-detail-player-main {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-player-avatar {
  /* 密集模式: 32→40 */
  width: clamp(32px, calc(32px + (100vw - 1100px) * 8 / 1100), 40px);
  height: clamp(32px, calc(32px + (100vw - 1100px) * 8 / 1100), 40px);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
  display: block;
}

/* 段位：固定宽度占位列，插在头像和名字之间——「段位 → 名字」的阅读顺序，
   且即便没有数据（未定级/请求失败/加载中）也保留槽位，避免十行名字参差不齐。
   overflow:hidden 是兜底裁切——真正的溢出防护在文案源头（useMatchPlayerRanks.ts 的
   formatCompactTierText 对大师+ 段位省略 4 位数胜点），这里只是双保险：万一文案逻辑
   日后被改动又漏了这茬，也只会裁切/省略号，不会撑破槽位挤压右侧名字列 */
.match-detail-player-rank {
  width: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.match-detail-rank-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 100%;
  cursor: help;
}

.match-detail-rank-icon {
  width: clamp(20px, calc(20px + (100vw - 1100px) * 4 / 1100), 24px);
  height: clamp(20px, calc(20px + (100vw - 1100px) * 4 / 1100), 24px);
  object-fit: contain;
  display: block;
}

/* 短文案如「钻石 IV」；灰度弱化，不与主名字抢视觉重量。
   overflow/ellipsis 是兜底：正常情况下不会触发（见上方 .match-detail-player-rank 注释） */
.match-detail-rank-text {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.match-detail-player-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* 锁定两行高度：无徽章的行名字不再垂直居中漂移，
     全表玩家名保持同一条顶线（"歪"感的来源之一） */
  min-height: 34px;
  justify-content: flex-start;
}

.match-detail-player-text-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.match-detail-player-display {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 可点击跳转战绩页：hover 高亮 + 手型光标，与游戏页玩家卡跳转语义一致 */
.match-detail-player-link {
  cursor: pointer;
  border-radius: 2px;
  transition: color var(--dur-fast) var(--ease-expo);
}

.match-detail-player-link:hover,
.match-detail-player-link:focus-visible {
  color: var(--accent-blue);
  outline: none;
}

/* 行内 AI 按钮：默认隐身，行 hover 或加载中才浮现——把每行常驻噪音降到最低 */
.match-detail-player-ai-trigger {
  --n-text-color: var(--text-secondary);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-expo);
}

.match-detail-row:hover .match-detail-player-ai-trigger,
.match-detail-player-ai-trigger--busy {
  opacity: 1;
}

.match-detail-player-copy {
  --n-text-color: var(--text-tertiary);
  opacity: 0.6;
  transition: opacity var(--dur-fast) var(--ease-expo);
}

.match-detail-player-copy:hover {
  opacity: 1;
}

.match-detail-badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

/* MVP/SVP 章：金/银双档，WeGame 式综合评分的胜败双方最高分 */
.match-detail-mvp-chip {
  --chip-color: var(--accent-gold);
  padding: 1px var(--space-6);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-2xs);
  font-weight: 800;
  font-style: italic;
  letter-spacing: 0.04em;
  line-height: 1.3;
  color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chip-color) 45%, transparent);
  flex-shrink: 0;
}

.match-detail-mvp-chip--mvp {
  --chip-color: var(--accent-gold);
}

.match-detail-mvp-chip--svp {
  --chip-color: #aab8c8;
}

.match-detail-player-text-row :deep(.n-tag) {
  color: var(--text-primary);
}

.match-detail-badge-icon {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight);
}

/* 战绩荣誉徽章配色：与战绩页 KDA/输出/承伤 色系一致 */
.match-detail-badge-kills {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 14%, transparent);
}
.match-detail-badge-damage {
  color: var(--accent-gold-deep);
  background: color-mix(in srgb, var(--accent-gold-deep) 16%, transparent);
}
.match-detail-badge-assists {
  color: var(--semantic-win-bright);
  background: color-mix(in srgb, var(--semantic-win-bright) 14%, transparent);
}
.match-detail-badge-turrets {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
}
.match-detail-badge-gold {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 14%, transparent);
}
.match-detail-badge-taken {
  color: var(--semantic-loss-bright);
  background: color-mix(in srgb, var(--semantic-loss-bright) 14%, transparent);
}
.match-detail-badge-cs {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
}

/* 多杀荣誉徽章：五杀金（底色更浓一档以示最高荣誉）/ 四杀琥珀 / 三杀蓝 */
.match-detail-badge-penta {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 22%, transparent);
}
.match-detail-badge-quadra {
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 16%, transparent);
}
.match-detail-badge-triple {
  color: var(--accent-sky);
  background: color-mix(in srgb, var(--accent-sky) 14%, transparent);
}

.match-detail-build-cell {
  display: flex;
  flex-direction: column;
  /* 密集: topline 与 items 间距 4→2 */
  gap: var(--space-2);
}

.match-detail-build-topline {
  /* 技能+符文紧凑同组靠左——不再 space-between（会把符文推到列右缘，像悬空 bug） */
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-6);
}

.match-detail-spells {
  display: flex;
  gap: var(--space-2);
}

.match-detail-spell-icon,
.match-detail-item-icon,
.match-detail-perk-icon {
  /* 18→22px 随 viewport：比旧 16 大一档，看得清图标细节 */
  width: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  height: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.match-detail-perks {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.match-detail-augment-icon-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 紧凑: 16→20 跟 spell/item/perk 同步 */
  width: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  height: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  border-radius: var(--radius-control);
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
  box-sizing: border-box;
  overflow: hidden;
}

.match-detail-augment-icon {
  /* inner 11→15 跟 shell 同步 */
  width: clamp(11px, calc(11px + (100vw - 1100px) * 4 / 1100), 15px);
  height: clamp(11px, calc(11px + (100vw - 1100px) * 4 / 1100), 15px);
  object-fit: contain;
  filter: var(--augment-filter);
}

.match-detail-augment-prismatic {
  --augment-border: rgba(187, 125, 255, 0.92);
  --augment-background: linear-gradient(180deg, rgba(123, 82, 214, 0.9), rgba(55, 34, 110, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(79%) sepia(31%) saturate(2173%)
    hue-rotate(225deg) brightness(102%) contrast(101%);
}

.match-detail-augment-gold {
  --augment-border: rgba(244, 198, 88, 0.92);
  --augment-background: linear-gradient(180deg, rgba(121, 90, 18, 0.9), rgba(62, 46, 8, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(82%) sepia(51%) saturate(590%)
    hue-rotate(354deg) brightness(103%) contrast(104%);
}

.match-detail-augment-silver {
  --augment-border: rgba(191, 205, 227, 0.88);
  --augment-background: linear-gradient(180deg, rgba(86, 103, 126, 0.9), rgba(39, 48, 61, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(418%)
    hue-rotate(176deg) brightness(103%) contrast(99%);
}

.match-detail-augment-bronze {
  --augment-border: rgba(197, 132, 89, 0.9);
  --augment-background: linear-gradient(180deg, rgba(118, 67, 35, 0.9), rgba(59, 33, 17, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(76%) sepia(31%) saturate(740%)
    hue-rotate(338deg) brightness(98%) contrast(94%);
}

.match-detail-augment-default {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
}

.match-detail-perk-icon-sub {
  opacity: 0.88;
}

.match-detail-items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* 空装备格：内凹暗槽，与实图标同尺寸——避免黑块被误读为图片加载失败 */
.match-detail-item-empty {
  width: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  height: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  border-radius: var(--radius-control);
  border: 1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
  box-sizing: border-box;
  flex-shrink: 0;
}

/* 饰品格（第 7 格）与前六格之间留出一档间距分组 */
.match-detail-item-trinket {
  margin-left: var(--space-4);
}

/* 数字单元格：统一右对齐 + 双行（主值 + 副行），全表共用一套结构。
   主值 sm 字号——数字要有存在感 */
.match-detail-value-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.match-detail-kda-line {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.match-detail-kda-separator {
  color: var(--text-tertiary);
}

/* 副行：每分钟/比值等次要信息，全列统一字号与色阶 */
.match-detail-cell-sub {
  font-size: var(--font-size-2xs);
  font-weight: 500;
  color: var(--text-tertiary);
  line-height: 1.2;
}

/* 占位副行：仅撑高度不显示——让单行列与双行列的主数值基线对齐 */
.match-detail-cell-sub--ghost {
  visibility: hidden;
}

/* 输出/承伤/治疗对比条：值 + 按全场最大值刻度的横向条。
   左侧留一档缩进，与推塔数字列拉开——两簇数字不贴身（拥挤感来源之一） */
.match-detail-bars-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: var(--space-8);
}

.match-detail-bar-row {
  /* 标签不逐行重复（列头已说明），色彩+顺序+tooltip 即可辨识——条更长更干净 */
  display: grid;
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: var(--space-4);
}

.match-detail-bar-value {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.match-detail-bar-track {
  height: 4px;
  border-radius: var(--radius-xs);
  background: var(--glass-bg-mid);
  overflow: hidden;
}

.theme-light .match-detail-bar-track {
  background: var(--glass-bg-high);
}

.match-detail-bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-xs);
  transition: width var(--dur-normal) var(--ease-expo);
}

/* 三色与旧图标底色同系：输出琥珀 / 承伤蓝 / 治疗绿 */
.match-detail-bar-fill--damage {
  background: linear-gradient(
    90deg,
    #f59e0b,
    #ef4444
  );
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.35);
}

.match-detail-bar-fill--taken {
  background: linear-gradient(
    90deg,
    #3b82f6,
    #6366f1
  );
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.35);
}

.match-detail-bar-fill--heal {
  background: linear-gradient(90deg, #10b981, #059669);
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.35);
}

@media (max-width: 1100px) {
  .match-detail-column-header,
  .match-detail-row {
    grid-template-columns: 1fr;
  }

  .match-detail-column-header {
    display: none;
  }

  .match-detail-row {
    gap: var(--space-10);
  }
}
</style>
