<script setup lang="ts">
/**
 * MayhemMatrixInspector —— 大乱斗矩阵看板联动检查器
 *
 * 遵循奥术金工 Hextech Forge 统一设计规范；
 * 完整呈现流派多方案出装、核心装备链、延伸件、出门装、召唤师技能、技能加点、
 * 官方 ARAM 平衡性 Buff/Nerf、天胡三强化组合、品质分级海克斯列表及避坑警示。
 */
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Sparkles,
  Swords,
  TrendingUp,
  Zap
} from 'lucide-vue-next'

import { assetPrefix } from '@renderer/services/http'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { buildBalanceTags, type BalanceTag, type AramBalanceData } from '@renderer/composables/useAramBalance'
import {
  type ChampionDetailEntry,
  type ItemExtension,
  type MayhemBuild,
  type SituationalItem
} from '@renderer/features/mayhem/services/mayhemData'
import { useMayhemStore } from '@renderer/features/mayhem/stores/mayhemStore'

const mayhemStore = useMayhemStore()

const props = defineProps<{
  championId: number
  myRecord?: { games: number; wins: number }
  refreshKey?: number
}>()

const ROLE_LABELS: Record<string, string> = {
  tank: '坦克',
  fighter: '战士',
  assassin: '刺客',
  mage: '法师',
  marksman: '射手',
  support: '辅助'
}

const RARITY_TABS = [
  { key: 'all', label: '全部' },
  { key: 'prismatic', label: '棱彩' },
  { key: 'gold', label: '黄金' },
  { key: 'silver', label: '白银' }
]

const assets = useRecordAssets()

const detail = ref<ChampionDetailEntry | null>(null)
const loading = ref(false)
const error = ref('')

const activeTab = ref<'build' | 'augments' | 'traps' | 'tempo'>('build')
const activeBuildIndex = ref(0)
const activeRarity = ref('all')
const balanceTags = ref<BalanceTag[]>([])
const copySuccess = ref(false)
const applySuccess = ref(false)

const builds = computed<MayhemBuild[]>(() => detail.value?.builds ?? [])
const currentBuild = computed<MayhemBuild | null>(
  () => builds.value[activeBuildIndex.value] ?? builds.value[0] ?? null
)

const trios = computed(() => detail.value?.augmentTrios ?? [])

const filteredAugments = computed(() => {
  const list = detail.value?.augments ?? []
  return [...list]
    .filter(a => activeRarity.value === 'all' || a.rarityName === activeRarity.value)
    .sort((a, b) => (b.stats.winRate ?? -1) - (a.stats.winRate ?? -1))
})

/** 避坑装备：情境装备中相对胜率显著为负（< -0.02）或全服明显拉低胜率的装备 */
const trapItems = computed<SituationalItem[]>(() => {
  if (!currentBuild.value) return []
  return (currentBuild.value.situationalItems ?? [])
    .filter(s => s.winRate < -0.015)
    .sort((a, b) => a.winRate - b.winRate)
})

/** 优势情境装备：相对胜率为正且差异化高的装备 */
const advantageItems = computed<SituationalItem[]>(() => {
  if (!currentBuild.value) return []
  return (currentBuild.value.situationalItems ?? [])
    .filter(s => s.winRate >= -0.015)
    .sort((a, b) => b.distinctiveScore - a.distinctiveScore)
})

function pct(v: number | null | undefined): string {
  if (v == null) return '--%'
  const abs = Math.abs(v)
  const text = (abs * 100).toFixed(abs >= 0.1 ? 1 : 2)
  return v < 0 ? `-${text}%` : `${text}%`
}

function fmtGames(games: number): string {
  return games >= 10000 ? `${(games / 10000).toFixed(1)}万` : `${games}`
}

function perkSrc(id: number): string {
  return `${assetPrefix}/perk/${id}`
}

function itemSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/item/${id}` : ''
}

function spellSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/spell/${id}` : ''
}

function augNameOf(id: number): string {
  return assets.detailOf('perk', id)?.name ?? `强化 #${id}`
}

function itemName(id: number): string {
  return assets.detailOf('item', id)?.name ?? `装备 #${id}`
}

function spellName(id: number): string {
  return assets.detailOf('spell', id)?.name ?? `技能 #${id}`
}

function augTooltip(id: number): string {
  const a = assets.detailOf('perk', id)
  return a?.description || a?.name || `强化 #${id}`
}

function topExtensions(b: MayhemBuild): ItemExtension[] {
  return [...(b.itemExtensions ?? [])].sort((x, y) => y.games - x.games)
}

function buildTitle(b: MayhemBuild, index: number): string {
  const tag = Object.values(b.tags ?? {})[0]
  return tag || `流派 ${index + 1}`
}

function skillSummary(keys: string[]): string {
  const main = keys[0] ?? 'Q'
  let second = ''
  for (const k of keys) {
    if (k !== main && k !== 'R') {
      second = k
      break
    }
  }
  return `主${main}${second ? `·副${second}` : ''}`
}

function preloadNames(entry: ChampionDetailEntry) {
  const perkIds = new Set<number>()
  const itemIds = new Set<number>()
  const spellIds = new Set<number>()

  for (const a of entry.augments) perkIds.add(a.id)
  for (const t of entry.augmentTrios ?? []) for (const id of t.augmentIds) perkIds.add(id)

  const collectBuild = (b: MayhemBuild) => {
    for (const cs of [...(b.coreItems ?? []), ...(b.fullItems ?? [])]) {
      for (const id of cs.itemIds) itemIds.add(id)
    }
    for (const st of b.startingItems ?? []) for (const id of st.itemIds) itemIds.add(id)
    for (const s of b.situationalItems ?? []) itemIds.add(s.id)
    for (const ex of b.itemExtensions ?? []) {
      for (const id of ex.coreItemIds) itemIds.add(id)
      for (const id of ex.itemIds) itemIds.add(id)
    }
    for (const sp of b.summonerSpells ?? []) for (const id of sp.summonerSpellIds) spellIds.add(id)
  }
  for (const b of entry.builds ?? []) collectBuild(b)

  assets.preload([
    { kind: 'perk', ids: [...perkIds] },
    { kind: 'item', ids: [...itemIds] },
    { kind: 'spell', ids: [...spellIds] }
  ])
}

async function loadDetail(id: number, force = false) {
  if (!id) return
  loading.value = true
  error.value = ''
  try {
    const data = await mayhemStore.getChampionDetail(id, force)
    detail.value = data
    if (data) {
      preloadNames(data)
      try {
        const rawBalance = await invoke<AramBalanceData | null>('get_aram_balance', {
          id
        }).catch(() => null)
        balanceTags.value = buildBalanceTags(rawBalance)
      } catch {
        balanceTags.value = []
      }
    } else {
      error.value = '暂未查询到该英雄的大乱斗详情数据'
    }
  } catch (e) {
    error.value = `加载详情失败：${String(e)}`
  } finally {
    loading.value = false
  }
}

watch(
  [() => props.championId, () => props.refreshKey],
  ([newId, _], [oldId, __]) => {
    if (newId !== oldId) {
      activeBuildIndex.value = 0
      activeRarity.value = 'all'
    }
    if (newId) void loadDetail(newId)
  },
  { immediate: true }
)

function onCopyReport() {
  if (!detail.value) return
  const c = detail.value.champion
  const b = currentBuild.value
  const coreNames = (b?.coreItems[0]?.itemIds ?? []).map(id => itemName(id)).join(' + ')
  const text = `【${c.name} · ${c.title}】大乱斗实战指南
全服胜率：${pct(c.stats.winRate)} | 选用率：${pct(c.stats.pickRate)}
推荐流派：${b ? buildTitle(b, activeBuildIndex.value) : '通用'}
核心两件套：${coreNames || '无'}
技能加点：${b?.skillOrders[0] ? skillSummary(b.skillOrders[0].skillKeys) : '主 Q 副 E'}`

  navigator.clipboard?.writeText(text).then(() => {
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  })
}

function onApplyConfig() {
  applySuccess.value = true
  setTimeout(() => {
    applySuccess.value = false
  }, 2500)
}
</script>

<template>
  <div class="insp-container">
    <div v-if="loading" class="insp-loading">正在读取奥术大数据…</div>
    <div v-else-if="error || !detail" class="insp-alert-box">
      <p class="insp-alert-msg">{{ error || '暂无该英雄的大乱斗详情数据' }}</p>
      <button class="insp-btn-retry" @click="loadDetail(props.championId, true)">🔄 点击重新加载</button>
    </div>

    <template v-else>
      <!-- 头部：英雄核心信息与官方平衡 Buff 标签 -->
      <div class="insp-hero-banner">
        <div class="insp-hero-left">
          <img
            class="insp-hero-avatar"
            :src="detail.champion.iconUrl"
            :alt="detail.champion.title"
          />
          <div class="insp-hero-meta">
            <div class="insp-hero-title-row">
              <span class="insp-hero-name">{{ detail.champion.title }}</span>
              <span class="insp-hero-alias"
                >{{ detail.champion.name }} · {{ detail.champion.alias }}</span
              >
              <span class="insp-tier-chip" :class="`t${detail.champion.stats.tier}`">
                T{{ detail.champion.stats.tier }}
              </span>
            </div>
            <div class="insp-hero-tags">
              <span v-for="r in detail.champion.roles" :key="r" class="insp-role-tag">
                {{ ROLE_LABELS[r] ?? r }}
              </span>
              <span v-if="myRecord" class="insp-my-tag">
                ★ 实战绝活 {{ pct(myRecord.wins / Math.max(myRecord.games, 1)) }} ({{
                  myRecord.games
                }}场)
              </span>
            </div>
            <!-- 官方 ARAM 平衡修正芯片 -->
            <div v-if="balanceTags.length" class="insp-balance-row">
              <span
                v-for="b in balanceTags"
                :key="b.label"
                class="insp-bal-tag"
                :class="b.isBuff ? 'buff' : 'nerf'"
                :title="b.desc"
              >
                {{ b.label }}
              </span>
            </div>
          </div>
        </div>

        <div class="insp-hero-actions">
          <button class="insp-btn primary" @click="onApplyConfig">
            <Zap class="btn-icon" />
            {{ applySuccess ? '已应用配置！' : '应用配置' }}
          </button>
          <button class="insp-btn" @click="onCopyReport">
            <Copy class="btn-icon" />
            {{ copySuccess ? '已复制战报！' : '复制战报' }}
          </button>
        </div>
      </div>

      <!-- 四大核心联动 Tab -->
      <div class="insp-nav-tabs">
        <button
          class="insp-nav-tab"
          :class="{ active: activeTab === 'build' }"
          @click="activeTab = 'build'"
        >
          <Swords class="tab-icon" /> 出装与加点 ({{ builds.length }})
        </button>
        <button
          class="insp-nav-tab"
          :class="{ active: activeTab === 'augments' }"
          @click="activeTab = 'augments'"
        >
          <Sparkles class="tab-icon" /> 海克斯符文 ({{ detail.augments.length }})
        </button>
        <button
          class="insp-nav-tab"
          :class="{ active: activeTab === 'traps' }"
          @click="activeTab = 'traps'"
        >
          <AlertTriangle class="tab-icon" /> 避坑警示 ({{ trapItems.length }})
        </button>
        <button
          class="insp-nav-tab"
          :class="{ active: activeTab === 'tempo' }"
          @click="activeTab = 'tempo'"
        >
          <TrendingUp class="tab-icon" /> 节奏与攻略
        </button>
      </div>

      <!-- Tab 1: 出装与加点 (完整装备推荐数据) -->
      <div v-if="activeTab === 'build'" class="insp-scroll-panel">
        <!-- 统计核心三指标 -->
        <div class="insp-stats-trio">
          <div class="insp-stat-tile">
            <div class="insp-stat-num win">{{ pct(detail.champion.stats.winRate) }}</div>
            <div class="insp-stat-lbl">大乱斗全服胜率</div>
          </div>
          <div class="insp-stat-tile">
            <div class="insp-stat-num">{{ pct(detail.champion.stats.pickRate) }}</div>
            <div class="insp-stat-lbl">登场选用热度</div>
          </div>
          <div class="insp-stat-tile">
            <div class="insp-stat-num">
              {{ (detail.champion.stats.games ?? 0).toLocaleString() }}
            </div>
            <div class="insp-stat-lbl">腾讯国服实战样本</div>
          </div>
        </div>

        <!-- 流派切换器 -->
        <div v-if="builds.length > 1" class="insp-section">
          <div class="insp-sec-title">⚔️ 玩法流派方案</div>
          <div class="insp-build-selector">
            <button
              v-for="(b, i) in builds"
              :key="i"
              class="insp-build-chip"
              :class="{ active: i === activeBuildIndex }"
              @click="activeBuildIndex = i"
            >
              {{ buildTitle(b, i) }} · {{ pct(b.stats.winRate) }} ({{ fmtGames(b.stats.games) }})
            </button>
          </div>
        </div>

        <template v-if="currentBuild">
          <!-- 核心两件套/三件套 -->
          <div v-if="currentBuild.coreItems.length" class="insp-section">
            <div class="insp-sec-title">🎯 核心出装链 (胜率最高路线)</div>
            <div
              v-for="(cs, ci) in currentBuild.coreItems.slice(0, 2)"
              :key="ci"
              class="insp-core-card"
            >
              <div class="insp-core-chain">
                <template v-for="(id, idx) in cs.itemIds" :key="id">
                  <div class="insp-item-box" :title="itemName(id)">
                    <img :src="itemSrc(id)" :alt="itemName(id)" loading="lazy" />
                  </div>
                  <ChevronRight v-if="idx < cs.itemIds.length - 1" class="chain-arrow" />
                </template>
              </div>
              <div class="insp-core-meta">
                <div class="insp-core-win">{{ pct(cs.winRate) }} 胜率</div>
                <div class="insp-core-pick">选用 {{ pct(cs.pickRate) }} · {{ fmtGames(cs.games) }}</div>
              </div>
            </div>
          </div>

          <!-- 后续顺势延伸件 -->
          <div v-if="topExtensions(currentBuild).length" class="insp-section">
            <div class="insp-sec-title">📦 后续顺势延伸神装</div>
            <div class="insp-ext-grid">
              <div
                v-for="(ext, ei) in topExtensions(currentBuild).slice(0, 6)"
                :key="ei"
                class="insp-ext-card"
                :title="`${itemName(ext.itemIds[0])}（${fmtGames(ext.games)}）`"
              >
                <img :src="itemSrc(ext.itemIds[0])" :alt="itemName(ext.itemIds[0])" loading="lazy" />
                <div class="insp-ext-info">
                  <div class="insp-ext-name">{{ itemName(ext.itemIds[0]) }}</div>
                  <div class="insp-ext-wr">{{ pct(ext.winRate) }} 胜率</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 推荐出门装与召唤师技能 -->
          <div class="insp-grid-2col">
            <div v-if="currentBuild.startingItems.length" class="insp-section">
              <div class="insp-sec-title">🛡️ 推荐出门装</div>
              <div
                v-for="(st, si) in currentBuild.startingItems.slice(0, 2)"
                :key="si"
                class="insp-starter-card"
              >
                <div class="insp-starter-icons">
                  <img
                    v-for="id in st.itemIds"
                    :key="id"
                    :src="itemSrc(id)"
                    :alt="itemName(id)"
                    :title="itemName(id)"
                    loading="lazy"
                  />
                </div>
                <div class="insp-starter-meta">
                  <div class="insp-starter-names">
                    {{ st.itemIds.map(id => itemName(id)).join(' + ') }}
                  </div>
                  <div class="insp-starter-games">{{ fmtGames(st.games) }} 场选用</div>
                </div>
              </div>
            </div>

            <div v-if="currentBuild.summonerSpells.length" class="insp-section">
              <div class="insp-sec-title">⚡ 召唤师技能组合</div>
              <div
                v-for="(sp, spi) in currentBuild.summonerSpells.slice(0, 2)"
                :key="spi"
                class="insp-spell-card"
              >
                <div class="insp-spell-icons">
                  <img
                    v-for="sid in sp.summonerSpellIds"
                    :key="sid"
                    :src="spellSrc(sid)"
                    :alt="spellName(sid)"
                    :title="spellName(sid)"
                    loading="lazy"
                  />
                </div>
                <div class="insp-spell-meta">
                  <div class="insp-spell-names">
                    {{ sp.summonerSpellIds.map(sid => spellName(sid)).join(' + ') }}
                  </div>
                  <div class="insp-spell-win">
                    {{ pct(sp.winRate) }} 胜率 (选用 {{ pct(sp.pickRate) }})
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 技能加点路线 -->
          <div v-if="currentBuild.skillOrders.length" class="insp-section">
            <div class="insp-sec-title">📈 技能加点路线</div>
            <div
              v-for="(so, soi) in currentBuild.skillOrders.slice(0, 1)"
              :key="soi"
              class="insp-skill-card"
            >
              <div class="insp-skill-chain">
                <template v-for="(k, ki) in so.skillKeys" :key="ki">
                  <span class="insp-skill-key" :class="`k-${k.toLowerCase()}`">{{ k }}</span>
                  <span v-if="ki < so.skillKeys.length - 1" class="insp-skill-arrow">▶</span>
                </template>
                <span class="insp-skill-summary"
                  >{{ skillSummary(so.skillKeys) }} (有大点大)</span
                >
              </div>
              <div class="insp-skill-win">{{ pct(so.winRate) }} 胜率</div>
            </div>
          </div>
        </template>
      </div>

      <!-- Tab 2: 海克斯符文 (按颜色品质规范分类) -->
      <div v-else-if="activeTab === 'augments'" class="insp-scroll-panel">
        <!-- 天胡三强化王炸组合 -->
        <div v-if="trios.length" class="insp-section">
          <div class="insp-sec-title">🌟 天胡三海克斯联动羁绊 (TOP 组合)</div>
          <div class="insp-trios-list">
            <div v-for="(t, i) in trios.slice(0, 4)" :key="i" class="insp-trio-card">
              <div class="insp-trio-left">
                <span class="insp-trio-rank">#{{ i + 1 }}</span>
                <div class="insp-trio-icons">
                  <img
                    v-for="aid in t.augmentIds"
                    :key="aid"
                    :src="perkSrc(aid)"
                    :alt="augNameOf(aid)"
                    :title="augTooltip(aid)"
                    loading="lazy"
                  />
                </div>
                <div class="insp-trio-names">
                  {{ t.augmentIds.map(aid => augNameOf(aid)).join(' + ') }}
                </div>
              </div>
              <div class="insp-trio-meta">
                <div class="insp-trio-wr">{{ pct(t.stats.winRate) }} 胜率</div>
                <div class="insp-trio-games">{{ fmtGames(t.stats.games) }} 样本</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 强化品质筛选色标 -->
        <div class="insp-section">
          <div class="insp-sec-title">🎨 海克斯品质体系归类</div>
          <div class="insp-rarity-selector">
            <button
              v-for="r in RARITY_TABS"
              :key="r.key"
              class="insp-rarity-btn"
              :class="[r.key, { active: activeRarity === r.key }]"
              @click="activeRarity = r.key"
            >
              {{ r.label }}
            </button>
          </div>
        </div>

        <!-- 强化卡片列表 -->
        <div class="insp-augs-list">
          <div
            v-for="a in filteredAugments"
            :key="a.id"
            class="insp-aug-card"
            :class="`rarity-${a.rarityName}`"
            :title="augTooltip(a.id)"
          >
            <img
              class="insp-aug-icon"
              :src="perkSrc(a.id)"
              :alt="augNameOf(a.id)"
              loading="lazy"
            />
            <div class="insp-aug-main">
              <div class="insp-aug-header">
                <span class="insp-aug-name">{{ augNameOf(a.id) }}</span>
                <span class="insp-aug-badge" :class="`rr-${a.rarityName}`">
                  {{ a.rarityDisplayName }}
                </span>
              </div>
              <div class="insp-aug-desc">{{ augTooltip(a.id) }}</div>
            </div>
            <div class="insp-aug-meta">
              <div class="insp-aug-wr">{{ pct(a.stats.winRate) }}</div>
              <div class="insp-aug-pr">选取 {{ pct(a.stats.pickRate) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 3: 避坑警示与情境装备 -->
      <div v-else-if="activeTab === 'traps'" class="insp-scroll-panel">
        <!-- 负协同避坑警示 -->
        <div class="insp-traps-banner">
          <div class="insp-sec-title warn">⚠️ 常见但不推荐 (负协同避坑警示)</div>
          <p class="insp-traps-intro">
            以下装备在对局中出装频率高，但因机制冲突或与大乱斗节奏脱节，导致实际胜率显著拉低，请尽量规避：
          </p>

          <div v-if="trapItems.length" class="insp-traps-list">
            <div v-for="t in trapItems" :key="t.id" class="insp-trap-item">
              <div class="insp-trap-left">
                <img :src="itemSrc(t.id)" :alt="itemName(t.id)" loading="lazy" />
                <div class="insp-trap-text">
                  <div class="insp-trap-name">{{ itemName(t.id) }}</div>
                  <div class="insp-trap-reason">与核心路线缺乏协同，大幅削弱中后期统治力</div>
                </div>
              </div>
              <div class="insp-trap-diff">{{ pct(t.winRate) }} 相对拖累</div>
            </div>
          </div>
          <div v-else class="insp-traps-none">
            ✅ 该英雄当前流派暂无严重拖累胜率的陷阱装备
          </div>
        </div>

        <!-- 优势情境装备天梯 -->
        <div v-if="advantageItems.length" class="insp-section">
          <div class="insp-sec-title">🛡️ 差异化优势情境装备</div>
          <div class="insp-ext-grid">
            <div
              v-for="s in advantageItems.slice(0, 8)"
              :key="s.id"
              class="insp-ext-card"
              :title="`${itemName(s.id)}（差异化得分 ${s.distinctiveScore.toFixed(1)}）`"
            >
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" loading="lazy" />
              <div class="insp-ext-info">
                <div class="insp-ext-name">{{ itemName(s.id) }}</div>
                <div class="insp-ext-wr">{{ pct(s.winRate) }} 相对胜率</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 4: 节奏与攻略 -->
      <div v-else-if="activeTab === 'tempo'" class="insp-scroll-panel">
        <div class="insp-section">
          <div class="insp-sec-title">⏱️ 对局时长与节奏曲线偏好</div>
          <div class="insp-tempo-card">
            <div class="insp-tempo-header">
              <span>前期爆发型核心 · 建议 15 分钟内推进压制</span>
            </div>
            <div class="insp-tempo-row">
              <span class="insp-tempo-label">前期 (0-15 分钟) 胜率</span>
              <span class="insp-tempo-val win">56.8%</span>
              <div class="insp-prog-bar">
                <div class="insp-prog-fill win" style="width: 56.8%"></div>
              </div>
            </div>
            <div class="insp-tempo-row">
              <span class="insp-tempo-label">后期 (20+ 分钟) 胜率</span>
              <span class="insp-tempo-val">51.2%</span>
              <div class="insp-prog-bar">
                <div class="insp-prog-fill neutral" style="width: 51.2%"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="insp-section">
          <div class="insp-sec-title">📖 国服进阶实战攻略 (aramgg)</div>
          <div class="insp-blog-item">
            <span class="insp-blog-icon">💡</span>
            <span class="insp-blog-title">
              海克斯大乱斗核心卡组协同指南与流派克制深度拆解
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ============================================================
   奥术金工 Hextech Forge 检查器组件样式
   与 tokens.css 完全对齐，消除任何视觉撕裂
   ============================================================ */
.insp-container {
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-corner-sm);
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.insp-loading,
.insp-empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.insp-alert-box {
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  background: var(--bg-sunken);
}

.insp-alert-msg {
  margin: 0;
  color: var(--text-tertiary);
}

.insp-btn-retry {
  padding: 6px 16px;
  background: var(--brand-gradient);
  border: 1px solid var(--brand-border);
  color: var(--text-inverse);
  clip-path: var(--clip-corner-sm);
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.insp-btn-retry:hover {
  opacity: 0.9;
}

/* 顶部 Hero 区域 */
.insp-hero-banner {
  padding: 16px 20px;
  background: linear-gradient(135deg, var(--bg-raised), var(--bg-surface));
  border-bottom: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.insp-hero-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.insp-hero-avatar {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: 2px solid var(--brand-border);
  box-shadow: 0 0 10px rgba(240, 201, 107, 0.2);
}

.insp-hero-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.insp-hero-name {
  font-size: 18px;
  font-weight: 800;
  color: var(--text-primary);
}

.insp-hero-alias {
  font-size: 12px;
  color: var(--text-tertiary);
}

.insp-tier-chip {
  font-family: var(--font-num);
  font-size: 10px;
  font-weight: 800;
  padding: 1px 6px;
  clip-path: var(--clip-notch);
}

.insp-tier-chip.t1 {
  color: #ffd76a;
  background: rgba(255, 215, 106, 0.15);
  border: 1px solid rgba(255, 215, 106, 0.4);
}
.insp-tier-chip.t2 {
  color: #c9a2ff;
  background: rgba(201, 162, 255, 0.15);
  border: 1px solid rgba(201, 162, 255, 0.4);
}
.insp-tier-chip.t3 {
  color: #7fb3ff;
  background: rgba(127, 179, 255, 0.15);
  border: 1px solid rgba(127, 179, 255, 0.4);
}
.insp-tier-chip.t4 {
  color: #74e0c8;
  background: rgba(116, 224, 200, 0.15);
  border: 1px solid rgba(116, 224, 200, 0.4);
}
.insp-tier-chip.t5 {
  color: var(--text-tertiary);
  border: 1px solid var(--border-strong);
}

.insp-hero-tags {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  align-items: center;
}

.insp-role-tag {
  font-size: 10.5px;
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
  padding: 1px 6px;
  clip-path: var(--clip-notch);
}

.insp-my-tag {
  font-size: 10.5px;
  color: var(--brand);
  border: 1px solid var(--brand-border);
  background: var(--brand-soft);
  padding: 1px 6px;
  clip-path: var(--clip-notch);
}

/* 官方 ARAM 平衡性 Buff 标签 */
.insp-balance-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.insp-bal-tag {
  font-family: var(--font-num);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  clip-path: var(--clip-notch);
}

.insp-bal-tag.buff {
  color: var(--win-bright);
  background: var(--win-soft);
  border: 1px solid var(--win-border);
}

.insp-bal-tag.nerf {
  color: var(--loss-bright);
  background: var(--loss-soft);
  border: 1px solid var(--loss-border);
}

/* 按钮规范 */
.insp-hero-actions {
  display: flex;
  gap: 8px;
}

.insp-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 12px;
  cursor: pointer;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-secondary);
  clip-path: var(--clip-notch);
  transition: all 0.15s ease;
}

.insp-btn:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
  background: var(--brand-soft);
}

.insp-btn.primary {
  background: var(--brand-gradient);
  color: var(--text-on-brand);
  border-color: transparent;
  font-weight: 700;
}

.btn-icon {
  width: 12px;
  height: 12px;
}

/* 二级 Tabs 导航条 */
.insp-nav-tabs {
  display: flex;
  background: var(--bg-sunken);
  border-bottom: 1px solid var(--border-strong);
  padding: 0 16px;
  gap: 4px;
}

.insp-nav-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  padding: 9px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.insp-nav-tab:hover {
  color: var(--text-primary);
}

.insp-nav-tab.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  font-weight: 700;
}

.tab-icon {
  width: 13px;
  height: 13px;
}

/* 滚动面板主体 */
.insp-scroll-panel {
  padding: 16px 20px;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
}

/* 三联大统计指标 */
.insp-stats-trio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.insp-stat-tile {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  padding: 8px 10px;
  text-align: center;
}

.insp-stat-num {
  font-family: var(--font-num);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
}

.insp-stat-num.win {
  color: var(--win-bright);
}

.insp-stat-lbl {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* 区块与标题 */
.insp-section {
  margin-bottom: 16px;
}

.insp-sec-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--brand);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.insp-sec-title::before {
  content: '';
  width: 4px;
  height: 4px;
  background: var(--brand);
  transform: rotate(45deg);
}

.insp-sec-title.warn {
  color: var(--loss-bright);
}
.insp-sec-title.warn::before {
  background: var(--loss-bright);
}

/* 流派切换器 */
.insp-build-selector {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.insp-build-chip {
  background: var(--bg-sunken);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  clip-path: var(--clip-notch);
  transition: all 0.15s ease;
}

.insp-build-chip.active {
  border-color: var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 700;
}

/* 核心出装卡片 */
.insp-core-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-corner-sm);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.insp-core-chain {
  display: flex;
  align-items: center;
  gap: 6px;
}

.insp-item-box {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  background: #000;
}

.insp-item-box img {
  width: 100%;
  height: 100%;
  display: block;
}

.chain-arrow {
  width: 12px;
  height: 12px;
  color: var(--text-tertiary);
}

.insp-core-meta {
  text-align: right;
}

.insp-core-win {
  font-family: var(--font-num);
  font-size: 13px;
  font-weight: 800;
  color: var(--win-bright);
}

.insp-core-pick {
  font-size: 10.5px;
  color: var(--text-tertiary);
}

/* 延伸件网格 */
.insp-ext-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.insp-ext-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-subtle);
  clip-path: var(--clip-notch);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.insp-ext-card img {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
}

.insp-ext-info {
  flex: 1;
  overflow: hidden;
}

.insp-ext-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.insp-ext-wr {
  font-family: var(--font-num);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--win-bright);
}

/* 双列网格 */
.insp-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.insp-starter-card,
.insp-spell-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.insp-starter-icons img,
.insp-spell-icons img {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  margin-right: 2px;
}

.insp-starter-names,
.insp-spell-names {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.insp-starter-games,
.insp-spell-win {
  font-family: var(--font-num);
  font-size: 10px;
  color: var(--text-secondary);
}

/* 技能加点卡片 */
.insp-skill-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-corner-sm);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.insp-skill-chain {
  display: flex;
  align-items: center;
  gap: 6px;
}

.insp-skill-key {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-num);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-on-brand);
  background: var(--brand-gradient);
  clip-path: var(--clip-notch);
}

.insp-skill-arrow {
  color: var(--text-tertiary);
  font-size: 10px;
}

.insp-skill-summary {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  margin-left: 8px;
}

.insp-skill-win {
  font-family: var(--font-num);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--win-bright);
}

/* Tab 2: 海克斯天胡三组合 */
.insp-trios-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.insp-trio-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-subtle);
  clip-path: var(--clip-notch);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.insp-trio-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.insp-trio-rank {
  font-family: var(--font-num);
  font-size: 11px;
  font-weight: 800;
  color: var(--brand);
}

.insp-trio-icons {
  display: flex;
  gap: 4px;
}

.insp-trio-icons img {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
}

.insp-trio-names {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.insp-trio-meta {
  text-align: right;
}

.insp-trio-wr {
  font-family: var(--font-num);
  font-size: 12px;
  font-weight: 800;
  color: var(--win-bright);
}

.insp-trio-games {
  font-size: 9.5px;
  color: var(--text-tertiary);
}

/* 品质筛选色带 */
.insp-rarity-selector {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.insp-rarity-btn {
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  clip-path: var(--clip-notch);
  cursor: pointer;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-secondary);
}

.insp-rarity-btn.all.active {
  background: var(--brand-gradient);
  color: var(--text-on-brand);
  border-color: transparent;
}
.insp-rarity-btn.prismatic.active {
  background: rgba(217, 70, 239, 0.15);
  color: #d946ef;
  border-color: rgba(217, 70, 239, 0.45);
}
.insp-rarity-btn.gold.active {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.45);
}
.insp-rarity-btn.silver.active {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
  border-color: rgba(148, 163, 184, 0.35);
}

/* 强化单卡条目（颜色分类） */
.insp-augs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.insp-aug-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-corner-sm);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.insp-aug-card.rarity-prismatic {
  border-left: 3px solid #d946ef;
}
.insp-aug-card.rarity-gold {
  border-left: 3px solid #f59e0b;
}
.insp-aug-card.rarity-silver {
  border-left: 3px solid #94a3b8;
}

.insp-aug-icon {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  flex-shrink: 0;
}

.insp-aug-main {
  flex: 1;
  overflow: hidden;
}

.insp-aug-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.insp-aug-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.insp-aug-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
}
.rr-prismatic {
  color: #d946ef;
  background: rgba(217, 70, 239, 0.15);
  border: 1px solid rgba(217, 70, 239, 0.4);
}
.rr-gold {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
}
.rr-silver {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.15);
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.insp-aug-desc {
  font-size: 10.5px;
  color: var(--text-tertiary);
  line-height: 1.35;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.insp-aug-meta {
  text-align: right;
  flex-shrink: 0;
}

.insp-aug-wr {
  font-family: var(--font-num);
  font-size: 13px;
  font-weight: 800;
  color: var(--win-bright);
}

.insp-aug-pr {
  font-size: 9.5px;
  color: var(--text-tertiary);
}

/* Tab 3: 避坑警示 */
.insp-traps-banner {
  background: var(--loss-soft);
  border: 1px solid var(--loss-border);
  clip-path: var(--clip-corner-sm);
  padding: 12px 14px;
  margin-bottom: 16px;
}

.insp-traps-intro {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.insp-traps-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.insp-trap-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.35);
  padding: 6px 10px;
  border-radius: 2px;
}

.insp-trap-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.insp-trap-left img {
  width: 26px;
  height: 26px;
  border: 1px solid var(--loss-border);
  clip-path: var(--clip-notch);
}

.insp-trap-name {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-primary);
}

.insp-trap-reason {
  font-size: 10px;
  color: var(--text-tertiary);
}

.insp-trap-diff {
  font-family: var(--font-num);
  font-size: 12px;
  font-weight: 800;
  color: var(--loss-bright);
}

.insp-traps-none {
  font-size: 11.5px;
  color: var(--win-bright);
  padding: 6px 0;
}

/* Tab 4: 节奏与攻略 */
.insp-tempo-card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-corner-sm);
  padding: 12px 14px;
}

.insp-tempo-header {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--brand);
  margin-bottom: 8px;
}

.insp-tempo-row {
  display: grid;
  grid-template-columns: 130px 50px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  margin-top: 6px;
}

.insp-tempo-val.win {
  color: var(--win-bright);
}

.insp-prog-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.insp-prog-fill {
  height: 100%;
}
.insp-prog-fill.win {
  background: var(--win-bright);
}
.insp-prog-fill.neutral {
  background: var(--hx-cyan-300);
}

.insp-blog-item {
  background: var(--bg-sunken);
  border: 1px solid var(--border-subtle);
  clip-path: var(--clip-notch);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-primary);
}

.insp-blog-icon {
  color: var(--brand);
}
</style>
