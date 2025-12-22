<template>
  <n-space vertical>
    <!-- Display Settings -->
    <n-card>
      <n-text tag="div" class="setting-title">基本设置</n-text>

      <n-space vertical>
        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#2080f0">
              <Flash />
            </n-icon>
            自动接受对局
          </span>
          <n-switch v-model:value="autoAccept" @update:value="updateAcceptSwitch" />
        </div>

        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#18a058">
              <CheckmarkCircle />
            </n-icon>
            自动选择英雄
          </span>
          <n-switch v-model:value="autoPick" @update:value="updatePickSwitch" />
        </div>
        <n-flex>
          <VueDraggable ref="el" v-model="myPickData">
            <n-tag
              v-for="item in myPickData"
              :key="item"
              round
              closable
              :bordered="false"
              @close="deletePickData(item)"
              style="margin-right: 15px"
            >
              {{ options.filter(option => option.value === item)?.[0]?.label || `英雄 ${item}` }}
              <template #avatar>
                <n-avatar
                  :src="assetPrefix + '/champion/' + item"
                  :fallback-src="assetPrefix + 'champion-1'"
                />
              </template>
            </n-tag>
          </VueDraggable>
          <n-select
            v-model:value="selectPickChampionId"
            filterable
            :filter="filterChampionFunc"
            placeholder="添加英雄"
            :render-tag="renderSingleSelectTag"
            :render-label="renderLabel"
            :options="options"
            size="small"
            @update:value="addPickData"
            style="width: 170px"
          />
        </n-flex>
        <n-text depth="3" style="font-size: 12px">拖动可以改变选择英雄的优先级</n-text>
        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#d03050">
              <Close />
            </n-icon>
            自动禁止英雄
          </span>
          <n-switch v-model:value="autoBan" @update:value="updateBanSwitch" />
        </div>
        <n-flex>
          <VueDraggable ref="el" v-model="myBanData">
            <n-tag
              v-for="item in myBanData"
              :key="item"
              round
              closable
              @close="deleteBanData(item)"
              :bordered="false"
              style="margin-right: 15px"
            >
              {{ options.filter(option => option.value === item)?.[0]?.label || `英雄 ${item}` }}
              <template #avatar>
                <n-avatar
                  :src="assetPrefix + '/champion/' + item"
                  :fallback-src="assetPrefix + 'champion-1'"
                />
              </template>
            </n-tag>
          </VueDraggable>
          <n-select
            v-model:value="selectBanChampionId"
            filterable
            :filter="filterChampionFunc"
            placeholder="添加英雄"
            :render-tag="renderSingleSelectTag"
            :render-label="renderLabel"
            :options="options"
            size="small"
            @update:value="addBanData"
            style="width: 170px"
          />
        </n-flex>
        <n-text depth="3" style="font-size: 12px">拖动可以改变禁用英雄的优先级</n-text>

        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#2080f0">
              <PlayCircle />
            </n-icon>
            自动开始匹配
          </span>
          <n-switch v-model:value="autoStart" @update:value="updateStartSwitch" />
        </div>
      </n-space>
    </n-card>
  </n-space>
</template>
<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { onMounted, ref } from 'vue'
import {
  renderSingleSelectTag,
  renderLabel,
  filterChampionFunc
} from '../../components/composition'
import { CheckmarkCircle, Flash, Close, PlayCircle } from '@vicons/ionicons5'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { assetPrefix } from '@renderer/services/http'
import { championOption } from '@renderer/components/type'
import { invoke } from '@tauri-apps/api/core'

onMounted(async () => {
  const opts = await invoke<championOption[]>('get_champion_options')
  options.value = opts.filter(opt => opt.value > 0)
  autoAccept.value = await getConfigByIpc<boolean>('settings.auto.acceptMatchSwitch')
  autoPick.value = await getConfigByIpc<boolean>('settings.auto.pickChampionSwitch')
  autoBan.value = await getConfigByIpc<boolean>('settings.auto.banChampionSwitch')
  myPickData.value = (await getConfigByIpc<number[]>('settings.auto.pickChampionSlice')) || []
  myBanData.value = (await getConfigByIpc<number[]>('settings.auto.banChampionSlice')) || []
  autoStart.value = await getConfigByIpc<boolean>('settings.auto.startMatchSwitch')
})

const options = ref<championOption[]>([])
const autoAccept = ref(false)
const autoPick = ref(false)
const autoBan = ref(false)
const autoStart = ref(false)

const selectPickChampionId = ref(null)
const selectBanChampionId = ref(null)

const myPickData = ref<number[]>([])
const myBanData = ref<number[]>([])

const updateAcceptSwitch = async () => {
  await putConfigByIpc('settings.auto.acceptMatchSwitch', { value: autoAccept.value })
}

const updatePickSwitch = async () => {
  await putConfigByIpc('settings.auto.pickChampionSwitch', { value: autoPick.value })
}
const updateBanSwitch = async () => {
  await putConfigByIpc('settings.auto.banChampionSwitch', { value: autoBan.value })
}
const updatePickData = async () => {
  await putConfigByIpc('settings.auto.pickChampionSlice', { value: myPickData.value })
}
const updateBanData = async () => {
  await putConfigByIpc('settings.auto.banChampionSlice', { value: myBanData.value })
}
const updateStartSwitch = async () => {
  await putConfigByIpc('settings.auto.startMatchSwitch', { value: autoStart.value })
}

const deleteBanData = async (value: number) => {
  myBanData.value = myBanData.value.filter(item => item !== value)
  await updateBanData()
}
const deletePickData = async (value: number) => {
  myPickData.value = myPickData.value.filter(item => item !== value)
  await updatePickData()
}
const addBanData = async (value: number) => {
  if (value === 0 || myBanData.value.includes(value)) return
  myBanData.value?.push(value)
  await updateBanData()
}
const addPickData = async (value: number) => {
  console.log('addPickData', value)
  if (myPickData.value.includes(value) || value === 0) return
  myPickData.value?.push(value)
  await updatePickData()
}
</script>

<style scoped>
.setting-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 16px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.setting-label {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon {
  font-style: normal;
}
</style>
