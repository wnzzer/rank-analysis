<template>
  <div class="mdetail">
    <PageStage kicker="MAYHEM · 大乱斗详情" :title="heroTitle" :sub="heroSub" compact>
      <template #actions>
        <button class="btn gho sm" @click="goBack">返回榜单</button>
      </template>
    </PageStage>

    <div class="d-body">
      <div v-if="error" class="m-alert">{{ error }}</div>
      <div v-if="loading" class="m-empty">正在加载…</div>
      <div v-else-if="!detail" class="m-empty">
        暂无该英雄的大乱斗数据（可能尚未同步或上游未覆盖）
      </div>

      <template v-else>
        <!-- 概要 -->
        <section class="d-hero">
          <img class="d-ava" :src="detail.champion.iconUrl" :alt="detail.champion.title" />
          <div class="d-heromain">
            <div class="d-nameline">
              <span class="ctier" :class="`t${tier}`">T{{ tier }}</span>
              <span class="d-name">{{ detail.champion.title }}</span>
              <span class="d-subname"
                >{{ detail.champion.name }} · {{ detail.champion.alias }}</span
              >
            </div>
            <div class="d-statsrow">
              <span><em>胜率</em>{{ pct(heroWinRate) }}</span>
              <span><em>选取率</em>{{ pct(detail.champion.stats.pickRate) }}</span>
              <span v-if="dateText"><em>数据日期</em>{{ dateText }}</span>
            </div>
            <div class="d-rolerow">
              <i v-for="role in detail.champion.roles" :key="role">{{ roleLabel(role) }}</i>
            </div>
            <div v-if="balanceTags.length" class="d-balrow">
              <span
                v-for="t in balanceTags"
                :key="t.label"
                class="dbal"
                :class="t.isBuff ? 'buff' : 'nerf'"
                :title="t.desc"
              >
                {{ t.label }}
              </span>
            </div>
          </div>
        </section>

        <!-- 推荐强化 -->
        <section class="d-sec">
          <div class="d-sechead">
            <h3>推荐强化</h3>
            <div class="m-roles">
              <button
                v-for="r in RARITY_OPTIONS"
                :key="r.key"
                class="chip"
                :class="{ 'chip--on': activeRarity === r.key }"
                @click="activeRarity = r.key"
              >
                {{ r.label }}
              </button>
            </div>
          </div>
          <p class="d-hint">
            胜率为 aramgg 客户端自采口径（全球，≥{{ minGamesText }}
            场才展示）；选取率为腾讯国服口径。
          </p>
          <div v-if="!filteredAugments.length" class="m-empty">没有符合条件的强化</div>
          <div v-else class="d-augs">
            <div v-for="a in filteredAugments" :key="a.id" class="daug" :title="augTooltip(a.id)">
              <img
                :src="perkSrc(a.id)"
                :alt="augNameOf(a.id)"
                loading="lazy"
                @error="fallbackIcon($event, a.iconUrl)"
              />
              <span class="daug__name">{{ augNameOf(a.id) }}</span>
              <span class="ararity" :class="`rr-${a.rarityName}`">{{ a.rarityDisplayName }}</span>
              <span class="daug__wr">{{ pct(a.stats.winRate) }}</span>
              <span class="daug__pr">选取 {{ pct(a.stats.pickRate) }}</span>
            </div>
          </div>
        </section>

        <!-- 强化组合 TOP -->
        <section v-if="trios.length" class="d-sec">
          <h3>强化组合 TOP {{ Math.min(trios.length, 5) }}</h3>
          <div class="d-trios">
            <div v-for="(t, i) in trios.slice(0, 5)" :key="i" class="dtrio">
              <span class="dtrio__rank">#{{ i + 1 }}</span>
              <img
                v-for="aid in t.augmentIds"
                :key="aid"
                :src="perkSrc(aid)"
                :alt="augNameOf(aid)"
                :title="augNameOf(aid)"
                loading="lazy"
                @error="hideIcon($event)"
              />
              <span class="dtrio__wr">{{ pct(t.stats.winRate) }}</span>
              <span class="dtrio__g">{{ fmtGames(t.stats.games) }}</span>
            </div>
          </div>
        </section>

        <!-- 出装与加点（按流派） -->
        <section v-for="(b, i) in builds" :key="i" class="d-sec">
          <h3>{{ buildTitle(b, i) }}</h3>
          <p class="d-hint">
            场次 {{ fmtGames(b.stats.games) }} · 胜率 {{ pct(b.stats.winRate) }}
            <template v-if="b.stats.pickRate != null">
              · 流派选取率 {{ pct(b.stats.pickRate) }}</template
            >
          </p>

          <div v-if="b.coreItems.length" class="d-rowgroup">
            <span class="d-label">核心装备</span>
            <div class="d-corelist">
              <div v-for="(cs, ci) in b.coreItems.slice(0, 3)" :key="ci" class="d-coreset">
                <img
                  v-for="iid in cs.itemIds"
                  :key="iid"
                  :src="itemSrc(iid)"
                  :alt="itemName(iid)"
                  :title="`${itemName(iid)}（${fmtGames(cs.games)}）`"
                  loading="lazy"
                />
                <span class="d-coremata"
                  >{{ pct(cs.winRate) }} · 选取 {{ pct(cs.pickRate ?? null) }}</span
                >
              </div>
            </div>
          </div>

          <div v-if="b.startingItems.length" class="d-rowgroup">
            <span class="d-label">出门装</span>
            <div class="d-starters">
              <span v-for="(st, si) in b.startingItems.slice(0, 3)" :key="si" class="d-starter">
                <img
                  v-for="iid in st.itemIds"
                  :key="iid"
                  :src="itemSrc(iid)"
                  :alt="itemName(iid)"
                  :title="itemName(iid)"
                  loading="lazy"
                />
                <em>{{ fmtGames(st.games) }}</em>
              </span>
            </div>
          </div>

          <div v-if="situationals(b).length" class="d-rowgroup">
            <span class="d-label">情境装备</span>
            <div class="d-sits">
              <img
                v-for="s in situationals(b).slice(0, 12)"
                :key="s.id"
                :src="itemSrc(s.id)"
                :alt="itemName(s.id)"
                :title="`${itemName(s.id)}（差异化分 ${s.distinctiveScore.toFixed(1)}）`"
                loading="lazy"
              />
            </div>
          </div>

          <div v-if="b.summonerSpells.length" class="d-rowgroup">
            <span class="d-label">召唤师技能</span>
            <div class="d-spells">
              <span v-for="(sp, spi) in b.summonerSpells.slice(0, 3)" :key="spi" class="d-spell">
                <img
                  v-for="sid in sp.summonerSpellIds"
                  :key="sid"
                  :src="spellSrc(sid)"
                  :alt="spellName(sid)"
                  :title="spellName(sid)"
                  loading="lazy"
                />
                <em>{{ pct(sp.pickRate) }} / {{ pct(sp.winRate) }}</em>
              </span>
            </div>
          </div>

          <div v-if="b.skillOrders.length" class="d-rowgroup">
            <span class="d-label">技能加点</span>
            <div class="d-skills">
              <div v-for="(so, soi) in b.skillOrders.slice(0, 2)" :key="soi" class="d-skillline">
                <span class="d-sksum">{{ skillSummary(so.skillKeys) }}</span>
                <span class="skillbar">
                  <i v-for="(k, ki) in so.skillKeys" :key="ki" :class="`k-${k.toLowerCase()}`">{{
                    k
                  }}</i>
                </span>
                <span class="d-skmeta">{{ pct(so.pickRate) }} / {{ pct(so.winRate) }}</span>
              </div>
            </div>
          </div>

          <div v-if="topExtensions(b).length" class="d-rowgroup">
            <span class="d-label">延伸件（下一件）</span>
            <div class="d-exts">
              <span v-for="(ex, ei) in topExtensions(b).slice(0, 6)" :key="ei" class="d-ext">
                <img
                  v-for="cid2 in ex.coreItemIds"
                  :key="'c' + cid2"
                  :src="itemSrc(cid2)"
                  :alt="itemName(cid2)"
                  :title="itemName(cid2)"
                  loading="lazy"
                />
                <em>→</em>
                <img
                  v-for="xid in ex.itemIds"
                  :key="'x' + xid"
                  :src="itemSrc(xid)"
                  :alt="itemName(xid)"
                  :title="itemName(xid)"
                  loading="lazy"
                />
                <em>{{ pct(ex.winRate) }}</em>
              </span>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * MayhemChampionDetail —— 大乱斗英雄详情子页（feature-expansion-plan A1 Tab3）
 * 数据：champion-shards 单英雄条目（推荐强化/TOP组合/多流派出装/召唤师技能/加点/延伸件）。
 * 图标走本地资产协议；名称用 get_asset_details 预载，失败回退远端 CDN / id 占位。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PageStage from '../components/ui/PageStage.vue'
import { invoke } from '@tauri-apps/api/core'
import { assetPrefix } from '../services/http'
import { useRecordAssets } from '../composables/useRecordAssets'
import {
  buildBalanceTags,
  type AramBalanceData,
  type BalanceTag
} from '../composables/useAramBalance'
import {
  getMayhemChampionDetail,
  type ChampionDetailEntry,
  type ItemExtension,
  type MayhemBuild,
  type SituationalItem
} from '../features/mayhem/services/mayhemData'

const ROLE_LABELS: Record<string, string> = {
  tank: '坦克',
  fighter: '战士',
  assassin: '刺客',
  mage: '法师',
  marksman: '射手',
  support: '辅助'
}

const RARITY_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'prismatic', label: '棱彩' },
  { key: 'gold', label: '黄金' },
  { key: 'silver', label: '白银' }
]

const route = useRoute()
const router = useRouter()
const assets = useRecordAssets()

const detail = ref<ChampionDetailEntry | null>(null)
const loading = ref(false)
const error = ref('')
const activeRarity = ref('all')
/** 大乱斗平衡参数（fandom 口径，450/2400 共用同一套修正） */
const balanceTags = ref<BalanceTag[]>([])

const championId = computed(() => Number.parseInt(String(route.params.id ?? ''), 10))

const heroTitle = computed(() => (detail.value ? `${detail.value.champion.title} · 大乱斗` : '…'))
const heroSub = computed(() =>
  detail.value ? `${detail.value.champion.name} · ${detail.value.champion.alias}` : ''
)
const tier = computed(() => clampTier(detail.value?.champion.stats.tier ?? 5))
const heroWinRate = computed(() => detail.value?.champion.stats.winRate ?? null)
const dateText = computed(() => {
  const d = detail.value?.champion.stats.date
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5) : (d ?? '')
})

/** 详情页强化：按稀有度筛选，自采胜率降序、无样本沉底 */
const filteredAugments = computed(() => {
  const list = detail.value?.augments ?? []
  return [...list]
    .filter(a => activeRarity.value === 'all' || a.rarityName === activeRarity.value)
    .sort((a, b) => (b.stats.winRate ?? -1) - (a.stats.winRate ?? -1))
})

const trios = computed(() => detail.value?.augmentTrios ?? [])
const builds = computed<MayhemBuild[]>(() => detail.value?.builds ?? [])

const minGamesText = computed(() => {
  const first = detail.value?.augments.find(a => a.stats.winRateMinimumGames != null)
  return String(first?.stats.winRateMinimumGames ?? 255)
})

function goBack() {
  void router.push({ name: 'Mayhem' })
}

function pct(v: number | null | undefined): string {
  if (v == null) return '--'
  // 上游存在相对胜率（情境装 winRate 为差值），带符号展示更准确
  const abs = Math.abs(v)
  const text = (abs * 100).toFixed(abs >= 0.1 ? 1 : 2)
  return v < 0 ? `-${text}%` : `${text}%`
}

function clampTier(v: number): number {
  return Math.min(Math.max(v, 1), 5)
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
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

function fallbackIcon(ev: Event, remoteUrl?: string) {
  applyFallback(ev, remoteUrl)
}

function hideIcon(ev: Event) {
  applyFallback(ev, undefined)
}

function applyFallback(ev: Event, remoteUrl?: string) {
  const img = ev.target as HTMLImageElement | null
  if (!img) return
  if (!remoteUrl) {
    img.style.display = 'none'
    return
  }
  if (img.dataset.fallback === remoteUrl) return
  img.dataset.fallback = remoteUrl
  img.src = remoteUrl
}

function situationals(b: MayhemBuild): SituationalItem[] {
  return [...(b.situationalItems ?? [])].sort((x, y) => y.distinctiveScore - x.distinctiveScore)
}

function topExtensions(b: MayhemBuild): ItemExtension[] {
  return [...(b.itemExtensions ?? [])].sort((x, y) => y.games - x.games)
}

function buildTitle(b: MayhemBuild, index: number): string {
  const tag = Object.values(b.tags ?? {})[0]
  return tag || `流派 ${index + 1}`
}

function fmtGames(games: number): string {
  return games >= 10000 ? `${(games / 10000).toFixed(1)}万场` : `${games}场`
}

/** 主副系摘要：首个主点技能为主系，随后第一个非 R 技能为副系，如 "主W·副Q" */
function skillSummary(keys: string[]): string {
  const main = keys[0]
  let second = ''
  for (const k of keys) {
    if (k !== main && k !== 'R') {
      second = k
      break
    }
  }
  return `主${main}${second ? `·副${second}` : ''}`
}

/** 收集本页所有图标 id，按类型一次性预载名称 */
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

async function load() {
  if (!Number.isFinite(championId.value)) {
    error.value = `无效的英雄 ID：${String(route.params.id)}`
    return
  }
  loading.value = true
  error.value = ''
  try {
    detail.value = await getMayhemChampionDetail(championId.value)
    if (detail.value) {
      preloadNames(detail.value)
      const balance = await invoke<AramBalanceData | null>('get_aram_balance', {
        id: championId.value
      }).catch(() => null)
      balanceTags.value = buildBalanceTags(balance)
    }
  } catch (e) {
    error.value = `读取英雄详情失败：${String(e)}`
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped src="./MayhemChampionDetail.styles.css"></style>
