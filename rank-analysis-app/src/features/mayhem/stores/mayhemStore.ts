import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getMayhemChampions,
  getMayhemAugments,
  getMayhemStatus,
  syncMayhemData,
  getMyChampionStats,
  getMyAugmentStats,
  extractMayhemChampions,
  type MayhemChampion,
  type MayhemAugment,
  type MayhemStatus,
  type MyChampionStat,
  type MyAugmentStat
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
      if (!status.value.ready && !syncing.value) {
        void sync(false)
      }
    } catch (e) {
      console.warn('[mayhemStore] getMayhemStatus failed:', e)
    }
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
    sync
  }
})
