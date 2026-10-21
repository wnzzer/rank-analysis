// AI 评测共用的造数据对局：只给原始战绩，份额/kda/每分钟数据按 snapshot.ts 公式推导，保证自洽。
// 被 bench-ai-quality.ts（Stage1 归因）与 ai-features.eval.ts（Stage2 / 进对局）共用。

import { computeRoleBenchmark, computeVsLaneOpponent } from '../rank-analysis-app/src/services/ai/shared/laneFacts'
import { classifyMode } from '../rank-analysis-app/src/services/ai/shared/modeContext'

export type Pos = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'
export interface Raw {
  id: number
  team: 100 | 200
  pos: Pos
  champ: string
  k: number
  d: number
  a: number
  gold: number
  cs: number
  dmg: number
  taken: number
  me?: boolean
  ward?: number | null
  double?: number
  triple?: number
  profile?: ReturnType<typeof profile> | null
}

export function profile(o: {
  main: Pos | 'UNCLEAR'
  laneRatio?: number
  firstTime?: boolean
  onetrick?: boolean
}) {
  const r = o.laneRatio ?? 0.6
  return {
    positionDistribution: [{ pos: o.main, ratio: 0.6, games: 12 }],
    mainPosition: o.main,
    currentLanePlayedRatio: r,
    championDistribution: [{ championId: 64, name: '李青', games: 8, winRate: 0.5, avgKda: 3.1 }],
    currentChampionMastery: o.firstTime
      ? { gamesInRecent: 0, winRate: 0, avgKda: 0, isOnetrick: false, isFirstTimeInRecent: true }
      : {
          gamesInRecent: o.onetrick ? 14 : 5,
          winRate: 0.6,
          avgKda: 3.2,
          isOnetrick: !!o.onetrick,
          isFirstTimeInRecent: false
        },
    recentWinRate: 0.55,
    recentKda: 3.0,
    streak: { kind: 'win', count: 2 },
    isOffRole: r < 0.2,
    offRoleSeverity: r < 0.2 ? 'severe' : r < 0.4 ? 'mild' : 'none'
  }
}

const r1 = (x: number) => Number(x.toFixed(1))

export function buildSnapshot(c: { gameId: number; queueId: number; gameMode: string; dur: number; win: 100 | 200; raws: Raw[] }) {
  const modeContext = classifyMode(c.queueId, c.gameMode)
  const tot = (team: number, f: (r: Raw) => number) =>
    c.raws.filter(r => r.team === team).reduce((s, r) => s + f(r), 0)
  const min = c.dur / 60
  const basePlayers = c.raws.map(r => ({
    participantId: r.id,
    teamId: r.team,
    name: `玩家${r.id}`,
    champion: r.champ,
    isMe: !!r.me,
    win: r.team === c.win,
    kda: Number(((r.k + r.a) / Math.max(1, r.d)).toFixed(2)),
    kills: r.k,
    deaths: r.d,
    assists: r.a,
    gold: r.gold,
    cs: r.cs,
    damage: r.dmg,
    taken: r.taken,
    heal: 1500,
    turretDamage: 1200,
    damageShare: r1((r.dmg / tot(r.team, x => x.dmg)) * 100),
    damageTakenShare: r1((r.taken / tot(r.team, x => x.taken)) * 100),
    goldShare: r1((r.gold / tot(r.team, x => x.gold)) * 100),
    killParticipation: r1(((r.k + r.a) / Math.max(1, tot(r.team, x => x.k))) * 100),
    perks: { primary: 8005, subStyle: 8200 },
    augments: [],
    teamPosition: r.pos,
    lane: '',
    role: '',
    summonerSpells: r.pos === 'JUNGLE' ? ['闪现', '惩戒'] : ['闪现', '点燃'],
    dpm: r1(r.dmg / min),
    gpm: r1(r.gold / min),
    csm: r1(r.cs / min),
    items: modeContext.hasItemBuild ? [3153, 3006, 3031, 1038, 1037, 0] : [],
    trinketId: 3340,
    wardScore: r.ward === undefined ? 20 : r.ward,
    controlWardsPlaced: r.ward === null ? null : 1,
    visionWardsBought: r.ward === null ? null : 3,
    multiKills: { double: r.double ?? 0, triple: r.triple ?? 0, quadra: 0, penta: 0 },
    recentProfile: r.profile ?? null
  }))
  // 与 snapshot.ts 同步：对位差 / 位置基准由 TS 预算
  const players = basePlayers.map(p => ({
    ...p,
    vsLaneOpponent: modeContext.hasLanes ? computeVsLaneOpponent(p as any, basePlayers as any) : null,
    roleBenchmark: modeContext.hasLanes ? computeRoleBenchmark(p as any) : null
  }))
  const teams = [c.win, c.win === 100 ? 200 : 100].map(teamId => {
    const tp = players.filter(p => p.teamId === teamId)
    const s = (f: (p: (typeof players)[number]) => number) => tp.reduce((a, p) => a + f(p), 0)
    return {
      teamId,
      result: teamId === c.win ? '胜方' : '败方',
      totalKills: s(p => p.kills),
      totalDeaths: s(p => p.deaths),
      totalAssists: s(p => p.assists),
      totalDamage: s(p => p.damage),
      totalTaken: s(p => p.taken),
      totalGold: s(p => p.gold),
      players: tp
    }
  })
  return {
    gameId: c.gameId,
    queueName: c.queueId === 450 ? '极地大乱斗' : '单双排位',
    queueId: c.queueId,
    gameMode: c.gameMode,
    durationSeconds: c.dur,
    modeContext,
    teams,
    players
  }
}

export type Snap = ReturnType<typeof buildSnapshot>
export type Label = '尽力' | '犯罪' | '被爆' | '被连累' | '缚地灵' | '正常'
export interface Case {
  key: string
  desc: string
  snap: Snap
  /** 明显该有的判定：pid → 可接受的标签集合 */
  expect: Record<number, Label[]>
  /** 文本里不该出现的词（winReason / finalCall / note / support） */
  forbidden?: RegExp
}

const R = (
  id: number, team: 100 | 200, pos: Pos, champ: string,
  k: number, d: number, a: number, gold: number, cs: number, dmg: number, taken: number,
  o: Partial<Raw> = {}
): Raw => ({ id, team, pos, champ, k, d, a, gold, cs, dmg, taken, ...o })

export const CASES: Case[] = [
  {
    key: 'stomp',
    desc: '排位碾压局：我方 ADC 12 杀 carry；敌方上单严重补位、敌方 ADC 首次玩该英雄',
    snap: buildSnapshot({
      gameId: 9000001, queueId: 420, gameMode: 'CLASSIC', dur: 1800, win: 100,
      raws: [
        R(1, 100, 'TOP', '奥恩', 4, 4, 10, 13800, 210, 21000, 32000, { profile: profile({ main: 'TOP' }) }),
        R(2, 100, 'JUNGLE', '李青', 7, 3, 8, 12500, 150, 18000, 24000, { profile: profile({ main: 'JUNGLE' }) }),
        R(3, 100, 'MIDDLE', '阿狸', 8, 2, 4, 14200, 240, 31000, 14000, { double: 1, profile: profile({ main: 'MIDDLE' }) }),
        R(4, 100, 'BOTTOM', '凯特琳', 12, 2, 3, 16800, 290, 38000, 12000, { me: true, double: 2, triple: 1, profile: profile({ main: 'BOTTOM' }) }),
        R(5, 100, 'UTILITY', '璐璐', 1, 2, 15, 9000, 40, 9000, 16000, { ward: 60, profile: profile({ main: 'UTILITY' }) }),
        R(6, 200, 'TOP', '杰斯', 3, 9, 4, 10500, 180, 14000, 28000, { profile: profile({ main: 'MIDDLE', laneRatio: 0.1 }) }),
        R(7, 200, 'JUNGLE', '盲僧', 4, 6, 8, 10800, 140, 13000, 21000, { profile: profile({ main: 'JUNGLE' }) }),
        R(8, 200, 'MIDDLE', '辛德拉', 6, 5, 4, 12900, 220, 29000, 15000, { profile: profile({ main: 'MIDDLE' }) }),
        R(9, 200, 'BOTTOM', '韦鲁斯', 2, 8, 5, 9800, 200, 16000, 14000, { profile: profile({ main: 'BOTTOM', firstTime: true }) }),
        R(10, 200, 'UTILITY', '锤石', 1, 7, 13, 7600, 30, 7000, 18000, { ward: 55, profile: profile({ main: 'UTILITY' }) })
      ]
    }),
    expect: { 4: ['尽力'], 9: ['犯罪', '被爆'], 6: ['犯罪', '被爆'] }
  },
  {
    key: 'carry-lost',
    desc: '排位惜败：我方（败方）中单 33% 伤害 carry 被连累；队友打野 1/11 犯罪；胜方 ADC 正常',
    snap: buildSnapshot({
      gameId: 9000002, queueId: 420, gameMode: 'CLASSIC', dur: 2100, win: 200,
      raws: [
        R(1, 100, 'TOP', '剑姬', 5, 6, 4, 14000, 250, 24000, 26000, { profile: profile({ main: 'TOP' }) }),
        R(2, 100, 'JUNGLE', '赵信', 1, 11, 5, 9500, 130, 11000, 30000, { profile: profile({ main: 'JUNGLE' }) }),
        R(3, 100, 'MIDDLE', '维克托', 9, 4, 6, 15500, 290, 42000, 16000, { me: true, double: 2, profile: profile({ main: 'MIDDLE' }) }),
        R(4, 100, 'BOTTOM', '伊泽瑞尔', 4, 6, 7, 13000, 260, 30000, 15000, { profile: profile({ main: 'BOTTOM' }) }),
        R(5, 100, 'UTILITY', '娜美', 0, 7, 14, 8500, 35, 7000, 14000, { profile: profile({ main: 'UTILITY' }) }),
        R(6, 200, 'TOP', '鳄鱼', 6, 4, 7, 14500, 240, 26000, 34000, { profile: profile({ main: 'TOP' }) }),
        R(7, 200, 'JUNGLE', '男枪', 10, 3, 9, 15000, 200, 25000, 26000, { triple: 1, profile: profile({ main: 'JUNGLE' }) }),
        R(8, 200, 'MIDDLE', '佐伊', 7, 5, 10, 14000, 250, 33000, 13000, { profile: profile({ main: 'MIDDLE' }) }),
        R(9, 200, 'BOTTOM', '金克斯', 9, 4, 8, 16500, 300, 36000, 14000, { profile: profile({ main: 'BOTTOM' }) }),
        R(10, 200, 'UTILITY', '蕾欧娜', 2, 3, 22, 9000, 40, 8000, 28000, { profile: profile({ main: 'UTILITY' }) })
      ]
    }),
    expect: { 3: ['被连累'], 2: ['犯罪', '被爆'], 7: ['尽力', '正常'] }
  },
  {
    key: 'traps',
    desc: '陷阱局：视野字段全 null（国服实况）；敌方打野多死但不补位也非首次；我方上单 recentProfile=null',
    snap: buildSnapshot({
      gameId: 9000003, queueId: 420, gameMode: 'CLASSIC', dur: 1650, win: 100,
      raws: [
        R(1, 100, 'TOP', '诺手', 3, 5, 6, 11500, 200, 19000, 27000, { ward: null, profile: null }),
        R(2, 100, 'JUNGLE', '佛耶戈', 9, 2, 7, 13500, 170, 22000, 23000, { ward: null, profile: profile({ main: 'JUNGLE' }) }),
        R(3, 100, 'MIDDLE', '劫', 11, 3, 3, 14000, 210, 27000, 13000, { me: true, ward: null, double: 2, profile: profile({ main: 'MIDDLE', onetrick: true }) }),
        R(4, 100, 'BOTTOM', '卡莎', 5, 3, 8, 13000, 230, 24000, 13000, { ward: null, profile: profile({ main: 'BOTTOM' }) }),
        R(5, 100, 'UTILITY', '布隆', 0, 4, 19, 7500, 30, 5000, 22000, { ward: null, profile: profile({ main: 'UTILITY' }) }),
        R(6, 200, 'TOP', '纳尔', 4, 4, 3, 11800, 210, 18000, 26000, { ward: null, profile: profile({ main: 'TOP' }) }),
        R(7, 200, 'JUNGLE', '蔚', 2, 10, 4, 8900, 120, 10000, 25000, { ward: null, profile: profile({ main: 'JUNGLE' }) }),
        R(8, 200, 'MIDDLE', '发条', 3, 6, 5, 11000, 220, 21000, 12000, { ward: null, profile: profile({ main: 'MIDDLE' }) }),
        R(9, 200, 'BOTTOM', '艾希', 3, 5, 4, 11500, 240, 20000, 11000, { ward: null, profile: profile({ main: 'BOTTOM' }) }),
        R(10, 200, 'UTILITY', '拉克丝', 1, 3, 7, 8000, 40, 15000, 9000, { ward: null, profile: profile({ main: 'UTILITY' }) })
      ]
    }),
    expect: { 3: ['尽力'], 7: ['犯罪', '被爆'] },
    forbidden: /视野|插眼|眼位|没.?眼|wardScore|控制守卫|真眼/
  },
  {
    key: 'aram',
    desc: '大乱斗：无路位、随机英雄；败方一人参团极低（缚地灵）；死亡普遍偏高',
    snap: buildSnapshot({
      gameId: 9000004, queueId: 450, gameMode: 'ARAM', dur: 1080, win: 200,
      raws: [
        R(1, 100, 'UNKNOWN', '盖伦', 8, 9, 12, 11000, 60, 22000, 38000),
        R(2, 100, 'UNKNOWN', '泽拉斯', 10, 7, 15, 11500, 70, 41000, 15000, { me: true }),
        R(3, 100, 'UNKNOWN', '亚索', 3, 8, 4, 9000, 85, 17000, 20000),
        R(4, 100, 'UNKNOWN', '索拉卡', 1, 6, 22, 8000, 30, 8000, 17000),
        R(5, 100, 'UNKNOWN', '薇恩', 7, 10, 10, 10500, 75, 28000, 21000),
        R(6, 200, 'UNKNOWN', '墨菲特', 5, 8, 25, 10500, 55, 20000, 42000, { double: 1 }),
        R(7, 200, 'UNKNOWN', '布兰德', 13, 6, 20, 13000, 65, 46000, 18000, { triple: 1 }),
        R(8, 200, 'UNKNOWN', '卢锡安', 9, 7, 14, 12000, 80, 31000, 19000),
        R(9, 200, 'UNKNOWN', '基兰', 2, 5, 26, 9000, 25, 9000, 15000),
        R(10, 200, 'UNKNOWN', '凯南', 6, 4, 19, 10800, 50, 25000, 20000)
      ]
    }),
    expect: { 7: ['尽力'], 2: ['被连累', '正常'], 3: ['缚地灵', '被爆', '犯罪'] },
    forbidden: /上路|中路|下路|打野|辅助|对线|对位|补位|BP|选英雄|gank|线权/
  }
]

