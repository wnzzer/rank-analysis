<template>
  <!-- 出装 tab：每局每玩家一张卡片——装备槽（LCU）+ 技能加点序列（SGP SKILL_LEVEL_UP 事件）。
       海克斯/斗魂模式展示强化槽替代装备。 -->
  <div class="match-detail-builds-tab">
    <section
      v-for="team in ctx.players.teamSections.value"
      :key="team.teamId"
      class="match-detail-builds-team"
    >
      <div class="match-detail-builds-team-title">{{ team.title }}</div>
      <div class="match-detail-builds-grid">
        <div
          v-for="player in team.players"
          :key="player.participantId"
          class="match-detail-builds-card"
          :class="{ 'match-detail-builds-card--me': player.isMe }"
        >
          <!-- 玩家头 -->
          <div class="match-detail-builds-card-head">
            <LazyImg
              class="match-detail-builds-avatar"
              :src="assetPrefix + '/champion/' + player.championId"
              alt="champion"
            />
            <span
              v-if="player.gameName"
              class="match-detail-builds-name match-detail-builds-name--link"
              role="link"
              tabindex="0"
              @click="searchSummoner(`${player.gameName}#${player.tagLine}`)"
              @keydown.enter="searchSummoner(`${player.gameName}#${player.tagLine}`)"
              >{{ player.displayName }}</span
            >
            <span v-else class="match-detail-builds-name">{{ player.displayName }}</span>
            <n-tag v-if="player.isMe" size="small" :bordered="false" type="success">我</n-tag>
          </div>

          <!-- 出装槽 -->
          <div class="match-detail-builds-slots">
            <template v-if="isAugments">
              <div
                v-for="augId in ctx.playerAugmentIds(player.stats)"
                :key="augId"
                class="match-detail-builds-slot"
              >
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <img
                      v-if="augmentSrc(augId)"
                      :src="augmentSrc(augId)"
                      class="match-detail-builds-item-img"
                      alt="augment"
                      loading="lazy"
                      decoding="async"
                    />
                    <span
                      v-else
                      class="match-detail-builds-item-img match-detail-builds-item-img--empty"
                    />
                  </template>
                  <span>{{ augmentName(augId) }}</span>
                </n-tooltip>
              </div>
            </template>
            <template v-else>
              <div
                v-for="itemId in ctx.itemIds(player.stats)"
                :key="itemId"
                class="match-detail-builds-slot"
              >
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <img
                      v-if="itemSrc(itemId)"
                      :src="itemSrc(itemId)"
                      class="match-detail-builds-item-img"
                      alt="item"
                      loading="lazy"
                      decoding="async"
                    />
                    <span
                      v-else
                      class="match-detail-builds-item-img match-detail-builds-item-img--empty"
                    />
                  </template>
                  <span>{{ itemName(itemId) || `装备 #${itemId}` }}</span>
                </n-tooltip>
              </div>
            </template>
          </div>

          <!-- 技能加点序列（SGP SKILL_LEVEL_UP）：QWER 徽章流，EVOLVE 红边，角标为等级 -->
          <div class="match-detail-builds-skill">
            <span class="match-detail-builds-skill-label">加点</span>
            <template v-if="builds.skills[player.participantId]?.length">
              <div class="match-detail-builds-skill-badges">
                <span
                  v-for="(sk, i) in builds.skills[player.participantId]"
                  :key="i"
                  class="match-detail-builds-skill-badge"
                  :class="[
                    `match-detail-builds-skill-badge--s${sk.slot}`,
                    { 'match-detail-builds-skill-badge--evolve': sk.levelUpType === 'EVOLVE' }
                  ]"
                  :title="`第 ${sk.displayLevel} 级 · ${SKILL_KEY[sk.slot] ?? '?'}${sk.levelUpType === 'EVOLVE' ? '（进化）' : ''} · ${fmtTs(sk.timestamp)}`"
                >
                  {{ SKILL_KEY[sk.slot] ?? '?' }}
                  <span class="match-detail-builds-skill-badge-level">{{ sk.displayLevel }}</span>
                </span>
              </div>
              <span class="match-detail-builds-skill-max"
                >{{ builds.skills[player.participantId].length }} 级</span
              >
            </template>
            <n-tooltip v-else trigger="hover" placement="top">
              <template #trigger>
                <span class="match-detail-builds-skill-na">—</span>
              </template>
              技能加点来自 SGP 数据源（LCU 战绩无事件流）
            </n-tooltip>
          </div>

          <!-- 装备购买时间线（SGP ITEM_PURCHASED/SOLD/UNDO）：购买流 + 售出/撤销标记 + 铁砧计数 -->
          <div class="match-detail-builds-timeline">
            <span class="match-detail-builds-skill-label">购买</span>
            <template v-if="builds.items[player.participantId]?.length">
              <div class="match-detail-builds-timeline-flow">
                <template v-for="(it, i) in builds.items[player.participantId]" :key="i">
                  <span v-if="it.kind === 'spacer'" class="match-detail-builds-timeline-spacer"
                    >→</span
                  >
                  <n-tooltip v-else-if="it.kind === 'purchase'" trigger="hover" placement="top">
                    <template #trigger>
                      <span class="match-detail-builds-timeline-item">
                        <img
                          v-if="itemSrc(it.itemId)"
                          :src="itemSrc(it.itemId)"
                          class="match-detail-builds-timeline-img"
                          alt="item"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    </template>
                    <span
                      >{{ itemName(it.itemId) || `装备 #${it.itemId}` }} ·
                      {{ fmtTs(it.timestamp) }} 购买</span
                    >
                  </n-tooltip>
                  <n-tooltip v-else-if="it.kind === 'sold'" trigger="hover" placement="top">
                    <template #trigger>
                      <span
                        class="match-detail-builds-timeline-item match-detail-builds-timeline-item--sold"
                      >
                        <img
                          v-if="itemSrc(it.itemId)"
                          :src="itemSrc(it.itemId)"
                          class="match-detail-builds-timeline-img"
                          alt="item"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    </template>
                    <span
                      >{{ itemName(it.itemId) || `装备 #${it.itemId}` }} ·
                      {{ fmtTs(it.timestamp) }} 出售</span
                    >
                  </n-tooltip>
                  <n-tooltip v-else-if="it.kind === 'undo'" trigger="hover" placement="top">
                    <template #trigger>
                      <span class="match-detail-builds-timeline-undo"
                        >撤销 {{ itemName(it.beforeId) || `#${it.beforeId}` }} →
                        {{ itemName(it.afterId) || `#${it.afterId}` }}</span
                      >
                    </template>
                    <span>{{ fmtTs(it.timestamp) }} 撤销购买（返还金币）</span>
                  </n-tooltip>
                </template>
              </div>
              <span
                v-if="builds.anvils[player.participantId]"
                class="match-detail-builds-anvil"
                title="铁砧（炼金装备合成器）购买次数"
                >铁砧 ×{{ builds.anvils[player.participantId] }}</span
              >
            </template>
            <n-tooltip v-else trigger="hover" placement="top">
              <template #trigger>
                <span class="match-detail-builds-skill-na">—</span>
              </template>
              购买记录来自 SGP 数据源（LCU 战绩无事件流）
            </n-tooltip>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!ctx.players.teamSections.value.length" class="match-detail-builds-empty">
      本局无出装数据
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject, onMounted } from 'vue'
import { NTag, NTooltip } from 'naive-ui'
import { searchSummoner } from '@renderer/utils/navigation'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import { matchDetailContextKey } from '../matchDetailContext'
import { collectBuildEvents, type BuildCollection } from './buildsTable'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailBuildsTab 必须在 MatchDetailInline 容器内使用')
const ctx = injected as NonNullable<typeof injected>

onMounted(() => {
  // 装备在 LCU 战绩就绪；技能加点/购买时间线需 SGP 事件流，顺带触发懒加载
  void ctx.loadSgpDetail()
})

const isAugments = computed(() => ctx.usesAugments.value)

const itemSrc = (id: number) => (id > 0 ? ctx.assets.srcOf('item', id) : '')
const itemName = (id: number) => (id > 0 ? (ctx.assets.detailOf('item', id)?.name ?? '') : '')
// 海克斯强化与符文共用后端 perk 资源缓存（PERK_CACHE 含 cherry-augments）
const augmentSrc = (id: number) => (id > 0 ? ctx.assets.srcOf('perk', id) : '')
const augmentName = (id: number) =>
  id > 0 ? (ctx.assets.detailOf('perk', id)?.name ?? `强化 #${id}`) : ''

const SKILL_KEY: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' }

/** 时间戳 → m:ss（与事件 tab 口径一致） */
const fmtTs = (ts: number) =>
  `${Math.floor(ts / 60000)}:${String(Math.round((ts % 60000) / 1000)).padStart(2, '0')}`

/** SGP 事件流聚合：技能加点 + 购买时间线 + 铁砧计数（纯函数层 buildsTable） */
const builds = computed<BuildCollection>(() => collectBuildEvents(ctx.sgpDetail.value?.frames))
</script>

<style scoped>
.match-detail-builds-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-12) var(--space-10);
}

.match-detail-builds-team {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-builds-team-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
  padding: 0 var(--space-4);
}

.match-detail-builds-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-8);
}

.match-detail-builds-card {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.015);
  padding: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  transition: background var(--dur-fast) var(--ease-expo);
}

.match-detail-builds-card:hover {
  background: var(--glass-bg-mid);
}

.theme-light .match-detail-builds-card {
  background: var(--bg-elevated);
}

.match-detail-builds-card--me {
  box-shadow: inset 3px 0 0 0 var(--semantic-win);
}

.match-detail-builds-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.match-detail-builds-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
  display: block;
}

.match-detail-builds-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.match-detail-builds-name--link {
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-expo);
}

.match-detail-builds-name--link:hover,
.match-detail-builds-name--link:focus-visible {
  color: var(--accent-blue);
  outline: none;
}

.match-detail-builds-slots {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--space-4);
}

.match-detail-builds-slot {
  min-width: 0;
}

.match-detail-builds-item-img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
  display: block;
}

.match-detail-builds-item-img--empty {
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
}

.match-detail-builds-skill {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6);
  font-size: var(--font-size-2xs);
}

.match-detail-builds-skill-label {
  flex-shrink: 0;
  color: var(--text-tertiary);
  letter-spacing: 0.06em;
}

.match-detail-builds-skill-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  max-width: 100%;
}

.match-detail-builds-skill-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-control);
  font-size: var(--font-size-2xs);
  font-weight: 700;
  cursor: default;
  flex-shrink: 0;
}

.match-detail-builds-skill-badge--s1 {
  background: color-mix(in srgb, var(--accent-blue) 22%, transparent);
  color: var(--accent-blue);
}

.match-detail-builds-skill-badge--s2 {
  background: color-mix(in srgb, var(--semantic-win) 22%, transparent);
  color: var(--semantic-win-bright);
}

.match-detail-builds-skill-badge--s3 {
  background: color-mix(in srgb, var(--semantic-loss) 22%, transparent);
  color: var(--semantic-loss-bright, #e2686c);
}

.match-detail-builds-skill-badge--s4 {
  background: color-mix(in srgb, var(--accent-gold) 22%, transparent);
  color: var(--accent-gold);
}

.match-detail-builds-skill-badge--evolve {
  box-shadow: inset 0 0 0 2px var(--semantic-loss);
}

.match-detail-builds-skill-badge-level {
  position: absolute;
  right: -5px;
  bottom: -5px;
  min-width: 12px;
  height: 12px;
  padding: 0 1px;
  border-radius: var(--radius-pill);
  background: var(--bg-overlay-strong, rgba(0, 0, 0, 0.72));
  color: var(--text-primary);
  font-size: 8px;
  line-height: 12px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.match-detail-builds-skill-max {
  color: var(--text-tertiary);
  margin-left: auto;
}

.match-detail-builds-skill-na {
  color: var(--text-tertiary);
  cursor: help;
}

.match-detail-builds-timeline {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6);
  font-size: var(--font-size-2xs);
}

.match-detail-builds-timeline-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  max-width: 100%;
}

.match-detail-builds-timeline-item {
  display: inline-flex;
  position: relative;
  cursor: default;
}

.match-detail-builds-timeline-img {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
  display: block;
}

.match-detail-builds-timeline-item--sold .match-detail-builds-timeline-img {
  filter: grayscale(1);
  opacity: 0.55;
}

.match-detail-builds-timeline-item--sold::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  background: var(--semantic-loss);
  transform: rotate(-20deg);
}

.match-detail-builds-timeline-spacer {
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  user-select: none;
}

.match-detail-builds-timeline-undo {
  color: var(--accent-gold);
  cursor: help;
  white-space: nowrap;
  border: 1px dashed color-mix(in srgb, var(--accent-gold) 45%, transparent);
  border-radius: var(--radius-control);
  padding: 1px var(--space-4);
  font-variant-numeric: tabular-nums;
}

.match-detail-builds-anvil {
  color: var(--semantic-win);
  border: 1px solid color-mix(in srgb, var(--semantic-win) 40%, transparent);
  border-radius: var(--radius-pill);
  padding: 1px var(--space-6);
  cursor: help;
}

.match-detail-builds-empty {
  padding: var(--space-16);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
</style>
