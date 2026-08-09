/**
 * 战绩卡片上的异步资源加载（装备、召唤师技能、海克斯符文）
 * 统一使用 requestAnimationFrame 推迟，避免阻塞首屏渲染
 */

import { ref } from 'vue'
import { getAssetDetailsByIpc, type AssetDetail } from '@renderer/services/ipc'
import itemNull from '@renderer/assets/imgs/item/null.png'
import { assetPrefix } from '@renderer/services/http'

type AssetKind = 'item' | 'spell' | 'perk'

export function useRecordAssets() {
  const itemDetails = ref<Record<number, AssetDetail>>({})
  const spellDetails = ref<Record<number, AssetDetail>>({})
  const augmentDetails = ref<Record<number, AssetDetail>>({})

  const bucketFor = (kind: AssetKind) => {
    switch (kind) {
      case 'item':
        return itemDetails
      case 'spell':
        return spellDetails
      case 'perk':
        return augmentDetails
    }
  }

  async function loadDetails(kind: AssetKind, ids: number[]) {
    const filtered = ids.filter(id => id > 0)
    if (!filtered.length) return
    try {
      const details = await getAssetDetailsByIpc(kind, filtered)
      bucketFor(kind).value = Object.fromEntries(details.map(d => [d.id, d]))
    } catch (error) {
      console.error(`failed to load ${kind} details`, error)
    }
  }

  /** 一次性调度多个资源的加载，每种放在独立 rAF 中避免阻塞 */
  function preload(plan: { kind: AssetKind; ids: number[] }[]) {
    plan.forEach(({ kind, ids }) => {
      if (ids.some(id => id > 0)) {
        requestAnimationFrame(() => loadDetails(kind, ids))
      }
    })
  }

  function detailOf(kind: AssetKind, id: number): AssetDetail | null {
    if (id <= 0) return null
    return bucketFor(kind).value[id] ?? null
  }

  function srcOf(kind: AssetKind, id: number) {
    return id > 0 ? `${assetPrefix}/${kind}/${id}` : itemNull
  }

  return {
    itemDetails,
    spellDetails,
    augmentDetails,
    preload,
    detailOf,
    srcOf
  }
}
