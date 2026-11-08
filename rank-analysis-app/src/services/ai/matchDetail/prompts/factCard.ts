/**
 * Stage 2 的「事实卡」：把快照数字写成每行都带主语的中文事实。
 *
 * 原先单人复盘喂两坨字段相同的 JSON（目标 / 对位），模型常把对位的数字安到目标头上；
 * 整局锐评只给归因 JSON，模型会把对面的队伍总击杀说成己方的（评测复现：「对位男枪自己
 * 只有 9500 金币」「队伍总击杀 28 个，蔚只沾到 6 个」）。事实卡让每个数字紧挨着它的
 * 主人出现，并预先写明双方队伍的总数据，从源头减少张冠李戴；结构化字段同时翻成中文，
 * 模型也就没有字段名可抄。
 *
 * 只写终局数字：位置高低的判断由评分模型（scoredAttribution 的【表现评估】等级词）给出，
 * 这里不再标注「低于该位置常见水平」之类的粗基准，免得两套口径互相打架。
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { RecentPlayerProfile } from '../../shared/types'

type SnapshotPlayer = MatchSnapshot['players'][number]

export const POSITION_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/** 卡片标题里的身份：`蔚（玩家7｜败方｜打野）` */
export function identity(p: SnapshotPlayer): string {
  const segs = [p.name, p.win ? '胜方' : '败方', POSITION_CN[p.teamPosition]].filter(Boolean)
  return `${p.champion}（${segs.join('｜')}）`
}

function multiKillText(mk: Partial<SnapshotPlayer['multiKills']> | undefined): string {
  if (!mk) return '无'
  const parts = [
    mk.double ? `双杀 ${mk.double} 次` : '',
    mk.triple ? `三杀 ${mk.triple} 次` : '',
    mk.quadra ? `四杀 ${mk.quadra} 次` : '',
    mk.penta ? `五杀 ${mk.penta} 次` : ''
  ].filter(Boolean)
  return parts.length ? parts.join('、') : '无'
}

function profileText(rp: RecentPlayerProfile | null): string {
  if (!rp) return '无数据（禁止评价熟练度与是否补位）'
  const pct = (r: number) => `${Math.round(r * 100)}%`
  const parts: string[] = []
  parts.push(
    rp.mainPosition === 'UNCLEAR'
      ? '主玩位置不固定'
      : `主玩${POSITION_CN[rp.mainPosition] ?? rp.mainPosition}`
  )
  if (rp.isOffRole) parts.push(rp.offRoleSeverity === 'severe' ? '本局严重补位' : '本局轻度补位')
  else parts.push('本局非补位')
  const m = rp.currentChampionMastery
  if (m?.isFirstTimeInRecent) parts.push('本英雄近期首次使用')
  else if (m)
    parts.push(
      `本英雄近期 ${m.gamesInRecent} 场、胜率 ${pct(m.winRate)}${m.isOnetrick ? '（绝活）' : ''}`
    )
  parts.push(`近期胜率 ${pct(rp.recentWinRate)}、近期 KDA ${rp.recentKda}`)
  if (rp.streak && rp.streak.count >= 2)
    parts.push(`近期 ${rp.streak.count} 连${rp.streak.kind === 'win' ? '胜' : '败'}`)
  if (rp.note) parts.push(`使用者备注（主观，仅供参考）：${rp.note}`)
  return parts.join('；')
}

/**
 * 单个玩家的事实卡：每行都以英雄名开头，数字紧跟主人
 * @param p - 快照玩家
 * @returns 多行 markdown 列表
 */
export function playerFactCard(p: SnapshotPlayer): string {
  const c = p.champion
  return [
    `- ${c} 战绩：${p.kills} 杀 / ${p.deaths} 死 / ${p.assists} 助攻，KDA ${p.kda}`,
    `- ${c} 输出：伤害 ${p.damage}，伤害占比 ${p.damageShare}%，每分钟伤害 ${p.dpm}`,
    `- ${c} 承伤：承伤 ${p.taken}，承伤占比 ${p.damageTakenShare}%`,
    `- ${c} 经济：${p.gold} 金币，经济占比 ${p.goldShare}%，每分钟经济 ${p.gpm}`,
    `- ${c} 补刀：${p.cs}，每分钟补刀 ${p.csm}`,
    `- ${c} 参团率：${p.killParticipation}%`,
    `- ${c} 视野得分：${p.wardScore ?? '无数据（国服战绩不下发，禁止评价视野）'}`,
    `- ${c} 多杀：${multiKillText(p.multiKills)}`,
    `- ${c} 近期画像：${profileText(p.recentProfile ?? null)}`
  ].join('\n')
}

/**
 * 双方队伍总数据，写明胜负方，避免把对面的总击杀说成己方的
 * @param snapshot - 对局快照
 * @param focusTeamId - 需要标注「本队」的队伍（单人复盘传目标所在队伍）
 */
export function teamFactLines(snapshot: MatchSnapshot, focusTeamId?: number): string {
  // 手工构造的快照（测试/旧缓存）可能没有 teams：按无队伍数据处理，不让 prompt 构建崩掉
  return (snapshot.teams ?? [])
    .map(t => {
      const tag =
        focusTeamId === undefined
          ? ''
          : t.teamId === focusTeamId
            ? '（目标玩家所在队伍）'
            : '（对面）'
      return `- ${t.result}${tag}：总击杀 ${t.totalKills}，总死亡 ${t.totalDeaths}，总助攻 ${t.totalAssists}，总经济 ${t.totalGold}，总伤害 ${t.totalDamage}`
    })
    .join('\n')
}
