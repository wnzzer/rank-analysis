/**
 * 把用户标注的两局（fixtures/games + fixtures/slim，含他人 ID，不入库）匿名导出为入库单测 fixture：
 * puuid → puuid-<序号>、名字 → 玩家<序号>#0000、gameId → 1/2、创建时间清零；身份只留 gameName/tagLine/puuid。
 * 先跑 backfill-positions.mjs 给 slim 补分路。
 * 用法：node scripts/ai-eval/export-regression.mjs <局A gameId> <局B gameId>
 * （真实 gameId 只从命令行传入，不写进仓库）
 */
import fs from 'node:fs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../src/services/ai/shared/scoring/__tests__/fixtures')
const [idA, idB] = process.argv.slice(2).map(Number)
if (!idA || !idB) {
  console.error('用法：node scripts/ai-eval/export-regression.mjs <局A gameId> <局B gameId>')
  process.exit(1)
}
const CASES = [
  ['regression-a', idA, 1],
  ['regression-b', idB, 2]
]

fs.mkdirSync(OUT, { recursive: true })
for (const [name, gameId, anonId] of CASES) {
  const { game } = JSON.parse(
    fs.readFileSync(path.join(HERE, `fixtures/games/${gameId}.json`), 'utf8')
  )
  const slim = JSON.parse(fs.readFileSync(path.join(HERE, `fixtures/slim/${gameId}.json`), 'utf8'))
  const anon = new Map(game.gameDetail.participantIdentities.map((x, i) => [x.player.puuid, i + 1]))
  const identity = x => {
    const i = anon.get(x.player.puuid)
    return {
      participantId: x.participantId,
      player: { gameName: `玩家${i}`, tagLine: '0000', puuid: `puuid-${i}` }
    }
  }
  const out = {
    game: {
      ...game,
      gameId: anonId,
      gameCreation: 0,
      gameCreationDate: '',
      platformId: 'ANON',
      participantIdentities: game.participantIdentities.map(identity),
      gameDetail: {
        ...game.gameDetail,
        gameId: anonId,
        gameCreation: 0,
        gameCreationDate: '',
        platformId: 'ANON',
        participantIdentities: game.gameDetail.participantIdentities.map(identity)
      }
    },
    slim: {
      ...slim,
      gameId: anonId,
      participants: slim.participants.map(p => ({
        participantId: p.participantId,
        puuid: `puuid-${anon.get(p.puuid) ?? 0}`,
        // SGP 真实分路（backfill-positions.mjs 已补；没补到为空串）
        teamPosition: p.teamPosition ?? ''
      }))
    }
  }
  const text = JSON.stringify(out)
  for (const [puuid] of anon) if (text.includes(puuid)) throw new Error(`${name} 残留真实 puuid`)
  if (text.includes(String(gameId))) throw new Error(`${name} 残留真实 gameId`)
  fs.writeFileSync(path.join(OUT, `${name}.json`), text)
  console.log(`✓ ${name}.json（${Math.round(text.length / 1024)}KB）`)
}
