/**
 * 英雄 ID → 中文名映射的懒加载缓存
 */

let championNameMap: Record<number, string> = {}
/** 客户端英文资源别名，缺失时不猜测来源 URL。 */
let championAliasMap: Record<number, string> = {}

/** 加载并缓存英雄名称及资源别名。
 * @returns 加载结束；失败保留占位名称，允许下次重试。
 */
export async function loadChampionNames(): Promise<void> {
  if (Object.keys(championNameMap).length > 0) return

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const champions =
      await invoke<Array<{ value: number; label: string; alias?: string }>>('get_champion_options')

    championNameMap = {}
    championAliasMap = {}
    champions.forEach(champ => {
      championNameMap[champ.value] = champ.label
      if (champ.alias && /^[A-Za-z0-9]+$/.test(champ.alias))
        championAliasMap[champ.value] = champ.alias
    })
  } catch (e) {
    console.error('Failed to load champion names:', e)
  }
}

/** 获取英雄中文名。
 * @param id 英雄 ID。
 * @returns 已加载名称或包含 ID 的占位文本。
 */
export function getChampionName(id: number): string {
  return championNameMap[id] || `英雄${id}`
}

/** 获取已验证的英文资源别名。
 * @param id 英雄 ID。
 * @returns 资源别名；尚未加载或缺失时为 null。
 */
export function getChampionAlias(id: number): string | null {
  return championAliasMap[id] ?? null
}
