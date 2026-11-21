/**
 * rebuttal：分歧判定、触发条件、指纹、事实卡、提示词、解析校验与保底、调用入口。
 * 视图模型用入库回归局 B。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modelPicks } from '@renderer/services/matchLabel'
import { modelB } from '@renderer/components/record/review/__tests__/fixtureModels'
import {
  REBUTTAL_FALLBACK_REPLY,
  REBUTTAL_MAX_REPLY,
  REBUTTAL_SYSTEM_PROMPT,
  REBUTTAL_TIMEOUT_MS,
  buildRebuttalPrompt,
  findDisputes,
  parseRebuttal,
  playerFacts,
  rebuttalBasis,
  requestRebuttal,
  shouldRebut
} from '../rebuttal'

const h = vi.hoisted(() => ({ stream: vi.fn(), resolveModel: vi.fn() }))
vi.mock('../../stream', () => ({
  DEFAULT_MODEL: 'default-model',
  requestAIContentStream: h.stream
}))
vi.mock('../../modelConfig', () => ({ resolveModel: h.resolveModel }))

const model = modelB({ timeline: true })
const players = Object.values(model.players).sort((a, b) => a.participantId - b.participantId)
const picks = modelPicks(players)
/** 一个既不是模型最关键、也不是模型最犯罪的人 */
const other = players.find(
  p => p.participantId !== picks.keyPid && p.participantId !== picks.blamePid
)!

describe('findDisputes', () => {
  it('should report no dispute when the player agrees with the model', () => {
    expect(findDisputes({ keyPid: picks.keyPid, blamePid: picks.blamePid }, players)).toEqual([])
  })

  it('should report only the rows that differ', () => {
    const d = findDisputes({ keyPid: picks.keyPid, blamePid: other.participantId }, players)

    expect(d).toHaveLength(1)
    expect(d[0].kind).toBe('blame')
    expect(d[0].mine.participantId).toBe(other.participantId)
    expect(d[0].model.participantId).toBe(picks.blamePid)
  })

  it('should report both rows when both differ', () => {
    const d = findDisputes({ keyPid: other.participantId, blamePid: other.participantId }, players)

    expect(d.map(x => x.kind)).toEqual(['key', 'blame'])
  })

  it('should ignore rows the player skipped', () => {
    expect(findDisputes({ keyPid: null, blamePid: picks.blamePid }, players)).toEqual([])
    expect(findDisputes({ keyPid: null, blamePid: null }, players)).toEqual([])
  })
})

describe('shouldRebut', () => {
  const disputes = findDisputes({ keyPid: other.participantId, blamePid: null }, players)

  it('should require a dispute', () => {
    expect(shouldRebut([], '他一直单带不参团')).toBe(false)
  })

  it('should require a reason of at least four characters', () => {
    expect(shouldRebut(disputes, '')).toBe(false)
    expect(shouldRebut(disputes, '  菜  ')).toBe(false)
    expect(shouldRebut(disputes, '他送了')).toBe(false)
    expect(shouldRebut(disputes, '他一直送')).toBe(true)
  })
})

describe('rebuttalBasis', () => {
  it('should change with the picks or the reason, and ignore surrounding whitespace', () => {
    const a = rebuttalBasis({ keyPid: 1, blamePid: 6 }, '他一直单带')

    expect(rebuttalBasis({ keyPid: 1, blamePid: 6 }, '  他一直单带 ')).toBe(a)
    expect(rebuttalBasis({ keyPid: 2, blamePid: 6 }, '他一直单带')).not.toBe(a)
    expect(rebuttalBasis({ keyPid: 1, blamePid: null }, '他一直单带')).not.toBe(a)
    expect(rebuttalBasis({ keyPid: 1, blamePid: 6 }, '他一直送')).not.toBe(a)
  })
})

describe('playerFacts', () => {
  const p = players[0]
  const card = playerFacts(
    p,
    players.filter(q => q.teamId === p.teamId)
  )

  it('should describe the player in level words', () => {
    expect(card).toContain(p.champion)
    expect(card).toContain(`KDA ${p.kills}/${p.deaths}/${p.assists}`)
    expect(card).toContain(`${p.parts[0].cn}${p.parts[0].level}`)
  })

  it('should carry the real stats behind each part', () => {
    const withStats = p.parts.find(x => x.stats.length > 0)!

    expect(withStats).toBeDefined()
    expect(card).toContain(`${withStats.cn}${withStats.level}（${withStats.stats.join('，')}）`)
  })

  it('should not leak raw scores', () => {
    // 原始分是多位小数的标准差数值。只查小数位不少于 3 位的：短小数（0.8）会和
    // 分项后面带的真实数据（如 KDA 0.8）撞上，不能说明泄漏
    const raw = [p.total, ...p.parts.map(x => x.value)].filter(
      v => (String(v).split('.')[1] ?? '').length >= 3
    )

    for (const v of raw) expect(card).not.toContain(String(v))
    expect(card).not.toContain(String(p.total))
  })
})

describe('playerFacts for the player themself', () => {
  const me = players.find(q => q.isMe)!
  const card = playerFacts(
    me,
    players.filter(q => q.teamId === me.teamId)
  )

  it('should say who the card is about', () => {
    expect(card).toContain(me.champion)
    expect(card).toContain('就是玩家本人')
  })

  it('should leave out everything that counts against the player', () => {
    // 落后的分项、KDA、自己该负责的阵亡都不给：模型手里没有，就说不出来
    for (const part of me.parts.filter(x => x.level === '落后' || x.level === '大幅落后')) {
      expect(card).not.toContain(`${part.cn}${part.level}`)
    }
    expect(card).not.toContain(`KDA ${me.kills}/${me.deaths}/${me.assists}`)
    expect(card).not.toContain('值得一提')
    expect(card).not.toContain('被对位单杀')
    expect(card).not.toContain('孤立被杀（我方 1 人、对面 1 人')
  })

  it('should keep the parts where the player did well', () => {
    for (const part of me.parts.filter(x => x.level === '领先' || x.level === '大幅领先')) {
      expect(card).toContain(`${part.cn}${part.level}`)
    }
  })

  it('should word head counts so they cannot be read backwards', () => {
    const someone = players.find(q => !q.isMe && (q.deathList?.length ?? 0) > 0)!
    const text = playerFacts(
      someone,
      players.filter(q => q.teamId === someone.teamId)
    )
    const d = someone.deathList![0]

    expect(text).toContain(`我方 ${d.allies} 人、对面 ${d.enemies} 人`)
  })
})

describe('buildRebuttalPrompt', () => {
  const disputes = findDisputes({ keyPid: null, blamePid: other.participantId }, players)
  const prompt = buildRebuttalPrompt(disputes, players, '  他全程单带不参团  ')

  it('should state the dispute, both players, the scoring notes and the reason', () => {
    expect(prompt).toContain(
      `最犯罪：玩家选了${other.champion}，你选的是${disputes[0].model.champion}`
    )
    expect(prompt).toContain('【评分不看什么】')
    expect(prompt).toContain('全程单带不参团属于这一条')
    expect(prompt.endsWith('他全程单带不参团')).toBe(true)
  })

  it('should include each involved player once even when both rows name them', () => {
    const both = findDisputes(
      { keyPid: other.participantId, blamePid: other.participantId },
      players
    )
    const text = buildRebuttalPrompt(both, players, '他全程单带不参团')
    const header = `${other.champion}（${other.roleCn}`

    expect(text.split(header).length - 1).toBe(1)
  })

  it('should not tell the model the timeline is missing when the game has one', () => {
    expect(prompt).not.toContain('没有时间线数据')
  })

  it('should tell the model when the game has no timeline', () => {
    const bare = Object.values(modelB({ timeline: false }).players).sort(
      (a, b) => a.participantId - b.participantId
    )
    const blame = modelPicks(bare).blamePid
    const someone = bare.find(q => q.participantId !== blame)!
    const d = findDisputes({ keyPid: null, blamePid: someone.participantId }, bare)

    expect(buildRebuttalPrompt(d, bare, '他全程单带不参团')).toContain('这局没有时间线数据')
  })

  it('should ask the model for JSON', () => {
    // DashScope 的 json_object 模式要求提示词里出现 JSON 字样
    expect(REBUTTAL_SYSTEM_PROMPT).toContain('JSON')
  })
})

describe('parseRebuttal', () => {
  const prompt = '【事实】KDA 3/9/4，阵亡 9 次'
  const ok = { stance: 'concede', category: 'absence', reply: '你说得对，这点评分确实没算。' }

  it('should accept a well-formed reply', () => {
    expect(parseRebuttal(JSON.stringify(ok), prompt)).toEqual(ok)
  })

  it('should tolerate code fences and surrounding text', () => {
    const raw = '```json\n' + JSON.stringify(ok) + '\n```'

    expect(parseRebuttal(raw, prompt)).toEqual(ok)
  })

  it('should trim the reply', () => {
    const raw = JSON.stringify({ ...ok, reply: '  有道理。\n' })

    expect(parseRebuttal(raw, prompt).reply).toBe('有道理。')
  })

  it('should accept numbers that appear in the material', () => {
    const raw = JSON.stringify({ ...ok, stance: 'hold', reply: '他这局阵亡 9 次，确实偏多。' })

    expect(parseRebuttal(raw, prompt).stance).toBe('hold')
  })

  const fallback = { stance: 'unknown', category: 'other', reply: REBUTTAL_FALLBACK_REPLY }

  it.each([
    ['not JSON', '我觉得你说得对'],
    ['broken JSON', '{"stance": "concede", "reply": '],
    ['unknown stance', JSON.stringify({ ...ok, stance: 'angry' })],
    ['unknown category', JSON.stringify({ ...ok, category: 'cheating' })],
    ['missing reply', JSON.stringify({ stance: 'concede', category: 'absence' })],
    ['empty reply', JSON.stringify({ ...ok, reply: '   ' })],
    ['reply too long', JSON.stringify({ ...ok, reply: '长'.repeat(REBUTTAL_MAX_REPLY + 1) })],
    // 材料里没有 14：模型编的
    ['a number not in the material', JSON.stringify({ ...ok, reply: '他阵亡了 14 次。' })]
  ])('should fall back on %s', (_name, raw) => {
    expect(parseRebuttal(raw, prompt)).toEqual(fallback)
  })

  it('should accept a reply at exactly the length limit', () => {
    const raw = JSON.stringify({ ...ok, reply: '长'.repeat(REBUTTAL_MAX_REPLY) })

    expect(parseRebuttal(raw, prompt).stance).toBe('concede')
  })
})

describe('requestRebuttal', () => {
  const disputes = findDisputes({ keyPid: null, blamePid: other.participantId }, players)

  beforeEach(() => {
    h.stream.mockReset()
    h.resolveModel.mockReset().mockResolvedValue('test-model')
  })

  it('should call the model in JSON mode and return the parsed reply with the model name', async () => {
    h.stream.mockImplementation(
      async (_p: string, cb: { onChunk: (c: string) => void; onDone: () => void }) => {
        cb.onChunk('{"stance":"concede","category":"absence",')
        cb.onChunk('"reply":"你说得对。"}')
        cb.onDone()
      }
    )

    const r = await requestRebuttal(disputes, players, '他全程单带不参团')

    expect(r).toEqual({
      stance: 'concede',
      category: 'absence',
      reply: '你说得对。',
      model: 'test-model'
    })
    expect(h.resolveModel).toHaveBeenCalledWith('labelRebuttal', 'default-model')
    const [prompt, , system, usedModel, opts] = h.stream.mock.calls[0]
    expect(prompt).toContain('他全程单带不参团')
    expect(system).toBe(REBUTTAL_SYSTEM_PROMPT)
    expect(usedModel).toBe('test-model')
    expect(opts).toEqual({ jsonMode: true })
  })

  it('should return the fallback reply when the model output is unusable', async () => {
    h.stream.mockImplementation(
      async (_p: string, cb: { onChunk: (c: string) => void; onDone: () => void }) => {
        cb.onChunk('抱歉，我无法回答')
        cb.onDone()
      }
    )

    const r = await requestRebuttal(disputes, players, '他全程单带不参团')

    expect(r.stance).toBe('unknown')
    expect(r.reply).toBe(REBUTTAL_FALLBACK_REPLY)
  })

  it('should reject when the request fails', async () => {
    h.stream.mockImplementation(async (_p: string, cb: { onError: (e: string) => void }) => {
      cb.onError('网络错误')
    })

    await expect(requestRebuttal(disputes, players, '他全程单带不参团')).rejects.toThrow('网络错误')
  })

  it('should reject when the model never answers', async () => {
    vi.useFakeTimers()
    h.stream.mockImplementation(() => new Promise(() => {}))

    const pending = requestRebuttal(disputes, players, '他全程单带不参团')
    const settled = expect(pending).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(REBUTTAL_TIMEOUT_MS + 10)
    await settled

    vi.useRealTimers()
  })
})
