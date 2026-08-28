<template>
  <div class="matrix-layout" :class="{ 'dual-pane': isWide, 'single-pane': !isWide }">
    <!-- 左侧 / 上半部：英雄筛选与 T 级矩阵 -->
    <section class="matrix-left">
      <!-- 搜索与职业筛选行 -->
      <div class="matrix-filter-bar">
        <div class="role-pills">
          <button
            class="role-pill"
            :class="{ active: activeRole === 'all' }"
            @click="activeRole = 'all'"
          >
            ★ 全部 ({{ champions.length }})
          </button>
          <button
            v-for="(label, role) in ROLE_LABELS"
            :key="role"
            class="role-pill"
            :class="{ active: activeRole === role }"
            @click="activeRole = role"
          >
            {{ label }}
          </button>
        </div>

        <div class="matrix-search-box">
          <span class="search-ico">🔍</span>
          <input
            v-model.trim="search"
            class="matrix-search-input"
            type="search"
            placeholder="搜寻英雄（中 / 英）"
          />
        </div>
      </div>

      <!-- T 级矩阵列表 -->
      <div class="tier-sections">
        <div v-for="grp in tierGroups" :key="grp.key" class="tier-section">
          <div class="tier-header">
            <span class="tier-badge" :class="grp.key">{{ grp.label }}</span>
            <span class="tier-desc">{{ grp.desc }} · {{ grp.list.length }} 位</span>
          </div>

          <div v-if="grp.list.length" class="hero-matrix-grid">
            <div
              v-for="c in grp.list"
              :key="c.id"
              class="matrix-hero-tile"
              :class="[
                `${grp.key}-border`,
                { active: selectedChampion?.id === c.id }
              ]"
              :title="`${c.name} · ${c.title}`"
              @click="onSelectChampion(c.id)"
            >
              <img
                class="matrix-hero-avatar"
                :src="c.iconUrl"
                :alt="c.title"
                loading="lazy"
              />
              <div class="matrix-hero-wr" :class="{ hi: (c.stats.winRate ?? 0) >= 0.52 }">
                {{ formatPct(c.stats.winRate) }}
              </div>
              <span
                v-if="myRecordMap[c.id]"
                class="matrix-my-badge"
                :title="`个人实战 ${myRecordMap[c.id].games} 场，胜率 ${formatPct(myRecordMap[c.id].wins / Math.max(myRecordMap[c.id].games, 1))}`"
              >
                ★ {{ formatPct(myRecordMap[c.id].wins / Math.max(myRecordMap[c.id].games, 1)) }}
              </span>
            </div>
          </div>
          <div v-else class="tier-empty-hint">当前筛选下无匹配英雄</div>

          <!-- 窄屏模式下：选中的英雄看板直接就地展开在当前梯队正下方 -->
          <div
            v-if="!isWide && selectedChampion && grp.list.some((c: MayhemChampion) => c.id === selectedChampion?.id)"
            class="inline-inspector-container"
          >
            <div class="inline-fold-bar">
              <span>已展开：{{ selectedChampion.name }} · {{ selectedChampion.title }}</span>
              <button class="btn-fold" @click="selectedId = null">收起看板 ✕</button>
            </div>
            <MayhemMatrixInspector
              :champion-id="selectedChampion.id"
              :refresh-key="clickStamp"
              :my-record="myRecordMap[selectedChampion.id]"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- 右侧：宽屏模式下 Sticky 常驻联动看板 -->
    <aside v-if="isWide" class="matrix-right">
      <div v-if="selectedChampion" class="sticky-inspector">
        <MayhemMatrixInspector
          :champion-id="selectedChampion.id"
          :refresh-key="clickStamp"
          :my-record="myRecordMap[selectedChampion.id]"
        />
      </div>
      <div v-else class="inspector-empty">
        <p>👈 在左侧点击任意英雄头像，即可在此即时查看深度出装、海克斯组合与官方平衡数据</p>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMayhemStore } from '../../features/mayhem/stores/mayhemStore'
import { type MayhemChampion } from '../../features/mayhem/services/mayhemData'
import MayhemMatrixInspector from './MayhemMatrixInspector.vue'

const mayhemStore = useMayhemStore()

const champions = computed(() => mayhemStore.champions)
const myRecords = computed(() => mayhemStore.myChamps)

const ROLE_LABELS: Record<string, string> = {
  assassin: '刺客',
  fighter: '战士',
  mage: '法师',
  marksman: '射手',
  support: '辅助',
  tank: '坦克'
}

const activeRole = ref<string>('all')
const search = ref('')
const selectedId = ref<number | null>(mayhemStore.selectedChampionId || null)
const clickStamp = ref(Date.now())

// 响应式分栏宽度（>= 768px 走宽屏左右分栏，< 768px 走就地内联展开）
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1400)
const isWide = computed(() => windowWidth.value >= 768)

function onResize() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})

// 本人熟练度字典映射
const myRecordMap = computed(() => {
  const map: Record<number, { games: number; wins: number }> = {}
  for (const r of myRecords.value) {
    map[r.championId] = { games: r.games, wins: r.wins }
  }
  return map
})

// 过滤后的英雄列表
const filteredChampions = computed(() => {
  let list = champions.value
  if (activeRole.value !== 'all') {
    list = list.filter((c: MayhemChampion) => c.roles.includes(activeRole.value))
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (c: MayhemChampion) =>
        c.title.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.alias.toLowerCase().includes(q)
    )
  }
  return list
})

// T 级分段矩阵
const tierGroups = computed(() => {
  const op: MayhemChampion[] = []
  const t1: MayhemChampion[] = []
  const t2: MayhemChampion[] = []
  const t3: MayhemChampion[] = []

  for (const c of filteredChampions.value) {
    const wr = c.stats.winRate ?? 0.5
    const tier = c.stats.tier ?? 3
    if (wr >= 0.55 || (tier === 1 && wr >= 0.54)) {
      op.push(c)
    } else if (wr >= 0.52 || tier <= 2) {
      t1.push(c)
    } else if (wr >= 0.5) {
      t2.push(c)
    } else {
      t3.push(c)
    }
  }

  return [
    { key: 'op', label: 'OP 梯队', desc: '版本核心 · 胜率 ≥ 55%', list: op },
    { key: 't1', label: 'T1 梯队', desc: '强势优选 · 胜率 52% ~ 55%', list: t1 },
    { key: 't2', label: 'T2 梯队', desc: '主流优选 · 胜率 50% ~ 52%', list: t2 },
    { key: 't3', label: 'T3 梯队', desc: '考验配合 · 胜率 < 50%', list: t3 }
  ]
})

const selectedChampion = computed(() => {
  if (!selectedId.value) return champions.value[0] ?? null
  return (
    champions.value.find((c: MayhemChampion) => c.id === selectedId.value) ??
    champions.value[0] ??
    null
  )
})

function onSelectChampion(id: number) {
  selectedId.value = id
  mayhemStore.selectedChampionId = id
  clickStamp.value = Date.now()
}

watch(
  () => champions.value.length,
  len => {
    if (len && !selectedId.value) {
      selectedId.value = champions.value[0].id
      clickStamp.value = Date.now()
    }
  },
  { immediate: true }
)

function formatPct(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '--%'
  return (val * 100).toFixed(1) + '%'
}
</script>

<style scoped src="./MayhemMatrixView.styles.css"></style>

