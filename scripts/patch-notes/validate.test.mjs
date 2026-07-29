import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWhitelist, validateExtraction } from './validate.mjs'

// CommunityDragon zh_cn：name=称号、description=中文名
const SUMMARY = [
  { id: -1, name: '无', description: '', alias: 'None' },
  { id: 1, name: '黑暗之女', description: '安妮', alias: 'Annie' },
  { id: 267, name: '唤潮鲛姬', description: '娜美', alias: 'Nami' },
  // 60000+ 的 Jade_* 模式变体与本体同名同称号，排在本体之后
  { id: 60267, name: '唤潮鲛姬', description: '娜美', alias: 'Jade_Nami' }
]
const wl = () => buildWhitelist(SUMMARY)
const ARTICLE = 'W 潮涌\n治疗量：60 → 65\n基础护甲：28 → 30'
const champ = over => ({
  name: '娜美',
  direction: 'buff',
  lines: ['治疗量：60 → 65'],
  ...over
})
const extracted = (...champs) => ({ isPatchNotes: true, champions: champs })

test('白名单以 description（中文名）为键并携带 id/alias', () => {
  assert.deepEqual(wl().get('娜美'), { championId: 267, alias: 'Nami' })
  assert.equal(wl().has('唤潮鲛姬'), false) // 称号不是键
  assert.equal(wl().has(''), false) // id=-1 的占位不进白名单
})

test('白名单遇同名的 Jade_* 模式变体时取本体 id，不被覆盖', () => {
  // 反序也要稳：不能依赖上游的排列顺序
  const reversed = buildWhitelist([...SUMMARY].reverse())
  assert.deepEqual(reversed.get('娜美'), { championId: 267, alias: 'Nami' })
})

test('happy path：通过并富化 championId/alias', () => {
  const r = validateExtraction(extracted(champ()), wl(), ARTICLE)
  assert.equal(r.ok, true)
  assert.deepEqual(r.champions, [
    { championId: 267, alias: 'Nami', name: '娜美', direction: 'buff', lines: ['治疗量：60 → 65'] }
  ])
})

test('拒绝：isPatchNotes 不为 true', () => {
  const r = validateExtraction({ isPatchNotes: false, champions: [champ()] }, wl(), ARTICLE)
  assert.equal(r.ok, false)
})

test('拒绝：英雄名不在白名单（AI 幻觉名）', () => {
  const r = validateExtraction(extracted(champ({ name: '娜美子' })), wl(), ARTICLE)
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /白名单/)
})

test('拒绝：direction 非法', () => {
  const r = validateExtraction(extracted(champ({ direction: 'rework' })), wl(), ARTICLE)
  assert.equal(r.ok, false)
})

test('拒绝：条目全部对不上原文（疑似改写）', () => {
  const r = validateExtraction(extracted(champ({ lines: ['治疗量大幅提升了'] })), wl(), ARTICLE)
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /改写/)
})

test('拒绝：champions 数量越界', () => {
  const r = validateExtraction(extracted(), wl(), ARTICLE) // 0 个
  assert.equal(r.ok, false)
  const many = Array.from({ length: 41 }, () => champ())
  assert.equal(validateExtraction({ isPatchNotes: true, champions: many }, wl(), ARTICLE).ok, false)
})

test('条目原文比对忽略空白差异', () => {
  const r = validateExtraction(
    extracted(champ({ lines: ['治疗量：60→65'] })), // 原文有空格，AI 输出没有
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, true)
})

test('AI 把小节标题与改动行并进同一条时，按换行拆开逐条校验', () => {
  const r = validateExtraction(
    extracted(champ({ lines: ['W 潮涌\n治疗量：60 → 65'] })),
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.champions[0].lines, ['W 潮涌', '治疗量：60 → 65'])
})

test('AI 用冒号把小节标题与改动行并成一条时，对回原文并还原成两条', () => {
  const r = validateExtraction(
    extracted(champ({ lines: ['W 潮涌：治疗量：60 → 65'] })),
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.champions[0].lines, ['W 潮涌', '治疗量：60 → 65'])
})

test('同一英雄被 AI 拆成多个条目时合并', () => {
  const r = validateExtraction(
    extracted(champ({ lines: ['治疗量：60 → 65'] }), champ({ lines: ['基础护甲：28 → 30'] })),
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, true)
  assert.equal(r.champions.length, 1)
  assert.deepEqual(r.champions[0].lines, ['治疗量：60 → 65', '基础护甲：28 → 30'])
})

test('换行拆分后仍逐条比对原文：拆出的条目全不命中则拒绝', () => {
  const r = validateExtraction(
    extracted(champ({ lines: ['治疗量大幅提升\n护甲也加强了'] })),
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /改写/)
})

test('拒绝：跨行拼接的伪造条目', () => {
  const r = validateExtraction(
    extracted(champ({ lines: ['潮涌治疗量'] })), // 跨行拼接：'W 潮涌' + '治疗量：...'
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /改写/)
})

test('lines 上限容纳大改英雄的长改动列表', () => {
  const many = Array.from({ length: 40 }, (_, i) => `属性${i}：1 → 2`)
  assert.equal(validateExtraction(extracted(champ({ lines: many })), wl(), many.join('\n')).ok, true)
  const tooMany = Array.from({ length: 61 }, (_, i) => `属性${i}：1 → 2`)
  const r = validateExtraction(extracted(champ({ lines: tooMany })), wl(), tooMany.join('\n'))
  assert.equal(r.ok, false)
})

test('失败时 champions 为空数组', () => {
  const r = validateExtraction(
    extracted(champ({ name: '娜美子' }), champ()), // 第一个名字不在白名单，第二个合法
    wl(),
    ARTICLE
  )
  assert.equal(r.ok, false)
  assert.equal(r.champions.length, 0)
})
