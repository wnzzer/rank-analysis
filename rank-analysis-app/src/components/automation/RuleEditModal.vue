<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NCard, NInput, NSwitch, NButton, NSelect } from 'naive-ui'
import RuleConditionRow from './RuleConditionRow.vue'
import type { PickRule, BanRule, RuleCondition, PickAction, BanAction } from '@renderer/types/rules'
import type { championOption } from '@renderer/types/domain/champion'
import { filterChampionFunc, renderLabel, renderSingleSelectTag } from '@renderer/utils/champion'

type Mode = 'pick' | 'ban'

// uuid: no uuid dep found — use inline fallback
const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const props = defineProps<{
  show: boolean
  mode: Mode
  initial?: PickRule | BanRule
  championOptions: championOption[]
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'save', v: PickRule | BanRule): void
}>()

// Form state
const id = ref('')
const name = ref('')
const enabled = ref(true)
const conditions = ref<RuleCondition[]>([])
const targetChampion = ref<number | null>(null)
const lock = ref(true) // pick mode only

watch(
  () => props.show,
  isShown => {
    if (!isShown) return
    const init = props.initial
    if (init) {
      id.value = init.id
      name.value = init.name
      enabled.value = init.enabled
      conditions.value = JSON.parse(JSON.stringify(init.conditions))
      targetChampion.value = init.action.champion_id
      if (props.mode === 'pick') {
        lock.value = (init.action as PickAction).lock
      } else {
        lock.value = true
      }
    } else {
      id.value = uuid()
      name.value = ''
      enabled.value = true
      conditions.value = []
      targetChampion.value = null
      lock.value = true
    }
  },
  { immediate: true }
)

const canSave = computed(
  () => name.value.trim().length > 0 && conditions.value.length > 0 && targetChampion.value != null
)

function addCondition() {
  conditions.value.push({ type: 'Position', value: 'middle' })
}

function updateCondition(idx: number, next: RuleCondition) {
  conditions.value[idx] = next
}

function removeCondition(idx: number) {
  conditions.value.splice(idx, 1)
}

function close() {
  emit('update:show', false)
}

function save() {
  if (!canSave.value || targetChampion.value == null) return
  if (props.mode === 'pick') {
    const rule: PickRule = {
      id: id.value,
      name: name.value.trim(),
      enabled: enabled.value,
      conditions: conditions.value,
      action: { champion_id: targetChampion.value, lock: lock.value } as PickAction
    }
    emit('save', rule)
  } else {
    const rule: BanRule = {
      id: id.value,
      name: name.value.trim(),
      enabled: enabled.value,
      conditions: conditions.value,
      action: { champion_id: targetChampion.value } as BanAction
    }
    emit('save', rule)
  }
  close()
}
</script>

<template>
  <n-modal :show="show" @update:show="close">
    <n-card style="width: 600px" :title="mode === 'pick' ? '编辑 Pick 规则' : '编辑 Ban 规则'">
      <div class="field">
        <label>名称</label>
        <n-input v-model:value="name" placeholder="如：中路防刺客" />
      </div>

      <div class="field">
        <label>启用</label>
        <n-switch v-model:value="enabled" />
      </div>

      <div class="field">
        <label>条件 (全部满足)</label>
        <RuleConditionRow
          v-for="(c, i) in conditions"
          :key="i"
          :model-value="c"
          :champion-options="championOptions"
          @update:model-value="v => updateCondition(i, v)"
          @remove="removeCondition(i)"
        />
        <n-button size="small" dashed @click="addCondition">+ 添加条件</n-button>
      </div>

      <div class="field">
        <label>目标英雄</label>
        <n-select
          v-model:value="targetChampion"
          filterable
          :filter="filterChampionFunc"
          :render-label="renderLabel"
          :render-tag="renderSingleSelectTag"
          :options="props.championOptions as any"
          placeholder="选择英雄"
        />
      </div>

      <div v-if="mode === 'pick'" class="field">
        <label>执行后锁定</label>
        <n-switch v-model:value="lock" />
        <span class="hint">关闭则只 hover，不自动确定</span>
      </div>

      <template #footer>
        <div class="footer">
          <n-button @click="close">取消</n-button>
          <n-button type="primary" :disabled="!canSave" @click="save">保存</n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<style scoped>
.field {
  margin-bottom: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}
.hint {
  font-size: var(--font-size-sm);
  color: var(--n-text-color-disabled);
}
</style>
