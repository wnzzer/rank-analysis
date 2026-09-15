#!/usr/bin/env node
/**
 * LCU 符文页行为探针（spec 2026-09-15-rune-recommend-design.md「待真机验证」V1–V5）
 *
 * 只在装有客户端的机器上跑，零依赖（Node ≥ 18）。凭据按序取：
 *   1. 环境变量 LCU_PORT + LCU_TOKEN
 *   2. --lockfile <path>（LeagueClient/lockfile）
 *   3. --ux-log-dir <dir>：取目录下最新的 *_LeagueClientUx.log，从启动命令行里抠
 *      --app-port / --remoting-auth-token（国服 WeGame 客户端提权启动、lockfile 陈旧时的绕法）
 *
 * 子命令：
 *   dump [out.json]        导出 phase / pages / inventory / currentpage（不写客户端）
 *   diff <a.json> <b.json> 对比两次 dump 的符文页（新增 / 消失 / 字段变化）
 *   try-temp [--current] [--keep]
 *                          V1/V2/V4：POST 一个 isTemporary 页，打印响应与前后 inventory，
 *                          默认随后删掉**这一页**（只删本次 POST 返回的 id，绝不碰其他页）
 *   watch [秒]             每 2s 轮询 phase + pages，打印变化（V3 生命周期 / V5 锁定窗口）
 *
 * 推荐流程（验证方法见 spec）：选人期先 dump before.json → 客户端里点一次「推荐符文」
 * → dump after.json → diff before.json after.json，照抄官方临时页的字段形状。
 */

import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

/** 解析 LCU 端口与 token，失败直接退出 */
function resolveAuth() {
  if (process.env.LCU_PORT && process.env.LCU_TOKEN) {
    return { port: process.env.LCU_PORT, token: process.env.LCU_TOKEN }
  }
  const lockfile = opt('--lockfile')
  if (lockfile) {
    // 格式：name:pid:port:password:protocol
    const [, , port, token] = fs.readFileSync(lockfile, 'utf8').split(':')
    if (port && token) return { port, token }
  }
  const logDir = opt('--ux-log-dir')
  if (logDir) {
    const latest = fs
      .readdirSync(logDir)
      .filter(f => f.endsWith('_LeagueClientUx.log'))
      .map(f => path.join(logDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
    if (latest) {
      const text = fs.readFileSync(latest, 'utf8')
      const port = text.match(/--app-port=(\d+)/)?.[1]
      const token = text.match(/--remoting-auth-token=([^\s"]+)/)?.[1]
      if (port && token) return { port, token }
    }
  }
  console.error('拿不到 LCU 凭据：设置 LCU_PORT/LCU_TOKEN，或传 --lockfile / --ux-log-dir')
  process.exit(2)
}

const auth = resolveAuth()
const agent = new https.Agent({ rejectUnauthorized: false })

/** 发一个 LCU 请求，返回 { status, body }（body 尽量按 JSON 解析） */
function lcu(method, uri, data) {
  const payload = data === undefined ? undefined : JSON.stringify(data)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: auth.port,
        path: uri,
        method,
        agent,
        auth: `riot:${auth.token}`,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}
      },
      res => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', c => (raw += c))
        res.on('end', () => {
          let body = raw
          try {
            body = raw ? JSON.parse(raw) : null
          } catch {
            /* 非 JSON 原样返回 */
          }
          resolve({ status: res.statusCode, body })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function snapshot() {
  const [phase, pages, inventory, current] = await Promise.all([
    lcu('GET', '/lol-gameflow/v1/gameflow-phase'),
    lcu('GET', '/lol-perks/v1/pages'),
    lcu('GET', '/lol-perks/v1/inventory'),
    lcu('GET', '/lol-perks/v1/currentpage')
  ])
  return {
    at: new Date().toISOString(),
    phase: phase.body,
    inventory: inventory.body,
    currentPageId: current.body?.id ?? null,
    pages: Array.isArray(pages.body) ? pages.body : []
  }
}

/** 页的摘要字段：对比时只看这些，uiPerks 之类的展示字段忽略 */
const KEY_FIELDS = [
  'name',
  'isTemporary',
  'isDeletable',
  'isEditable',
  'isActive',
  'current',
  'order',
  'isRecommendationOverride',
  'recommendationChampionId',
  'recommendationIndex',
  'runeRecommendationId',
  'quickPlayChampionIds',
  'primaryStyleId',
  'subStyleId',
  'selectedPerkIds'
]
const brief = p => Object.fromEntries(KEY_FIELDS.map(k => [k, p[k]]))

function diffSnapshots(a, b) {
  console.log(`phase: ${a.phase} → ${b.phase}`)
  console.log('inventory:', JSON.stringify(a.inventory), '→', JSON.stringify(b.inventory))
  console.log(`currentPageId: ${a.currentPageId} → ${b.currentPageId}`)
  const byId = list => new Map(list.map(p => [p.id, p]))
  const ma = byId(a.pages)
  const mb = byId(b.pages)
  for (const [id, p] of mb) {
    if (!ma.has(id)) console.log(`+ 新增页 ${id}:`, JSON.stringify(brief(p)))
  }
  for (const [id, p] of ma) {
    if (!mb.has(id)) console.log(`- 消失页 ${id}:`, JSON.stringify(brief(p)))
  }
  for (const [id, pa] of ma) {
    const pb = mb.get(id)
    if (!pb) continue
    for (const k of KEY_FIELDS) {
      if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) {
        console.log(`~ 页 ${id} ${k}: ${JSON.stringify(pa[k])} → ${JSON.stringify(pb[k])}`)
      }
    }
  }
}

async function tryTemp() {
  const before = await snapshot()
  const existing = new Set(before.pages.map(p => p.id))
  console.log('before:', JSON.stringify(before.inventory), 'phase', before.phase)
  // 亚索中单 emerald+ 头部构筑（OP.GG 2026-09-15），九个 id 顺序：主系 4 + 副系 2 + 属性 3
  const bodies = [
    {
      name: 'RA probe (temp)',
      isTemporary: true,
      primaryStyleId: 8000,
      subStyleId: 8400,
      selectedPerkIds: [8008, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001],
      current: flag('--current')
    }
  ]
  // --twice：紧接着再建第二个临时页，观察第一个是否被顶掉（V3）
  if (flag('--twice')) {
    bodies.push({
      ...bodies[0],
      name: 'RA probe (temp 2)',
      selectedPerkIds: [8021, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001]
    })
  }
  let prev = before
  let firstId
  for (const body of bodies) {
    const res = await lcu('POST', '/lol-perks/v1/pages', body)
    console.log(`\nPOST /lol-perks/v1/pages (${body.name}) → ${res.status}`)
    console.log(JSON.stringify(typeof res.body === 'object' ? brief(res.body ?? {}) : res.body))
    if (res.status >= 300) console.log('raw body:', JSON.stringify(res.body))
    firstId ??= typeof res.body === 'object' ? res.body?.id : undefined
    const after = await snapshot()
    diffSnapshots(prev, after)
    prev = after
  }

  // --update：先把当前页切回原页，再 PUT 改写刚建的临时页，观察 isTemporary 是否保留、
  // 改写后是否自动成为当前页（换人重写走「原地改写」而非「再建一页」的依据）
  if (flag('--update') && firstId) {
    if (before.currentPageId) await lcu('PUT', '/lol-perks/v1/currentpage', before.currentPageId)
    const mid = await snapshot()
    const res = await lcu('PUT', `/lol-perks/v1/pages/${firstId}`, {
      ...bodies[0],
      name: 'RA probe (updated)',
      selectedPerkIds: [8010, 9111, 9104, 8014, 8135, 8139, 5005, 5008, 5001],
      primaryStyleId: 8000,
      subStyleId: 8100
    })
    console.log(`\nPUT /lol-perks/v1/pages/${firstId} → ${res.status}`)
    if (res.status >= 300) console.log('raw body:', JSON.stringify(res.body))
    const after = await snapshot()
    diffSnapshots(mid, after)
    prev = after
  }

  if (flag('--keep')) return
  // 只删本次新出现的页；实测删掉当前页后客户端会处于「无当前页」，必须把原当前页选回去
  for (const p of prev.pages.filter(p => !existing.has(p.id))) {
    const del = await lcu('DELETE', `/lol-perks/v1/pages/${p.id}`)
    console.log(`清理：DELETE /lol-perks/v1/pages/${p.id} → ${del.status}`)
  }
  if (before.currentPageId) {
    const put = await lcu('PUT', '/lol-perks/v1/currentpage', before.currentPageId)
    console.log(`恢复当前页 ${before.currentPageId} → ${put.status}`)
  }
}

async function watch(seconds) {
  let prev = await snapshot()
  console.log(`[${prev.at}] start phase=${prev.phase}`, JSON.stringify(prev.inventory))
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 2000))
    const cur = await snapshot()
    const changed =
      cur.phase !== prev.phase ||
      JSON.stringify(cur.pages.map(brief)) !== JSON.stringify(prev.pages.map(brief)) ||
      cur.currentPageId !== prev.currentPageId
    if (changed) {
      console.log(`[${cur.at}]`)
      diffSnapshots(prev, cur)
    }
    prev = cur
  }
}

const [cmd, a1, a2] = args
switch (cmd) {
  case 'dump': {
    const snap = await snapshot()
    const out = JSON.stringify(snap, null, 2)
    if (a1 && !a1.startsWith('--')) fs.writeFileSync(a1, out)
    else console.log(out)
    break
  }
  case 'diff':
    diffSnapshots(JSON.parse(fs.readFileSync(a1, 'utf8')), JSON.parse(fs.readFileSync(a2, 'utf8')))
    break
  case 'try-temp':
    await tryTemp()
    break
  case 'watch':
    await watch(Number(a1) > 0 ? Number(a1) : 600)
    break
  default:
    console.log('用法: perks-probe.mjs dump|diff|try-temp|watch（详见文件头注释）')
}
