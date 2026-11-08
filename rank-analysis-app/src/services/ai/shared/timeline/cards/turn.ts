/**
 * 转折卡（T）：两队经济差逐分钟曲线里，2 分钟窗口内变化最大的至多 3 段（|变化| ≥1500，互不重叠），
 * 并列出窗口内的击杀比与资源/建筑变动。
 */
import { fmtTime } from '../geometry'
import { buildingLabel, monsterLabel, sideLabel } from '../labels'
import type { CardDraft, CardInput } from '../types'

const WINDOW_FRAMES = 2
const MIN_SWING = 1500
const MAX_CARDS = 3

const lead = (diff: number) =>
  diff === 0 ? '持平' : diff > 0 ? `蓝方领先 ${diff}` : `红方领先 ${-diff}`

/** 生成转折卡（weight 固定 3） */
export function buildTurnCards(input: CardInput): CardDraft[] {
  const { tl, roster } = input
  const teamOf = new Map(roster.map(r => [r.participantId, r.teamId]))
  const diffs = tl.frames.map(f =>
    f.players.reduce(
      (s, p) => s + (teamOf.get(p.participantId) === 100 ? p.totalGold : -p.totalGold),
      0
    )
  )
  const windows: Array<{ i: number; delta: number }> = []
  for (let i = 0; i + WINDOW_FRAMES < diffs.length; i++) {
    windows.push({ i, delta: diffs[i + WINDOW_FRAMES] - diffs[i] })
  }
  windows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const picked: typeof windows = []
  for (const w of windows) {
    if (picked.length >= MAX_CARDS || Math.abs(w.delta) < MIN_SWING) break
    if (picked.some(p => w.i < p.i + WINDOW_FRAMES && p.i < w.i + WINDOW_FRAMES)) continue
    picked.push(w)
  }

  return picked
    .sort((a, b) => a.i - b.i)
    .map(({ i, delta }) => {
      const from = tl.frames[i].timestamp
      const to = tl.frames[i + WINDOW_FRAMES].timestamp
      let blue = 0
      let red = 0
      const objectives: string[] = []
      for (const e of tl.events) {
        if (e.timestamp < from || e.timestamp > to) continue
        if (e.type === 'CHAMPION_KILL') {
          if (teamOf.get(e.victimId) === 200) blue++
          if (teamOf.get(e.victimId) === 100) red++
        }
        if (e.type === 'ELITE_MONSTER_KILL')
          objectives.push(`${sideLabel(e.killerTeamId)}拿下${monsterLabel(e.monsterType)}`)
        if (e.type === 'BUILDING_KILL') {
          objectives.push(
            `${sideLabel(e.teamId === 100 ? 200 : 100)}推掉${sideLabel(e.teamId)}${buildingLabel(e)}`
          )
        }
      }
      const during = [`击杀 蓝方${blue}:${red}红方`, ...objectives].join('；')
      return {
        kind: 'turn' as const,
        subjects: [],
        minute: from / 60000,
        weight: 3,
        text:
          `${fmtTime(from)}-${fmtTime(to)} 经济转折：${lead(diffs[i])} → ${lead(diffs[i + WINDOW_FRAMES])}` +
          `（${delta > 0 ? '蓝方' : '红方'} +${Math.abs(delta)}）｜期间：${during}`
      }
    })
}
