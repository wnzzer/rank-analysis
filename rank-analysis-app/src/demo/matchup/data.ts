/** 固定模拟会话和统计，仅用于演示，不作为真实 OP.GG 结果。 */
import { reactive } from 'vue'
import { defaultRank, defaultSummoner } from '@renderer/types/domain/player'
import { defaultUserTag } from '@renderer/types/domain/analysis'
import type { Game } from '@renderer/types/domain/match'
import type { SessionSummoner, Subteam } from '@renderer/types/domain/gaming'
import type { MatchupApi, MatchupQuery } from '@renderer/types/matchup'
import { DEMO_CHAMPIONS, demoIcon } from './champions'

/** 开发演示可切换的故障场景。 */
export const demoState = reactive({
  /** 正常、空数据、错误或慢响应，不影响正式运行。 */
  scenario: 'ready',
  /** 模拟头像加载失败。 */
  imageFailure: false
})

/** 延迟模拟网络反馈；错误场景明确抛出错误。
 * @returns 延迟结束；error 场景拒绝 Promise。
 */
async function waitForDemo(): Promise<void> {
  const scenario = demoState.scenario
  await new Promise(resolve => setTimeout(resolve, scenario === 'slow' ? 1600 : 220))
  if (scenario === 'error') throw new Error('演示请求失败')
}

/** 为模拟查询产生一致的来源上下文。
 * @param query 当前查询条件。
 * @returns 只标记为 demo 的来源；不是当前真实版本。
 */
function source(query: MatchupQuery) {
  return { ...query, version: 'demo-16.21', cachedAt: null, fetchedAt: 0, stale: false }
}

/** 正式组件注入的演示提供器；段位变化由固定偏移展示不同示例。 */
export const demoApi: MatchupApi = {
  demo: true,
  loadNames: async () => {},
  name: id => DEMO_CHAMPIONS[id]?.name ?? `英雄${id}`,
  icon: id => (demoState.imageFailure ? '/demo-assets/missing' : demoIcon(id)),
  getPosition: async id =>
    id === 64 ? 'jungle' : id === 86 ? 'top' : id === 222 ? 'adc' : id === 412 ? 'support' : 'mid',
  getList: async query => {
    await waitForDemo()
    const ids = [1, 127, 112, 3, 61, 134, 99, 90, 13, 7, 84, 55, 517]
    return {
      ...source(query),
      candidates:
        demoState.scenario === 'empty'
          ? []
          : ids.map((championId, i) => ({
              championId,
              enemyWinRate: i < 9 ? 0.43 + i * 0.006 : 0.52 + (i - 9) * 0.01,
              play: i === 8 ? 146 : 2300 + i * 213
            }))
    }
  },
  getDetail: async (query, candidateId) => {
    await waitForDemo()
    const offset = query.tier === 'diamond_plus' ? 0.012 : query.tier === 'all' ? -0.008 : 0
    return {
      ...source(query),
      candidateId,
      candidateWinRate: 0.52 + (candidateId % 5) * 0.004 + offset,
      laneKillRate: query.position === 'jungle' ? null : 0.49 + (candidateId % 7) * 0.008,
      play: candidateId === 13 ? 146 : 2300 + candidateId
    }
  }
}

/** 创建覆盖原卡片渲染字段的固定模拟玩家。
 * @param championId 本局英雄。
 * @param index 队伍内槽位。
 * @param mine 是否我方。
 * @returns 无真实身份信息的本地会话玩家。
 */
function demoPlayer(championId: number, index: number, mine: boolean): SessionSummoner {
  const userTag = defaultUserTag()
  Object.assign(userTag.recentData, {
    selectModeCn: '单双排',
    selectWins: mine ? 3 : 1,
    selectLosses: mine ? 1 : 3,
    kda: 2.2,
    kills: 6,
    deaths: 4,
    assists: 8,
    groupRate: 57,
    damageDealtToChampionsRate: 24
  })
  const games = [1, 64, 103, 86].map(
    (id, i) =>
      ({
        queueName: '单双排',
        gameId: index * 10 + i,
        participants: [
          {
            championId: id,
            stats: { win: i % 3 !== 0, kills: 4 + i, deaths: 2 + i, assists: 9 - i }
          }
        ]
      }) as Game
  )
  return {
    championId,
    championKey: `champion_${championId}`,
    summoner: {
      ...defaultSummoner(),
      puuid: `demo-${mine}-${index}`,
      gameName: `${mine ? '我方' : '敌方'}演示玩家${index + 1}`,
      tagLine: '示例',
      summonerLevel: 210 + index * 12
    },
    matchHistory: { platformId: 'DEMO', begIndex: 0, endIndex: 4, games: { games } },
    userTag,
    rank: defaultRank(),
    meetGames: [],
    preGroupMarkers: { name: '', type: '' },
    pickState: 'locked'
  }
}

/** 产生两个独立的模拟队伍，支持重置而不复用被修改的玩家。
 * @returns 我方和敌方完整卡片输入。
 */
export function createDemoTeams(): Subteam[] {
  return [
    [516, 5, 1, 22, 89],
    [86, 64, 103, 222, 412]
  ].map((ids, i) => ({
    subteamId: i + 1,
    players: ids.map((id, slot) => demoPlayer(id, slot, i === 0))
  }))
}
