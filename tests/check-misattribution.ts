// 离线核对：对已保存的评测输出跑张冠李戴过滤器，列出被剔除的句子（人工看误杀）
// 用法（rank-analysis-app 下）：npx vite-node ../tests/check-misattribution.ts <输出目录>...
import { readdirSync, readFileSync } from 'node:fs'
import { CASES } from './ai-fixtures'
import {
  buildEntityFacts,
  findMisattributions
} from '../rank-analysis-app/src/services/ai/matchDetail/misattribution'

for (const dir of process.argv.slice(2)) {
  let files = 0
  let removed = 0
  const samples: string[] = []
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(stomp|carry-lost|traps|aram)-r\d+-(overview|player(\d+))\.md$/)
    if (!m) continue
    const c = CASES.find(x => x.key === m[1])!
    const md = readFileSync(`${dir}/${f}`, 'utf8')
    const hits = findMisattributions(md, {
      players: buildEntityFacts(c.snap as any),
      subjectId: m[3] ? Number(m[3]) : undefined
    })
    files++
    removed += hits.length
    for (const h of hits) if (samples.length < 20) samples.push(`[${f}] ${h.reason} ｜ ${h.sentence.slice(0, 90)}`)
  }
  console.log(`${dir}: ${files} 篇，剔除 ${removed} 句（${(removed / Math.max(1, files)).toFixed(2)}/篇）`)
  for (const s of samples) console.log('   ' + s)
}
