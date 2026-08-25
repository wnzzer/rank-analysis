<template>
  <div class="player-bar">
    <div class="player-bar-identity">
      <div class="player-bar-avatar-wrap">
        <n-avatar
          round
          :size="36"
          :src="`${assetPrefix}/profile/${summoner?.profileIconId}`"
          fallback-src="https://cube.elemecdn.com/3/7c/3ea6beec64369c2642b92c6726f1epng.png"
          class="player-bar-avatar"
        />
        <div class="player-bar-level">{{ summoner.summonerLevel }}</div>
      </div>
      <n-flex vertical :size="1" class="player-bar-identity-text">
        <n-flex align="center" :size="4" :wrap="false">
          <n-ellipsis class="player-bar-nickname">
            {{ summoner.gameName }}
          </n-ellipsis>
          <span class="player-bar-tagline">#{{ summoner.tagLine }}</span>
          <n-button text size="tiny" @click="copyName">
            <template #icon>
              <n-icon><Copy /></n-icon>
            </template>
          </n-button>
          <PlayerNoteBadge
            v-if="summoner.puuid"
            :puuid="summoner.puuid"
            :game-name="summoner.gameName"
            :tag-line="summoner.tagLine"
            size="normal"
          />
        </n-flex>
      </n-flex>
    </div>

    <n-flex v-if="!isCrossRegion" align="center" :size="14" class="player-bar-stats">
      <div v-if="hasRealTier(soloInfo)" class="player-bar-rank">
        <img :src="tierImage(soloInfo.tier)" class="player-bar-rank-img" alt="" />
        <span class="player-bar-rank-text">{{ formatCompactTierText(soloInfo) }}</span>
      </div>
      <!-- 单双/灵活胜率已并入左栏概览卡（RankCard），此处瘦身去重（R3） -->
      <div class="player-bar-recent">
        <span class="player-bar-recent-label">近20场</span>
        <span class="player-bar-recent-value">
          {{ recentData.wins }}W{{ recentData.losses }}L
        </span>
      </div>
    </n-flex>

    <div class="player-bar-platform">
      <n-popover trigger="hover" v-if="serverDescription">
        <template #trigger>
          <n-tag size="small" :bordered="false" type="default" class="player-bar-platform-tag">
            {{ platformIdCn }}
          </n-tag>
        </template>
        <span>{{ serverDescription }}</span>
      </n-popover>
      <n-tag v-else size="small" :bordered="false" type="default" class="player-bar-platform-tag">
        {{ platformIdCn }}
      </n-tag>
    </div>

    <UnifiedTagRow
      v-if="!isCrossRegion && (tags.length > 0 || hasNote)"
      class="player-bar-tags"
      :tags="tags"
      :puuid="summoner.puuid"
      :game-name="summoner.gameName"
      :tag-line="summoner.tagLine"
    />
  </div>
</template>

<script lang="ts" setup>
import { assetPrefix } from '@renderer/services/http'
import { Copy } from 'lucide-vue-next'
import { computed } from 'vue'
import { NAvatar, NButton, NFlex, NIcon, NEllipsis, NPopover, NTag, useMessage } from 'naive-ui'
import type { Rank, Summoner } from '@renderer/types/domain/player'
import type { RankTag, RecentData } from '@renderer/types/domain/analysis'
import { usePlayerNotesStore } from '@renderer/features/settings/stores/playerNotes'
import { formatCompactTierText, hasRealTier } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import UnifiedTagRow from '@renderer/components/common/UnifiedTagRow.vue'

const props = defineProps<{
  summoner: Summoner
  rank: Rank
  recentData: RecentData
  tags: RankTag[]
  platformIdCn: string
  isCrossRegion: boolean
}>()

const serverDesc: Record<string, string> = {
  联盟一区: '联盟一区：祖安、皮尔特沃夫、巨神峰、教育网、男爵领域、均衡教派、影流、守望之海',
  联盟二区: '联盟二区：卡拉曼达、暗影岛、征服之海、诺克萨斯、战争学院、雷瑟守备',
  联盟三区: '联盟三区：班德尔城、裁决之地、水晶之痕、钢铁烈阳、皮城警备',
  联盟四区: '联盟四区：比尔吉沃特、弗雷尔卓德、扭曲丛林',
  联盟五区: '联盟五区：德玛西亚、无畏先锋、恕瑞玛、巨龙之巢'
}

const serverDescription = computed(() => serverDesc[props.platformIdCn])

const soloInfo = computed(() => props.rank.queueMap.RANKED_SOLO_5x5)

const notesStore = usePlayerNotesStore()
/** 当前玩家是否已有手动备注（决定标签行在无系统标签时是否仍展示备注 chip） */
const hasNote = computed(() => !!props.summoner.puuid && !!notesStore.getNote(props.summoner.puuid))

const message = useMessage()
const copyName = () => {
  navigator.clipboard
    .writeText(props.summoner.gameName + '#' + props.summoner.tagLine)
    .then(() => message.success('复制成功'))
    .catch(() => message.error('复制失败'))
}
</script>

<style lang="css" scoped>
/* 顶部紧凑玩家条（60px 高度级）：身份 | 段位与胜率 | 大区标签；有标签/备注时第二行 */
.player-bar {
  display: flex;
  align-items: center;
  gap: var(--space-16);
  height: 60px;
  padding: 0 var(--space-16);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
}

.player-bar-identity {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  min-width: 0;
}

.player-bar-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.player-bar-avatar :deep(img) {
  border: 1px solid var(--border-subtle);
}

.player-bar-level {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  padding: 0 var(--space-4);
  height: 14px;
  line-height: 12px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  white-space: nowrap;
  z-index: 1;
}

.player-bar-identity-text {
  flex: 1;
  min-width: 0;
}

:deep(.player-bar-nickname) {
  max-width: 220px;
  font-size: var(--font-size-md);
  font-weight: 700;
}

.player-bar-tagline {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.player-bar-stats {
  margin-left: auto;
  flex-shrink: 0;
}

.player-bar-rank {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}

.player-bar-rank-img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.player-bar-rank-text {
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-sm);
  font-weight: 700;
  white-space: nowrap;
}

.player-bar-recent {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-4);
  white-space: nowrap;
}

.player-bar-recent-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.player-bar-recent-value {
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.player-bar-platform {
  flex-shrink: 0;
}

.player-bar-platform-tag {
  font-size: var(--font-size-2xs);
  padding: 0 var(--space-4);
  height: 18px;
}

.player-bar-tags {
  flex-shrink: 0;
}

/* 窄窗：隐藏次要统计（灵活/近20场），保留段位与单双胜率，防止横向溢出 */
@media (max-width: 900px) {
  .player-bar-rate:nth-of-type(2),
  .player-bar-recent {
    display: none;
  }
}

@media (max-width: 640px) {
  .player-bar-rank-text {
    display: none;
  }

  .player-bar-tags {
    display: none;
  }
}
</style>
