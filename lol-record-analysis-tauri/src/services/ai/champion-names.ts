/**
 * 英雄 ID → 中文名映射的懒加载缓存
 */

let championNameMap: Record<number, string> = {}

export async function loadChampionNames(): Promise<void> {
  if (Object.keys(championNameMap).length > 0) return

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const champions = await invoke<Array<{ value: number; label: string }>>('get_champion_options')

    championNameMap = {}
    champions.forEach(champ => {
      championNameMap[champ.value] = champ.label
    })
  } catch (e) {
    console.error('Failed to load champion names:', e)
  }
}

export function getChampionName(id: number): string {
  return championNameMap[id] || `英雄${id}`
}
