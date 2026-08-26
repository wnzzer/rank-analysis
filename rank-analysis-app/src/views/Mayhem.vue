<template>
  <div class="mayhem">
    <PageStage
      kicker="MAYHEM · 海克斯大乱斗"
      title="大 乱 斗"
      sub="英雄强度 · 强化排行 · 版本数据"
      compact
    >
      <template #actions>
        <span v-if="status?.activeVersion" class="mver">
          数据 {{ status.activeVersion }}
          <template v-if="syncedDateText"> · {{ syncedDateText }}</template>
        </span>
        <button class="btn gho sm" :disabled="syncing" @click="onSync(true)">
          <RefreshCw class="btn-ico" :class="{ spinning: syncing }" />
          {{ syncing ? '同步中…' : '刷新数据' }}
        </button>
      </template>
    </PageStage>

    <div class="m-body">
      <div v-if="error" class="m-alert">{{ error }}</div>

      <div class="m-toolbar">
        <input
          v-model.trim="search"
          class="m-search"
          type="search"
          placeholder="搜索 英雄名 / 称号 / 英文…"
        />
        <div class="m-roles">
          <button
            v-for="r in roleOptions"
            :key="r.key"
            class="chip"
            :class="{ 'chip--on': activeRole === r.key }"
            @click="activeRole = r.key"
          >
            {{ r.label }}
          </button>
        </div>
      </div>

      <div v-if="loading && !champions.length" class="m-empty">正在加载数据…</div>
      <div v-else-if="!filtered.length" class="m-empty">没有符合条件的英雄</div>

      <div v-else class="m-grid">
        <button v-for="c in filtered" :key="c.id" class="ccard" :title="`${c.name}·${c.title}`">
          <span class="ctier" :class="`t${tierOf(c)}`">T{{ tierOf(c) }}</span>
          <img class="cico" :src="c.iconUrl" :alt="c.title" loading="lazy" />
          <span class="cname">{{ c.title }}</span>
          <span class="calias">{{ c.name }}</span>
          <span class="cwr">{{ pct(c.stats.winRate) }}</span>
          <span class="cpr">选取 {{ pct(c.stats.pickRate) }}</span>
          <span class="croles">
            <i v-for="role in c.roles.slice(0, 2)" :key="role">{{ roleLabel(role) }}</i>
          </span>
        </button>
      </div>

      <p class="m-note">
        数据来源：aramgg 公开客户端 API（腾讯国服公开统计口径，T 级官方、胜率随版本每日更新）。
        数据缓存于本地，离线时展示上一同步版本。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Mayhem —— 海克斯大乱斗数据中心（feature-expansion-plan M1 / A1）
 * 首屏：本地优先读取已同步版本；无本地数据或用户点击时才走网络同步。
 * 后续迭代在此页扩展强化榜 / 英雄详情子页（见计划 A1 Tab 2/3）。
 */
import { computed, onMounted, ref } from 'vue'

import PageStage from '../components/ui/PageStage.vue'
import { RefreshCw } from 'lucide-vue-next'
import {
  getMayhemChampions,
  getMayhemStatus,
  syncMayhemData,
  type MayhemChampion,
  type MayhemStatus
} from '../features/mayhem/services/mayhemData'

const status = ref<MayhemStatus | null>(null)
const champions = ref<MayhemChampion[]>([])
const loading = ref(false)
const syncing = ref(false)
const error = ref('')
const search = ref('')
const activeRole = ref('all')

const ROLE_LABELS: Record<string, string> = {
  tank: '坦克',
  fighter: '战士',
  assassin: '刺客',
  mage: '法师',
  marksman: '射手',
  support: '辅助'
}

const roleOptions = [
  { key: 'all', label: '全部' },
  ...Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label }))
]

const syncedDateText = computed(() => {
  if (!status.value?.syncedAt) return ''
  const d = new Date(status.value.syncedAt * 1000)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}-${d.getDate()} 同步`
})

const filtered = computed(() => {
  const kw = search.value.toLowerCase()
  return [...champions.value]
    .filter(c => activeRole.value === 'all' || c.roles.includes(activeRole.value))
    .filter(
      c =>
        !kw ||
        c.title.toLowerCase().includes(kw) ||
        c.name.toLowerCase().includes(kw) ||
        c.alias.toLowerCase().includes(kw)
    )
    .sort((a, b) => (b.stats.winRate ?? 0) - (a.stats.winRate ?? 0))
})

function tierOf(c: MayhemChampion): number {
  return Math.min(Math.max(c.stats.tier ?? 5, 1), 5)
}

function pct(v: number | null): string {
  return v == null ? '--' : `${(v * 100).toFixed(v >= 0.1 ? 1 : 2)}%`
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const res = await getMayhemChampions()
    champions.value = res.champions ?? []
  } catch (e) {
    error.value = `读取本地数据失败：${String(e)}（可尝试刷新数据）`
  } finally {
    loading.value = false
  }
}

async function onSync(force: boolean) {
  syncing.value = true
  try {
    await syncMayhemData(force)
    await loadData()
    status.value = await getMayhemStatus()
  } catch (e) {
    error.value = `同步失败（离线时可继续使用本地版本）：${String(e)}`
  } finally {
    syncing.value = false
  }
}

onMounted(async () => {
  try {
    status.value = await getMayhemStatus()
    if (!status.value.ready) {
      await onSync(false)
    } else {
      await loadData()
    }
  } catch (e) {
    error.value = `初始化失败：${String(e)}`
    loading.value = false
  }
})
</script>

<style scoped src="./Mayhem.styles.css"></style>
