/**
 * 数据管线编排：列表 → 候选 → docid 对比 → 文章 → AI 抽取 → 校验 → 写文件。
 * 任何校验失败以非 0 退出（workflow 红灯），绝不写入半成品数据。
 * AI 判定 isPatchNotes=false 时静默跳过（宽筛选的正常路径），会在下轮重试。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fetchList, pickCandidate, fetchArticleHtml, deriveLabel } from './fetch.mjs'
import { htmlToText, callModel } from './extract.mjs'
import { fetchWhitelist, validateExtraction } from './validate.mjs'

const DATA_DIR = path.join(process.cwd(), 'data', 'patch-notes')
const LATEST = path.join(DATA_DIR, 'cn-latest.json')

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(LATEST, 'utf8'))
  } catch {
    return null
  }
}

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('缺少 GITHUB_TOKEN 环境变量')
  process.exit(1)
}

const items = await fetchList()
const candidate = pickCandidate(items)
if (!candidate) {
  console.log('频道最近列表无版本更新公告，跳过')
  process.exit(0)
}
const existing = readExisting()
if (existing?.docId === String(candidate.iDocID)) {
  console.log(`docid 未变（${candidate.iDocID}），无需更新`)
  process.exit(0)
}

console.log(`发现新公告: ${candidate.sTitle} (docid=${candidate.iDocID})`)
const html = await fetchArticleHtml(candidate.sRedirectURL)
const text = htmlToText(html)
const extracted = await callModel(text, token)
if (extracted.isPatchNotes !== true) {
  console.log('AI 判定非端游版本更新公告，跳过')
  process.exit(0)
}

// sIdxTime 为北京时间（UTC+8）
const publishedAtEpoch = Math.floor(
  new Date(candidate.sIdxTime.replace(' ', 'T') + '+08:00').getTime() / 1000
)

/** 组装产出对象并写入 latest + archive；docId 强制转 string 防上游类型漂移破坏 Rust 端反序列化 */
function writeOut(champions) {
  const out = {
    schemaVersion: 1,
    docId: String(candidate.iDocID),
    title: candidate.sTitle,
    patchLabel: deriveLabel(candidate.sTitle),
    publishedAt: candidate.sIdxTime.slice(0, 10),
    publishedAtEpoch,
    generatedAt: new Date().toISOString(),
    sourceUrl: candidate.sRedirectURL,
    champions
  }
  fs.mkdirSync(path.join(DATA_DIR, 'archive'), { recursive: true })
  const json = JSON.stringify(out, null, 2) + '\n'
  fs.writeFileSync(LATEST, json)
  fs.writeFileSync(path.join(DATA_DIR, 'archive', `${out.docId}.json`), json)
  return out
}

// 合法的零改动公告（如仅修 bug 的停机公告）：AI 判定为版本公告但未抽出任何英雄改动。
// champions 为空数组时无条目可过白名单校验，直接跳过 validateExtraction 写入空改动并
// 记录 docid，避免下界校验判定越界 exit 1、docid 未落盘导致每 6h 红灯到下期公告。
if (Array.isArray(extracted.champions) && extracted.champions.length === 0) {
  const out = writeOut([])
  console.log(`本期公告无英雄平衡改动，已记录 docid（${out.patchLabel}）`)
  process.exit(0)
}

const whitelist = await fetchWhitelist()
const result = validateExtraction(extracted, whitelist, text)
if (!result.ok) {
  console.error('校验闸门未通过，保留旧数据：\n- ' + result.errors.join('\n- '))
  process.exit(1)
}

const out = writeOut(result.champions)
console.log(`已写入 ${out.champions.length} 个英雄的改动（${out.patchLabel}）`)
