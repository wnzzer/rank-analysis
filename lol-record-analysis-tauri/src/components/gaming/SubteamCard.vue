<template>
  <div class="subteam-card" :class="{ 'subteam-card-mine': isMine }">
    <div class="subteam-card-header">
      <span class="subteam-card-title">队伍 {{ subteam.subteamId }}</span>
      <n-tag v-if="isMine" size="small" type="success" :bordered="false">我方</n-tag>
    </div>
    <div class="subteam-card-body">
      <PlayerCard
        v-for="(p, i) of subteam.players"
        :key="`subteam-${subteam.subteamId}-${i}-${p.summoner.puuid}`"
        :session-summoner="p"
        :type-cn="typeCn"
        :mode-type="modeType"
        :queue-id="queueId"
        :img-url="tiersBySubteam[subteam.subteamId]?.[i]?.imgUrl ?? ''"
        :tier-cn="tiersBySubteam[subteam.subteamId]?.[i]?.tierCn ?? '无'"
        :team="isMine ? 'mine' : 'enemy'"
        :density="density"
      />
      <div v-for="i in placeholderCount" :key="`placeholder-${i}`" class="subteam-card-empty">
        <span>已离开</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import PlayerCard from './PlayerCard.vue'
import type { Subteam } from '@renderer/types/domain/gaming'
import type { TierDisplay } from '@renderer/composables/useSessionTiers'

interface Props {
  subteam: Subteam
  isMine: boolean
  expectedSize: number
  typeCn: string
  modeType: string
  queueId: number
  tiersBySubteam: Record<number, TierDisplay[]>
  density: 'normal' | 'compact'
}

const props = withDefaults(defineProps<Props>(), { density: 'normal' })
const placeholderCount = computed(() =>
  Math.max(0, props.expectedSize - props.subteam.players.length)
)
</script>

<style scoped>
.subteam-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border-radius: var(--radius-md);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}

.subteam-card-mine {
  border-color: rgba(34, 197, 94, 0.6);
  box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3);
}

.subteam-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
}

.subteam-card-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.subteam-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.subteam-card-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 11px;
  min-height: 60px;
}
</style>
