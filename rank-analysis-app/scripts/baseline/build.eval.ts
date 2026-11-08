/**
 * 基准构建：scripts/baseline/raw → src/data/baseline/{baseline,thresholds}.json（入库）。
 * 用法：npm run baseline:build（语料约 54.8k 局 + DETAILS 6000 份，raw/ 668MB；坏行/坏 gz 跳过）。
 * 内存不够时：NODE_OPTIONS=--max-old-space-size=8192 npm run baseline:build（vitest 子进程继承）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildBaseline, buildThresholds, DATA_DIR, loadCorpus, RAW_DIR } from './pipeline'

describe('baseline build', () => {
  it('writes baseline.json and thresholds.json', () => {
    const t0 = Date.now()
    const builtAt = new Date().toISOString()
    const corpus = loadCorpus(RAW_DIR)
    const baseline = buildBaseline(corpus, builtAt)
    const thresholds = buildThresholds(corpus, baseline, builtAt)
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(path.join(DATA_DIR, 'baseline.json'), JSON.stringify(baseline))
    fs.writeFileSync(path.join(DATA_DIR, 'thresholds.json'), JSON.stringify(thresholds))
    console.log(
      `语料 ${baseline.meta.sampleGames} 局（DETAILS ${baseline.meta.detailsGames}），` +
        `perQueue ${JSON.stringify(baseline.meta.perQueue)}，版本 ${baseline.meta.versions.join(',')}；` +
        `基准格 ${Object.keys(baseline.cells).length}，阈值格 ${Object.keys(thresholds.cells).length}，` +
        `耗时 ${Math.round((Date.now() - t0) / 1000)}s`
    )
    expect(Object.keys(baseline.cells).length).toBeGreaterThan(0)
    expect(thresholds.cells['*|*|tl']).toBeDefined()
    expect(thresholds.cells['*|*|notl']).toBeDefined()
  })
})
