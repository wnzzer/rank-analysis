<template>
  <n-space vertical>
    <!-- Basic settings card -->
    <n-card>
      <n-text tag="div" class="setting-title">基本设置</n-text>
      <n-space vertical>
        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" class="setting-item-icon setting-item-icon-accept">
              <FlashOutline />
            </n-icon>
            自动接受对局
          </span>
          <n-switch v-model:value="autoAccept" @update:value="updateAcceptSwitch" />
        </div>

        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" class="setting-item-icon setting-item-icon-start">
              <PlayCircleOutline />
            </n-icon>
            自动开始匹配
          </span>
          <n-switch v-model:value="autoStart" @update:value="updateStartSwitch" />
        </div>
      </n-space>
    </n-card>

    <!-- Pick group card -->
    <n-card>
      <template #header>
        <span class="setting-label">
          <n-icon size="20" class="setting-item-icon setting-item-icon-pick">
            <CheckmarkCircleOutline />
          </n-icon>
          自动选择英雄
        </span>
      </template>
      <template #header-extra>
        <n-switch v-model:value="autoPick" @update:value="updatePickSwitch" />
      </template>

      <!-- 开关关闭时整体降透明度：规则仍可编辑，但一眼能看出当前不生效 -->
      <div :class="{ 'rules-inactive': !autoPick }">
        <div class="rules-section">
          <div class="section-title">
            规则（按顺序匹配，第一条命中即用）
            <n-button size="small" type="primary" ghost @click="openPickEdit()"
              >+ 添加规则</n-button
            >
          </div>
          <VueDraggable
            :model-value="pickRules"
            @update:model-value="(next: PickRule[]) => savePickRules(next)"
          >
            <div v-for="rule in pickRules" :key="rule.id" class="rule-row">
              <n-checkbox
                :checked="rule.enabled"
                @update:checked="(v: boolean) => togglePickRule(rule.id, v)"
              />
              <span class="rule-name">{{ rule.name }}</span>
              <n-avatar
                :src="assetPrefix + '/champion/' + rule.action.champion_id"
                :fallback-src="`${assetPrefix}/champion/-1`"
                :size="24"
                style="flex-shrink: 0"
              />
              <span class="rule-summary">{{ summarize(rule) }}</span>
              <n-button quaternary size="small" @click="openPickEdit(rule)">编辑</n-button>
              <n-button quaternary type="error" size="small" @click="deletePickRule(rule.id)"
                >删除</n-button
              >
            </div>
          </VueDraggable>
        </div>

        <div class="section-title">兜底（规则都没命中时按顺序选）</div>
        <n-flex>
          <VueDraggable ref="el" v-model="myPickData">
            <n-tag
              v-for="item in myPickData"
              :key="item"
              round
              closable
              :bordered="false"
              @close="deletePickData(item)"
              style="margin-right: var(--space-16)"
            >
              {{ options.filter(option => option.value === item)?.[0]?.label || `英雄 ${item}` }}
              <template #avatar>
                <n-avatar
                  :src="assetPrefix + '/champion/' + item"
                  :fallback-src="`${assetPrefix}/champion/-1`"
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
        <n-text depth="3" style="font-size: var(--font-size-sm)"
          >拖动可以改变选择英雄的优先级</n-text
        >
      </div>

      <RuleEditModal
        v-model:show="pickModalShow"
        mode="pick"
        :initial="pickEditing"
        :champion-options="options"
        @save="onPickSave"
      />
    </n-card>

    <!-- Ban group card -->
    <n-card>
      <template #header>
        <span class="setting-label">
          <n-icon size="20" color="#d03050">
            <Close />
          </n-icon>
          自动禁止英雄
        </span>
      </template>
      <template #header-extra>
        <n-switch v-model:value="autoBan" @update:value="updateBanSwitch" />
      </template>

      <div :class="{ 'rules-inactive': !autoBan }">
        <div class="rules-section">
          <div class="section-title">
            规则（按顺序匹配，第一条命中即用）
            <n-button size="small" type="primary" ghost @click="openBanEdit()">+ 添加规则</n-button>
          </div>
          <VueDraggable
            :model-value="banRules"
            @update:model-value="(next: BanRule[]) => saveBanRules(next)"
          >
            <div v-for="rule in banRules" :key="rule.id" class="rule-row">
              <n-checkbox
                :checked="rule.enabled"
                @update:checked="(v: boolean) => toggleBanRule(rule.id, v)"
              />
              <span class="rule-name">{{ rule.name }}</span>
              <n-avatar
                :src="assetPrefix + '/champion/' + rule.action.champion_id"
                :fallback-src="`${assetPrefix}/champion/-1`"
                :size="24"
                style="flex-shrink: 0"
              />
              <span class="rule-summary">{{ summarize(rule) }}</span>
              <n-button quaternary size="small" @click="openBanEdit(rule)">编辑</n-button>
              <n-button quaternary type="error" size="small" @click="deleteBanRule(rule.id)"
                >删除</n-button
              >
            </div>
          </VueDraggable>
        </div>

        <div class="section-title">兜底（规则都没命中时按顺序选）</div>
        <n-flex>
          <VueDraggable ref="el" v-model="myBanData">
            <n-tag
              v-for="item in myBanData"
              :key="item"
              round
              closable
              @close="deleteBanData(item)"
              :bordered="false"
              style="margin-right: var(--space-16)"
            >
              {{ options.filter(option => option.value === item)?.[0]?.label || `英雄 ${item}` }}
              <template #avatar>
                <n-avatar
                  :src="assetPrefix + '/champion/' + item"
                  :fallback-src="`${assetPrefix}/champion/-1`"
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
        <n-text depth="3" style="font-size: var(--font-size-sm)"
          >拖动可以改变禁用英雄的优先级</n-text
        >
      </div>

      <RuleEditModal
        v-model:show="banModalShow"
        mode="ban"
        :initial="banEditing"
        :champion-options="options"
        @save="onBanSave"
      />
    </n-card>
  </n-space>
</template>
<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { onMounted, ref } from 'vue'
import { renderSingleSelectTag, renderLabel, filterChampionFunc } from '@renderer/utils/champion'
import { CheckmarkCircleOutline, FlashOutline, Close, PlayCircleOutline } from '@vicons/ionicons5'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { assetPrefix } from '@renderer/services/http'
import type { championOption } from '@renderer/types/domain/champion'
import { invoke } from '@tauri-apps/api/core'
import { usePickRules, useBanRules } from '@renderer/composables/useRules'
import RuleEditModal from '@renderer/components/automation/RuleEditModal.vue'
import type { PickRule, BanRule, PickAction } from '@renderer/types/rules'

const { rules: pickRules, reload: reloadPickRules, save: savePickRules } = usePickRules()
const { rules: banRules, reload: reloadBanRules, save: saveBanRules } = useBanRules()

const pickModalShow = ref(false)
const pickEditing = ref<PickRule | undefined>(undefined)
const banModalShow = ref(false)
const banEditing = ref<BanRule | undefined>(undefined)

onMounted(async () => {
  const opts = await invoke<championOption[]>('get_champion_options')
  options.value = opts.filter(opt => opt.value > 0)
  autoAccept.value = (await getConfigByIpc<boolean>('settings.auto.acceptMatchSwitch')) ?? false
  autoPick.value = (await getConfigByIpc<boolean>('settings.auto.pickChampionSwitch')) ?? false
  autoBan.value = (await getConfigByIpc<boolean>('settings.auto.banChampionSwitch')) ?? false
  myPickData.value = (await getConfigByIpc<number[]>('settings.auto.pickChampionSlice')) ?? []
  myBanData.value = (await getConfigByIpc<number[]>('settings.auto.banChampionSlice')) ?? []
  autoStart.value = (await getConfigByIpc<boolean>('settings.auto.startMatchSwitch')) ?? false
  await reloadPickRules()
  await reloadBanRules()
})

function openPickEdit(rule?: PickRule) {
  pickEditing.value = rule ? JSON.parse(JSON.stringify(rule)) : undefined
  pickModalShow.value = true
}
async function onPickSave(rule: PickRule | BanRule) {
  const r = rule as PickRule
  const existingIdx = pickRules.value.findIndex(x => x.id === r.id)
  const next = [...pickRules.value]
  if (existingIdx >= 0) next[existingIdx] = r
  else next.push(r)
  await savePickRules(next)
}
async function deletePickRule(id: string) {
  await savePickRules(pickRules.value.filter(r => r.id !== id))
}
async function togglePickRule(id: string, enabled: boolean) {
  await savePickRules(pickRules.value.map(r => (r.id === id ? { ...r, enabled } : r)))
}

function openBanEdit(rule?: BanRule) {
  banEditing.value = rule ? JSON.parse(JSON.stringify(rule)) : undefined
  banModalShow.value = true
}
async function onBanSave(rule: PickRule | BanRule) {
  const r = rule as BanRule
  const existingIdx = banRules.value.findIndex(x => x.id === r.id)
  const next = [...banRules.value]
  if (existingIdx >= 0) next[existingIdx] = r
  else next.push(r)
  await saveBanRules(next)
}
async function deleteBanRule(id: string) {
  await saveBanRules(banRules.value.filter(r => r.id !== id))
}
async function toggleBanRule(id: string, enabled: boolean) {
  await saveBanRules(banRules.value.map(r => (r.id === id ? { ...r, enabled } : r)))
}

function summarize(rule: PickRule | BanRule): string {
  const positionLabel = (p: string) =>
    ({ top: '上路', jungle: '打野', middle: '中路', bottom: '下路', utility: '辅助' })[p] ?? p
  const parts: string[] = []
  for (const c of rule.conditions) {
    switch (c.type) {
      case 'Position':
        parts.push(positionLabel(c.value))
        break
      case 'AllyChampionsContains':
        parts.push(`自家含 ${c.ids.length} 个`)
        break
      case 'AllyChampionsNotContains':
        parts.push(`自家无 ${c.ids.length} 个`)
        break
      case 'EnemyChampionsContains':
        parts.push(`对面含 ${c.ids.length} 个`)
        break
      case 'EnemyChampionsNotContains':
        parts.push(`对面无 ${c.ids.length} 个`)
        break
    }
  }
  const target =
    options.value?.find(c => c.value === rule.action.champion_id)?.label ??
    `#${rule.action.champion_id}`
  const isPick = 'lock' in rule.action
  const lockTag = isPick && (rule.action as PickAction).lock ? ' [锁]' : ''
  return `${parts.join(' + ')} → ${isPick ? '选' : 'Ban'} ${target}${lockTag}`
}

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
  await putConfigByIpc('settings.auto.acceptMatchSwitch', autoAccept.value)
}

const updatePickSwitch = async () => {
  await putConfigByIpc('settings.auto.pickChampionSwitch', autoPick.value)
}
const updateBanSwitch = async () => {
  await putConfigByIpc('settings.auto.banChampionSwitch', autoBan.value)
}
const updatePickData = async () => {
  await putConfigByIpc('settings.auto.pickChampionSlice', myPickData.value)
}
const updateBanData = async () => {
  await putConfigByIpc('settings.auto.banChampionSlice', myBanData.value)
}
const updateStartSwitch = async () => {
  await putConfigByIpc('settings.auto.startMatchSwitch', autoStart.value)
}

const deleteBanData = async (value: any) => {
  myBanData.value = myBanData.value.filter(item => item !== value)
  await updateBanData()
}
const deletePickData = async (value: any) => {
  myPickData.value = myPickData.value.filter(item => item !== value)
  await updatePickData()
}
const addBanData = async (value: any) => {
  if (value === 0 || myBanData.value.includes(value)) return
  myBanData.value?.push(value)
  await updateBanData()
}
const addPickData = async (value: any) => {
  if (myPickData.value.includes(value) || value === 0) return
  myPickData.value?.push(value)
  await updatePickData()
}
</script>

<style scoped>
.setting-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  margin-bottom: var(--space-16);
  color: var(--text-primary);
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-8) 0;
}

.setting-label {
  font-size: var(--font-size-md);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--text-primary);
}

.radio-label {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.setting-item-icon {
  flex-shrink: 0;
}
.setting-item-icon-accept {
  color: var(--accent-blue);
}
.setting-item-icon-pick {
  color: var(--semantic-win);
}
.setting-item-icon-start {
  color: var(--accent-blue);
}

.icon {
  font-style: normal;
}

.rules-section {
  margin-bottom: var(--space-12);
}

/* 功能开关关闭时的规则区：可编辑但视觉降权，避免被误读成正在生效 */
.rules-inactive {
  opacity: 0.45;
  transition: opacity var(--dur-normal, 0.2s) ease;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin: var(--space-12) 0 var(--space-8);
}

.rule-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--n-border-color);
}

.rule-name {
  min-width: 120px;
  font-weight: 500;
}

.rule-summary {
  flex: 1;
  color: var(--n-text-color-disabled);
  font-size: var(--font-size-sm);
}
</style>
