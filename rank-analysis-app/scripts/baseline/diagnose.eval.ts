/**
 * 回归诊断：对标注局 A/B 与两局排位 eval fixture，输出每位玩家的位置、胜负、KDA、总分/分档、
 * 分项、标签、减责证据与死亡归责计数，生成 Markdown 校准报告。
 * 用法：npm run baseline:diagnose
 * 报告写到 <repo>/.superpowers/sdd/calibration-report.md（不入库）；同时打印到控制台。
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../../src/services/ai/shared/snapshot'
import { buildPuuidMap, remapTimeline } from '../../src/services/ai/shared/timeline/remap'
import type { SlimTimeline } from '../../src/services/ai/shared/timeline/types'
import { scoreSnapshot } from '../../src/services/ai/shared/scoring/match'
import type { DeathKind } from '../../src/services/ai/shared/scoring/deathAttribution'
import a from '../../src/services/ai/shared/scoring/__tests__/fixtures/regression-a.json'
import b from '../../src/services/ai/shared/scoring/__tests__/fixtures/regression-b.json'

const EVAL_DIR = path.resolve(__dirname, '../ai-eval/fixtures')
const REPORT = path.resolve(__dirname, '../../../.superpowers/sdd/calibration-report.md')
/** eval fixture 中额外诊断的两局排位（一负一胜） */
const EXTRA_GAMES = [301056739895, 301050270709]
const KINDS: DeathKind[] = ['solo', 'isolated', 'ganked', 'fight', 'collapse', 'other']

const CHAMPS = new Map(
  (
    JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'champions.json'), 'utf8')) as Array<{
      value: number
      label: string
    }>
  ).map(c => [c.value, c.label])
)
const champName = (id: number) => CHAMPS.get(id) ?? String(id)

const f2 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2))

interface Case {
  name: string
  game: Game
  slim: SlimTimeline
}

function loadExtra(id: number): Case {
  const { game } = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, `games/${id}.json`), 'utf8')) as {
    game: Game
  }
  const slim = JSON.parse(
    fs.readFileSync(path.join(EVAL_DIR, `slim/${id}.json`), 'utf8')
  ) as SlimTimeline
  return { name: `eval ${id}`, game, slim }
}

describe('regression diagnose', () => {
  it('prints breakdown', () => {
    const cases: Case[] = [
      { name: '标注局 A', ...(a as unknown as { game: Game; slim: SlimTimeline }) },
      { name: '标注局 B', ...(b as unknown as { game: Game; slim: SlimTimeline }) },
      ...EXTRA_GAMES.map(loadExtra)
    ]
    const out: string[] = ['# 评分校准报告（自动生成）', '']
    for (const c of cases) {
      const snap = buildMatchSnapshot(
        c.game,
        undefined,
        remapTimeline(c.slim, buildPuuidMap(c.game))
      )
      out.push(
        `## ${c.name}（队列 ${snap.queueId}，${Math.round(snap.durationSeconds / 60)} 分钟）`,
        ''
      )
      out.push(
        '| pid | 英雄 | 位置 | 胜负 | KDA | 总分 | 分位段 | 对线 | 团战 | 死亡质量 | 发育 | 资源 | 视野 | 标签 | 减责证据 | 死亡归责 |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'
      )
      for (const s of scoreSnapshot(snap)) {
        const p = snap.players.find(x => x.participantId === s.participantId)!
        const counts = KINDS.map(
          k => [k, (s.deaths ?? []).filter(d => d.kind === k).length] as const
        )
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}×${n}`)
          .join(' ')
        const mit = s.mitigation.mitigated ? `是：${s.mitigation.reasons.join('；')}` : '否'
        out.push(
          `| ${s.participantId} | ${champName(p.championId)} | ${p.teamPosition} | ${p.win ? '胜' : '负'} | ` +
            `${p.kills}/${p.deaths}/${p.assists} | ${f2(s.total)} | ${s.band} | ${f2(s.sub.lane)} | ${f2(s.sub.teamfight)} | ` +
            `${f2(s.sub.deathQuality)} | ${f2(s.sub.growth)} | ${f2(s.sub.resources)} | ${f2(s.sub.vision)} | ` +
            `${s.label} | ${mit} | ${counts || '—'} |`
        )
      }
      const scores = scoreSnapshot(snap)
      const ranked = [...scores].sort((x, y) => y.total - x.total)
      const nameOf = (id: number) => {
        const p = snap.players.find(x => x.participantId === id)!
        return `${champName(p.championId)}(pid ${id}, ${p.teamPosition}, ${p.win ? '胜' : '负'})`
      }
      const drivers = (s: (typeof scores)[number], dir: 1 | -1) =>
        Object.entries(s.contributions)
          .sort((x, y) => dir * (y[1] - x[1]))
          .slice(0, 3)
          .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
          .join('、')
      const hi = ranked[0]
      const lo = ranked[ranked.length - 1]
      out.push(
        '',
        `- 最高分 ${nameOf(hi.participantId)} 总分 ${f2(hi.total)}，主要贡献：${drivers(hi, 1)}。`,
        `- 最低分 ${nameOf(lo.participantId)} 总分 ${f2(lo.total)}，主要拖累：${drivers(lo, -1)}。`,
        ''
      )
    }
    const text = out.join('\n')
    console.log(text)
    fs.mkdirSync(path.dirname(REPORT), { recursive: true })
    fs.writeFileSync(REPORT, text, 'utf8')
  })
})
