/**
 * LCU / SGP 访问的共享工具（ai-eval 采集与 baseline 试采集共用）。
 * 凭据：优先环境变量 LCU_PORT / LCU_TOKEN；否则从 WeGame 的 LeagueClientUx 日志里抠。
 * 注意：任何函数都不得打印或落盘 token。
 */
import process from 'node:process'
import { Buffer } from 'node:buffer'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

export const UA = 'LeagueOfLegendsClient/15.0.0.0 (rcp-be-lol-match-history)'

/** 与 src-tauri/src/constant/game.rs 的 SGP_PLATFORM_TO_HOST 保持一致 */
export const SGP_HOST = {
  HN1: 'hn1-k8s-sgp.lol.qq.com:21019',
  HN10: 'hn10-k8s-sgp.lol.qq.com:21019',
  NJ100: 'nj100-sgp.lol.qq.com:21019',
  GZ100: 'gz100-sgp.lol.qq.com:21019',
  CQ100: 'cq100-sgp.lol.qq.com:21019',
  TJ100: 'tj100-sgp.lol.qq.com:21019',
  TJ101: 'tj101-sgp.lol.qq.com:21019',
  BGP2: 'bgp2-k8s-sgp.lol.qq.com:21019'
}

/**
 * 读取 LCU 端口与 token。
 * @returns {{port: string, token: string}} 凭据
 */
export function findCreds() {
  if (process.env.LCU_PORT && process.env.LCU_TOKEN) {
    return { port: process.env.LCU_PORT, token: process.env.LCU_TOKEN }
  }
  const logs = []
  const root = 'C:/WeGameApps'
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d, 'LeagueClient')
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('_LeagueClientUx.log')) logs.push(path.join(dir, f))
      }
    }
  }
  logs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  for (const l of logs) {
    const t = fs.readFileSync(l, 'latin1')
    const port = t.match(/--app-port=(\d+)/)?.[1]
    const token = t.match(/--remoting-auth-token=([^\s"]+)/)?.[1]
    if (port && token) return { port, token }
  }
  throw new Error('找不到 LCU 凭据：请设置 LCU_PORT / LCU_TOKEN 环境变量')
}

/**
 * 请求本机 LCU（basic auth）。
 * @param {{port: string, token: string}} creds - 凭据
 * @param {string} p - 以 / 开头的路径
 * @returns {Promise<any>} 解析后的 JSON
 */
export function lcuGet(creds, p) {
  return new Promise((resolve, reject) => {
    https
      .get(
        {
          host: '127.0.0.1',
          port: creds.port,
          path: p,
          rejectUnauthorized: false,
          headers: {
            Authorization: 'Basic ' + Buffer.from('riot:' + creds.token).toString('base64')
          }
        },
        res => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', c => (body += c))
          res.on('end', () =>
            res.statusCode < 300
              ? resolve(JSON.parse(body))
              : reject(new Error(`LCU ${res.statusCode} ${p}: ${body.slice(0, 200)}`))
          )
        }
      )
      .on('error', reject)
  })
}

/**
 * 请求 SGP（bearer）。失败时抛出带 `status` 属性的 Error（超时/网络错误无 status）。
 * @param {string} host - SGP 主机（含端口）
 * @param {string} p - 不带前导 / 的路径
 * @param {string} token - entitlements accessToken
 * @param {number} [timeoutMs] - 可选超时（毫秒）
 * @returns {Promise<any>} 解析后的 JSON
 */
export async function sgpGet(host, p, token, timeoutMs) {
  const r = await fetch(`https://${host}/${p}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {})
  })
  const text = await r.text()
  if (!r.ok) {
    const err = new Error(`SGP ${r.status} ${p}: ${text.slice(0, 200)}`)
    err.status = r.status
    throw err
  }
  return JSON.parse(text)
}
