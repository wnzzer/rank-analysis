/**
 * RecordCard 行卡单元测试
 *
 * 覆盖 D-P3 之后的行卡增强：
 * - CS/分钟（含野怪）小字，时长异常降级 0.0
 * - 模式短名（单双/灵活/极地/斗魂…，未知 queueId 退回 queueName 前 4 字）
 * - 召唤师技能图标两枚（左上角竖排）
 * - 全队参团率与金/伤/承/治占比数据透传（占位断言）
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { Game, Participant } from '@renderer/types/domain/match'

vi.mock('@renderer/composables/useTheme', () => ({
  useTheme: () => ({ isDark: ref(true) })
}))

const assetDetail = vi.hoisted(() => ({
  srcOf: vi.fn((_: string, id: number) => `http://asset.localhost/${id}`),
  detailOf: vi.fn(() => null)
}))
vi.mock('@renderer/composables/useRecordAssets', () => ({
  useRecordAssets: () => ({
    injected: assetDetail,
    ...assetDetail,
    srcOf: assetDetail.srcOf,
    detailOf: assetDetail.detailOf
  })
}))

import RecordCard from '../RecordCard.vue'

const stubs = {
  LazyImg: { props: ['src', 'alt'], template: '<img :src="src" :alt="alt" />' },
  Ellipsis: { template: '<span><slot /></span>' },
  Tooltip: {
    template: '<div><slot name="trigger" /><span class="tooltip-content"><slot /></span></div>'
  },
  Icon: { template: '<span />' }
}

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    win: true,
    participantId: 1,
    teamId: 100,
    championId: 17,
    spell1Id: 4,
    spell2Id: 12,
    stats: {
      win: true,
      item0: 6653,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      perk0: 0,
      perkPrimaryStyle: 0,
      perkSubStyle: 0,
      playerAugment1: 0,
      playerAugment2: 0,
      playerAugment3: 0,
      playerAugment4: 0,
      playerAugment5: 0,
      playerAugment6: 0,
      kills: 6,
      deaths: 3,
      assists: 8,
      goldEarned: 13500,
      goldSpent: 12000,
      totalDamageDealtToChampions: 24000,
      totalDamageDealt: 30000,
      totalDamageTaken: 18000,
      totalHeal: 9000,
      totalMinionsKilled: 180,
      neutralMinionsKilled: 30,
      damageDealtToTurrets: 5000,
      groupRate: 55,
      goldEarnedRate: 22,
      damageDealtToChampionsRate: 25,
      damageTakenRate: 20,
      healRate: 18,
      playerSubteamId: 0,
      subteamPlacement: 0
    },
    ...overrides
  }
}

function gameOf(overrides: Partial<Game> = {}): Game {
  return {
    mvp: '',
    gameDetail: { endOfGameResult: '', participantIdentities: [], participants: [] },
    gameId: 1,
    gameCreationDate: '1755200000000',
    gameDuration: 1800,
    gameMode: 'CLASSIC',
    gameType: '',
    mapId: 11,
    queueId: 420,
    queueName: '单双排',
    platformId: 'TJ100',
    participantIdentities: [],
    participants: [participant()],
    ...overrides
  }
}

function mountCard(game: Game) {
  return mount(RecordCard, {
    props: { games: game },
    global: { stubs }
  })
}

describe('RecordCard 行卡增强（CS/模式/技能/日期）', () => {
  it('渲染 CS/分钟（含野怪），时长 30 分钟 → 7.0', () => {
    const wrapper = mountCard(gameOf())
    expect(wrapper.find('.record-card-cs').text()).toBe('7.0 CS/分')
  })

  it('时长缺失/为 0 时 CS 降级 0.0，不 NaN', () => {
    const wrapper = mountCard(gameOf({ gameDuration: 0 }))
    expect(wrapper.find('.record-card-cs').text()).toBe('0.0 CS/分')
  })

  it('模式短名：420 → 含「单双」、450 → 含「极地」、490 → 含「斗魂」（日期常显后为 日期·模式 复合行）', () => {
    expect(
      mountCard(gameOf({ queueId: 420 }))
        .find('.record-card-mode')
        .text()
    ).toContain('单双')
    expect(
      mountCard(gameOf({ queueId: 450 }))
        .find('.record-card-mode')
        .text()
    ).toContain('极地')
    expect(
      mountCard(gameOf({ queueId: 490 }))
        .find('.record-card-mode')
        .text()
    ).toContain('斗魂')
  })

  it('未知 queueId 退回 queueName 前 4 字', () => {
    const wrapper = mountCard(gameOf({ queueId: 999, queueName: '自定义模式' }))
    expect(wrapper.find('.record-card-mode').text()).toContain('自定义模')
  })

  it('渲染两枚召唤师技能图标（spell1/spell2）', () => {
    const wrapper = mountCard(gameOf())
    const spells = wrapper.findAll('.record-card-spell-img')
    expect(spells).toHaveLength(2)
    expect(spells[0].attributes('src')).toContain('/4')
    expect(spells[1].attributes('src')).toContain('/12')
  })

  it('技能缺失时（id=0）不渲染图标', () => {
    const p = participant({ spell1Id: 0, spell2Id: 0 })
    const wrapper = mountCard(gameOf({ participants: [p] }))
    expect(wrapper.findAll('.record-card-spell-img')).toHaveLength(0)
  })

  it('日期常显：模式行以 MM-DD HH:mm 开头（R5：回溯无需悬停）', () => {
    const wrapper = mountCard(gameOf())
    expect(wrapper.find('.record-card-mode').text()).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}/)
  })

  it('ISO 字符串日期按本地时区格式化（不显示 UTC 原文）', () => {
    const iso = new Date(Date.UTC(2026, 7, 16, 4, 13, 14)).toISOString()
    const wrapper = mountCard(gameOf({ gameCreationDate: iso }))
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    const expected = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    expect(wrapper.find('.record-card-mode').text()).toContain(expected)
  })

  it('数值毫秒戳与 ISO 字符串解析结果一致（同为本地时区）', () => {
    const iso = new Date(Date.UTC(2026, 7, 16, 4, 13, 14)).toISOString()
    const ms = String(new Date(iso).getTime())
    const isoWrapper = mountCard(gameOf({ gameCreationDate: iso }))
    const msWrapper = mountCard(gameOf({ gameCreationDate: ms }))
    expect(isoWrapper.find('.tooltip-content').text()).toBe(
      msWrapper.find('.tooltip-content').text()
    )
  })

  it('无法解析的日期显示原文', () => {
    const wrapper = mountCard(gameOf({ gameCreationDate: 'not-a-date' }))
    expect(wrapper.find('.record-card-mode').text()).toContain('not-a-date')
  })

  it('参团率透传：55 → 55%参团', () => {
    const wrapper = mountCard(gameOf())
    expect(wrapper.find('.record-card-group-rate').text()).toBe('55%参团')
  })

  it('CHERRY 局名次标签优先（第 N 名）', () => {
    const wrapper = mountCard(
      gameOf({
        gameMode: 'CHERRY',
        queueId: 1700,
        participants: [participant({ stats: { ...participant().stats, subteamPlacement: 3 } })]
      })
    )
    expect(wrapper.find('.record-card-result-label').text()).toBe('第 3 名')
  })
})

describe('RecordCard 键盘可达性（R22-3）', () => {
  it('role=button + tabindex=0；Enter 与 Space 均触发 open-detail', async () => {
    const wrapper = mountCard(gameOf())
    const card = wrapper.find('.record-card')
    expect(card.attributes('role')).toBe('button')
    expect(card.attributes('tabindex')).toBe('0')
    await card.trigger('keyup.enter')
    expect(wrapper.emitted('open-detail')).toHaveLength(1)
    await card.trigger('keydown.space')
    expect(wrapper.emitted('open-detail')).toHaveLength(2)
    wrapper.unmount()
  })
})
