<template>
  <n-space vertical>
    <n-card title="标签管理" size="small">
      <template #header-extra>
        <n-button type="primary" size="small" @click="openCreateModal"> 新增标签 </n-button>
      </template>
      <n-data-table :columns="columns" :data="tags" :loading="loading" :bordered="false" />
    </n-card>

    <n-modal v-model:show="showModal" preset="card" title="编辑标签" style="width: 800px">
      <n-form
        ref="formRef"
        :model="currentTag"
        label-placement="left"
        label-width="100"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="标签名称" path="name">
          <n-input v-model:value="currentTag.name" placeholder="请输入标签名称" />
        </n-form-item>
        <n-form-item label="描述" path="desc">
          <n-input v-model:value="currentTag.desc" placeholder="请输入描述" />
        </n-form-item>
        <n-form-item label="类型" path="good">
          <n-switch v-model:value="currentTag.good">
            <template #checked>好标签 (绿色)</template>
            <template #unchecked>坏标签 (红色/灰色)</template>
          </n-switch>
        </n-form-item>

        <n-form-item label="生效范围">
          <n-radio-group v-model:value="scopeType" name="scopeGroup">
            <n-radio-button value="global">全局</n-radio-button>
            <n-radio-button value="mode">特定模式</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="scopeType === 'mode'" label="模式选择">
          <n-select v-model:value="currentTag.scopeModeList" multiple :options="modeOptions" />
        </n-form-item>

        <n-divider title-placement="left">触发条件 (满足任一组即可触发)</n-divider>

        <n-space vertical>
          <n-card
            v-for="(group, gIndex) in currentTag.triggers"
            :key="gIndex"
            size="small"
            embedded
          >
            <template #header> 条件组 {{ Number(gIndex) + 1 }} (组内所有条件必须满足) </template>
            <template #header-extra>
              <n-button size="tiny" type="error" @click="removeGroup(Number(gIndex))"
                >删除组</n-button
              >
            </template>

            <n-space vertical>
              <n-space v-for="(condition, cIndex) in group" :key="cIndex" align="center">
                <n-select
                  style="width: 120px"
                  v-model:value="condition.type"
                  :options="conditionTypes"
                  @update:value="handleConditionTypeChange(condition)"
                />

                <!-- Win/Lose Streak Config -->
                <template v-if="condition.type === 'winStreak' || condition.type === 'loseStreak'">
                  <span>连续</span>
                  <n-input-number v-model:value="condition.min" size="small" style="width: 80px" />
                  <span>场</span>
                  <n-select
                    v-model:value="condition.championId"
                    filterable
                    :filter="filterChampionFunc"
                    placeholder="任意英雄"
                    clearable
                    :render-tag="renderSingleSelectTag"
                    :render-label="renderLabel"
                    :options="championOptions"
                    style="width: 170px"
                  />
                </template>

                <!-- Stat Config -->
                <template v-if="condition.type === 'stat'">
                  <n-select
                    style="width: 120px"
                    v-model:value="condition.metric"
                    :options="metricOptions"
                    placeholder="指标"
                  />
                  <n-select
                    style="width: 80px"
                    v-model:value="condition.operator"
                    :options="operatorOptions"
                  />
                  <n-input-number
                    v-model:value="condition.value"
                    size="small"
                    style="width: 100px"
                  />

                  <!-- Champion Filter for ALL stat metrics -->
                  <n-select
                    v-model:value="condition.championId"
                    filterable
                    :filter="filterChampionFunc"
                    placeholder="任意英雄"
                    clearable
                    :render-tag="renderSingleSelectTag"
                    :render-label="renderLabel"
                    :options="championOptions"
                    style="width: 170px"
                  />
                </template>

                <n-button
                  size="tiny"
                  circle
                  @click="removeCondition(Number(gIndex), Number(cIndex))"
                  >-</n-button
                >
              </n-space>
              <n-button dashed size="small" @click="addCondition(Number(gIndex))"
                >+ 添加条件</n-button
              >
            </n-space>
          </n-card>
          <n-button dashed block @click="addGroup">+ 添加条件组 (OR)</n-button>
        </n-space>
      </n-form>
      <template #footer>
        <n-flex justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="saveTag">保存</n-button>
        </n-flex>
      </template>
    </n-modal>
  </n-space>
</template>

<script setup lang="ts">
import { ref, onMounted, h } from 'vue'
import { NTag, NButton, NPopconfirm, useMessage, NSpace, NSwitch } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import {
  renderSingleSelectTag,
  renderLabel,
  filterChampionFunc
} from '../../components/composition'
import { championOption } from '../../components/type'

// Types (Mirroring backend roughly)
interface TagCondition {
  type: string // 'winStreak', 'loseStreak', 'stat'
  min?: number
  modeFilter?: number[]
  modeExclude?: number[]
  // Stat
  metric?: string
  operator?: string
  value?: number
  championId?: number
}

interface TagConfig {
  id: string
  name: string
  desc: string
  good: boolean
  enabled: boolean
  scope: any
  triggers: TagCondition[][] // Serialized directly from backend
  isDefault?: boolean

  // UI Helpers
  scopeModeList?: number[] // Helper for UI editing
}

const message = useMessage()
const tags = ref<TagConfig[]>([])
const loading = ref(false)
const showModal = ref(false)
const currentTag = ref<any>({})
const scopeType = ref('global')

const modeOptions = ref<{ label: string; value: number }[]>([])

// Options
/*
const modeOptions = [
    { label: '单双排', value: 420 },
    { label: '灵活组排', value: 440 },
    { label: '大乱斗', value: 450 },
    { label: '匹配', value: 430 },
    { label: '竞技场', value: 1700 }, // Example
];
*/

const conditionTypes = [
  { label: '连胜', value: 'winStreak' },
  { label: '连败', value: 'loseStreak' },
  { label: '数据统计', value: 'stat' }
]

const metricOptions = [
  { label: 'KDA', value: 'kda' },
  { label: '胜率', value: 'winRate' },
  { label: '总场次', value: 'gameCount' },
  { label: '英雄场次', value: 'championGames' }
]

const operatorOptions = [
  { label: '>', value: '>' },
  { label: '<', value: '<' },
  { label: '>=', value: '>=' },
  { label: '<=', value: '<=' },
  { label: '=', value: '==' }
]

const championOptions = ref<championOption[]>([])
// Need to fetch champions. For now empty or mocked.

const columns = [
  {
    title: '状态',
    key: 'enabled',
    width: 80,
    render: (row: any) =>
      h(NSwitch, {
        value: row.enabled,
        size: 'small',
        onUpdateValue: val => toggleEnabled(row, val)
      })
  },
  {
    title: '名称',
    key: 'name',
    render: (row: any) =>
      h(NTag, { type: row.good ? 'success' : 'error' }, { default: () => row.name })
  },
  { title: '描述', key: 'desc' },
  { title: '默认', key: 'isDefault', render: (row: any) => (row.isDefault ? '是' : '否') },
  {
    title: '操作',
    key: 'actions',
    render(row: any) {
      if (row.isDefault) return null
      return h(
        NSpace,
        {},
        {
          default: () => [
            h(
              NButton,
              { size: 'tiny', onClick: () => openEditModal(row) },
              { default: () => '编辑' }
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => deleteTag(row.id) },
              {
                trigger: () =>
                  h(NButton, { size: 'tiny', type: 'error' }, { default: () => '删除' }),
                default: () => '确定删除该标签吗？'
              }
            )
          ]
        }
      )
    }
  }
]

onMounted(async () => {
  loadTags()
  fetchChampions()
  fetchModes()
})

async function loadTags() {
  loading.value = true
  try {
    const res = await invoke<TagConfig[]>('get_all_tag_configs')
    tags.value = res.map(t => {
      // Deserialize helpers
      // Backend triggers: vec![vec![TagCondition]]
      // TagCondition is enum.
      // Example WinStreak: { winStreak: { min: 3 } }
      // We need to transform to UI model
      return transformToUiModel(t)
    })
  } catch (e: any) {
    message.error('加载标签失败: ' + e)
  } finally {
    loading.value = false
  }
}

async function fetchModes() {
  try {
    const res: any = await invoke('get_game_modes')
    // Filter out "All" (0) if not needed, or keep it.
    modeOptions.value = res.filter((m: any) => m.value !== 0)
  } catch (e) {
    message.error('加载游戏模式失败')
  }
}

async function fetchChampions() {
  try {
    const res: any = await invoke('get_champion_options')
    championOptions.value = res
  } catch (e) {
    message.error('加载英雄列表失败')
  }
}

function transformToUiModel(tag: any): TagConfig {
  // Simplification: We will pass raw structure mostly but may need tweaking
  // Scope: "global" or { mode: [] }
  if (typeof tag.scope === 'object' && tag.scope.mode) {
    tag.scopeModeList = tag.scope.mode
  }

  // Triggers: The backend returns structure like [ [ { winStreak: {...} } ] ]
  // We need to flatten the enum for UI: { type: 'winStreak', min: ... }
  tag.triggers = tag.triggers.map((group: any[]) =>
    group.map((c: any) => {
      if (c.winStreak) return { type: 'winStreak', ...c.winStreak }
      if (c.loseStreak) return { type: 'loseStreak', ...c.loseStreak }
      if (c.stat) return { type: 'stat', ...c.stat }
      return c
    })
  )
  return tag
}

async function toggleEnabled(row: TagConfig, val: boolean) {
  row.enabled = val
  // We need to persist this change
  // Since row is part of tags.value, we can just save all
  // But we need to be careful about transformation
  // transformToBackendModel relies on `currentTag`'s `scopeType` if we used it blindly.
  // So we should construct backend model for THIS row specifically, or ALL rows cleanly.

  // Safer:
  const newTags = tags.value.map(t => {
    // We modify the row in place, but for saving we need correct format
    // Re-use logic from `saveTag` kind of, but we are not in edit mode.
    // We need `transformToBackendModel` to be stateless regarding `scopeType` if possible
    // OR we manually fix the scope structure for existing tags before saving.

    // Actually, `tags.value` items already have `scope` in correct backend format mostly?
    // No, `transformToUiModel` adds `scopeModeList` but keeps `scope`.
    // Let's create a helper that doesn't rely on `scopeType` global ref.

    const res = { ...t }
    delete res.scopeModeList
    // Triggers already transformed to UI model in `loadTags`, need revert.

    // This is tricky because `tags.value` is in UI model.
    // We need a persistent way.
    return transformUiToBackendForSave(res)
  })

  try {
    await invoke('save_tag_configs', { configs: newTags })
    message.success(val ? '已启用' : '已禁用')
  } catch (e: any) {
    message.error(e)
    row.enabled = !val // revert UI
  }
}

function transformUiToBackendForSave(tag: TagConfig): any {
  const res: any = { ...tag }
  // Scope: if scopeModeList exists, it might be mode. But verify `tag.scope`
  // Actually `transformToUiModel` populates `scopeModeList` from `scope.mode`.
  // We can trust `tag.scope` if we didn't touch it, but we might have if we edited?
  // No, `toggleEnabled` edits in place.
  // But `scopeModeList` is just helper. `res.scope` should be valid from `loadTags`.
  delete res.scopeModeList

  // Triggers: need to revert from flat object to Enum wrapper
  res.triggers = res.triggers.map((group: any[]) =>
    group.map((c: any) => {
      if (c.type === 'winStreak')
        return { winStreak: { min: c.min, modeFilter: c.modeFilter, championId: c.championId } }
      if (c.type === 'loseStreak')
        return { loseStreak: { min: c.min, modeFilter: c.modeFilter, championId: c.championId } }
      if (c.type === 'stat')
        return {
          stat: {
            metric: c.metric,
            operator: c.operator,
            value: c.value,
            championId: c.championId,
            modeFilter: c.modeFilter,
            modeExclude: c.modeExclude
          }
        }
      return c
    })
  )
  return res
}

function transformToBackendModel(tag: any): any {
  const res = { ...tag }
  // Ensure isDefault is present
  if (res.isDefault === undefined) res.isDefault = false
  // Ensure enabled is present
  if (res.enabled === undefined) res.enabled = true

  // Scope
  if (scopeType.value === 'global') {
    res.scope = 'global'
  } else {
    res.scope = { mode: res.scopeModeList || [] }
  }
  delete res.scopeModeList

  // Triggers
  res.triggers = res.triggers.map((group: any[]) =>
    group.map((c: any) => {
      // Shared championId logic for streaks
      if (c.type === 'winStreak')
        return { winStreak: { min: c.min, modeFilter: c.modeFilter, championId: c.championId } }
      if (c.type === 'loseStreak')
        return { loseStreak: { min: c.min, modeFilter: c.modeFilter, championId: c.championId } }
      if (c.type === 'stat')
        return {
          stat: {
            metric: c.metric,
            operator: c.operator,
            value: c.value,
            championId: c.championId,
            modeFilter: c.modeFilter,
            modeExclude: c.modeExclude
          }
        }
      return c
    })
  )

  return res
}

function openCreateModal() {
  currentTag.value = {
    id: crypto.randomUUID(),
    name: '',
    desc: '',
    good: true,
    isDefault: false,
    enabled: true,
    scopeModeList: [],
    triggers: [[]]
  }
  scopeType.value = 'global'
  showModal.value = true
}

function addGroup() {
  currentTag.value.triggers.push([])
}
function removeGroup(idx: number) {
  currentTag.value.triggers.splice(idx, 1)
}
function addCondition(groupIdx: number) {
  currentTag.value.triggers[groupIdx].push({
    type: 'stat',
    metric: 'gameCount',
    operator: '>',
    value: 10
  })
}
function removeCondition(groupIdx: number, condIdx: number) {
  currentTag.value.triggers[groupIdx].splice(condIdx, 1)
}
function handleConditionTypeChange(condition: any) {
  if (condition.type === 'winStreak' || condition.type === 'loseStreak') {
    condition.min = 3
  }
  // retain other props or reset?
}

function openEditModal(row: any) {
  currentTag.value = JSON.parse(JSON.stringify(row))
  // Determine scopeType
  if (row.scopeModeList && row.scopeModeList.length > 0) {
    scopeType.value = 'mode'
  } else {
    scopeType.value = 'global'
  }
  showModal.value = true
}

async function saveTag() {
  // Validation
  if (!currentTag.value.name) {
    message.error('请输入名称')
    return
  }

  // Convert current tag to backend model
  const backendConfig = transformToBackendModel(currentTag.value)

  // Prepare full list for saving
  // We map existing UI tags to backend model, REPLACING the modified one if it exists
  let newTags = tags.value.map(t => {
    if (t.id === backendConfig.id) {
      return backendConfig
    }
    // Use the safe helper for others
    return transformUiToBackendForSave(t)
  })

  // If it's a new tag (id not found in map), push it
  if (!tags.value.find(t => t.id === backendConfig.id)) {
    newTags.push(backendConfig)
  }

  try {
    await invoke('save_tag_configs', { configs: newTags })
    message.success('保存成功')
    showModal.value = false
    loadTags()
  } catch (e: any) {
    message.error(e)
  }
}

async function deleteTag(id: string) {
  const newTags = tags.value.filter(t => t.id !== id).map(t => transformUiToBackendForSave(t))
  try {
    await invoke('save_tag_configs', { configs: newTags })
    message.success('删除成功')
    loadTags()
  } catch (e: any) {
    message.error(e)
  }
}
</script>
