<template>
  <section class="stat-workbench" aria-labelledby="stat-workbench-title">
    <header class="stat-workbench__header">
      <div>
        <span>COMBAT TELEMETRY</span>
        <h2 id="stat-workbench-title">等级数值推演</h2>
      </div>
      <output :for="sliderId">LV. {{ level }}</output>
    </header>

    <div class="stat-workbench__slider">
      <span>01</span>
      <input
        :id="sliderId"
        :value="level"
        type="range"
        min="1"
        max="18"
        step="1"
        aria-label="英雄等级"
        :style="{ '--level-progress': `${((level - 1) / 17) * 100}%` }"
        @input="updateLevel"
      />
      <span>18</span>
    </div>

    <div class="stat-workbench__table" role="table" aria-label="英雄等级数值对照">
      <div class="stat-workbench__row stat-workbench__row--heading" role="row">
        <span role="columnheader">属性</span>
        <span role="columnheader">1级</span>
        <span role="columnheader">当前</span>
        <span role="columnheader">18级</span>
      </div>
      <div v-for="metric in metrics" :key="metric.key" class="stat-workbench__row" role="row">
        <span class="stat-workbench__name" role="rowheader">
          <i :class="`stat-workbench__signal--${metric.tone}`" />
          {{ metric.label }}
        </span>
        <span role="cell">{{ metric.valueAt(1) }}</span>
        <strong role="cell">{{ metric.valueAt(level) }}</strong>
        <span role="cell">{{ metric.valueAt(18) }}</span>
      </div>
    </div>

    <p class="stat-workbench__note">
      成长属性按英雄联盟标准非线性等级曲线估算；实际数值可能受模式、装备与版本热修影响。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import type { ChampionStats, ChampionStatValue } from '@renderer/types/domain/championCollection'
import { attackSpeedAtLevel, statAtLevel } from '../championStats'

const props = defineProps<{
  stats: ChampionStats
  modelValue: number
}>()

const emit = defineEmits<{
  'update:modelValue': [level: number]
}>()

const sliderId = `champion-level-${useId()}`
const level = computed(() => Math.min(18, Math.max(1, Math.round(props.modelValue))))

function attackSpeedAt(championLevel: number): number {
  return attackSpeedAtLevel(props.stats.attackSpeed, championLevel)
}

function format(value: number, precision = 1, suffix = ''): string {
  return `${value.toFixed(precision).replace(/\.0$/, '')}${suffix}`
}

function formatter(stat: ChampionStatValue): (championLevel: number) => string {
  return championLevel => format(statAtLevel(stat, championLevel), stat.precision ?? 1, stat.suffix)
}

const metrics = computed(() => [
  { key: 'health', label: '生命值', tone: 'vital', valueAt: formatter(props.stats.health) },
  {
    key: 'resource',
    label: props.stats.resourceName || '资源',
    tone: 'resource',
    valueAt: formatter(props.stats.resource)
  },
  {
    key: 'attackDamage',
    label: '攻击力',
    tone: 'force',
    valueAt: formatter(props.stats.attackDamage)
  },
  { key: 'armor', label: '护甲', tone: 'guard', valueAt: formatter(props.stats.armor) },
  {
    key: 'magicResist',
    label: '魔抗',
    tone: 'guard',
    valueAt: formatter(props.stats.magicResist)
  },
  {
    key: 'attackSpeed',
    label: '攻击速度',
    tone: 'tempo',
    valueAt: (championLevel: number) => format(attackSpeedAt(championLevel), 3)
  },
  {
    key: 'moveSpeed',
    label: '移动速度',
    tone: 'tempo',
    valueAt: () => format(props.stats.moveSpeed, 0)
  },
  {
    key: 'attackRange',
    label: '攻击距离',
    tone: 'range',
    valueAt: () => format(props.stats.attackRange, 0)
  }
])

function updateLevel(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  emit('update:modelValue', Number(input.value))
}
</script>

<style scoped>
.stat-workbench {
  --tactics-panel: #10151a;
  --tactics-panel-raised: #151b20;
  --tactics-line: rgba(179, 190, 198, 0.16);
  --tactics-muted: #77838c;
  --tactics-text: #dce3e6;
  --tactics-accent: #c9aa71;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--tactics-line);
  border-radius: 14px;
  background:
    linear-gradient(110deg, rgba(201, 170, 113, 0.045), transparent 38%), var(--tactics-panel);
}

.stat-workbench::before {
  position: absolute;
  top: 0;
  left: 24px;
  width: 54px;
  height: 2px;
  background: var(--tactics-accent);
  content: '';
}

.stat-workbench__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 14px;
}

.stat-workbench__header span {
  color: var(--tactics-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.stat-workbench__header h2 {
  margin: 3px 0 0;
  color: var(--tactics-text);
  font-size: 17px;
  font-weight: 650;
}

.stat-workbench__header output {
  min-width: 66px;
  padding: 7px 10px;
  border: 1px solid rgba(201, 170, 113, 0.34);
  border-radius: 5px;
  background: rgba(201, 170, 113, 0.08);
  color: var(--tactics-accent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 14px;
  text-align: center;
}

.stat-workbench__slider {
  display: grid;
  grid-template-columns: 20px 1fr 20px;
  align-items: center;
  gap: 10px;
  padding: 0 22px 18px;
  color: var(--tactics-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
}

.stat-workbench__slider input {
  width: 100%;
  height: 3px;
  margin: 0;
  border-radius: 2px;
  appearance: none;
  background: linear-gradient(
    90deg,
    var(--tactics-accent) var(--level-progress),
    rgba(255, 255, 255, 0.12) var(--level-progress)
  );
  cursor: pointer;
}

.stat-workbench__slider input::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  border: 2px solid var(--tactics-panel);
  border-radius: 2px;
  appearance: none;
  background: var(--tactics-accent);
  box-shadow: 0 0 0 1px rgba(201, 170, 113, 0.55);
  transform: rotate(45deg);
}

.stat-workbench__slider input:focus-visible {
  outline: 2px solid var(--tactics-accent);
  outline-offset: 5px;
}

.stat-workbench__table {
  border-top: 1px solid var(--tactics-line);
}

.stat-workbench__row {
  display: grid;
  grid-template-columns: minmax(110px, 1.35fr) repeat(3, minmax(58px, 0.72fr));
  align-items: center;
  min-height: 43px;
  padding: 0 22px;
  border-bottom: 1px solid rgba(179, 190, 198, 0.09);
  color: var(--tactics-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.stat-workbench__row--heading {
  min-height: 30px;
  background: rgba(255, 255, 255, 0.018);
  color: #66717a;
  font-size: 8px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.stat-workbench__row > :first-child {
  text-align: left;
}

.stat-workbench__row strong {
  color: var(--tactics-text);
  font-size: 12px;
}

.stat-workbench__name {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #aeb8be;
  font-family: inherit;
}

.stat-workbench__name i {
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: #76838c;
}

.stat-workbench__signal--vital {
  background: #6fa782 !important;
}

.stat-workbench__signal--resource {
  background: #628fb7 !important;
}

.stat-workbench__signal--force {
  background: #b77b69 !important;
}

.stat-workbench__signal--tempo {
  background: #bda561 !important;
}

.stat-workbench__note {
  margin: 0;
  padding: 12px 22px 15px;
  color: #65717a;
  font-size: 10px;
  line-height: 1.55;
}

@media (max-width: 520px) {
  .stat-workbench__row {
    grid-template-columns: minmax(92px, 1.2fr) repeat(3, minmax(48px, 0.7fr));
    padding: 0 14px;
  }
}
</style>
