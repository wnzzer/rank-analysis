<script setup lang="ts">
/**
 * 选人期大乱斗助手面板（feature-expansion-plan A2）。
 *
 * 仅在 queueId 2400 的选人阶段渲染：阵容缺口一句话 + bench 候选打分排序
 * （官方 T 级 × 我的历史胜率）。数据自轮询 mayhem_draft_context，
 * 榜单元数据复用 Mayhem 页缓存（getMayhemChampions/getMyChampionStats）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

import { assetPrefix } from '@renderer/services/http'
import {
  extractMayhemChampions,
  getMayhemChampions,
  getMyChampionStats,
  type MayhemChampion,
  type MyChampionStat
} from '@renderer/features/mayhem/services/mayhemData'
import {
  compositionGaps,
  scoreBench,
  type BenchEntry,
  type ChampMetaMap
} from '@renderer/features/mayhem/draft'

interface DraftContext {
  queueId: number | null
  localCellId: number
  myTeam: Array<{ championId: number; cellId: number; selectedPosition?: string }>
  bench: number[]
}

const MAYHEM_QUEUE_ID = 2400

const ctx = ref<DraftContext | null>(null)
const champions = ref<MayhemChampion[]>([])
const myRecords = ref<Record<number, MyChampionStat>>({})
let timer: ReturnType<typeof setInterval> | null = null

const metaMap = computed<ChampMetaMap>(() => {
  const map: ChampMetaMap = {}
  for (const c of champions.value) map[c.id] = { tier: c.stats.tier, roles: c.roles }
  return map
})

const isMayhem = computed(() => ctx.value?.queueId === MAYHEM_QUEUE_ID)

const lockedTeamIds = computed(() =>
  (ctx.value?.myTeam ?? []).filter(p => p.championId > 0).map(p => p.championId)
)

/** 阵容缺口（按已锁定英雄计算） */
const gaps = computed(() =>
  isMayhem.value ? compositionGaps(lockedTeamIds.value, metaMap.value) : null
)

const benchEntries = computed<BenchEntry[]>(() =>
  isMayhem.value ? scoreBench(ctx.value?.bench ?? [], metaMap.value, toMine(myRecords.value)) : []
)

function toMine(recs: Record<number, MyChampionStat>) {
  const out: Record<number, { games: number; wins: number }> = {}
  for (const [id, r] of Object.entries(recs)) out[Number(id)] = { games: r.games, wins: r.wins }
  return out
}

function champName(id: number): string {
  const c = champions.value.find(x => x.id === id)
  return c ? `${c.title}` : `英雄 #${id}`
}

function champIcon(id: number): string {
  return `${assetPrefix}/champion/${id}`
}

async function poll() {
  try {
    const data = (await invoke('mayhem_draft_context')) as DraftContext | null
    ctx.value = data
    if (data && data.queueId === MAYHEM_QUEUE_ID && !champions.value.length) {
      void loadMeta()
    }
  } catch {
    /* LCU 未连接等：保持上次状态 */
  }
}

async function loadMeta() {
  try {
    const [champRes] = await Promise.all([
      getMayhemChampions(),
      getMyChampionStats().then(
        stats => (myRecords.value = Object.fromEntries(stats.map(s => [s.championId, s]))),
        () => {}
      )
    ])
    champions.value = extractMayhemChampions(champRes)
  } catch {
    /* 元数据失败不阻塞上下文展示 */
  }
}

onMounted(() => {
  void poll()
  timer = setInterval(() => void poll(), 2_000)
})
onUnmounted(() => {
  if (timer != null) clearInterval(timer)
})
</script>

<template>
  <div v-if="isMayhem" class="mdp">
    <div class="mdp__head">大乱斗选人助手</div>

    <p class="mdp__gaps" :class="{ 'mdp__gaps--warn': gaps && gaps.sentence !== '阵容均衡' }">
      {{ gaps?.sentence ?? '等待锁定…' }}
    </p>

    <template v-if="benchEntries.length">
      <div class="mdp__sub">备选席建议（高分优先）</div>
      <div class="mdp__bench">
        <button
          v-for="e in benchEntries.slice(0, 5)"
          :key="e.championId"
          class="mdp__item"
          :title="e.reasons.join(' · ')"
        >
          <img :src="champIcon(e.championId)" :alt="champName(e.championId)" loading="lazy" />
          <span class="mdp__name">{{ champName(e.championId) }}</span>
          <span class="mdp__score">{{ e.score }}</span>
        </button>
      </div>
      <p class="mdp__hint">仅作参考建议；换人操作请自行确认。</p>
    </template>
  </div>
</template>

<style scoped>
.mdp {
  border: 1px solid var(--brand-border);
  padding: var(--space-10) var(--space-12);
  margin-bottom: var(--space-12);
}
.mdp__head {
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
  margin-bottom: 6px;
}
.mdp__gaps {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.mdp__gaps--warn {
  color: #ffd76a;
}
.mdp__sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: 8px 0 4px;
}
.mdp__bench {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.mdp__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  background: transparent;
  cursor: help;
}
.mdp__item img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}
.mdp__name {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
}
.mdp__score {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: #7fe08f;
}
.mdp__hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
