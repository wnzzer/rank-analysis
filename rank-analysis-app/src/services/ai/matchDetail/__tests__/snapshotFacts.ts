/**
 * 测试用:给手搓的快照玩家补齐数值事实(validator 会按快照重写证据,缺字段的指标会被摘除)。
 * 默认值全队相同 → 各项排名并列第 1、死亡并列最多、KDA 并列最低,
 * 因此「犯罪」(败方)与「尽力」(胜方)的量化复核默认成立;伤害占比 22% 不触发「被连累」。
 */
import { RANKED_METRICS } from '../../shared/snapshot'

export function withFacts<T extends Record<string, unknown>>(player: T) {
  const facts = {
    kda: 2.5,
    kills: 5,
    deaths: 5,
    assists: 5,
    gold: 10000,
    cs: 150,
    damage: 20000,
    taken: 20000,
    heal: 3000,
    turretDamage: 2000,
    damageShare: 22,
    damageTakenShare: 20,
    goldShare: 20,
    killParticipation: 60,
    dpm: 600,
    gpm: 400,
    csm: 6,
    teamPosition: 'UNKNOWN',
    champion: '测试英雄',
    multiKills: { double: 0, triple: 0, quadra: 0, penta: 0 },
    wardScore: null,
    vsLaneOpponent: null,
    roleBenchmark: null,
    ...player
  }
  const teamRanks = Object.fromEntries(RANKED_METRICS.map(m => [m, 1]))
  return { ...facts, teamRanks: { ...teamRanks, ...((player.teamRanks as object) ?? {}) } }
}
