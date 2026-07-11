<template>
  <div class="subteam-card" :class="{ 'subteam-card-mine': isMine }">
    <div class="subteam-card-header">
      <span class="subteam-card-title">队伍 {{ subteam.subteamId }}</span>
      <n-tag v-if="isMine" size="small" type="success" :bordered="false">我方</n-tag>
    </div>
    <div class="subteam-card-body">
      <template
        v-for="(p, i) of subteam.players"
        :key="`subteam-${subteam.subteamId}-${i}-${p.summoner.puuid || p.championId}`"
      >
        <ChampionIntelCard
          v-if="phase === 'ChampSelect' && !p.summoner.puuid"
          :champion-id="p.championId"
          :pick-state="p.pickState"
          :mode="opggMode"
          :my-champion-ids="isMine ? EMPTY_IDS : myChampionIds"
          :density="density"
          :style="{ '--stagger-i': i }"
        />
        <PlayerCard
          v-else
          :session-summoner="p"
          :type-cn="typeCn"
          :mode-type="modeType"
          :queue-id="queueId"
          :img-url="tiersBySubteam[subteam.subteamId]?.[i]?.imgUrl ?? ''"
          :tier-cn="tiersBySubteam[subteam.subteamId]?.[i]?.tierCn ?? '无'"
          :team="isMine ? 'mine' : 'enemy'"
          :density="density"
          :style="{ '--stagger-i': i }"
        />
      </template>
      <div v-for="i in placeholderCount" :key="`placeholder-${i}`" class="subteam-card-empty">
        <span>{{ phase === 'ChampSelect' ? '等待选人…' : '已离开' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import PlayerCard from './PlayerCard.vue'
import ChampionIntelCard from './ChampionIntelCard.vue'
import type { Subteam } from '@renderer/types/domain/gaming'
import type { TierDisplay } from '@renderer/composables/useSessionTiers'
import type { OpggMode } from '@renderer/services/opgg'

/**
 * 空英雄 id 列表的稳定引用。
 * 若在模板里内联 `:my-champion-ids="isMine ? [] : myChampionIds"`，`isMine` 分支每次
 * 重渲染都会产生一个新的 `[]`，导致 ChampionIntelCard 的 watch 认为数组"变了"而重拉数据。
 * 提到 setup 顶层，让同一组件实例在整个生命周期内复用同一个空数组引用。
 */
const EMPTY_IDS: number[] = []

interface Props {
  subteam: Subteam
  isMine: boolean
  expectedSize: number
  typeCn: string
  modeType: string
  queueId: number
  tiersBySubteam: Record<number, TierDisplay[]>
  density: 'normal' | 'compact'
  /** 会话阶段（ChampSelect 时启用敌方情报卡渲染 + 空位占位文案） */
  phase?: string
  /** OP.GG 数据模式，透传给情报卡 */
  opggMode?: OpggMode
  /** 我方已亮出的英雄 id 列表，仅敌方情报卡用于克制提示 */
  myChampionIds?: number[]
}

const props = withDefaults(defineProps<Props>(), {
  density: 'normal',
  phase: '',
  opggMode: 'ranked',
  myChampionIds: () => []
})
const placeholderCount = computed(() =>
  Math.max(0, props.expectedSize - props.subteam.players.length)
)
</script>

<style scoped>
.subteam-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  border-radius: var(--radius-md);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}

.subteam-card-mine {
  border-color: var(--semantic-win);
  /* tinted ring：保持 rgba 以与卡片 token 颜色一致的发光感，复用全局 --glow-win 风格 */
  box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3);
}

.subteam-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: 0 var(--space-4);
}

.subteam-card-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.subteam-card-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 显式锁掉横向滚动 (避免内部元素溢出时底部出滚动条) */
  overflow-x: hidden;
}

.subteam-card-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  min-height: 60px;
}
</style>
