/**
 * 符文 tab + 时间线 tab 的错误态组件测试。
 *
 * 验证（本次修复 D-P3 相关 SGP 依赖）：
 * - RunesTab 完整符文页：perks 存在时渲染主系 3 符文 + 副系 2 符文 + 属性碎片，不再出现「需 SGP」
 * - RunesTab 回退：无 perks 时显示扁平三字段布局 + 「符文页数据缺失」提示
 * - TimelineTab 错误态：status=error 显示「帧数据拉取失败」+ 重试按钮，点击触发 loadSgpDetail
 * - TimelineTab 成功但无帧：显示「本局无逐分钟数据」，不再出现「LCU 战绩无 participantFrames」误导句
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import type { Participant, GamePerks } from '@renderer/types/domain/match'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'
import { matchDetailContextKey, type MatchDetailContext } from '../matchDetailContext'
import MatchDetailRunesTab from '../tabs/MatchDetailRunesTab.vue'
import MatchDetailTimelineTab from '../tabs/MatchDetailTimelineTab.vue'

vi.mock('@renderer/utils/navigation', () => ({ searchSummoner: vi.fn() }))

function perks(overrides: Partial<GamePerks> = {}): GamePerks {
  return {
    statPerks: { defense: 5008, flex: 5008, offense: 5008 },
    styles: [
      {
        description: 'primaryStyle',
        style: 8100,
        selections: [
          { perk: 8112, var1: 0, var2: 0, var3: 0 },
          { perk: 9111, var1: 0, var2: 0, var3: 0 },
          { perk: 9112, var1: 0, var2: 0, var3: 0 }
        ]
      },
      {
        description: 'subStyle',
        style: 8000,
        selections: [
          { perk: 8275, var1: 0, var2: 0, var3: 0 },
          { perk: 8347, var1: 0, var2: 0, var3: 0 }
        ]
      }
    ],
    ...overrides
  }
}

function playerOf(participantId: number, full: boolean): DetailPlayer {
  return {
    participantId,
    teamId: 100,
    championId: 897,
    spell1Id: 14,
    spell2Id: 4,
    perks: full ? perks() : undefined,
    stats: {
      win: true,
      item0: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      perk0: full ? 8112 : 0,
      perkPrimaryStyle: full ? 8100 : 0,
      perkSubStyle: full ? 8000 : 0,
      playerAugment1: 0,
      playerAugment2: 0,
      playerAugment3: 0,
      playerAugment4: 0,
      playerAugment5: 0,
      playerAugment6: 0,
      kills: 8,
      deaths: 2,
      assists: 5,
      goldEarned: 13200,
      goldSpent: 13000,
      totalDamageDealtToChampions: 28660,
      totalDamageDealt: 100000,
      totalDamageTaken: 47327,
      totalHeal: 8485,
      totalMinionsKilled: 167,
      neutralMinionsKilled: 0,
      damageDealtToTurrets: 1000,
      groupRate: 55,
      goldEarnedRate: 60,
      damageDealtToChampionsRate: 30,
      damageTakenRate: 25,
      healRate: 20,
      playerSubteamId: 0,
      subteamPlacement: 0
    },
    displayName: '玩家A#1234',
    puuid: 'p1',
    gameName: '玩家A',
    tagLine: '1234',
    isMe: true,
    win: true,
    badges: [],
    score: 8.2,
    mvpTag: 'MVP',
    teamRelative: { damage: 0.6, taken: 0.5, heal: 0.4 }
  }
}

function makeContext(overrides: Partial<MatchDetailContext> = {}): MatchDetailContext {
  const players = [playerOf(1, true), playerOf(2, false)]
  return {
    game: ref(null),
    players: {
      detailPlayers: computed(() => players),
      teamSections: computed(() => [
        {
          teamId: 100,
          title: '蓝方',
          headerClass: '',
          kills: 10,
          deaths: 5,
          assists: 20,
          gold: 30000,
          damage: 50000,
          taken: 40000,
          players
        }
      ])
    } as unknown as MatchDetailContext['players'],
    ranks: null as unknown as MatchDetailContext['ranks'],
    assets: {
      srcOf: (_kind: string, id: number) => (id > 0 ? `/perk/${id}.png` : ''),
      detailOf: (_kind: string, id: number) => ({ name: `符文${id}` })
    } as unknown as MatchDetailContext['assets'],
    ai: null as unknown as MatchDetailContext['ai'],
    usesAugments: ref(false),
    isDark: ref(false),
    copy: vi.fn(),
    buildEncounter: () => undefined,
    itemIds: () => [],
    playerAugmentIds: () => [],
    displayedPerkIds: (stats: Participant['stats']) => [stats.perk0, stats.perkSubStyle],
    sgpDetail: ref(null),
    sgpDetailStatus: ref('idle'),
    loadSgpDetail: vi.fn(),
    ...overrides
  }
}

const stubs = {
  LazyImg: { template: '<img :src="$attrs.src" />' },
  Tag: { template: '<span><slot /></span>' },
  Tooltip: {
    template:
      '<span class="tooltip-stub"><span class="trigger"><slot name="trigger" /></span></span>'
  },
  Spin: { template: '<span class="n-spin-stub" />' }
}

describe('MatchDetailRunesTab 完整符文页', () => {
  it('有 perks 时渲染主系 3 符文 + 副系 2 符文 + 属性碎片，无「需 SGP」字样', () => {
    const ctx = makeContext()
    const wrapper = mount(MatchDetailRunesTab, {
      global: { provide: { [matchDetailContextKey as symbol]: ctx }, stubs }
    })
    const imgs = wrapper.findAll('img.match-detail-runes-perk')
    // 主系 2（基石单独显示）+ 副系 2 + 属性 3 = 7 个小图标；基石 1 个
    expect(imgs).toHaveLength(7)
    expect(wrapper.findAll('img.match-detail-runes-keystone')).toHaveLength(1)
    expect(imgs.map(i => i.attributes('src'))).toContain('/perk/9111.png')
    expect(imgs.map(i => i.attributes('src'))).toContain('/perk/8275.png')
    expect(imgs.map(i => i.attributes('src'))).toContain('/perk/5008.png')
    expect(wrapper.text()).toContain('主系')
    expect(wrapper.text()).toContain('副系')
    expect(wrapper.text()).toContain('属性')
    expect(wrapper.text()).not.toContain('需 SGP')
  })

  it('无 perks 时回退扁平三字段布局 + 「符文页数据缺失」提示', () => {
    const ctx = makeContext()
    const wrapper = mount(MatchDetailRunesTab, {
      global: { provide: { [matchDetailContextKey as symbol]: ctx }, stubs }
    })
    // 两张卡：玩家1（完整页）有 1 个基石；玩家2（无 perks）回退显示主/副系风格名
    const text = wrapper.text()
    expect(text).toContain('符文页数据缺失')
    expect(text).toContain('主系')
    expect(wrapper.findAll('img.match-detail-runes-perk')).toHaveLength(7)
  })

  it('海克斯/斗魂模式显示强化提示', () => {
    const ctx = makeContext({ usesAugments: ref(true) })
    const wrapper = mount(MatchDetailRunesTab, {
      global: { provide: { [matchDetailContextKey as symbol]: ctx }, stubs }
    })
    expect(wrapper.text()).toContain('无传统符文页')
  })
})

describe('MatchDetailTimelineTab 错误态与空态', () => {
  it('status=error：显示「帧数据拉取失败」+ 重试按钮触发 loadSgpDetail', async () => {
    const loadSgpDetail = vi.fn().mockResolvedValue(undefined)
    const ctx = makeContext({ sgpDetailStatus: ref('error'), loadSgpDetail })
    const wrapper = mount(MatchDetailTimelineTab, {
      global: { provide: { [matchDetailContextKey as symbol]: ctx }, stubs }
    })
    expect(wrapper.text()).toContain('帧数据拉取失败')
    const before = loadSgpDetail.mock.calls.length
    await wrapper.find('button.match-detail-timeline-retry').trigger('click')
    expect(loadSgpDetail.mock.calls.length).toBe(before + 1)
  })

  it('ready 但无帧：显示「本局无逐分钟数据」，不再出现误导句', () => {
    const ctx = makeContext({ sgpDetailStatus: ref('ready'), sgpDetail: ref(null) })
    const wrapper = mount(MatchDetailTimelineTab, {
      global: { provide: { [matchDetailContextKey as symbol]: ctx }, stubs }
    })
    expect(wrapper.text()).toContain('本局无逐分钟数据')
    expect(wrapper.text()).not.toContain('LCU 战绩无')
  })

  it('loading：显示加载中', () => {
    const ctx = makeContext({ sgpDetailStatus: ref('loading') })
    const wrapper = mount(MatchDetailTimelineTab, {
      global: { provide: { [matchDetailContextKey as symbol]: ctx }, stubs }
    })
    expect(wrapper.text()).toContain('正在加载帧数据')
  })
})
