/**
 * 知识库构建脚本测试（node --test scripts/build-knowledge*.test.mjs）。
 * 断言：产物契约形状、yaml 解析、畸形规则报错、markdown 条目抽取。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { buildKnowledge } from './build-knowledge.mjs'

test('产物契约：schemaVersion / patch / patchNotes 空对象 / 三模式知识', () => {
  const out = buildKnowledge()
  assert.equal(out.schemaVersion, 1)
  assert.equal(typeof out.patch, 'string')
  assert.ok(out.patch.length > 0)
  assert.deepEqual(out.patchNotes, {})
  for (const key of ['ranked', 'aram', 'brawl']) {
    assert.ok(Array.isArray(out.modeKnowledge[key]), `${key} 应有知识条目数组`)
    assert.ok(out.modeKnowledge[key].length > 0, `${key} 条目不应为空`)
  }
})

test('信号规则解析：字段齐备且合法', () => {
  const { signalRules } = buildKnowledge()
  assert.ok(signalRules.length >= 3, `至少 3 条规则，实际 ${signalRules.length}`)
  for (const rule of signalRules) {
    assert.ok(rule.id, 'id 必填')
    assert.ok(['teammate', 'enemy', 'self'].includes(rule.scope), `scope 合法: ${rule.scope}`)
    assert.ok(['info', 'warn', 'danger'].includes(rule.severity), `severity 合法: ${rule.severity}`)
    assert.ok(rule.text.includes('{name}'), 'text 应含 {name} 占位符')
    const conditions = [...rule.whenAll, ...rule.whenAny]
    assert.ok(conditions.length > 0, 'when 条件非空')
    for (const cond of conditions) {
      assert.ok(['lt', 'lte', 'gt', 'gte', 'eq'].includes(cond.op), `op 合法: ${cond.op}`)
      assert.equal(typeof cond.value, 'number')
    }
  }
})

test('markdown 条目按节抽取并带节名前缀', () => {
  const ranked = buildKnowledge().modeKnowledge.ranked
  assert.ok(ranked.every(e => e.startsWith('[对局节奏]') || e.startsWith('[分路要点]') || e.startsWith('[心态与沟通]') || e.startsWith('[常见误区]')))
  assert.ok(ranked.some(e => e.includes('小龙')), '排位知识应含小龙节奏条目')
})

test('畸形规则应抛错（未知指标）', () => {
  const src = path.join(process.cwd(), 'knowledge', 'rules', 'signals.yaml')
  const original = fs.readFileSync(src, 'utf8')
  const bad = original.replace('metric: lossStreak', 'metric: killParticipation10')
  try {
    fs.writeFileSync(src, bad)
    assert.throws(() => buildKnowledge(), /不在白名单/)
  } finally {
    fs.writeFileSync(src, original)
  }
})
