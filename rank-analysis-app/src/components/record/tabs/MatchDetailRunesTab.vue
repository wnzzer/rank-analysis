<template>
  <!-- 符文 tab：每人一张卡片——完整符文页（主系 3 符文 + 副系 2 符文 + 属性碎片）。
       数据源 = LCU match-details `participants[].perks`（跨区 SGP match-v5 同构透传）；
       旧缓存无 perks 时回退扁平 perk0/perkPrimaryStyle/perkSubStyle -->
  <div class="match-detail-runes-tab">
    <div v-if="ctx.usesAugments.value" class="match-detail-runes-hint">
      本局为海克斯/斗魂模式，无传统符文页（以海克斯强化代替）。
    </div>

    <section
      v-for="team in ctx.players.teamSections.value"
      :key="team.teamId"
      class="match-detail-runes-team"
    >
      <div class="match-detail-runes-team-title">{{ team.title }}</div>
      <div class="match-detail-runes-grid">
        <div
          v-for="player in team.players"
          :key="player.participantId"
          class="match-detail-runes-card"
          :class="{ 'match-detail-runes-card--me': player.isMe }"
        >
          <div class="match-detail-runes-card-head">
            <LazyImg
              class="match-detail-runes-avatar"
              :src="assetPrefix + '/champion/' + player.championId"
              alt="champion"
            />
            <span
              v-if="player.gameName"
              class="match-detail-runes-name match-detail-runes-name--link"
              role="link"
              tabindex="0"
              @click="searchSummoner(`${player.gameName}#${player.tagLine}`)"
              @keydown.enter="searchSummoner(`${player.gameName}#${player.tagLine}`)"
              >{{ player.displayName }}</span
            >
            <span v-else class="match-detail-runes-name">{{ player.displayName }}</span>
            <n-tag v-if="player.isMe" size="small" :bordered="false" type="success">我</n-tag>
          </div>

          <div class="match-detail-runes-body">
            <template v-if="perksOf(player).primary">
              <!-- 主系：基石 + 3 符文 + 风格 -->
              <div class="match-detail-runes-slot">
                <span class="match-detail-runes-slot-label">主系</span>
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <img
                      v-if="perkSrc(perksOf(player).primary!.selections[0]?.perk)"
                      :src="perkSrc(perksOf(player).primary!.selections[0]!.perk)"
                      class="match-detail-runes-keystone"
                      alt="perk"
                      loading="lazy"
                      decoding="async"
                    />
                  </template>
                  {{ perkName(perksOf(player).primary!.selections[0]?.perk ?? 0) }}
                </n-tooltip>
                <span class="match-detail-runes-style">
                  {{ styleName(perksOf(player).primary!.style) }}
                </span>
                <div class="match-detail-runes-perk-list">
                  <img
                    v-for="sel in perksOf(player).primary!.selections.slice(1)"
                    :key="sel.perk"
                    v-bind="perkImgAttrs(sel.perk)"
                  />
                </div>
              </div>

              <!-- 副系：2 符文 + 风格 -->
              <div class="match-detail-runes-slot" v-if="perksOf(player).sub">
                <span class="match-detail-runes-slot-label">副系</span>
                <span class="match-detail-runes-style">
                  {{ styleName(perksOf(player).sub!.style) }}
                </span>
                <div class="match-detail-runes-perk-list">
                  <img
                    v-for="sel in perksOf(player).sub!.selections"
                    :key="sel.perk"
                    v-bind="perkImgAttrs(sel.perk)"
                  />
                </div>
              </div>

              <!-- 属性碎片 -->
              <div class="match-detail-runes-slot" v-if="perksOf(player).statIds.length">
                <span class="match-detail-runes-slot-label">属性</span>
                <div class="match-detail-runes-perk-list">
                  <img v-for="id in perksOf(player).statIds" :key="id" v-bind="perkImgAttrs(id)" />
                </div>
              </div>
            </template>

            <!-- 回退：无完整 perks（旧缓存/异常数据）时只显示 LCU 扁平三字段 -->
            <template v-else>
              <div class="match-detail-runes-slot">
                <span class="match-detail-runes-slot-label">主系</span>
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <img
                      v-if="perkSrc(player.stats.perk0)"
                      :src="perkSrc(player.stats.perk0)"
                      class="match-detail-runes-keystone"
                      alt="perk"
                      loading="lazy"
                      decoding="async"
                    />
                  </template>
                  {{ perkName(player.stats.perk0) }}
                </n-tooltip>
                <span class="match-detail-runes-style">
                  {{ styleName(player.stats.perkPrimaryStyle) }}
                </span>
              </div>

              <div class="match-detail-runes-slot">
                <span class="match-detail-runes-slot-label">副系</span>
                <span class="match-detail-runes-style">
                  {{ styleName(player.stats.perkSubStyle) }}
                </span>
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <span class="match-detail-runes-more">符文页数据缺失</span>
                  </template>
                  旧缓存/异常数据未携带完整符文页，仅显示主系基石与主/副系风格
                </n-tooltip>
              </div>
            </template>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!ctx.players.teamSections.value.length" class="match-detail-runes-empty">
      本局无符文数据
    </div>
  </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { NTag, NTooltip } from 'naive-ui'
import { searchSummoner } from '@renderer/utils/navigation'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import type { GamePerks } from '@renderer/types/domain/match'
import { matchDetailContextKey } from '../matchDetailContext'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailRunesTab 必须在 MatchDetailInline 容器内使用')
/** 注入非空：上方守卫保证容器内使用 */
const ctx = injected as NonNullable<typeof injected>

/** 基石符文图标（无 id 时返回空串，模板不渲染） */
function perkSrc(perkId: number) {
  if (perkId <= 0) return ''
  return ctx.assets.srcOf('perk', perkId)
}

/** 基石符文名（缓存未就绪时回退编号） */
function perkName(perkId: number) {
  if (perkId <= 0) return ''
  return ctx.assets.detailOf('perk', perkId)?.name ?? `符文 #${perkId}`
}

/** 主/副系风格名（风格 id 也在 perk 缓存中，未命中回退编号） */
const styleName = (styleId: number) =>
  styleId <= 0 ? '未选择' : (ctx.assets.detailOf('perk', styleId)?.name ?? `风格 #${styleId}`)

/** 完整符文页切分：主系（styles[0]，基石在 selections[0]）/ 副系（styles[1]）/ 属性碎片 */
function perksOf(player: { perks?: GamePerks }) {
  const p = player.perks
  const primary = p?.styles?.[0]
  const sub = p?.styles?.[1]
  return {
    primary,
    sub,
    statIds: p?.statPerks ? [p.statPerks.offense, p.statPerks.flex, p.statPerks.defense] : []
  }
}

/** 普通符文小图标（20px 槽位）属性；无 id 不渲染 */
function perkImgAttrs(perkId: number) {
  return perkId > 0
    ? {
        src: ctx.assets.srcOf('perk', perkId),
        class: 'match-detail-runes-perk',
        alt: 'perk',
        loading: 'lazy' as const,
        decoding: 'async' as const
      }
    : { class: 'match-detail-runes-perk match-detail-runes-perk--empty' }
}
</script>

<style scoped>
.match-detail-runes-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-12) var(--space-10);
}

.match-detail-runes-hint {
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--glass-bg-low);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.match-detail-runes-team {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-runes-team-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
  padding: 0 var(--space-4);
}

.match-detail-runes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-8);
}

.match-detail-runes-card {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.015);
  padding: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  transition: background var(--dur-fast) var(--ease-expo);
}

.match-detail-runes-card:hover {
  background: var(--glass-bg-mid);
}

.theme-light .match-detail-runes-card {
  background: var(--bg-elevated);
}

.match-detail-runes-card--me {
  box-shadow: inset 3px 0 0 0 var(--semantic-win);
}

.match-detail-runes-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.match-detail-runes-avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
  display: block;
}

.match-detail-runes-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.match-detail-runes-name--link {
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-expo);
}

.match-detail-runes-name--link:hover,
.match-detail-runes-name--link:focus-visible {
  color: var(--accent-blue);
  outline: none;
}

.match-detail-runes-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-runes-slot {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-runes-slot-label {
  width: 28px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  letter-spacing: 0.06em;
}

.match-detail-runes-keystone {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
  flex-shrink: 0;
}

.match-detail-runes-style {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-detail-runes-perk-list {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.match-detail-runes-perk {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
  flex-shrink: 0;
}

.match-detail-runes-perk--empty {
  opacity: 0.25;
  border-style: dashed;
}

.match-detail-runes-more {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  cursor: help;
  margin-left: auto;
}

.match-detail-runes-empty {
  padding: var(--space-16);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
</style>
