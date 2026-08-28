import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getMayhemChampions,
  getMayhemAugments,
  getMayhemChampionDetail,
  getMayhemStatus,
  syncMayhemData,
  getMyChampionStats,
  getMyAugmentStats,
  extractMayhemChampions,
  type MayhemChampion,
  type MayhemAugment,
  type MayhemStatus,
  type MyChampionStat,
  type MyAugmentStat,
  type ChampionDetailEntry
} from '../services/mayhemData'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'

export type MayhemViewMode = 'matrix' | 'classic'

export const useMayhemStore = defineStore('mayhem', () => {
  const champions = ref<MayhemChampion[]>([])
  const augments = ref<MayhemAugment[]>([])
  const myChamps = ref<MyChampionStat[]>([])
  const myAugs = ref<MyAugmentStat[]>([])
  const status = ref<MayhemStatus | null>(null)

  const loading = ref(false)
  const augsLoading = ref(false)
  const syncing = ref(false)
  const error = ref('')
  const selectedChampionId = ref<number | null>(null)

  // 视图模式：'matrix'（全新 AramMeta 矩阵看板）或 'classic'（经典列表卡片）
  const viewMode = ref<MayhemViewMode>('matrix')

  const isDataReady = computed(() => champions.value.length > 0)

  async function initViewMode(): Promise<void> {
    try {
      const saved = await getConfigByIpc<string>('mayhem.viewMode')
      if (saved === 'classic' || saved === 'matrix') {
        viewMode.value = saved
        return
      }
    } catch {
      /* 回退到 localStorage */
    }
    const ls = localStorage.getItem('mayhem.viewMode')
    if (ls === 'classic' || ls === 'matrix') {
      viewMode.value = ls
    }
  }

  async function setViewMode(mode: MayhemViewMode): Promise<void> {
    viewMode.value = mode
    localStorage.setItem('mayhem.viewMode', mode)
    try {
      await putConfigByIpc('mayhem.viewMode', mode)
    } catch {
      /* 存储失败静默 */
    }
  }

  /**
   * 加载英雄榜数据。内存中已有数据时直接秒开，后台可静默刷新。
   */
  async function loadChampions(force = false): Promise<void> {
    if (champions.value.length && !force) return
    loading.value = true
    error.value = ''
    try {
      const res = await getMayhemChampions()
      const list = extractMayhemChampions(res)
      if (list.length) {
        champions.value = list
        if (!selectedChampionId.value) {
          selectedChampionId.value = list[0].id
        }
      }
    } catch (e) {
      if (!champions.value.length) {
        error.value = `读取本地数据失败：${String(e)}`
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * 加载强化榜数据。
   */
  async function loadAugments(force = false): Promise<void> {
    if (augments.value.length && !force) return
    augsLoading.value = true
    try {
      const res = await getMayhemAugments()
      if (res.data?.length) {
        augments.value = res.data
      }
    } catch (e) {
      console.warn('[mayhemStore] loadAugments failed:', e)
    } finally {
      augsLoading.value = false
    }
  }

  /**
   * 加载本地自采数据。
   */
  async function loadMine(force = false): Promise<void> {
    if (myChamps.value.length && !force) return
    try {
      const [c, a] = await Promise.all([getMyChampionStats(), getMyAugmentStats()])
      myChamps.value = c
      myAugs.value = a
    } catch (e) {
      console.warn('[mayhemStore] loadMine failed:', e)
    }
  }

  /**
   * 页面挂载时初始化：确保数据立即可用，避免因切页导致的空白或闪烁。
   */
  async function init(): Promise<void> {
    await initViewMode()
    // 无论 status 状态为何，优先读取本地现存缓存，保证页面秒开不白屏
    await loadChampions()

    try {
      status.value = await getMayhemStatus()
      // 仅当本地既无就绪状态、列表也为空且当前未在同步时，才触发首次静默拉取
      if (!status.value.ready && !champions.value.length && !syncing.value) {
        void sync(false)
      }
    } catch (e) {
      console.warn('[mayhemStore] getMayhemStatus failed:', e)
    }
  }

  const detailCache = new Map<number, ChampionDetailEntry>()

  /**
   * 获取单英雄详情（内存缓存优先，带 120ms 并发容错重试）
   */
  async function getChampionDetail(id: number, force = false): Promise<ChampionDetailEntry | null> {
    if (!id) return null
    if (!force && detailCache.has(id)) {
      return detailCache.get(id)!
    }
    try {
      const d = await getMayhemChampionDetail(id)
      if (d) {
        detailCache.set(id, d)
        return d
      }
    } catch (e) {
      console.warn(`[mayhemStore] getChampionDetail(${id}) first attempt failed:`, e)
    }

    // 容错重试：如果第一次读取因后台同步切换目录或文件锁短暂返回失败，延迟 120ms 重试
    await new Promise(r => setTimeout(r, 120))
    try {
      const retry = await getMayhemChampionDetail(id)
      if (retry) {
        detailCache.set(id, retry)
        return retry
      }
    } catch (e) {
      console.error(`[mayhemStore] getChampionDetail(${id}) retry failed:`, e)
    }
    return null
  }

  /**
   * 执行数据同步。
   */
  async function sync(force = false): Promise<void> {
    if (syncing.value) return
    syncing.value = true
    error.value = ''
    try {
      await syncMayhemData(force)
      detailCache.clear()
      await Promise.all([loadChampions(true), loadAugments(true)])
      status.value = await getMayhemStatus()
    } catch (e) {
      error.value = `同步失败：${String(e)}`
    } finally {
      syncing.value = false
    }
  }

  return {
    champions,
    augments,
    myChamps,
    myAugs,
    status,
    loading,
    augsLoading,
    syncing,
    error,
    selectedChampionId,
    viewMode,
    isDataReady,
    init,
    initViewMode,
    setViewMode,
    loadChampions,
    loadAugments,
    loadMine,
    getChampionDetail,
    sync
  }
})
