<template>
  <section class="matchup">
    <div class="review-section-title">
      对位总览<span v-if="hasGoldDiff" class="matchup-hint"
        >· 中间为 14 分钟对位经济差（以蓝方为准）</span
      >
    </div>

    <template v-if="matchup.kind === 'lanes'">
      <div
        v-for="row in matchup.rows"
        :key="row.position"
        class="matchup-lane"
        data-test="matchup-lane"
      >
        <button
          type="button"
          class="matchup-player"
          :class="{ 'is-selected': selected === row.blue }"
          data-test="matchup-player"
          :data-pid="row.blue"
          @click="emit('select', row.blue)"
        >
          <PlayerChip :player="players[row.blue]" />
        </button>
        <div class="matchup-center">
          <span class="matchup-pos">{{ row.posCn }}</span>
          <span
            v-if="row.goldDiff14 !== null"
            class="matchup-diff font-number"
            :class="diffClass(row.goldDiff14)"
            data-test="matchup-diff"
            >{{ signed(row.goldDiff14) }}</span
          >
        </div>
        <button
          type="button"
          class="matchup-player matchup-player--red"
          :class="{ 'is-selected': selected === row.red }"
          data-test="matchup-player"
          :data-pid="row.red"
          @click="emit('select', row.red)"
        >
          <PlayerChip :player="players[row.red]" mirror />
        </button>
      </div>
    </template>

    <div v-else class="matchup-teams">
      <div
        v-for="team in matchup.teams"
        :key="team.teamId"
        class="matchup-team"
        :class="`matchup-team--${team.side}`"
        data-test="matchup-team"
      >
        <button
          v-for="pid in team.players"
          :key="pid"
          type="button"
          class="matchup-player"
          :class="{ 'is-selected': selected === pid }"
          data-test="matchup-player"
          :data-pid="pid"
          @click="emit('select', pid)"
        >
          <PlayerChip :player="players[pid]" />
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ① 对位总览：有分路五行（左蓝右红，中间 14 分钟对位经济差）；无分路两队并列（按总分排序）。
 * 点任意玩家切换下方所有模块。
 * @property matchup - 对位结构
 * @property players - participantId → 玩家视图
 * @property selected - 当前选中玩家
 * @emits select - 点击玩家（participantId）
 */
import { computed } from 'vue'
import type { Matchup, PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import PlayerChip from './PlayerChip.vue'

const props = defineProps<{
  matchup: Matchup
  players: Record<number, PlayerView>
  selected: number | null
}>()

const emit = defineEmits<{ select: [participantId: number] }>()

const hasGoldDiff = computed(
  () => props.matchup.kind === 'lanes' && props.matchup.rows.some(r => r.goldDiff14 !== null)
)

/** 经济差配色：蓝领先 / 红领先 / 持平中性 */
const diffClass = (n: number): string => (n > 0 ? 'is-blue' : n < 0 ? 'is-red' : 'is-even')

/** 带符号的整数（+1700 / −400） */
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
</script>

<style scoped>
.matchup {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.matchup-hint {
  margin-left: var(--space-4);
  color: var(--text-tertiary);
  font-weight: 400;
}

.matchup-lane {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-6);
}

.matchup-player {
  display: block;
  width: 100%;
  min-width: 0;
  padding: var(--space-4) var(--space-6);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-expo);
}

.matchup-player:hover {
  background: color-mix(in srgb, var(--text-tertiary) 10%, transparent);
}

.matchup-player.is-selected {
  border-color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 8%, transparent);
}

.matchup-player--red {
  text-align: right;
}

.matchup-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
}

.matchup-pos {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

.matchup-diff {
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.matchup-diff.is-blue {
  color: var(--side-blue);
}

.matchup-diff.is-red {
  color: var(--side-red);
}

.matchup-diff.is-even {
  color: var(--text-secondary);
}

.matchup-teams {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-8);
}

.matchup-team {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-left: var(--space-6);
  border-left: 2px solid var(--side-blue);
}

.matchup-team--red {
  border-left-color: var(--side-red);
}
</style>
