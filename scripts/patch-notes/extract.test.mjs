import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, parseModelJson, callModel, MODELS_URL } from './extract.mjs'

// 按真实公告页结构裁剪（与 Rust cn_patch_notes.rs 原 fixture 同源）
const HTML = `
<h3><strong>英雄</strong></h3>
<h4 style="x"><img src="x" /><em><strong>沙漠皇帝 阿兹尔</strong></em></h4>
<p>&emsp;W - 沙兵现身<br />&nbsp;【征服者】现在会在每次命中时叠加2层，而不是1层</p>
<h4><img src="w" /><em>德玛西亚之力 盖伦</em></h4>
<p>真实伤害：150 / 250 / 350 &rarr; 125 / 200 / 275</p>
`

test('htmlToText 去标签、转实体、保留行结构', () => {
  const text = htmlToText(HTML)
  assert.match(text, /沙漠皇帝 阿兹尔/)
  assert.match(text, /真实伤害：150 \/ 250 \/ 350 → 125 \/ 200 \/ 275/)
  assert.ok(!text.includes('<'))
  assert.ok(!text.includes('&rarr;'))
})

test('parseModelJson 容忍代码栅栏包装', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 })
})

test('callModel 发 POST 到 GitHub Models 并解析回包', async () => {
  let captured = null
  const fetchFn = async (url, init) => {
    captured = { url, init }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"isPatchNotes":true,"champions":[]}' } }]
      })
    }
  }
  const out = await callModel('正文', 'tok', fetchFn)
  assert.equal(captured.url, MODELS_URL)
  assert.equal(JSON.parse(captured.init.body).temperature, 0)
  assert.equal(captured.init.headers.Authorization, 'Bearer tok')
  assert.deepEqual(out, { isPatchNotes: true, champions: [] })
})

test('callModel 非 200 抛错', async () => {
  const fetchFn = async () => ({ ok: false, status: 429, text: async () => 'rate limited' })
  await assert.rejects(() => callModel('x', 'tok', fetchFn), /429/)
})
