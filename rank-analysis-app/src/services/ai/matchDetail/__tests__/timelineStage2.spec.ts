/**
 * 时间线接入 Stage 2 的测试：prompt 替换、引用过滤、引用角标渲染。
 */
import { describe, it, expect } from 'vitest'
import { buildStage2Prompt } from '../prompts/stage2-critique'
import { buildStage2PlayerPrompt } from '../prompts/stage2-player'
import { stripInvalidCitations } from '../postprocess'
import { renderAnalysisReport } from '../renderReport'
import type { MatchSnapshot } from '../../shared/snapshot'
import { visibleCards, type TimelineCard } from '../../shared/timeline'
import type { AttributionResult } from '../types'

const cards: TimelineCard[] = [
  {
    id: 'T1',
    kind: 'turn',
    subjects: [],
    minute: 18,
    text: '18:00-20:00 经济转折',
    numbers: [18, 0, 20],
    weight: 3
  },
  {
    id: 'D2',
    kind: 'death',
    subjects: [4, 7],
    minute: 14.5,
    text: '14:32 卡莎 死于小龙坑',
    numbers: [14, 32],
    weight: 3
  }
]
const base = {
  gameId: 1,
  modeContext: {
    kind: 'ranked',
    description: '排位',
    hasLanes: true,
    hasItemBuild: true,
    hasAugmentSystem: false,
    championAssignment: 'pick',
    isTeamMode: true
  },
  players: [
    {
      participantId: 4,
      teamId: 100,
      teamPosition: 'BOTTOM',
      champion: '卡莎',
      name: '玩家4',
      win: false
    }
  ]
}
const snap = (tl: boolean) =>
  ({ ...base, timeline: tl ? { cards } : undefined }) as unknown as MatchSnapshot
const attribution: AttributionResult = { winReason: 'x', verdicts: [] }

const BRACKET_RULE = '禁止发明任何别的方括号标记（如 [TS]）'

describe('stage2 prompts with timeline', () => {
  it('overview: unchanged without timeline; cards + citation rule with it', () => {
    expect(buildStage2Prompt(attribution, snap(false), [])).toContain('**禁止过程性行为叙事**')
    const p = buildStage2Prompt(attribution, snap(true), [])
    expect(p).toContain('[T1] 18:00-20:00 经济转折')
    expect(p).toContain('**过程性描述必须带卡片编号**')
    expect(p).not.toContain('**禁止过程性行为叙事**')
    expect(p).toContain(BRACKET_RULE)
    expect(p).not.toMatch(/TS 算好|TS 从/)
  })

  it('player: adds 关键时刻 section and own cards; extraMaterial appended', () => {
    const without = buildStage2PlayerPrompt(attribution, snap(false), 4, [])
    expect(without).not.toContain('## 关键时刻')
    const p = buildStage2PlayerPrompt(attribution, snap(true), 4, [], '0:10 击杀 原始行')
    expect(p).toContain('## 关键时刻')
    expect(p).toContain(BRACKET_RULE)
    expect(p).not.toMatch(/TS 算好|TS 从/)
    expect(p).toContain('[D2] 14:32 卡莎 死于小龙坑')
    expect(p).toContain('[T1] 18:00-20:00 经济转折')
    expect(p).toContain('【本人关键时刻原始事件】')
    expect(p).toContain('0:10 击杀 原始行')
  })
})

describe('citations', () => {
  it('should drop sentences citing unknown cards', () => {
    const md = '## 关键时刻\n- [D2] 14:32 送了一波。[D9] 编的一句。\n- 正常句子。'
    expect(stripInvalidCitations(md, new Set(['D2']))).toBe(
      '## 关键时刻\n- [D2] 14:32 送了一波。\n- 正常句子。'
    )
  })

  it('should render citation badges with card text as title', () => {
    const html = renderAnalysisReport(
      '## 关键时刻\n- [D2] 14:32 送了一波。',
      undefined,
      undefined,
      cards
    )
    expect(html).toContain('<sup class="ai-cite" title="14:32 卡莎 死于小龙坑">D2</sup>')
    expect(html).not.toContain('[D2]')
  })
})

describe('citations against the visible card set', () => {
  // 玩家 4 有 3 张同权重死亡卡：整局只展示前 1 张，D2/D3 只在全量卡里
  const own = (id: string, minute: number): TimelineCard => ({
    id,
    kind: 'death',
    subjects: [4, 7],
    minute,
    text: `${id} 原文`,
    numbers: [minute],
    weight: 1
  })
  const all = [cards[0], own('D1', 5), own('D2', 9), own('D3', 12)]

  it('strips a sentence citing a card that exists but was not shown to the model', () => {
    const visible = visibleCards(all, 'overview')
    expect(visible.map(c => c.id)).toEqual(['T1', 'D1'])
    const html = renderAnalysisReport(
      '## 一句话定论\n蓝方赢在 [T1]。卡莎 [D2] 又送了。',
      undefined,
      undefined,
      visible
    )
    expect(html).toContain('<sup class="ai-cite" title="18:00-20:00 经济转折">T1</sup>')
    expect(html).not.toContain('D2')
  })

  it('player mode also accepts the player-only card', () => {
    expect(visibleCards(all, 'player', 4).map(c => c.id)).toEqual(['T1', 'D1', 'D2', 'D3'])
  })
})

describe('player prompt teammate context', () => {
  const mate = (
    participantId: number,
    name: string,
    champion: string,
    teamPosition: string,
    kda: [number, number, number],
    goldShare: number
  ) => ({
    participantId,
    teamId: 100,
    teamPosition,
    champion,
    name,
    win: false,
    kills: kda[0],
    deaths: kda[1],
    assists: kda[2],
    goldShare
  })
  const enemy = { ...mate(7, '敌人', '妖姬', 'BOTTOM', [1, 1, 1], 20), teamId: 200 }
  const players = [
    mate(4, '玩家4', '卡莎', 'BOTTOM', [2, 6, 3], 18.5),
    mate(1, '队友甲', '剑魔', 'TOP', [1, 8, 2], 15.2),
    mate(3, '队友丙', '发条', 'MIDDLE', [5, 2, 4], 22),
    mate(2, '队友乙', '盲僧', 'JUNGLE', [3, 4, 6], 19),
    enemy
  ]
  const teamContext = {
    1: { laneGoldDiff14: -2100, deaths: 8, deathsAfterTeammatesDown: 1 },
    2: { laneGoldDiff14: 300, deaths: 4, deathsAfterTeammatesDown: 0 },
    3: { laneGoldDiff14: -1500, deaths: 2, deathsAfterTeammatesDown: 0 },
    4: { laneGoldDiff14: null, deaths: 6, deathsAfterTeammatesDown: 4 },
    7: { laneGoldDiff14: 900, deaths: 1, deathsAfterTeammatesDown: 0 }
  }
  const make = (hasLanes: boolean, ctx: object | undefined = teamContext) =>
    ({
      ...base,
      modeContext: { ...base.modeContext, hasLanes },
      players,
      timeline: { cards, teamContext: ctx }
    }) as unknown as MatchSnapshot
  const attr: AttributionResult = {
    winReason: 'x',
    verdicts: [
      {
        participantId: 1,
        name: '队友甲',
        label: '犯罪',
        evidenceMetrics: [],
        mitigatingFactors: [],
        finalCall: 'y'
      }
    ]
  } as unknown as AttributionResult

  it('lists teammates sorted by participantId with lane diff and verdict label', () => {
    const p = buildStage2PlayerPrompt(attr, make(true), 4, [])
    expect(p).toContain('【队友状况】（系统预先算好的事实）')
    const lines = p.split('\n').filter(l => /^- 队友[甲乙丙]/.test(l))
    expect(lines).toEqual([
      '- 队友甲｜剑魔｜TOP｜KDA 1/8/2｜经济占比 15.2%｜整局判定 犯罪｜14分钟对位经济落后 2100',
      '- 队友乙｜盲僧｜JUNGLE｜KDA 3/4/6｜经济占比 19%｜14分钟对位经济领先 300',
      '- 队友丙｜发条｜MIDDLE｜KDA 5/2/4｜经济占比 22%｜14分钟对位经济落后 1500'
    ])
    expect(p).not.toContain('- 敌人')
  })

  it('renders lane gold as 领先/落后/持平 text, never a signed number', () => {
    const ctx = {
      ...teamContext,
      1: { ...teamContext[1], laneGoldDiff14: 2283 },
      2: { ...teamContext[2], laneGoldDiff14: 0 },
      3: { ...teamContext[3], laneGoldDiff14: -103 }
    }
    const p = buildStage2PlayerPrompt(attr, make(true, ctx), 4, [])
    expect(p).toContain('14分钟对位经济领先 2283')
    expect(p).toContain('14分钟与对位经济持平')
    expect(p).toContain('14分钟对位经济落后 103')
    expect(p).not.toContain('经济差')
    expect(p).not.toContain('+2283')
    expect(p).not.toContain('-103')
  })

  it('omits lane and diff segments without lanes', () => {
    const p = buildStage2PlayerPrompt(attr, make(false), 4, [])
    expect(p).toContain('- 队友甲｜剑魔｜KDA 1/8/2｜经济占比 15.2%｜整局判定 犯罪')
    expect(p).not.toContain('死亡 ')
    expect(p).not.toContain('14分钟')
    expect(p).not.toContain('MIDDLE')
    expect(p).not.toContain('队友中')
  })

  it('renders team situation counts and laggards over 1500 (strictly)', () => {
    const p = buildStage2PlayerPrompt(attr, make(true), 4, [])
    expect(p).toContain('【团队处境】')
    expect(p).toContain('- 你阵亡 6 次，其中 4 次发生在 ≥2 名队友已先阵亡（30 秒内）之后')
    expect(p).toContain('- 队友中 1 人 14 分钟对线落后超过 1500 经济：队友甲（落后 2100）')
    expect(p).toContain('（必须引用【团队处境】里的至少一个数字）')
    expect(p).toContain('「责任归因」必须结合【队友状况】与【团队处境】')
  })

  it('uses the snapshot (LCU) deaths for 你阵亡, not the timeline count', () => {
    // 战绩死亡 6（快照），时间线 teamContext 口径给 9：团队处境必须用 6
    const skewed = { ...teamContext, 4: { ...teamContext[4], deaths: 9 } }
    const p = buildStage2PlayerPrompt(attr, make(true, skewed), 4, [])
    expect(p).toContain('- 你阵亡 6 次，其中 4 次发生在 ≥2 名队友已先阵亡（30 秒内）之后')
    expect(p).not.toContain('你阵亡 9 次')
  })

  it('omits the blame rule and citation when the team block is not rendered', () => {
    const noMine = { ...teamContext, 4: undefined }
    const p = buildStage2PlayerPrompt(attr, make(true, noMine), 4, [])
    expect(p).not.toContain('【团队处境】')
    expect(p).not.toContain('必须结合【队友状况】与【团队处境】')
    expect(p).not.toContain('必须引用【团队处境】')
  })

  it('omits the laggard line when nobody is far behind', () => {
    const calm = { ...teamContext, 1: { ...teamContext[1], laneGoldDiff14: -100 } }
    const p = buildStage2PlayerPrompt(attr, make(true, calm), 4, [])
    expect(p).toContain('【团队处境】')
    expect(p).not.toContain('队友中')
  })

  it('adds nothing without timeline and leaves the overview prompt alone', () => {
    const none = { ...make(true), timeline: undefined } as unknown as MatchSnapshot
    const p = buildStage2PlayerPrompt(attr, none, 4, [])
    expect(p).not.toContain('【队友状况】')
    expect(p).not.toContain('【团队处境】')
    expect(p).not.toContain('必须引用【团队处境】')
    const o = buildStage2Prompt(attr, make(true), [])
    expect(o).not.toContain('【队友状况】')
    expect(o).not.toContain('【团队处境】')
  })
})
