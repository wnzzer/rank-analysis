import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { getSgpRankByName, getSgpRegions } from '@renderer/features/record/services/sgp'
import { modeOptions, initModeOptions } from '@renderer/composables/useGameModes'
import {
  defaultRank,
  defaultRecentWinRate,
  defaultSummoner,
  type Rank,
  type RecentWinRate,
  type Summoner
} from '@renderer/types/domain/player'
import {
  defaultRecentData,
  type RankTag,
  type RecentData,
  type UserTag
} from '@renderer/types/domain/analysis'

/**
 * 战绩页玩家数据源：玩家条（PlayerBar）与左栏（UserSidePanel）共享同一份
 * summoner / rank / 近期胜率 / 标签 / 近期聚合数据。
 *
 * 从原 UserRecord.vue 迁移：路由 name/region 查询参数加载，跨区查询时
 * 段位走 SGP rankedStats 直查；胜率/标签不支持跨区，只展示玩家名、段位与大区。
 */
export function usePlayerRecordData() {
  const route = useRoute()
  /** 跨区查询目标大区 platformId（空 = 当前区，走本地 LCU） */
  const region = computed(() => (route.query.region as string) ?? '')
  const isCrossRegion = computed(() => !!region.value)

  const summoner = ref<Summoner>(defaultSummoner())
  const rank = ref<Rank>(defaultRank())
  const solo5v5 = ref<RecentWinRate>(defaultRecentWinRate())
  const flex = ref<RecentWinRate>(defaultRecentWinRate())
  const recentData = ref<RecentData>(defaultRecentData())
  const tags = ref<RankTag[]>([])
  const platformIdCn = ref('未知')
  const mode = ref('全部')

  let name = ''

  const getTags = async (summonerName: string, modeValue: number) => {
    const user_tag = await invoke<UserTag>('get_user_tag_by_name', {
      name: summonerName,
      mode: modeValue
    })
    tags.value = user_tag.tag
    recentData.value = user_tag.recentData
  }

  const loadSummonerData = async (summonerName: string) => {
    if (!summonerName) return

    name = summonerName

    // 跨区：胜率/标签不支持跨区（SGP 无这些数据），只补段位——走 SGP
    // `leagues-ledge` rankedStats 直查（LCU 段位端点只能查当前登录区）。
    // 对局战绩由右侧 MatchHistory 走 SGP，不在此处加载。
    if (region.value) {
      const [g, t] = summonerName.split('#')
      summoner.value = { ...defaultSummoner(), gameName: g ?? summonerName, tagLine: t ?? '' }
      const sgpRank = await getSgpRankByName(region.value, summonerName)
      rank.value = sgpRank ?? defaultRank()
      solo5v5.value = defaultRecentWinRate()
      flex.value = defaultRecentWinRate()
      recentData.value = defaultRecentData()
      tags.value = []
      const regions = await getSgpRegions()
      platformIdCn.value = regions.find(r => r.value === region.value)?.label ?? region.value
      return
    }

    // 需要 summoner 作为其余请求的依据，单独先取；其余调用互相独立，并行
    summoner.value = await invoke<Summoner>('get_summoner_by_name', { name })

    const [rankValue, modeValue, platformValue, solo, flexValue] = await Promise.all([
      invoke<Rank>('get_rank_by_name', { name }),
      // 历史上 reader 用 `selectMode`、writer 用 `settings.user.selectMode`，
      // 导致用户切换的模式从来没被持久化读到。统一为 writer 用的 key。
      getConfigByIpc<number>('settings.user.selectMode').then(v => v ?? 0),
      invoke<string>('get_platform_name_by_name', { name }),
      invoke<RecentWinRate>('get_win_rate_by_name_mode', { name, mode: 420 }),
      invoke<RecentWinRate>('get_win_rate_by_name_mode', { name, mode: 440 })
    ])

    rank.value = rankValue
    mode.value = modeOptions.value.find(option => option.key === modeValue)?.label || '全部'
    platformIdCn.value = platformValue
    solo5v5.value = solo
    flex.value = flexValue

    getTags(name, modeValue)
  }

  const updateMode = (value: string | number, option: { label?: string }) => {
    const selectMode = value as number
    putConfigByIpc('settings.user.selectMode', selectMode)
    getTags(name, selectMode)
    mode.value = option.label ?? '全部'
  }

  onMounted(async () => {
    await initModeOptions()
    const nameFromQuery = route.query.name as string
    if (nameFromQuery) {
      await loadSummonerData(nameFromQuery)
    }
  })

  watch(
    () => route.query.name,
    newName => {
      if (newName && typeof newName === 'string') {
        loadSummonerData(newName)
      }
    }
  )

  return {
    summoner,
    rank,
    solo5v5,
    flex,
    recentData,
    tags,
    platformIdCn,
    mode,
    isCrossRegion,
    updateMode
  }
}
