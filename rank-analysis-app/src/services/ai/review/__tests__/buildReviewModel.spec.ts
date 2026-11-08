/**
 * buildReviewModel：两份入库匿名回归局（单双排，带时间线）+ 构造的无时间线 / 无分路 / 无基准输入。
 * 断言对位分组、等级词、阵亡分类计数、曲线点数与标记、出装时间、异常标签、默认选中本人。
 * 固定事实来自 fixture（regression-a：本人 pid 4 蓝方下路、红方胜；regression-b：本人 pid 9 红方下路、蓝方胜）。
 */
import { describe, it, expect } from 'vitest'
import type { Game } from '@renderer/types/domain/match'
import { DEATH_PLAIN } from '../../matchDetail/plainScore'
import { scoreSnapshot } from '../../shared/scoring/match'
import { buildMatchSnapshot } from '../../shared/snapshot'
import { buildPuuidMap, remapTimeline } from '../../shared/timeline/remap'
import type { SlimTimeline } from '../../shared/timeline/types'
import a from '../../shared/scoring/__tests__/fixtures/regression-a.json'
import b from '../../shared/scoring/__tests__/fixtures/regression-b.json'
import {
  BAR_LIMIT,
  buildReviewModel,
  RESPONSIBILITY_CN,
  RESPONSIBILITY_OF,
  reviewModelFromGame,
  type DeathView
} from '../buildReviewModel'

function load(fx: unknown, patch: Partial<Game> = {}, withTimeline = true) {
  const { game, slim } = fx as { game: Game; slim: SlimTimeline }
  const g = { ...game, ...patch }
  const tl = withTimeline ? remapTimeline(slim, buildPuuidMap(g)) : null
  return { game: g, tl, model: reviewModelFromGame(g, tl) }
}

const LEVELS = ['大幅落后', '落后', '持平', '领先', '大幅领先']

describe('责任分档', () => {
  it('与 plainScore.DEATH_PLAIN 的 tag 一致', () => {
    for (const [kind, plain] of Object.entries(DEATH_PLAIN)) {
      const resp = RESPONSIBILITY_OF[kind as keyof typeof DEATH_PLAIN]
      if (plain.tag) expect(RESPONSIBILITY_CN[resp]).toBe(plain.tag)
      else expect(['fight', 'other']).toContain(resp)
    }
  })
})

describe('buildReviewModel：回归局 B（单双排、有时间线）', () => {
  const { model } = load(b)

  it('标题行：蓝方胜、击杀比、时长、胜负关键不含编号', () => {
    expect(model.header.winner).toBe('blue')
    expect(model.header.kills).toEqual({ blue: 59, red: 57 })
    expect(model.header.durationText).toBe('37 分钟')
    expect(model.header.queueName).toBe('对局')
    expect(model.header.keyReason.startsWith('蓝方')).toBe(true)
    expect(model.header.keyReason).toContain('11:00-13:00 经济转折')
    expect(model.header.keyReason).toMatch(/\d+:\d{2} 关键团战/)
    expect(model.header.keyReason).not.toContain('[')
  })

  it('对位总览按五路成行，14 分钟经济差以蓝方为正', () => {
    expect(model.matchup.kind).toBe('lanes')
    if (model.matchup.kind !== 'lanes') return
    expect(model.matchup.rows.map(r => r.position)).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY'
    ])
    const bot = model.matchup.rows[3]
    expect(bot).toMatchObject({ posCn: '下', blue: 4, red: 9, goldDiff14: 1700 })
    expect(model.matchup.rows[0].goldDiff14).toBe(-530)
  })

  it('默认选中本人', () => {
    expect(model.defaultPid).toBe(9)
    const me = model.players[9]
    expect(me).toMatchObject({ isMe: true, side: 'red', roleCn: '下路（ADC）', opponentId: 4 })
  })

  it('个人卡：下路五项（无视野），等级词与条长', () => {
    const me = model.players[9]
    expect(me.parts.map(x => x.key)).toEqual([
      'lane',
      'teamfight',
      'deathQuality',
      'growth',
      'resources'
    ])
    expect(me.parts[0].level).toBe('大幅落后')
    expect(me.parts[1].level).toBe('领先')
    for (const part of me.parts) {
      expect(LEVELS).toContain(part.level)
      expect(Math.abs(part.bar)).toBeLessThanOrEqual(BAR_LIMIT)
      expect(Array.isArray(part.stats)).toBe(true)
    }
    expect(me.parts[0].stats[0]).toBe('14 分钟对位经济落后 1700')
    expect(me.rank).toMatch(/^大约处于同位置玩家的(前|后) \d+%$/)
  })

  it('阵亡列表：时间、地点、击杀者、责任与分类计数', () => {
    const me = model.players[9]
    expect(me.deathList).toHaveLength(11)
    const first = me.deathList![0]
    expect(first).toMatchObject({
      index: 0,
      time: '4:54',
      zone: '下路（红方半场）',
      killer: '英雄45',
      assists: [],
      kind: 'other',
      kindCn: '其他',
      resp: 'other',
      x: 13773,
      y: 3917
    })
    expect(first.cardId).toMatch(/^D\d+$/)
    expect(me.deathCounts).toEqual({ self: 4, partial: 1, excused: 2, fight: 2, other: 2 })
    expect(me.deathSummary.startsWith('11 次阵亡：')).toBe(true)
  })

  it('阵亡找不到对应击杀事件：坐标为 null（不当作蓝方基地 0,0），地点未知', () => {
    const { game, tl } = load(b)
    const snapshot = buildMatchSnapshot(game, undefined, tl)
    const first = model.players[9].deathList![0]
    // 只删掉视图层用来取坐标的那条击杀事件：阵亡本身（snapshot 预算）不变
    const stripped = {
      ...tl!,
      events: tl!.events.filter(
        e => !(e.type === 'CHAMPION_KILL' && e.victimId === 9 && e.timestamp === first.ms)
      )
    }
    const m = buildReviewModel(snapshot, scoreSnapshot(snapshot), stripped)
    const d = m.players[9].deathList![0]
    expect(d.x).toBeNull()
    expect(d.y).toBeNull()
    expect(d.zone).toBe('位置未知')
    expect(m.players[9].deathList![1].x).not.toBeNull()
  })

  it('出装：成型装按时间，鞋与传说装分类', () => {
    const me = model.players[9]
    expect(me.items[0]).toMatchObject({ name: '明朗之靴', kind: 'boots', time: '8:27' })
    expect(me.items[1]).toMatchObject({ name: '黯炎火炬', kind: 'legendary', time: '10:28' })
    expect(model.medianFirstLegendaryMs).not.toBeNull()
  })

  it('异常小标签：大招晚点、第一件传说装比对位晚 ≥2 分钟', () => {
    expect(model.players[4].flags).toContain('大招晚点')
    expect(model.players[8].flags).toContain('大招晚点')
    expect(model.players[6].flags).toContain('第一件传说装比对位晚 3.7 分钟')
    expect(model.players[9].flags).toEqual([])
  })

  it('经济曲线：逐分钟点、团战与资源标记', () => {
    const curve = model.goldCurve!
    expect(curve.points).toHaveLength(39)
    expect(curve.points[0].minute).toBe(0)
    const fights = curve.markers.filter(m => m.kind === 'fight')
    const objectives = curve.markers.filter(m => m.kind === 'objective')
    expect(fights).toHaveLength(18)
    expect(objectives).toHaveLength(13)
    expect(fights[0]).toMatchObject({ id: 'F1', title: '6:53 下半河道团战（13 秒）' })
    if (fights[0].kind === 'fight') {
      expect(fights[0].lines).toHaveLength(4)
      expect(fights[0].lines[0]).toBe('人头 蓝方2:2红方')
    }
    expect(objectives[0]).toMatchObject({ id: 'O1', side: 'red', title: '7:37 红方拿下小龙' })
    expect(objectives[0]).toMatchObject({ monster: 'DRAGON' })
    expect(
      objectives.every(m => m.kind === 'objective' && m.monster !== '' && m.subType !== undefined)
    ).toBe(true)
    const minutes = curve.markers.map(m => m.minute)
    expect(minutes).toEqual([...minutes].sort((x, y) => x - y))
    expect(curve.maxAbs).toBeGreaterThanOrEqual(
      Math.max(...curve.points.map(p => Math.abs(p.diff)))
    )
    expect(curve.endMinute).toBeCloseTo(2246574 / 60000, 3)
  })

  it('能力位全开', () => {
    expect(model).toMatchObject({
      hasTimeline: true,
      hasLanes: true,
      hasItemBuild: true,
      hasBaseline: true,
      mapId: 11,
      durationMs: 2246000
    })
  })

  it('确定性：同输入两次结果相同', () => {
    expect(load(b).model).toEqual(model)
  })
})

describe('buildReviewModel：回归局 A', () => {
  const { model } = load(a)

  it('红方胜，本人 pid 4 的阵亡全部是团战中/其他', () => {
    expect(model.header.winner).toBe('red')
    expect(model.header.kills).toEqual({ blue: 40, red: 44 })
    expect(model.defaultPid).toBe(4)
    const me = model.players[4]
    expect(me.deathCounts).toEqual({ self: 0, partial: 0, excused: 0, fight: 5, other: 4 })
    expect(me.deathList![0]).toMatchObject({ time: '2:24', killer: '英雄99', assists: ['英雄236'] })
  })

  it('曲线与标记数量', () => {
    const curve = model.goldCurve!
    expect(curve.points).toHaveLength(42)
    expect(curve.markers.filter(m => m.kind === 'fight')).toHaveLength(14)
    expect(curve.markers.filter(m => m.kind === 'objective')).toHaveLength(12)
  })

  it('下路对位经济差', () => {
    if (model.matchup.kind !== 'lanes') throw new Error('expected lanes')
    expect(model.matchup.rows[3].goldDiff14).toBe(-1209)
  })
})

describe('buildReviewModel：无时间线', () => {
  const { model } = load(b, {}, false)

  it('曲线为空、阵亡不细分、无对线项、对位无经济差', () => {
    expect(model.hasTimeline).toBe(false)
    expect(model.goldCurve).toBeNull()
    const me = model.players[9]
    expect(me.deathList).toBeNull()
    expect(me.deathCounts).toBeNull()
    expect(me.deathSummary).toBe('阵亡 11 次（无时间线，无法细分）')
    expect(me.items).toEqual([])
    expect(me.parts.map(x => x.key)).not.toContain('lane')
    expect(model.matchup.kind).toBe('lanes')
    if (model.matchup.kind === 'lanes')
      expect(model.matchup.rows.every(r => r.goldDiff14 === null)).toBe(true)
  })
})

describe('buildReviewModel：无分路（大乱斗）', () => {
  const { game, tl, model } = load(b, { queueId: 450, gameMode: 'ARAM' })

  it('两队并列，队内按总分降序', () => {
    expect(model.hasLanes).toBe(false)
    expect(model.matchup.kind).toBe('teams')
    if (model.matchup.kind !== 'teams') return
    expect(model.matchup.teams.map(t => [t.teamId, t.side])).toEqual([
      [100, 'blue'],
      [200, 'red']
    ])
    const totals = new Map(
      scoreSnapshot(buildMatchSnapshot(game, undefined, tl)).map(s => [s.participantId, s.total])
    )
    for (const team of model.matchup.teams) {
      const ts = team.players.map(pid => totals.get(pid) ?? 0)
      expect(ts).toEqual([...ts].sort((x, y) => y - x))
    }
  })

  it('无对位、分项只取无分路权重项、出装参照全场中位', () => {
    const me = model.players[9]
    expect(me.opponentId).toBeNull()
    expect(me.roleCn).toBe('无分路')
    for (const part of me.parts) expect(['teamfight', 'deathQuality', 'growth']).toContain(part.key)
    expect(model.medianFirstLegendaryMs).not.toBeNull()
    for (const p of Object.values(model.players))
      for (const f of p.flags) expect(f.startsWith('大招晚点') || f.includes('全场中位')).toBe(true)
  })
})

describe('buildReviewModel：无国服基准的队列（斗魂竞技场）', () => {
  const { model } = load(b, { queueId: 1700, gameMode: 'CHERRY' })

  it('不显示分位，标签照常，无出装', () => {
    expect(model.hasBaseline).toBe(false)
    expect(model.hasItemBuild).toBe(false)
    for (const p of Object.values(model.players)) {
      expect(p.rank).toBeNull()
      expect(p.label).toBeTruthy()
      expect(p.items).toEqual([])
    }
  })
})

describe('DeathView 类型守护', () => {
  it('cardId 指向本人 D 卡', () => {
    const { model } = load(b)
    const list = model.players[9].deathList as DeathView[]
    expect(list.every(d => d.cardId === null || /^D\d+$/.test(d.cardId))).toBe(true)
  })
})
