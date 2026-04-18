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

/** value 允许任何可序列化为 JSON 的类型；Rust 端使用 serde_json::Value 接收 */
export async function putConfigByIpc(key: string, value: unknown) {
  await invoke('put_config', { key, value })
}

interface ConfigValue<T = unknown> {
  value: T
}

/**
 * 调用者通过泛型声明期望类型。
 * 这里的类型断言（configValue.value as T）是 Tauri <-> 前端的信任边界 ——
 * Rust 侧负责 schema，前端接收到的就是声明的类型。
 */
export async function getConfigByIpc<T>(key: string) {
  const configValue = await invoke<ConfigValue<T>>('get_config', { key })
  return configValue.value
}

export async function getGameModesByIpc() {
  return await invoke<{ label: string; value: number }[]>('get_game_modes')
}

export async function getAssetDetailsByIpc(typeString: 'item' | 'perk' | 'spell', ids: number[]) {
  return await invoke<AssetDetail[]>('get_asset_details', { typeString, ids })
}
