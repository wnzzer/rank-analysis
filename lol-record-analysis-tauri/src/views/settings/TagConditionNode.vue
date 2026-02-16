<template>
  <div class="condition-node">
    <!-- Logic Nodes (AND/OR) -->
    <div v-if="condition.type === 'and' || condition.type === 'or'" class="group-node">
      <div class="node-header">
        <n-tag :type="condition.type === 'and' ? 'info' : 'warning'" size="small" class="node-type">
          {{ condition.type === 'and' ? '满足所有 (AND)' : '满足任一 (OR)' }}
        </n-tag>
        <div class="node-actions">
          <n-button size="tiny" circle type="success" @click="addChild" class="add-btn">+</n-button>
          <n-button size="tiny" circle type="error" @click="removeSelf" v-if="!isRoot">-</n-button>
        </div>
      </div>
      <div class="children-container">
        <TagConditionNode
          v-for="(child, index) in condition.conditions"
          :key="index"
          :model-value="child"
          :mode-options="modeOptions"
          :champion-options="championOptions"
          @update:model-value="val => updateChild(index, val)"
          @remove="() => removeChild(index)"
        />
        <div
          v-if="!condition.conditions || condition.conditions.length === 0"
          class="empty-placeholder"
        >
          (请添加条件)
        </div>
      </div>
    </div>

    <!-- NOT Node -->
    <div v-else-if="condition.type === 'not'" class="group-node not-node">
      <div class="node-header">
        <n-tag type="error" size="small">排除 (NOT)</n-tag>
        <n-button size="tiny" circle type="error" @click="removeSelf" v-if="!isRoot">-</n-button>
      </div>
      <div class="children-container">
        <TagConditionNode
          v-if="condition.condition"
          :model-value="condition.condition"
          :mode-options="modeOptions"
          :champion-options="championOptions"
          @update:model-value="(val: any) => updateNotChild(val)"
          @remove="() => removeNotChild()"
        />
        <div v-else class="empty-placeholder">
          <n-button size="tiny" dashed @click="addNotChild">添加条件</n-button>
        </div>
      </div>
    </div>

    <!-- Leaf Node: History (The main logic) -->
    <div v-else-if="condition.type === 'history'" class="leaf-node">
      <div class="node-header leaf-header">
        <span class="leaf-title">历史数据检查</span>
        <n-button
          size="tiny"
          circle
          type="error"
          text
          @click="removeSelf"
          v-if="!isRoot"
          class="remove-btn"
        >
          <template #icon>✕</template>
        </n-button>
      </div>

      <div class="leaf-body">
        <!-- Filters -->
        <div class="section-label">筛选比赛 (Filters)</div>
        <div class="filters-container">
          <div v-for="(filter, fIndex) in condition.filters" :key="fIndex" class="filter-row">
            <n-select
              size="small"
              :value="filter.type"
              @update:value="val => handleFilterTypeChange(filter, val)"
              :options="filterTypeOptions"
              class="sel-type"
            />

            <!-- Queue Filter -->
            <n-select
              v-if="filter.type === 'queue'"
              size="small"
              multiple
              v-model:value="filter.ids"
              :options="modeOptions"
              placeholder="选择模式"
              class="sel-value-wide"
            />

            <!-- Champion Filter -->
            <n-select
              v-if="filter.type === 'champion'"
              size="small"
              multiple
              filterable
              :filter="filterChampionFunc"
              :render-tag="renderSingleSelectTag"
              :render-label="renderLabel"
              v-model:value="filter.ids"
              :options="championOptions"
              placeholder="选择英雄"
              class="sel-value-wide"
            />

            <!-- Stat Filter -->
            <template v-if="filter.type === 'stat'">
              <n-select
                size="small"
                v-model:value="filter.metric"
                :options="metricOptions"
                class="sel-metric"
              />
              <n-select
                size="small"
                v-model:value="filter.op"
                :options="opOptions"
                class="sel-op"
              />
              <n-input-number
                size="small"
                v-model:value="filter.value"
                :show-button="false"
                class="num-input"
              />
            </template>

            <n-button
              size="tiny"
              circle
              text
              type="error"
              @click="removeFilter(fIndex)"
              class="row-remove-btn"
              >×</n-button
            >
          </div>
          <n-button size="tiny" dashed class="add-filter-btn" @click="addFilter"
            >+ 添加筛选</n-button
          >
        </div>

        <n-divider style="margin: 8px 0" />

        <!-- Checks -->
        <div class="section-label">计算与校验 (Check)</div>

        <div v-if="condition.refresh" class="refresh-row">
          <n-select
            size="small"
            v-model:value="condition.refresh.type"
            :options="refreshTypeOptions"
            class="sel-type"
          />

          <!-- Count/Sum/Avg/Max/Min -->
          <template
            v-if="['count', 'sum', 'average', 'max', 'min'].includes(condition.refresh.type)"
          >
            <n-select
              v-if="condition.refresh.type !== 'count'"
              size="small"
              v-model:value="condition.refresh.metric"
              :options="metricOptions"
              placeholder="指标"
              class="sel-metric"
            />
            <n-select
              size="small"
              v-model:value="condition.refresh.op"
              :options="opOptions"
              class="sel-op"
            />
            <n-input-number
              size="small"
              v-model:value="condition.refresh.value"
              :show-button="false"
              class="num-input"
            />
          </template>

          <!-- Streak -->
          <template v-if="condition.refresh.type === 'streak'">
            <n-select
              size="small"
              v-model:value="condition.refresh.kind"
              :options="[
                { label: '连胜', value: 'win' },
                { label: '连败', value: 'loss' }
              ]"
              class="sel-metric"
            />
            <span class="text-label">>=</span>
            <n-input-number
              size="small"
              v-model:value="condition.refresh.min"
              :show-button="false"
              class="num-input"
            />
            <span class="text-label">场</span>
          </template>
        </div>
      </div>
    </div>

    <!-- Leaf Node: Current Context (Simple) -->
    <div
      v-else-if="condition.type === 'currentQueue' || condition.type === 'currentChampion'"
      class="leaf-node"
    >
      <div class="node-header leaf-header">
        <n-select
          size="small"
          v-model:value="condition.type"
          :options="[
            { label: '当前模式', value: 'currentQueue' },
            { label: '当前英雄', value: 'currentChampion' }
          ]"
          style="width: 120px"
        />
        <n-button size="tiny" circle text type="error" @click="removeSelf" v-if="!isRoot"
          >✕</n-button
        >
      </div>
      <div style="padding: 10px">
        <n-select
          v-if="condition.type === 'currentQueue'"
          size="small"
          multiple
          v-model:value="condition.ids"
          :options="modeOptions"
          placeholder="模式"
          class="sel-value-wide"
        />
        <n-select
          v-if="condition.type === 'currentChampion'"
          size="small"
          multiple
          filterable
          :filter="filterChampionFunc"
          :render-tag="renderSingleSelectTag"
          :render-label="renderLabel"
          v-model:value="condition.ids"
          :options="championOptions"
          placeholder="英雄"
          class="sel-value-wide"
        />
      </div>
    </div>

    <!-- Fallback -->
    <div v-else class="leaf-node error-node">
      Unknown Type: {{ condition.type }}
      <n-button size="tiny" circle type="error" @click="removeSelf">-</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PropType, toRefs } from 'vue'
import { NTag, NButton, NSelect, NInputNumber, NDivider, useThemeVars } from 'naive-ui'
import TagConditionNode from './TagConditionNode.vue' // Recursive import
import {
  renderSingleSelectTag,
  renderLabel,
  filterChampionFunc
} from '../../components/composition'

const themeVars = useThemeVars()

// We receive props for mode/champion options
const props = defineProps({
  modelValue: {
    type: Object as PropType<any>,
    required: true
  },
  isRoot: {
    type: Boolean,
    default: false
  },
  modeOptions: { type: Array as PropType<any[]>, default: () => [] },
  championOptions: { type: Array as PropType<any[]>, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'remove'])
const { modelValue: condition } = toRefs(props)

// --- Options ---
const filterTypeOptions = [
  { label: '模式', value: 'queue' },
  { label: '英雄', value: 'champion' },
  { label: '单场数据', value: 'stat' }
]

const metricOptions = [
  { label: '击杀 (Kills)', value: 'kills' },
  { label: '死亡 (Deaths)', value: 'deaths' },
  { label: '助攻 (Assists)', value: 'assists' },
  { label: 'KDA', value: 'kda' },
  { label: '胜负 (Win)', value: 'win' },
  { label: '金币', value: 'gold' },
  { label: '补刀 (CS)', value: 'cs' },
  { label: '造成伤害', value: 'damage' },
  { label: '承受伤害', value: 'damageTaken' },
  { label: '游戏时长', value: 'gameDuration' }
]

const opOptions = [
  { label: '>', value: '>' },
  { label: '>=', value: '>=' },
  { label: '<', value: '<' },
  { label: '<=', value: '<=' },
  { label: '==', value: '==' },
  { label: '!=', value: '!=' }
]

const refreshTypeOptions = [
  { label: '场次计数', value: 'count' },
  { label: '平均值', value: 'average' },
  { label: '求和', value: 'sum' },
  { label: '最大值', value: 'max' },
  { label: '最小值', value: 'min' },
  { label: '连胜/败', value: 'streak' }
]

// --- Actions ---

function addChild() {
  if (!condition.value.conditions) condition.value.conditions = []
  // Add a default simple History node
  condition.value.conditions.push({
    type: 'history',
    filters: [],
    refresh: { type: 'count', op: '>=', value: 1 }
  })
  emitUpdate()
}

function updateChild(index: any, val: any) {
  condition.value.conditions[index] = val
  emitUpdate()
}

function removeChild(index: any) {
  condition.value.conditions.splice(index, 1)
  emitUpdate()
}

function removeSelf() {
  emit('remove')
}

function updateNotChild(val: any) {
  condition.value.condition = val
  emitUpdate()
}

function addNotChild() {
  condition.value.condition = {
    type: 'history',
    filters: [],
    refresh: { type: 'count', op: '>=', value: 1 }
  }
  emitUpdate()
}

function removeNotChild() {
  condition.value.condition = null
  emitUpdate()
}

// History Actions
function addFilter() {
  if (!condition.value.filters) condition.value.filters = []
  condition.value.filters.push({ type: 'queue', ids: [] })
  emitUpdate()
}

function removeFilter(index: any) {
  condition.value.filters.splice(index, 1)
  emitUpdate()
}

function handleFilterTypeChange(filter: any, newType: string) {
  filter.type = newType
  // Clean up other properties based on newType
  if (newType === 'queue') {
    delete filter.metric
    delete filter.op
    delete filter.value
    filter.ids = []
  } else if (newType === 'champion') {
    delete filter.metric
    delete filter.op
    delete filter.value
    filter.ids = []
  } else if (newType === 'stat') {
    delete filter.ids
    filter.metric = 'kda'
    filter.op = '>='
    filter.value = 0
  }
  emitUpdate()
}

function emitUpdate() {
  emit('update:modelValue', condition.value)
}
</script>

<style scoped>
.condition-node {
  border-left: 3px solid v-bind('themeVars.borderColor');
  padding-left: 12px;
  margin-top: 10px;
  margin-bottom: 10px;
}

.group-node {
  border: 1px dashed v-bind('themeVars.borderColor');
  padding: 8px;
  border-radius: var(--radius-md);
  background-color: v-bind('themeVars.actionColor');
}
.not-node {
  background-color: rgba(208, 58, 82, 0.05);
  border-color: v-bind('themeVars.errorColor');
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.children-container {
  padding-left: 8px;
}
.empty-placeholder {
  color: v-bind('themeVars.textColorDisabled');
  font-size: 12px;
  font-style: italic;
  padding: 4px;
}

/* Leaf Node Styling */
.leaf-node {
  background-color: v-bind('themeVars.cardColor');
  border: 1px solid v-bind('themeVars.borderColor');
  border-radius: var(--radius-md);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.leaf-header {
  background-color: v-bind('themeVars.tableHeaderColor');
  padding: 4px 8px;
  border-bottom: 1px solid v-bind('themeVars.dividerColor');
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  height: 28px;
}
.leaf-title {
  font-size: 12px;
  font-weight: bold;
  color: v-bind('themeVars.textColor2');
}

.leaf-body {
  padding: 10px;
}

.section-label {
  font-size: 11px;
  color: v-bind('themeVars.textColor3');
  margin-bottom: 4px;
  font-weight: bold;
}

/* Controls Layout */
.filter-row,
.refresh-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.sel-type {
  width: 100px;
}
.sel-metric {
  width: 120px;
}
.sel-op {
  width: 70px;
}
.num-input {
  width: 80px;
}
.sel-value-wide {
  width: 220px;
  flex-grow: 1;
  min-width: 150px;
}
.text-label {
  font-size: 12px;
}
.row-remove-btn {
  margin-left: auto;
}
.add-filter-btn {
  margin-top: 4px;
  width: 100%;
}
</style>
