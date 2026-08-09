import { invoke } from '@tauri-apps/api/core'

export interface AssetDetail {
  id: number
  name: string
  description: string
  rarity?: string
}

export async function getImgBase64ByIpc(typeString: string, id: number) {
  const base64 = await invoke<string>('get_asset_base64', { typeString, id })
  return base64
}

/**
 * 写入配置。
 *
 * 持久化格式统一为 `{ value: T }` 包装 —— helper 内部完成包装，调用方只传裸值。
 * 历史上配置以"裸值"和"包装值"两种格式混存，会让后续 contributor 很容易踩坑
 * （比如 read 用 helper 解包但 write 忘了包装）。现统一为单一格式，避免再发生。
 *
 * 注意：不要把形如 `{ value: ... }` 的业务对象作为 value 传入 ——
 * 会被 `getConfigByIpc` 读出时误解包成内部字段。
 */
export async function putConfigByIpc<T>(key: string, value: T): Promise<void> {
  await invoke('put_config', { key, value: { value } })
}

/**
 * 读取配置，自动解包 `{ value: T }` 格式。
 *
 * 老版本（v1.8.0 及之前）可能以裸值持久化少数 key（theme / matchHistoryCount /
 * selectMode）；升级后这些键读出 `undefined`，调用方走默认值，用户需要在 UI
 * 上重新设置一次。这是已知一次性影响，写在 CHANGELOG。
 */
export async function getConfigByIpc<T>(key: string): Promise<T | undefined> {
  const raw = await invoke<{ value: T } | null>('get_config', { key })
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return raw.value
  }
  return undefined
}

export async function getGameModesByIpc() {
  return await invoke<{ label: string; value: number }[]>('get_game_modes')
}

export async function getAssetDetailsByIpc(typeString: 'item' | 'perk' | 'spell', ids: number[]) {
  return await invoke<AssetDetail[]>('get_asset_details', { typeString, ids })
}

/**
 * 免 WeGame 一键启动国服英雄联盟登录客户端。
 *
 * 成功仅表示登录客户端已拉起（随后会弹腾讯登录窗，仍需登录）；后端未找到安装目录、
 * 未找到登录客户端 exe 或 spawn 失败时，会 reject 一个中文错误说明。
 */
export async function launchLeagueByIpc(): Promise<void> {
  await invoke('launch_league')
}

/**
 * 关闭正在运行的英雄联盟客户端。
 *
 * 后端优先走 LCU 优雅退出（等同点客户端右上角关闭），LCU 不可用时兜底强杀
 * 客户端进程链；客户端本就没在运行时 reject 一个中文错误说明。
 */
export async function closeLeagueByIpc(): Promise<void> {
  await invoke('close_league')
}
