// 临时探测脚本：验证 GitHub Models 能否胜任公告抽取（不写任何数据）
import { fetchList, pickCandidate, fetchArticleHtml } from './fetch.mjs'
import { htmlToText, callModel } from './extract.mjs'
import { fetchWhitelist, validateExtraction } from './validate.mjs'

const URL = 'https://models.github.ai/inference/chat/completions'
const token = process.env.GITHUB_TOKEN
const c = pickCandidate(await fetchList())
const text = htmlToText(await fetchArticleHtml(c.sRedirectURL))
console.log(`公告: ${c.sTitle}，正文 ${text.length} 字符`)
const { whitelist, titles } = await fetchWhitelist()
for (const model of (process.env.MODELS || 'openai/gpt-4.1,openai/gpt-4o').split(',')) {
  const fetchFn = (_u, init) => {
    const body = JSON.parse(init.body)
    body.model = model
    return fetch(URL, { ...init, body: JSON.stringify(body) })
  }
  const t0 = Date.now()
  try {
    const ex = await callModel(text, token, fetchFn)
    const r = validateExtraction(ex, whitelist, text, titles)
    console.log(`[${model}] ${Date.now() - t0}ms isPatchNotes=${ex.isPatchNotes} 抽出=${ex.champions?.length} ok=${r.ok} 通过=${r.champions.length}`)
    if (!r.ok) console.log('  ' + r.errors.join('\n  '))
    console.log('  名单: ' + (ex.champions ?? []).map(x => `${x.name}/${x.direction}`).join(', '))
  } catch (e) {
    console.log(`[${model}] 失败: ${e.message}`)
  }
}
