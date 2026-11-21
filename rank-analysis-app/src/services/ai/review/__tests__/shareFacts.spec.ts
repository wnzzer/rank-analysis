/**
 * shareFacts：各事实生成器的阈值、口吻筛选、角度轮换，以及两局入库回归局上的端到端构建。
 */
import { describe, it, expect } from 'vitest'
import type { Game } from '@renderer/types/domain/match'
import { buildPuuidMap, remapTimeline } from '../../shared/timeline/remap'
import type { SlimTimeline } from '../../shared/timeline/types'
import a from '../../shared/scoring/__tests__/fixtures/regression-a.json'
import b from '../../shared/scoring/__tests__/fixtures/regression-b.json'
import { reviewModelFromGame, type DeathView, type PlayerView } from '../buildReviewModel'
import {
  angleCount,
  buildShareCard,
  factsForTone,
  LABEL_COPY,
  MAX_ANGLES,
  pickAngle,
  shareFacts,
  type ShareFact
} from '../shareFacts'

function death(over: Partial<DeathView> = {}): DeathView {
  return {
    index: 0,
    cardId: null,
    ms: 600000,
    time: '10:00',
    zone: '中路',
    killer: '英雄1',
    assists: [],
    kind: 'fight',
    kindCn: '团战阵亡',
    resp: 'fight',
    blame: 0.6,
    enemies: 2,
    allies: 2,
    traded: false,
    x: 0,
    y: 0,
    ...over
  }
}

function player(over: Partial<PlayerView> = {}): PlayerView {
  return {
    participantId: 1,
    teamId: 100,
    side: 'blue',
    name: '我',
    champion: '亚索',
    championId: 157,
    isMe: true,
    win: false,
    kills: 5,
    deaths: 5,
    assists: 5,
    position: 'MIDDLE',
    roleCn: '中路',
    label: '正常',
    total: 0,
    rank: null,
    parts: [],
    flags: [],
    deathList: null,
    deathCounts: null,
    deathSummary: '',
    items: [],
    opponentId: null,
    ...over
  }
}

const kinds = (facts: ShareFact[]) => facts.map(f => f.kind)

describe('归责事实', () => {
  it('本人责任 ≤ 50% 阵亡：洗冤句，依据按次数取前两类', () => {
    const me = player({
      deaths: 5,
      deathList: [
        death({ kind: 'collapse', blame: 0.3 }),
        death({ kind: 'collapse', blame: 0.3 }),
        death({ kind: 'fight', blame: 0.4, enemies: 4, allies: 2 }),
        death({ kind: 'ganked', blame: 0.5 }),
        death({ kind: 'solo', blame: 1 })
      ]
    })
    const [f] = shareFacts(me, [me]).filter(x => x.kind === 'blame')
    expect(f.polarity).toBe('good')
    expect(f.headline).toBe('5 次阵亡，本人责任只算 2.5 次')
    expect(f.detail).toBe('队友先崩 2 次 · 以少打多 1 次')
  })

  it('阵亡不足 3 次不谈归责', () => {
    const me = player({ deathList: [death({ blame: 0 }), death({ blame: 0 })] })
    expect(kinds(shareFacts(me, [me]))).not.toContain('blame')
  })

  it('≥5 次且几乎全是自己的锅：自嘲句（bad）；介于两者之间不出', () => {
    const solo = Array.from({ length: 6 }, () => death({ kind: 'solo', blame: 1 }))
    const roast = shareFacts(player({ deathList: solo }), [])
    expect(roast[0]).toMatchObject({
      kind: 'blame',
      polarity: 'bad',
      headline: '6 次阵亡，6 次算自己的',
      detail: '被单杀 / 落单 6 次'
    })
    const mid = Array.from({ length: 5 }, () => death({ blame: 0.75 }))
    expect(kinds(shareFacts(player({ deathList: mid }), []))).not.toContain('blame')
  })

  it('无时间线（deathList 为 null）不出归责与牵制', () => {
    expect(shareFacts(player(), [])).toEqual([])
  })
})

describe('牵制换资源', () => {
  it('一次：说清几包几；多次：说次数；分数高于普通事实', () => {
    const once = shareFacts(
      player({ deathList: [death({ traded: true, enemies: 4, allies: 1, time: '24:10' })] }),
      []
    )
    expect(once[0]).toMatchObject({
      kind: 'traded',
      headline: '被 4 包 1 拖住，队友趁机拿到资源',
      detail: '24:10 中路'
    })
    const twice = shareFacts(
      player({ deathList: [death({ traded: true }), death({ traded: true })] }),
      []
    )
    expect(twice[0].headline).toBe('2 次以少打多拖住对面，队友趁机拿到资源')
  })
})

describe('反差事实', () => {
  const mates = (me: PlayerView) => [
    me,
    player({ participantId: 2, isMe: false, kills: 10, deaths: 1, assists: 5, total: -1 }),
    player({ participantId: 3, isMe: false, kills: 8, deaths: 2, assists: 5, total: -0.5 }),
    player({ participantId: 4, isMe: false, kills: 3, deaths: 3, assists: 3, total: -0.8 })
  ]

  it('KDA 垫底但评分第一：good', () => {
    const me = player({ kills: 1, deaths: 6, assists: 2, total: 1 })
    const f = shareFacts(me, mates(me)).find(x => x.kind === 'contrast')!
    expect(f).toMatchObject({
      headline: 'KDA 队内第 4，评分队内第 1',
      detail: '数据不好看，活没少干',
      polarity: 'good'
    })
  })

  it('KDA 第一但评分垫底：bad', () => {
    const me = player({ kills: 20, deaths: 0, assists: 5, total: -2 })
    const f = shareFacts(me, mates(me)).find(x => x.kind === 'contrast')!
    expect(f).toMatchObject({ headline: 'KDA 队内第 1，评分队内第 4', polarity: 'bad' })
  })

  it('名次差 < 2 不算反差；队伍不足 3 人不比', () => {
    const me = player({ kills: 3, deaths: 3, assists: 4, total: -0.6 })
    expect(kinds(shareFacts(me, mates(me)))).not.toContain('contrast')
    expect(kinds(shareFacts(me, [me]))).not.toContain('contrast')
  })
})

describe('分项与分位', () => {
  it('只取大幅领先 / 大幅落后，依据取第一条数据', () => {
    const me = player({
      parts: [
        {
          key: 'lane',
          cn: '对线',
          value: 2.1,
          bar: 2.1,
          level: '大幅领先',
          stats: ['14 分钟领先 1200']
        },
        { key: 'teamfight', cn: '团战', value: 0.8, bar: 0.8, level: '领先', stats: [] },
        { key: 'growth', cn: '发育', value: -1.8, bar: -1.8, level: '大幅落后', stats: [] }
      ]
    })
    const facts = shareFacts(me, [])
    expect(facts.filter(f => f.kind === 'standout').map(f => [f.headline, f.polarity])).toEqual([
      ['对线大幅领先同位置同英雄', 'good'],
      ['发育大幅落后同位置同英雄', 'bad']
    ])
    expect(facts.find(f => f.headline.startsWith('对线'))!.detail).toBe('14 分钟领先 1200')
  })

  it('分位前 / 后 20% 以内才上卡', () => {
    const top = shareFacts(player({ rank: '大约处于同位置玩家的前 5%' }), [])
    expect(top[0]).toMatchObject({ headline: '本局表现约在同位置玩家前 5%', polarity: 'good' })
    expect(shareFacts(player({ rank: '大约处于同位置玩家的前 30%' }), [])).toEqual([])
    expect(shareFacts(player({ rank: '大约处于同位置玩家的后 10%' }), [])[0].polarity).toBe('bad')
  })
})

describe('口吻与角度', () => {
  const facts: ShareFact[] = [
    { kind: 'traded', headline: 'T', detail: null, score: 4, polarity: 'good' },
    { kind: 'blame', headline: 'B', detail: null, score: 3, polarity: 'good' },
    { kind: 'contrast', headline: 'C', detail: null, score: 2.5, polarity: 'bad' },
    { kind: 'standout', headline: 'S', detail: null, score: 2, polarity: 'good' },
    { kind: 'rank', headline: 'R', detail: null, score: 1.5, polarity: 'good' }
  ]

  it('自嘲只要负面，其余口吻只要正面', () => {
    expect(factsForTone(facts, 'roast').map(f => f.headline)).toEqual(['C'])
    for (const tone of ['brag', 'vindicate', 'neutral'] as const)
      expect(factsForTone(facts, tone).map(f => f.headline)).toEqual(['T', 'B', 'S', 'R'])
  })

  it('角度在前 MAX_ANGLES 条里轮换，支撑取其余最高的两条', () => {
    const good = factsForTone(facts, 'brag')
    expect(angleCount(good)).toBe(MAX_ANGLES)
    expect(pickAngle(good, 0)).toMatchObject({ headline: { headline: 'T' } })
    expect(pickAngle(good, 0).support.map(f => f.headline)).toEqual(['B', 'S'])
    expect(pickAngle(good, 1).headline!.headline).toBe('B')
    expect(pickAngle(good, 1).support.map(f => f.headline)).toEqual(['T', 'S'])
    expect(pickAngle(good, MAX_ANGLES).headline!.headline).toBe('T')
    expect(pickAngle([], 2)).toEqual({ headline: null, support: [] })
  })

  it('入口分级：被连累 / Carry / 尽力直接展开，犯罪 / 缚地灵只给自嘲入口', () => {
    expect(LABEL_COPY['被连累'].tier).toBe('primary')
    expect(LABEL_COPY.Carry.tier).toBe('primary')
    expect(LABEL_COPY['尽力'].tier).toBe('primary')
    expect(LABEL_COPY['犯罪']).toMatchObject({ tier: 'opt-in', tone: 'roast' })
    expect(LABEL_COPY['缚地灵']).toMatchObject({ tier: 'opt-in', tone: 'roast' })
  })
})

describe('buildShareCard：回归局', () => {
  function modelOf(fx: unknown) {
    const { game, slim } = fx as { game: Game; slim: SlimTimeline }
    return reviewModelFromGame(game, remapTimeline(slim, buildPuuidMap(game)))
  }

  for (const [name, fx] of [
    ['A', a],
    ['B', b]
  ] as const) {
    it(`局 ${name}：本人卡片字段齐全，事实与口吻一致，事实排序稳定`, () => {
      const model = modelOf(fx)
      const card = buildShareCard(model)!
      const me = Object.values(model.players).find(p => p.isMe)!
      expect(card).toMatchObject({ label: me.label, champion: me.champion, win: me.win })
      expect(card.copy).toBe(LABEL_COPY[me.label])
      const want = card.copy.tone === 'roast' ? 'bad' : 'good'
      expect(card.facts.every(f => f.polarity === want)).toBe(true)
      for (let i = 1; i < card.facts.length; i++)
        expect(card.facts[i - 1].score).toBeGreaterThanOrEqual(card.facts[i].score)
      expect(buildShareCard(modelOf(fx))).toEqual(card)
    })
  }

  it('自嘲版：传 roast 只留负面事实', () => {
    const card = buildShareCard(modelOf(b), 'roast')!
    expect(card.facts.every(f => f.polarity === 'bad')).toBe(true)
  })

  it('找不到本人返回 null', () => {
    const model = modelOf(a)
    const players = Object.fromEntries(
      Object.entries(model.players).map(([k, p]) => [k, { ...p, isMe: false }])
    )
    expect(buildShareCard({ ...model, players })).toBeNull()
  })
})
