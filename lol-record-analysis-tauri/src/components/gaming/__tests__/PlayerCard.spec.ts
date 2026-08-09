/**
 * PlayerCard OP.GG 数据跟随 opggRevision 回归测试（修复 A）。
 *
 * 背景：SubteamCard 的分流是「无玩家身份的空位走 ChampionIntelCard，其余走 PlayerCard」。
 * 我方五人全程有 puuid，走的都是 PlayerCard——上一轮只给 ChampionIntelCard 接了
 * opggRevision，导致段位切换后我方卡片的 T 级/胜率 chip 纹丝不动，只有敌方匿名位会变。
 *
 * 关键陷阱（与 ChampionIntelCard 同款）：PlayerCard 有内容级请求去重
 * `lastOpggRequestKey = \`${championId}|${mode}\``。段位切换时 championId 与 opggMode
 * 都不变，仅把 `opggRevision.value` 加进 watch 源不够——回调会被去重直接 return 掉。
 * 必须把 rev 一并编进那个 key。本测试直接证明：不改变 championId/opggMode，仅
 * `bumpOpggRevision()` 一次，也能触发新的 `get_champion_meta` 调用——这是 rev 真的
 * 穿透了去重守卫的直接证据。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
// jsdom 下没有 n-message-provider，useCopy() 内部用到 useMessage，同 Automation.tierSelect.spec.ts
// 的约定替换掉。
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

import { invoke } from '@tauri-apps/api/core'
import { opggRevision, bumpOpggRevision } from '@renderer/services/opgg'
import PlayerCard from '../PlayerCard.vue'
import type { SessionSummoner } from '@renderer/types/domain/gaming'

const mockInvoke = vi.mocked(invoke)

/** 造一个已识别玩家（有 puuid）的最小 SessionSummoner，走 PlayerCard 内容分支。 */
function summoner(championId: number): SessionSummoner {
  return {
    championId,
    championKey: `champion_${championId}`,
    summoner: {
      gameName: 'Faker',
      tagLine: 'KR1',
      summonerLevel: 500,
      profileIconId: 1,
      profileIconKey: '1',
      puuid: 'puuid-1',
      platformIdCn: ''
    },
    matchHistory: { platformId: '', begIndex: 0, endIndex: 0, games: { games: [] } },
    userTag: { recentData: {} as SessionSummoner['userTag']['recentData'], tag: [] },
    rank: {} as SessionSummoner['rank'],
    meetGames: [],
    preGroupMarkers: { name: '', type: '' }
  }
}

/** 让 watch 回调里的一串 await（getChampionMeta 等）落定。 */
async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  opggRevision.value = 0
  setActivePinia(createPinia())
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_champion_meta') {
      return { championId: 86, tier: 1, winRate: 0.53, rank: 1, rankPrevPatch: 0 }
    }
    if (cmd === 'get_aram_balance') return null
    return undefined
  })
})

describe('PlayerCard OP.GG 数据跟随 opggRevision（修复 A）', () => {
  it('championId/opggMode 不变，仅 opggRevision 变化也应重新拉取 T 级/胜率', async () => {
    const w = mount(PlayerCard, {
      shallow: true,
      global: { plugins: [createPinia()] },
      props: {
        sessionSummoner: summoner(86),
        typeCn: '排位赛',
        modeType: 'ranked',
        imgUrl: '',
        tierCn: '黄金',
        queueId: 420, // 非 ARAM 队列，不触发 get_aram_balance 分支
        opggMode: 'ranked'
      }
    })
    await flush()
    await w.vm.$nextTick()

    // 初次挂载已按 championId+mode 发起一次请求
    expect(mockInvoke).toHaveBeenCalledWith('get_champion_meta', {
      mode: 'ranked',
      championId: 86
    })
    mockInvoke.mockClear()

    // 段位切换：不改变 props，只 bump 全局 revision（模拟 useOpggTier.switchTier 的效果）
    bumpOpggRevision()
    await w.vm.$nextTick()
    await flush()

    // 若 rev 没有编进内容级去重 key，这里 requestKey 与上次相同会被直接 return，
    // get_champion_meta 就不会被再次调用——这正是修复前的缺陷。
    expect(mockInvoke).toHaveBeenCalledWith('get_champion_meta', {
      mode: 'ranked',
      championId: 86
    })

    w.unmount()
  })

  it('opggRevision 不变时（championId/mode 也不变）不应重复请求——去重仍然生效', async () => {
    const w = mount(PlayerCard, {
      shallow: true,
      global: { plugins: [createPinia()] },
      props: {
        sessionSummoner: summoner(86),
        typeCn: '排位赛',
        modeType: 'ranked',
        imgUrl: '',
        tierCn: '黄金',
        queueId: 420,
        opggMode: 'ranked'
      }
    })
    await flush()
    await w.vm.$nextTick()
    mockInvoke.mockClear()

    // 触发一次与 OP.GG 无关的重渲染（同 championId/mode/rev），不应重新请求
    await w.setProps({ tierCn: '铂金' })
    await w.vm.$nextTick()
    await flush()

    expect(mockInvoke).not.toHaveBeenCalledWith('get_champion_meta', expect.anything())

    w.unmount()
  })
})
