<template>
  <n-space vertical>
    <n-card title="标签管理" size="small">
      <template #header-extra>
        <n-button type="primary" size="small" @click="openCreateModal"> 新增标签 </n-button>
      </template>
      <n-data-table :columns="columns" :data="tags" :loading="loading" :bordered="false" />
    </n-card>

    <n-modal v-model:show="showModal" preset="card" title="编辑标签" style="width: 900px">
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

        <n-divider title-placement="left">触发条件 (Logic Tree)</n-divider>

        <div class="condition-editor-container">
          <TagConditionNode
            v-if="currentTag.condition"
            v-model="currentTag.condition"
            :is-root="true"
            :mode-options="modeOptions"
            :champion-options="championOptions"
          />
          <div v-else class="empty-root">
            <n-button @click="initRootCondition">初始化条件</n-button>
          </div>
        </div>
      </n-form>
      <template #footer>
        <n-flex justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="saveTag" v-if="!currentTag.isDefault">保存</n-button>
        </n-flex>
      </template>
    </n-modal>
  </n-space>
</template>

<script setup lang="ts">
import { ref, onMounted, h } from 'vue'
import {
  NTag,
  NButton,
  NPopconfirm,
  useMessage,
  NSpace,
  NSwitch,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NDivider,
  NCard,
  NDataTable,
  NFlex,
  useThemeVars
} from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import TagConditionNode from './TagConditionNode.vue'
import { championOption } from '../../components/type'

const themeVars = useThemeVars()

// Backend Interfaces
interface TagConfig {
  id: string
  name: string
  desc: string
  good: boolean
  enabled: boolean
  condition: any // Complex tree structure, using any to delegate to component
  isDefault?: boolean
}

const message = useMessage()
const tags = ref<TagConfig[]>([])
const loading = ref(false)
const showModal = ref(false)
// Initialize with empty object matching interface partially
const currentTag = ref<TagConfig>({
  id: '',
  name: '',
  desc: '',
  good: false,
  enabled: true,
  condition: null
})

const modeOptions = ref<{ label: string; value: number }[]>([])
const championOptions = ref<championOption[]>([])

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
      if (row.isDefault) {
        return h(
          NButton,
          { size: 'tiny', onClick: () => openEditModal(row) },
          { default: () => '查看' }
        )
      }
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
    // No transformation needed now, assume backend sends valid tree
    tags.value = res
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

async function toggleEnabled(row: TagConfig, val: boolean) {
  row.enabled = val
  // Save all tags
  try {
    await invoke('save_tag_configs', { configs: tags.value })
    message.success(val ? '已启用' : '已禁用')
  } catch (e: any) {
    message.error(e)
    row.enabled = !val
  }
}

function openCreateModal() {
  currentTag.value = {
    id: crypto.randomUUID(),
    name: '',
    desc: '',
    good: true,
    isDefault: false,
    enabled: true,
    condition: {
      // Default root: OR group
      type: 'or',
      conditions: [
        {
          type: 'history',
          filters: [{ type: 'queue', ids: [420, 440] }], // Ranked
          refresh: { type: 'streak', kind: 'win', min: 3 }
        }
      ]
    }
  }
  showModal.value = true
}

function initRootCondition() {
  currentTag.value.condition = {
    type: 'or',
    conditions: []
  }
}

function openEditModal(row: any) {
  // Deep copy
  currentTag.value = JSON.parse(JSON.stringify(row))
  showModal.value = true
}

async function saveTag() {
  if (!currentTag.value.name) {
    message.error('请输入名称')
    return
  }
  if (!currentTag.value.condition) {
    message.error('请配置触发条件')
    return
  }

  const tagToSave = { ...currentTag.value }

  // Update list
  let newTags = [...tags.value]
  const idx = newTags.findIndex(t => t.id === tagToSave.id)
  if (idx >= 0) {
    newTags[idx] = tagToSave
  } else {
    newTags.push(tagToSave)
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
  const newTags = tags.value.filter(t => t.id !== id)
  try {
    await invoke('save_tag_configs', { configs: newTags })
    message.success('删除成功')
    loadTags()
  } catch (e: any) {
    message.error(e)
  }
}
</script>

<style scoped>
.condition-editor-container {
  max-height: 500px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid v-bind('themeVars.borderColor');
  border-radius: 4px;
}
.empty-root {
  text-align: center;
  padding: 20px;
}
</style>
