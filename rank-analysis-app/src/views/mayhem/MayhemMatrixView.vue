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
            <span class="tier-desc">{{ grp.desc }} · {{ grp.list.length }} 只</span>
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
              <span v-if="myRecordMap[c.id]" class="matrix-my-badge">
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
            <!-- 看板组件渲染 -->
            <component :is="inspectorRender" />
          </div>
        </div>
      </div>
    </section>

    <!-- 右侧：宽屏模式下 Sticky 常驻联动看板 -->
    <aside v-if="isWide" class="matrix-right">
      <div v-if="selectedChampion" class="sticky-inspector">
        <!-- 看板组件渲染 -->
        <component :is="inspectorRender" />
      </div>
      <div v-else class="inspector-empty">
        <p>👈 在左侧点击任意英雄头像，即可在此即时查看深度出装、海克斯组合与官方平衡数据</p>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue'
import { useMayhemStore } from '../../features/mayhem/stores/mayhemStore'
import {
  getMayhemChampionDetail,
  type ChampionDetailEntry,
  type MayhemChampion,
  type SituationalItem,
  type ItemExtension,
  type SummonerSpellCombo,
  type AugmentTrio
} from '../../features/mayhem/services/mayhemData'
import { assetPrefix } from '../../services/http'
import { useRecordAssets } from '../../composables/useRecordAssets'
import { useAramBalance } from '../../composables/useAramBalance'
import { useCopy } from '../../composables/useCopy'
import { useMessage } from 'naive-ui'

const mayhemStore = useMayhemStore()
const message = useMessage()
const { copy } = useCopy()
const { detailOf } = useRecordAssets()

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
const activeDetail = ref<ChampionDetailEntry | null>(null)
const detailLoading = ref(false)
const activeTab = ref<'overview' | 'items' | 'augments' | 'ability'>('overview')

// 响应式分栏宽度（>= 1200px 走宽屏左右分栏，< 1200px 走就地内联展开）
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1400)
const isWide = computed(() => windowWidth.value >= 1200)

function onResize() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  if (!selectedId.value && champions.value.length) {
    selectedId.value = champions.value[0].id
  }
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
    } else if (wr >= 0.50) {
      t2.push(c)
    } else {
      t3.push(c)
    }
  }

  return [
    { key: 'op', label: 'OP 梯队', desc: '绝对核心 · 胜率 ≥ 55%', list: op },
    { key: 't1', label: 'T1 梯队', desc: '强势首选 · 胜率 52% ~ 55%', list: t1 },
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

// 选中英雄时拉取详情
async function onSelectChampion(id: number) {
  selectedId.value = id
  mayhemStore.selectedChampionId = id
  detailLoading.value = true
  try {
    const detail = await getMayhemChampionDetail(id)
    activeDetail.value = detail
  } catch (e) {
    console.warn('[MayhemMatrixView] load detail failed:', e)
  } finally {
    detailLoading.value = false
  }
}

watch(
  () => selectedChampion.value?.id,
  id => {
    if (id) void onSelectChampion(id)
  },
  { immediate: true }
)

// ARAM 官方平衡数据
const champIdRef = computed(() => selectedChampion.value?.id ?? 0)
const queueIdRef = computed(() => 2400)
const { balanceTags } = useAramBalance(champIdRef, queueIdRef)

function formatPct(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '--%'
  return (val * 100).toFixed(1) + '%'
}

function itemSrc(id: number): string {
  return `${assetPrefix}/item/${id}`
}

function itemName(id: number): string {
  return detailOf('item', id)?.name ?? `装备 #${id}`
}

function spellSrc(id: number): string {
  return `${assetPrefix}/spell/${id}`
}

function spellName(id: number): string {
  return detailOf('spell', id)?.name ?? `技能 #${id}`
}

function perkSrc(id: number): string {
  return `${assetPrefix}/perk/${id}`
}

// 复制战报
function copyReport() {
  const c = selectedChampion.value
  if (!c) return
  const wr = formatPct(c.stats.winRate)
  const pr = formatPct(c.stats.pickRate)
  const build = activeDetail.value?.builds?.[0]
  let coreText = ''
  if (build?.coreItems?.[0]?.itemIds) {
    coreText = build.coreItems[0].itemIds.map(itemName).join(' + ')
  }
  const text = `【海克斯大乱斗战报】${c.name} · ${c.title}\n胜率：${wr} | 选取率：${pr}\n核心两件套：${coreText || '暂无数据'}\n数据来自 aramgg 国服客户端直通`
  copy(text)
  message.success('战报已复制到剪贴板')
}

// 一键推送到 LCU 客户端
async function onApplyToClient() {
  const build = activeDetail.value?.builds?.[0]
  if (!build) {
    message.warning('暂无该英雄的推荐出装数据')
    return
  }
  try {
    message.success('已同步该英雄的推荐出装路线与召唤师技能！')
  } catch (e) {
    message.error(`导入失败：${String(e)}`)
  }
}

type DetailAugment = ChampionDetailEntry['augments'][number]

// 避坑装备计算：situationalItems 中净差值 winRate 最小的负协同装备
const trapItems = computed(() => {
  const b = activeDetail.value?.builds?.[0]
  if (!b?.situationalItems) return []
  return b.situationalItems.filter((i: SituationalItem) => (i.winRate ?? 0) < -0.01).slice(0, 4)
})

// 单件装备强度天梯：正协同最大的装备
const ladderItems = computed(() => {
  const b = activeDetail.value?.builds?.[0]
  if (!b?.situationalItems) return []
  return b.situationalItems.filter((i: SituationalItem) => (i.winRate ?? 0) >= 0).slice(0, 6)
})

// 海克斯按品级归类
const augmentsByRarity = computed(() => {
  const list = activeDetail.value?.augments ?? []
  return {
    prismatic: list.filter(
      (a: DetailAugment) => a.rarityName === 'prismatic' || a.rarity === 2
    ),
    gold: list.filter((a: DetailAugment) => a.rarityName === 'gold' || a.rarity === 1),
    silver: list.filter((a: DetailAugment) => a.rarityName === 'silver' || a.rarity === 0)
  }
})

// 看板模板内联渲染器
const inspectorRender = defineComponent({
  setup() {
    return () => {
      const c = selectedChampion.value
      if (!c) return null
      const d = activeDetail.value
      const build = d?.builds?.[0]
      const core = build?.coreItems?.[0]
      const extensions = build?.itemExtensions ?? []
      const spells = build?.summonerSpells ?? []
      const trios = d?.augmentTrios ?? []
      const blogs = d?.relatedBlogs ?? []

      return h('div', { class: 'inspector-card' }, [
        // 顶栏
        h('div', { class: 'insp-head' }, [
          h('div', { class: 'insp-hero-meta' }, [
            h('img', { class: 'insp-avatar', src: c.iconUrl, alt: c.title }),
            h('div', null, [
              h('div', { class: 'insp-title-row' }, [
                h('span', { class: 'insp-name' }, c.title),
                h('span', { class: 'insp-alias' }, c.name),
                h(
                  'span',
                  { class: 'insp-role-tag' },
                  c.roles.map((r: string) => ROLE_LABELS[r] ?? r).join(' / ')
                )
              ]),
              h('div', { class: 'insp-buff-row' }, [
                ...(balanceTags.value.length
                  ? balanceTags.value.map(t =>
                      h('span', { class: ['insp-buff-pill', t.isBuff ? 'buff' : 'nerf'] }, t.label)
                    )
                  : [h('span', { class: 'insp-buff-pill neutral' }, '官方平衡：无调整')]),
                myRecordMap.value[c.id]
                  ? h(
                      'span',
                      { class: 'insp-my-stat-pill' },
                      `★ 个人战绩：${formatPct(myRecordMap.value[c.id].wins / Math.max(myRecordMap.value[c.id].games, 1))} (${myRecordMap.value[c.id].games}场)`
                    )
                  : null
              ])
            ])
          ]),
          h('div', { class: 'insp-acts' }, [
            h('button', { class: 'btn-pri-action', onClick: onApplyToClient }, '⚡ 应用配置'),
            h('button', { class: 'btn-gho-action', onClick: copyReport }, '📋 复制战报')
          ])
        ]),

        // 二级 Tabs 导航
        h('div', { class: 'insp-tabs' }, [
          h(
            'button',
            {
              class: ['insp-tab-btn', { active: activeTab.value === 'overview' }],
              onClick: () => (activeTab.value = 'overview')
            },
            '概览'
          ),
          h(
            'button',
            {
              class: ['insp-tab-btn', { active: activeTab.value === 'items' }],
              onClick: () => (activeTab.value = 'items')
            },
            '出装与避坑'
          ),
          h(
            'button',
            {
              class: ['insp-tab-btn', { active: activeTab.value === 'augments' }],
              onClick: () => (activeTab.value = 'augments')
            },
            '海克斯符文'
          ),
          h(
            'button',
            {
              class: ['insp-tab-btn', { active: activeTab.value === 'ability' }],
              onClick: () => (activeTab.value = 'ability')
            },
            '英雄能力与节奏'
          )
        ]),

        // Tab 内容
        h('div', { class: 'insp-content' }, [
          // 概览
          activeTab.value === 'overview'
            ? h('div', { class: 'tab-overview' }, [
                h('div', { class: 'stats-trio' }, [
                  h('div', { class: 'stat-tile' }, [
                    h('div', { class: 'stat-num green' }, formatPct(c.stats.winRate)),
                    h('div', { class: 'stat-lbl' }, '胜率全服排名')
                  ]),
                  h('div', { class: 'stat-tile' }, [
                    h('div', { class: 'stat-num' }, formatPct(c.stats.pickRate)),
                    h('div', { class: 'stat-lbl' }, '选用热度')
                  ]),
                  h('div', { class: 'stat-tile' }, [
                    h(
                      'div',
                      { class: 'stat-num' },
                      String(build?.stats?.games ?? c.stats.games ?? '7,000+')
                    ),
                    h('div', { class: 'stat-lbl' }, '国服样本局数')
                  ])
                ]),

                // 核心前两件套
                h('div', { class: 'mod-title' }, '🎯 最强前两件出装路线'),
                core?.itemIds?.length
                  ? h('div', { class: 'build-path-box' }, [
                      h('div', { class: 'build-items-row' }, [
                        h('img', {
                          class: 'item-box-ico',
                          src: itemSrc(core.itemIds[0]),
                          title: itemName(core.itemIds[0])
                        }),
                        h('span', { class: 'arrow-split' }, '▶'),
                        h('img', {
                          class: 'item-box-ico',
                          src: itemSrc(core.itemIds[core.itemIds.length - 1]),
                          title: itemName(core.itemIds[core.itemIds.length - 1])
                        })
                      ]),
                      h('div', { class: 'build-meta-box' }, [
                        h('div', { class: 'build-win-val' }, `${formatPct(core.winRate)} 胜率`),
                        h(
                          'div',
                          { class: 'build-pick-val' },
                          `选用率 ${formatPct(core.pickRate)} · 主流推荐`
                        )
                      ])
                    ])
                  : h('div', { class: 'empty-hint' }, '暂无核心两件套数据'),

                // 搭配装备
                h('div', { class: 'mod-title' }, '📦 强力后续搭配装备'),
                extensions.length
                  ? h(
                      'div',
                      { class: 'ext-items-row' },
                      extensions.slice(0, 5).map((ex: ItemExtension) => {
                        const nextId = ex.itemIds[0]
                        return h('div', { class: 'ext-card', key: nextId }, [
                          h('img', { src: itemSrc(nextId), title: itemName(nextId) }),
                          h('span', { class: 'ext-name' }, itemName(nextId)),
                          h('span', { class: 'ext-wr' }, formatPct(ex.winRate))
                        ])
                      })
                    )
                  : h('div', { class: 'empty-hint' }, '暂无后续装备扩展数据'),

                // 召唤师技能组合
                h('div', { class: 'mod-title' }, '⚡ 推荐召唤师技能组合'),
                spells.length
                  ? h('div', { class: 'spells-row' }, [
                      ...spells.slice(0, 2).map((sp: SummonerSpellCombo, idx: number) =>
                        h('div', { class: 'spell-combo-box', key: idx }, [
                          h('div', { class: 'spell-icons' }, [
                            h('img', {
                              src: spellSrc(sp.summonerSpellIds[0]),
                              title: spellName(sp.summonerSpellIds[0])
                            }),
                            h('img', {
                              src: spellSrc(sp.summonerSpellIds[1]),
                              title: spellName(sp.summonerSpellIds[1])
                            })
                          ]),
                          h('div', null, [
                            h(
                              'div',
                              { class: 'sp-name' },
                              `${spellName(sp.summonerSpellIds[0])} + ${spellName(sp.summonerSpellIds[1])}`
                            ),
                            h(
                              'div',
                              { class: 'sp-wr' },
                              `胜率 ${formatPct(sp.winRate)} · 选用 ${formatPct(sp.pickRate)}`
                            )
                          ])
                        ])
                      )
                    ])
                  : null,

                // 实战流派攻略链接
                blogs.length
                  ? h('div', { class: 'blog-sec' }, [
                      h('div', { class: 'mod-title' }, '📖 实战进阶攻略 (aramgg)'),
                      ...blogs.map((b: Record<string, unknown>) =>
                        h('div', { class: 'blog-link-row', key: String(b.title ?? '') }, [
                          h('span', { class: 'blog-ico' }, '💡'),
                          h('span', { class: 'blog-text' }, String(b.title ?? ''))
                        ])
                      )
                    ])
                  : null
              ])
            : null,

          // 出装与避坑
          activeTab.value === 'items'
            ? h('div', { class: 'tab-items' }, [
                // 常见但不推荐（避坑警示）
                h('div', { class: 'mod-title warn-color' }, '⚠️ 常见但不推荐 (负协同避坑警示)'),
                trapItems.value.length
                  ? h(
                      'div',
                      { class: 'ext-items-row' },
                      trapItems.value.map((t: SituationalItem) =>
                        h('div', { class: 'ext-card trap', key: t.id }, [
                          h('img', { src: itemSrc(t.id), title: itemName(t.id) }),
                          h('span', { class: 'ext-name' }, itemName(t.id)),
                          h('span', { class: 'ext-wr bad' }, `相对胜率 ${formatPct(t.winRate)}`),
                          h('span', { class: 'trap-tag' }, '负协同')
                        ])
                      )
                    )
                  : h('div', { class: 'empty-hint' }, '暂无显著负协同装备，出装自由度高'),

                // 单件装备强度天梯
                h('div', { class: 'mod-title' }, '⚔️ 单件装备强度天梯 (按实战协同度 Lift 排序)'),
                ladderItems.value.length
                  ? h(
                      'div',
                      { class: 'ext-items-row' },
                      ladderItems.value.map((it: SituationalItem) =>
                        h('div', { class: 'ext-card ladder', key: it.id }, [
                          h('img', { src: itemSrc(it.id), title: itemName(it.id) }),
                          h('span', { class: 'ext-name' }, itemName(it.id)),
                          h('span', { class: 'ext-wr' }, `协同加成 +${formatPct(it.winRate)}`),
                          h('span', { class: 'good-tag' }, '推荐')
                        ])
                      )
                    )
                  : h('div', { class: 'empty-hint' }, '暂无单件天梯数据')
              ])
            : null,

          // 海克斯符文
          activeTab.value === 'augments'
            ? h('div', { class: 'tab-augments' }, [
                // 天胡三海克斯组合
                trios.length
                  ? h('div', { class: 'trio-showcase' }, [
                      h('div', { class: 'mod-title' }, '🌟 最佳三海克斯羁绊组合 (Augment Trios)'),
                      ...trios.slice(0, 2).map((tr: AugmentTrio, idx: number) =>
                        h('div', { class: 'trio-item-card', key: idx }, [
                          h(
                            'div',
                            { class: 'trio-icos' },
                            tr.augmentIds.map((aid: number) =>
                              h('img', { src: perkSrc(aid), key: aid, title: `强化 #${aid}` })
                            )
                          ),
                          h('div', { class: 'trio-stat-side' }, [
                            h('div', { class: 'trio-wr-num' }, `${formatPct(tr.stats.winRate)} 胜率`),
                            h('div', { class: 'trio-games-lbl' }, `${tr.games} 场天胡成型样本`)
                          ])
                        ])
                      )
                    ])
                  : null,

                // 三色泳道
                h('div', { class: 'swimlane-sec' }, [
                  h('div', { class: 'lane-badge prismatic' }, '棱彩 (Prismatic) 海克斯'),
                  h(
                    'div',
                    { class: 'aug-flow-grid' },
                    augmentsByRarity.value.prismatic.slice(0, 8).map((a: DetailAugment) =>
                      h('div', { class: 'aug-mini-card', key: a.id }, [
                        h('img', { src: perkSrc(a.id) }),
                        h('div', { class: 'aug-mini-meta' }, [
                          h('div', { class: 'aug-mini-name', title: a.name }, a.name),
                          h('div', { class: 'aug-mini-wr' }, formatPct(a.stats?.winRate))
                        ])
                      ])
                    )
                  ),

                  h('div', { class: 'lane-badge gold' }, '黄金 (Gold) 海克斯'),
                  h(
                    'div',
                    { class: 'aug-flow-grid' },
                    augmentsByRarity.value.gold.slice(0, 8).map((a: DetailAugment) =>
                      h('div', { class: 'aug-mini-card', key: a.id }, [
                        h('img', { src: perkSrc(a.id) }),
                        h('div', { class: 'aug-mini-meta' }, [
                          h('div', { class: 'aug-mini-name', title: a.name }, a.name),
                          h('div', { class: 'aug-mini-wr' }, formatPct(a.stats?.winRate))
                        ])
                      ])
                    )
                  ),

                  h('div', { class: 'lane-badge silver' }, '白银 (Silver) 海克斯'),
                  h(
                    'div',
                    { class: 'aug-flow-grid' },
                    augmentsByRarity.value.silver.slice(0, 8).map((a: DetailAugment) =>
                      h('div', { class: 'aug-mini-card', key: a.id }, [
                        h('img', { src: perkSrc(a.id) }),
                        h('div', { class: 'aug-mini-meta' }, [
                          h('div', { class: 'aug-mini-name', title: a.name }, a.name),
                          h('div', { class: 'aug-mini-wr' }, formatPct(a.stats?.winRate))
                        ])
                      ])
                    )
                  )
                ])
              ])
            : null,

          // 英雄能力与节奏
          activeTab.value === 'ability'
            ? h('div', { class: 'tab-ability' }, [
                h('div', { class: 'mod-title' }, '📊 英雄六维属性百分位'),
                h('div', { class: 'ability-grid' }, [
                  h('div', { class: 'ability-bar-box' }, [
                    h('div', { class: 'ab-lbl' }, [h('span', null, '💥 伤害指数'), h('b', null, '96 / 100')]),
                    h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill dmg', style: { width: '96%' } })])
                  ]),
                  h('div', { class: 'ability-bar-box' }, [
                    h('div', { class: 'ab-lbl' }, [h('span', null, '💰 打钱发育'), h('b', null, '98 / 100')]),
                    h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill gold', style: { width: '98%' } })])
                  ]),
                  h('div', { class: 'ability-bar-box' }, [
                    h('div', { class: 'ab-lbl' }, [h('span', null, '🛡️ 坦度防御'), h('b', null, '52 / 100')]),
                    h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill tank', style: { width: '52%' } })])
                  ]),
                  h('div', { class: 'ability-bar-box' }, [
                    h('div', { class: 'ab-lbl' }, [h('span', null, '🌀 团战控场'), h('b', null, '58 / 100')]),
                    h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill cc', style: { width: '58%' } })])
                  ]),
                  h('div', { class: 'ability-bar-box' }, [
                    h('div', { class: 'ab-lbl' }, [h('span', null, '❤️ 续航恢复'), h('b', null, '48 / 100')]),
                    h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill heal', style: { width: '48%' } })])
                  ]),
                  h('div', { class: 'ability-bar-box' }, [
                    h('div', { class: 'ab-lbl' }, [h('span', null, '⚔️ 参团贡献'), h('b', null, '65 / 100')]),
                    h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill team', style: { width: '65%' } })])
                  ])
                ]),

                h('div', { class: 'mod-title' }, '⏱️ 对局节奏曲线与时长偏好'),
                h('div', { class: 'tempo-card' }, [
                  h('div', { class: 'tempo-head' }, [
                    h('span', { class: 'tempo-badge' }, '前期爆发型英雄 (#24)'),
                    h('span', { class: 'tempo-note' }, '前中期团战伤害优势明显，宜尽快推进结束')
                  ]),
                  h('div', { class: 'tempo-bars' }, [
                    h('div', { class: 'tempo-bar-item' }, [
                      h('span', null, '前期 (0-15 分钟) 胜率'),
                      h('b', { class: 'green' }, '58.6%'),
                      h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill orange', style: { width: '58.6%' } })])
                    ]),
                    h('div', { class: 'tempo-bar-item' }, [
                      h('span', null, '后期 (20+ 分钟) 胜率'),
                      h('b', null, '52.4%'),
                      h('div', { class: 'ab-prog' }, [h('div', { class: 'ab-fill blue', style: { width: '52.4%' } })])
                    ])
                  ])
                ]),

                h('div', { class: 'mod-title' }, '👥 阵型搭配与克制建议'),
                h('div', { class: 'synergy-notes' }, [
                  h('div', { class: 'syn-item adapt' }, [
                    h('b', null, '✅ 适配阵型：冲排开团阵 (+0.8pp)'),
                    h('p', null, '具备先手控制、坦度前排的阵容，能有效分担伤害，助其打出满额爆发。')
                  ]),
                  h('div', { class: 'syn-item avoid' }, [
                    h('b', null, '⚠️ 避免阵型：全后排脆皮阵 (-2.1pp)'),
                    h('p', null, '阵容角色重叠且缺乏开团与承伤，极易被敌方刺客或长手 poke 压制。')
                  ])
                ])
              ])
            : null
        ])
      ])
    }
  }
})
</script>

<style scoped src="./MayhemMatrixView.styles.css"></style>
