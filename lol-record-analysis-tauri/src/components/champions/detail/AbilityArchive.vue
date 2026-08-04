<template>
  <section class="ability-archive" aria-labelledby="ability-archive-title">
    <header class="ability-archive__header">
      <div>
        <span>ABILITY ARCHIVE</span>
        <h2 id="ability-archive-title">技能档案</h2>
      </div>
      <span>{{ abilities.length }} 项能力记录</span>
    </header>

    <div v-if="abilities.length" class="ability-archive__body">
      <div class="ability-archive__tabs" role="tablist" aria-label="英雄技能">
        <button
          v-for="ability in abilities"
          :id="`ability-tab-${ability.slot}`"
          :key="ability.slot"
          type="button"
          role="tab"
          class="ability-archive__tab"
          :class="{ 'ability-archive__tab--active': selectedSlot === ability.slot }"
          :aria-selected="selectedSlot === ability.slot"
          :aria-controls="`ability-panel-${ability.slot}`"
          @click="selectedSlot = ability.slot"
        >
          <span class="ability-archive__icon">
            <img :src="ability.iconUrl" alt="" loading="lazy" />
            <i>{{ ability.slot }}</i>
          </span>
          <span>{{ ability.name }}</span>
        </button>
      </div>

      <article
        v-if="selectedAbility"
        :id="`ability-panel-${selectedAbility.slot}`"
        class="ability-archive__panel"
        role="tabpanel"
        :aria-labelledby="`ability-tab-${selectedAbility.slot}`"
      >
        <div class="ability-archive__title">
          <span>{{
            selectedAbility.slot === 'P' ? '被动技能' : `${selectedAbility.slot} 技能`
          }}</span>
          <h3>{{ selectedAbility.name }}</h3>
        </div>

        <div v-if="selectedAbility.slot !== 'P'" class="ability-archive__ranks">
          <span>技能等级</span>
          <div role="group" :aria-label="`${selectedAbility.name}技能等级`">
            <button
              v-for="rank in selectedAbility.maxRank"
              :key="rank"
              type="button"
              :class="{ active: selectedRank === rank }"
              :aria-pressed="selectedRank === rank"
              @click="setRank(rank)"
            >
              {{ rank }}
            </button>
          </div>
        </div>

        <p class="ability-archive__description">{{ selectedAbility.description }}</p>

        <dl v-if="coreValues.length" class="ability-archive__core-values">
          <div v-for="item in coreValues" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>

        <div v-if="rankValues.length" class="ability-archive__rank-values">
          <div v-for="item in rankValues" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </article>
    </div>

    <p v-else class="ability-archive__empty">暂无可用技能资料</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChampionAbility } from '@renderer/types/domain/championCollection'

const props = defineProps<{
  abilities: ChampionAbility[]
}>()

const selectedSlot = ref<ChampionAbility['slot']>('P')
const selectedRank = ref(1)

const selectedAbility = computed(
  () => props.abilities.find(ability => ability.slot === selectedSlot.value) ?? props.abilities[0]
)

watch(
  () => props.abilities,
  abilities => {
    if (!abilities.some(ability => ability.slot === selectedSlot.value)) {
      selectedSlot.value = abilities[0]?.slot ?? 'P'
    }
  },
  { immediate: true }
)

watch(selectedSlot, () => {
  selectedRank.value = 1
})

function valueAt(values: Array<number | string>, rank: number): string {
  if (!values.length) return '—'
  const value = values[Math.min(rank - 1, values.length - 1)]
  return String(value)
}

const coreValues = computed(() => {
  const ability = selectedAbility.value
  if (!ability || ability.slot === 'P') return []
  return [
    { label: '冷却时间', value: valueAt(ability.cooldowns, selectedRank.value) },
    { label: '资源消耗', value: valueAt(ability.costs, selectedRank.value) },
    { label: '施法距离', value: valueAt(ability.ranges, selectedRank.value) }
  ].filter(item => item.value !== '—')
})

const rankValues = computed(() => {
  const ability = selectedAbility.value
  if (!ability) return []
  return ability.rankValues.map(item => ({
    label: item.label,
    value: `${valueAt(item.values, selectedRank.value)}${item.suffix ?? ''}`
  }))
})

function setRank(rank: number) {
  selectedRank.value = Math.min(selectedAbility.value?.maxRank ?? 1, Math.max(1, rank))
}
</script>

<style scoped>
.ability-archive {
  --tactics-panel: #101419;
  --tactics-panel-raised: #171c22;
  --tactics-line: rgba(180, 190, 197, 0.16);
  --tactics-muted: #76828b;
  --tactics-text: #dce3e7;
  --tactics-accent: #c8a96d;
  overflow: hidden;
  border: 1px solid var(--tactics-line);
  border-radius: 14px;
  background: var(--tactics-panel);
}

.ability-archive__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 19px 22px 15px;
  border-bottom: 1px solid var(--tactics-line);
}

.ability-archive__header div > span {
  color: var(--tactics-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.ability-archive__header h2 {
  margin: 3px 0 0;
  color: var(--tactics-text);
  font-size: 17px;
}

.ability-archive__header > span {
  color: var(--tactics-muted);
  font-size: 10px;
}

.ability-archive__body {
  display: grid;
  grid-template-columns: 154px minmax(0, 1fr);
  min-height: 390px;
}

.ability-archive__tabs {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px;
  border-right: 1px solid var(--tactics-line);
  background:
    linear-gradient(rgba(200, 169, 109, 0.025) 1px, transparent 1px) 0 0 / 100% 24px,
    #0d1115;
}

.ability-archive__tab {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--tactics-muted);
  cursor: pointer;
  font-size: 11px;
  text-align: left;
  transition: 150ms ease;
}

.ability-archive__tab:hover,
.ability-archive__tab--active {
  border-color: var(--tactics-line);
  background: rgba(255, 255, 255, 0.035);
  color: var(--tactics-text);
}

.ability-archive__tab--active {
  box-shadow: inset 2px 0 var(--tactics-accent);
}

.ability-archive__tab:focus-visible,
.ability-archive__ranks button:focus-visible {
  outline: 2px solid var(--tactics-accent);
  outline-offset: 2px;
}

.ability-archive__icon {
  position: relative;
  width: 38px;
  height: 38px;
  overflow: hidden;
  border: 1px solid rgba(200, 169, 109, 0.24);
  border-radius: 5px;
  background: #080b0e;
}

.ability-archive__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ability-archive__icon i {
  position: absolute;
  right: 1px;
  bottom: 1px;
  min-width: 13px;
  padding: 2px;
  border-radius: 2px;
  background: rgba(5, 7, 9, 0.88);
  color: var(--tactics-accent);
  font-size: 8px;
  font-style: normal;
  text-align: center;
}

.ability-archive__panel {
  padding: 22px 24px;
  background:
    radial-gradient(circle at 100% 0, rgba(200, 169, 109, 0.07), transparent 35%),
    var(--tactics-panel-raised);
}

.ability-archive__title > span,
.ability-archive__ranks > span {
  color: var(--tactics-muted);
  font-size: 9px;
  letter-spacing: 0.11em;
}

.ability-archive__title h3 {
  margin: 4px 0 16px;
  color: var(--tactics-text);
  font-size: 21px;
  font-weight: 650;
}

.ability-archive__ranks {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--tactics-line);
  border-bottom: 1px solid var(--tactics-line);
}

.ability-archive__ranks div {
  display: flex;
  gap: 4px;
}

.ability-archive__ranks button {
  width: 27px;
  height: 25px;
  border: 1px solid var(--tactics-line);
  border-radius: 4px;
  background: #10151a;
  color: var(--tactics-muted);
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
}

.ability-archive__ranks button.active {
  border-color: rgba(200, 169, 109, 0.48);
  background: rgba(200, 169, 109, 0.12);
  color: var(--tactics-accent);
}

.ability-archive__description {
  margin: 18px 0;
  color: #aeb8be;
  font-size: 12px;
  line-height: 1.75;
}

.ability-archive__core-values,
.ability-archive__rank-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.ability-archive__core-values div,
.ability-archive__rank-values div {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--tactics-line);
  border-radius: 6px;
  background: rgba(7, 10, 12, 0.32);
}

.ability-archive__core-values dt,
.ability-archive__rank-values span {
  color: var(--tactics-muted);
  font-size: 9px;
}

.ability-archive__core-values dd,
.ability-archive__rank-values strong {
  display: block;
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--tactics-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ability-archive__rank-values {
  margin-top: 7px;
}

.ability-archive__empty {
  padding: 44px;
  color: var(--tactics-muted);
  text-align: center;
}

@media (max-width: 620px) {
  .ability-archive__body {
    grid-template-columns: 1fr;
  }

  .ability-archive__tabs {
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--tactics-line);
  }

  .ability-archive__tab {
    grid-template-columns: 36px;
    min-width: 52px;
  }

  .ability-archive__tab > span:last-child {
    display: none;
  }

  .ability-archive__core-values,
  .ability-archive__rank-values {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
