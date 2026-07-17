<template>
  <n-space vertical :size="12">
    <!-- 手动备份 -->
    <n-card title="手动备份" size="small">
      <n-space vertical>
        <n-text :depth="3" style="font-size: var(--font-size-sm)">
          导出全量备份(应用设置 + 玩家备注)为 JSON 文件,或从备份文件恢复。 备份文件包含你填写的 API
          key,请妥善保管。
        </n-text>
        <n-space>
          <n-button size="small" @click="handleExport">导出全量备份</n-button>
          <n-button size="small" @click="handleImport">从文件导入</n-button>
        </n-space>
      </n-space>
    </n-card>

    <!-- 云同步 -->
    <n-card title="云同步" size="small">
      <n-space vertical>
        <n-space align="center" justify="space-between">
          <n-space vertical :size="4">
            <n-text>跨设备同步玩家备注</n-text>
            <n-text :depth="3" style="font-size: var(--font-size-sm)">
              按当前登录的召唤师（puuid）存取，明文存储于第三方云端，开启前请阅读风险说明。
            </n-text>
          </n-space>
          <n-switch :value="cloudStore.enabled" @update:value="handleToggle" />
        </n-space>

        <n-space v-if="cloudStore.enabled" align="center">
          <n-button
            size="small"
            :loading="cloudStore.syncing"
            :disabled="cloudStore.syncing"
            @click="handleSyncNow"
          >
            立即同步
          </n-button>
          <n-text :depth="3" style="font-size: var(--font-size-sm)">{{ syncStatusText }}</n-text>
        </n-space>
      </n-space>
    </n-card>

    <!-- 风险告知弹窗：开启云同步前必经，勾选确认才放行 -->
    <n-modal
      :show="showRiskModal"
      preset="card"
      title="开启云同步前，请了解以下风险"
      style="max-width: 480px"
      :mask-closable="false"
      @update:show="cancelRisk"
    >
      <n-space vertical size="large">
        <ol class="risk-list">
          <li>
            你的备注与应用设置(不含 API key)将<b>明文</b>存储在第三方云端(Supabase / AWS 海外节点)。
          </li>
          <li>
            数据按你的召唤师标识（puuid）存取，而 puuid 对局内队友、对手及战绩网站均可见——
            <b>任何知道你 puuid 的人理论上都能查询到你同步的备注</b>。
          </li>
          <li>本功能无身份验证，数据存在被他人覆盖或污染的残余风险。</li>
          <li>请<b>不要</b>在备注中写入任何隐私或敏感信息。</li>
        </ol>
        <n-checkbox v-model:checked="riskAcknowledged">我已阅读并了解上述风险</n-checkbox>
        <n-space justify="end">
          <n-button @click="cancelRisk">取消</n-button>
          <n-button type="primary" :disabled="!riskAcknowledged" @click="confirmRisk">
            开启云同步
          </n-button>
        </n-space>
      </n-space>
    </n-modal>
  </n-space>
</template>

<script setup lang="ts">
/**
 * 设置页·数据与同步分区
 *
 * 手动导入导出（JSON 文件，经系统对话框）+ 云同步开关（开启必经风险告知）。
 * 同步编排在 pinia/cloudSync，合并语义在 utils/mergePlayerNotes，本组件只做交互。
 */
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { save, open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import { useCloudSyncStore } from '@renderer/pinia/cloudSync'
import { useSettingsStore } from '@renderer/pinia/setting'
import { isBackupFileV2 } from '@renderer/utils/backupFile'
import type { MergeStats } from '@renderer/utils/mergePlayerNotes'

const message = useMessage()
const notesStore = usePlayerNotesStore()
const cloudStore = useCloudSyncStore()
const settingsStore = useSettingsStore()

const showRiskModal = ref(false)
const riskAcknowledged = ref(false)

const syncStatusText = computed(() => {
  if (cloudStore.syncing) return '同步中…'
  if (cloudStore.lastError) return `上次同步失败：${cloudStore.lastError}`
  if (cloudStore.lastSyncAt) return `上次同步：${formatSyncTime(cloudStore.lastSyncAt)}`
  return '本次启动尚未同步'
})

/**
 * 上次同步时间展示：当天只显时间，跨天补日期。
 * 只显 toLocaleTimeString 会让昨天 22:51 的同步看起来像刚同步过。
 */
function formatSyncTime(ts: number): string {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString()
}

/** 导出:系统保存对话框选路径 → Rust export_backup 全量写文件(过滤在 Rust 侧) */
async function handleExport(): Promise<void> {
  const path = await save({
    defaultPath: `rank-analysis-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!path) return
  try {
    await invoke('export_backup', { path })
    message.success('已导出全量备份')
  } catch (e) {
    message.error(String(e))
  }
}

/**
 * 导入：系统打开对话框选文件 → Rust 读文件 → 校验格式 → 并入 store。
 * 校验要点：parse 结果必须是「普通对象」（排除 null / 数组 / 原始值），
 * 否则 importNotes 的 Object.entries 会拿到垃圾数据。
 */
async function handleImport(): Promise<void> {
  const path = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!path || Array.isArray(path)) return
  // 读文件与 parse 分开 catch：Rust 侧的「文件过大」「仅支持 .json」等文案需原样透传
  let content: string
  try {
    content = await invoke<string>('read_text_file', { path })
  } catch (e) {
    message.error(String(e))
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    message.error('文件内容不是合法 JSON')
    return
  }
  if (!isBackupFileV2(parsed)) {
    message.error('不是本应用导出的备份文件,或版本不支持')
    return
  }
  let stats: MergeStats
  try {
    stats = await notesStore.importNotes(parsed.playerNotes)
  } catch (e) {
    message.error(`导入失败:${String(e)}`)
    return
  }
  const notesSummary =
    `备注新增 ${stats.added},更新 ${stats.replaced},保留本地 ${stats.kept}` +
    (stats.invalid ? `,跳过损坏 ${stats.invalid}` : '')
  try {
    await invoke('apply_config_snapshot', { snapshot: parsed.appConfig })
    await settingsStore.initTheme()
    message.success(`导入完成:配置已恢复;${notesSummary}`)
  } catch (e) {
    // 备注已真实落盘,配置失败必须如实分开报,否则用户误以为整次导入失败
    message.warning(`备注已导入(${notesSummary}),但配置恢复失败:${String(e)}`)
  }
}

/** 开关交互：开=先过风险弹窗；关=直接关 */
function handleToggle(v: boolean): void {
  if (v) {
    riskAcknowledged.value = false
    showRiskModal.value = true
  } else {
    cloudStore.setEnabled(false).catch(() => message.error('保存失败'))
  }
}

function cancelRisk(): void {
  showRiskModal.value = false
}

async function confirmRisk(): Promise<void> {
  showRiskModal.value = false
  try {
    await cloudStore.setEnabled(true)
    message.success('云同步已开启，正在后台同步')
  } catch {
    message.error('保存失败')
  }
}

async function handleSyncNow(): Promise<void> {
  try {
    await cloudStore.syncNow()
    message.success('同步完成')
  } catch {
    message.error(cloudStore.lastError ?? '同步失败')
  }
}
</script>

<style scoped>
.risk-list {
  margin: 0;
  padding-left: 1.2em;
  line-height: 1.8;
}
</style>
