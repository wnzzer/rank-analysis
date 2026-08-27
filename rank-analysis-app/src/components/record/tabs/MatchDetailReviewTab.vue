<script setup lang="ts">
/**
 * 赛后评审 tab（A7 + C4）：八轴雷达 / 徽章墙 / 三裁判点评 同屏。
 * 数据来自 matchDetailContext（players.detailPlayers），LLM 调用注入式。
 */
import { computed, inject, ref } from 'vue'

import BadgeWall from '@renderer/components/companion/BadgeWall.vue'
import {
  computeBadges,
  runJudges,
  type JudgePlayer,
  type JudgeResult
} from '@renderer/companion/judges'
import { computeReviewAxes, radarPoints } from '@renderer/companion/review'
import { matchDetailContextKey } from '../matchDetailContext'
import { requestAIContent } from '@renderer/services/ai/stream'
import { getChampionName } from '@renderer/services/ai/champion-names'
import { useCopy } from '@renderer/composables/useCopy'
import { Copy } from 'lucide-vue-next'
import { formatReviewReport } from '@renderer/companion/reviewReport'

const injectedCtx = inject(matchDetailContextKey)
if (!injectedCtx) throw new Error('ReviewTab 必须在 MatchDetailInline 内使用')
const { players } = injectedCtx

const SIZE = 260
const CX = 130
const CY = 130
const R = 96

/** DetailPlayer → JudgePlayer（评审专用最小映射） */
const detailPlayers = computed(() => players.detailPlayers.value)
const judgePlayers = computed<JudgePlayer[]>(() =>
  detailPlayers.value.map(p => ({
    name: p.displayName,
    championName: getChampionName(p.championId) || String(p.championId),
    team: p.teamId,
    win: p.win,
    kills: p.stats.kills,
    deaths: p.stats.deaths,
    assists: p.stats.assists,
    damageDealt: p.stats.totalDamageDealtToChampions,
    damageTaken: p.stats.totalDamageTaken,
    turretDamage: p.stats.damageDealtToTurrets ?? 0,
    heal: p.stats.totalHeal,
    goldEarned: p.stats.goldEarned
  }))
)

/** 当前查看的玩家（默认我；点击头像/名字切换） */
const selectedName = ref('')
const effectiveSelected = computed(
  () =>
    selectedName.value ||
    detailPlayers.value.find(p => p.isMe)?.displayName ||
    detailPlayers.value[0]?.displayName ||
    ''
)

const review = computed(() => computeReviewAxes(judgePlayers.value, effectiveSelected.value))
const axes = computed(() => review.value.axes)
const selfPoly = computed(() =>
  radarPoints(
    axes.value.map(a => a.self),
    CX,
    CY,
    R
  )
)
const avgPoly = computed(() =>
  radarPoints(
    axes.value.map(a => a.avg),
    CX,
    CY,
    R
  )
)
const axisLabelPos = computed(() =>
  axes.value.map((a, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / axes.value.length
    return {
      label: a.label,
      x: CX + Math.cos(angle) * (R + 18),
      y: CY + Math.sin(angle) * (R + 16)
    }
  })
)
const rings = [0.25, 0.5, 0.75, 1].map(f => radarPoints(Array(8).fill(f), CX, CY, R))

const badgeMap = computed(() => computeBadges(judgePlayers.value))
const selectedBadges = computed(() => badgeMap.value.get(effectiveSelected.value) ?? [])

function select(name: string) {
  selectedName.value = name
}

// ---- 三裁判（按需生成，结果按当前玩家缓存） ----
const running = ref(false)
const judgeResults = ref<JudgeResult[]>([])
const judgedFor = ref('')

async function generateJudges() {
  if (running.value) return
  running.value = true
  try {
    const me = detailPlayers.value.find(p => p.isMe)?.displayName || effectiveSelected.value
    const results = await runJudges(judgePlayers.value, me, async (userPrompt, systemPrompt) => {
      const res = await requestAIContent(
        userPrompt,
        `judge:${injectedCtx?.game.value?.gameId ?? 0}:${Date.now()}`,
        systemPrompt
      )
      return res.success && res.content ? res.content.trim() : null
    })
    judgeResults.value = results
    judgedFor.value = effectiveSelected.value
  } finally {
    running.value = false
  }
}

const { copy } = useCopy()

function copyReport() {
  const p = judgePlayers.value.find(p => p.name === effectiveSelected.value)
  if (!p) return
  const queueId = injectedCtx?.game.value?.queueId
  const queueName = queueId === 450 ? '极地大乱斗' : queueId === 2400 ? '海克斯大乱斗' : undefined
  const text = formatReviewReport({
    player: p,
    badges: selectedBadges.value,
    judges: judgedFor.value === effectiveSelected.value ? judgeResults.value : [],
    queueName
  })
  copy(text)
}
</script>

<template>
  <div class="rv">
    <!-- 玩家切换 chips -->
    <div class="rv-chips">
      <button
        v-for="p in detailPlayers"
        :key="p.puuid"
        class="chip"
        :class="{ 'chip--on': p.displayName === effectiveSelected }"
        @click="select(p.displayName)"
      >
        {{ p.displayName }}
      </button>
    </div>

    <div class="rv-grid">
      <!-- 雷达 -->
      <section v-if="review.found" class="rv-block">
        <h4>表现雷达 · 对比全场均值</h4>
        <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="rv-radar">
          <polygon v-for="(ring, i) in rings" :key="'r' + i" :points="ring" class="radar-ring" />
          <polygon :points="avgPoly" class="radar-avg" />
          <polygon :points="selfPoly" class="radar-self" />
          <text
            v-for="pos in axisLabelPos"
            :key="pos.label"
            :x="pos.x"
            :y="pos.y"
            class="radar-label"
            text-anchor="middle"
          >
            {{ pos.label }}
          </text>
        </svg>
      </section>

      <!-- 徽章 -->
      <section class="rv-block">
        <h4>本局徽章</h4>
        <BadgeWall v-if="selectedBadges.length" :badges="selectedBadges" />
        <p v-else class="rv-muted">本局无徽章——稳定发挥也是一种实力。</p>

        <h4 style="margin-top: 16px">三裁判点评</h4>
        <div class="rv-actions">
          <button class="rv-btn" :disabled="running" @click="generateJudges">
            {{
              running
                ? '评审中…'
                : judgedFor === effectiveSelected && judgeResults.length
                  ? '重新生成'
                  : '生成三裁判点评'
            }}
          </button>
          <button
            class="rv-btn rv-btn--sec"
            title="复制格式化战报文本到剪贴板，方便在开黑群分享"
            @click="copyReport"
          >
            <Copy class="btn-ico" /> 复制战报
          </button>
        </div>
        <div v-if="judgeResults.length && judgedFor === effectiveSelected" class="rv-judges">
          <div v-for="j in judgeResults" :key="j.styleId" class="rv-judge">
            <b>{{ j.label }}</b>
            <p>{{ j.text }}</p>
          </div>
        </div>
        <p v-else-if="!running" class="rv-muted">点击上方按钮，让三位风格迥异的裁判给出点评。</p>
      </section>
    </div>
  </div>
</template>

<style scoped src="./MatchDetailReviewTab.styles.css"></style>
