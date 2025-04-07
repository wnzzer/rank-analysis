<template>

    <div class="ratio-container">

      <n-flex vertical class="content-wrapper" style="height: 100%; position: relative">
        <n-flex>
          <n-select v-model:value="filterQueueId" placeholder="按模式筛选" :options="modeOptions" size="small"
            style="width: 100px" @update:value="handleUpdateValue" />
          <n-select v-model:value="filterChampionId" filterable :filter="filterChampionFunc" placeholder="按英雄筛选"
            :render-tag="renderSingleSelectTag" :render-label="renderLabel" :options="championOptions" size="small"
            style="width: 170px" @update:value="handleUpdateValue" />

          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text style="font-size: 24px" @click="resetFilter">
                <n-icon>
                  <Repeat />
                </n-icon>
              </n-button>
            </template>
            复位
          </n-tooltip>
        </n-flex>

        <RecordCard v-for="(game, index) in matchHistory?.games?.games || []" :key="index" :record-type="true"
          :games="game">
        </RecordCard>

        <!-- 自定义分页组件 -->

        <div class="pagination">
          <n-pagination style="margin-top: 0px">
            <template #prev>
              <n-button size="tiny" :disabled="page == 1 || isRequestingMatchHostory" @click="prevPage">
                <template #icon>
                  <n-icon>
                    <ArrowBack></ArrowBack>
                  </n-icon>
                </template>
              </n-button>
            </template>
            <template #label>
              <span>{{ page }}</span>
            </template>
            <template #next>
              <n-button size="tiny" @click="nextPage" :disabled="isRequestingMatchHostory">
                <template #icon>
                  <n-icon>
                    <ArrowForward></ArrowForward>
                  </n-icon>
                </template>
              </n-button>
            </template>
          </n-pagination>
        </div>
      </n-flex>
    </div>

</template>

<script setup lang="ts">
import http from '../../services/http'
import RecordCard from './RecordCard.vue'
import { ArrowBack, ArrowForward, Repeat } from '@vicons/ionicons5'
import { onMounted, ref } from 'vue'
import { useLoadingBar } from 'naive-ui'
import { useRoute } from 'vue-router'
import { renderSingleSelectTag,renderLabel,championOptions,filterChampionFunc } from '../composition'

const filterQueueId = ref(0)
const filterChampionId = ref(0)
const modeOptions = [
  { label: '全部', value: 0 },
  { label: '单双排', value: 420 },
  { label: '匹配', value: 430 },
  { label: '灵活排', value: 440 },
  { label: '大乱斗', value: 450 },
  { label: '匹配', value: 490 },
  { label: '人机', value: 890 },
  { label: '无限乱斗', value: 900 },
  { label: '斗魂竞技场', value: 1700 },
  { label: '无限火力', value: 1900 }
]


const resetFilter = () => {
  pageHistory.value = []
  filterQueueId.value = 0
  filterChampionId.value = 0
  handleUpdateValue()
}
const handleUpdateValue = () => {
  page.value = 1
  if (filterChampionId.value != 0 || filterQueueId.value != 0) {
    getHistoryMatch(route.query.name as string, 0, 800)
  } else {
    getHistoryMatch(route.query.name as string, 0, 9)
  }
}

// 类型定义
export interface GameDetail {
  endOfGameResult: string
  participantIdentities: {
    player: {
      accountId: string
      platformId: string
      gameName: string
      tagLine: string
      summonerName: string
      summonerId: string
    }
  }[]
  participants: {
    teamId: number
    participantId: number
    championId: number
    championKey: string
    summonerName: string
    summonerId: string
  }[]
}

export interface ParticipantStats {
  win: boolean
  item0: number
  item1: number
  item2: number
  item3: number
  item4: number
  item5: number
  item6: number
  item0Key: string
  item1Key: string
  item2Key: string
  item3Key: string
  item4Key: string
  item5Key: string
  item6Key: string
  perkPrimaryStyle: number
  perkSubStyle: number
  perkPrimaryStyleKey: string
  perkSubStyleKey: string
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  goldSpent: number
  totalDamageDealtToChampions: number
  totalDamageDealt: number
  totalDamageTaken: number
  totalHeal: number
  totalMinionsKilled: number
  groupRate: number
  goldEarnedRate: number
  damageDealtToChampionsRate: number
  damageTakenRate: number
  healRate: number
}

export interface Participant {
  win: boolean
  participantId: number
  teamId: number
  championId: number
  championKey: string
  spell1Id: number
  spell1Key: string
  spell2Id: number
  spell2Key: string
  stats: ParticipantStats
}

export interface Game {
  mvp: string
  gameDetail: GameDetail
  gameId: number
  gameCreationDate: string
  gameDuration: number
  gameMode: string
  gameType: string
  mapId: number
  queueId: number
  queueName: number
  participantIdentities: {
    player: {
      accountId: string
      platformId: string
      gameName: string
      tagLine: string
      summonerName: string
      summonerId: string
    }
  }[]
  participants: Participant[]
}

export interface MatchHistory {
  platformId: string
  beginIndex: number
  endIndex: number
  games: {
    gameDetail: GameDetail
    games: Game[]
  }
}

const matchHistory = ref<MatchHistory>()
const loadingBar = useLoadingBar()
const isRequestingMatchHostory = ref(false)
const page = ref(1)
const pageHistory = ref<{ begIndex: number; endIndex: number }[]>([])

let curBegIndex = 0
let curEndIndex = 0

const route = useRoute()
let name = ''

// 获取历史记录
const getHistoryMatch = async (name: string, begIndex: number, endIndex: number) => {
  loadingBar.start()
  isRequestingMatchHostory.value = true
  try {
    const res = await http.get<MatchHistory>('/GetMatchHistory', {
      params: {
        filterQueueId: filterQueueId.value,
        filterChampionId: filterChampionId.value,
        begIndex,
        endIndex,
        name,
      },
    })
    matchHistory.value = res.data
    curBegIndex = res.data.beginIndex
    curEndIndex = res.data.endIndex
    loadingBar.finish()
  } catch (error) {
    // 兜底请求默认数据，避免页面空白
    const res = await http.get<MatchHistory>('/GetMatchHistory')
    matchHistory.value = res.data
    loadingBar.error()
  } finally {
    isRequestingMatchHostory.value = false
  }
}

// 下一页
const nextPage = async () => {
  let begIndex = 0
  let endIndex = 0
  pageHistory.value.push({ begIndex: curBegIndex, endIndex: curEndIndex })

  if (filterQueueId.value !== 0 || filterChampionId.value !== 0) {
    begIndex = curEndIndex + 1
    endIndex = begIndex + 799
  } else {
    begIndex = page.value * 10
    endIndex = begIndex + 9
  }

  await getHistoryMatch(name, begIndex, endIndex)
  page.value++
}

// 上一页
const prevPage = async () => {
  const lastPage = pageHistory.value.pop()
  console.log(lastPage)

  if (!lastPage) {
    throw new Error("无上一页数据")
  }
  await getHistoryMatch(name, lastPage.begIndex, lastPage.endIndex)
  page.value = Math.max(1, page.value - 1)
}

onMounted(async () => {
  name = route.query.name as string
  await getHistoryMatch(name, 0, 9)
})

</script>

<style lang="css" scoped>
.ratio-container {
  /* 维持1.1:1宽高比的核心容器 */
  width: 100%;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: center;
}

.content-wrapper {
  /* 比例容器 */
  aspect-ratio: 1.1 / 1;
  width: 100%;
  max-width: calc(100vh * 1.1);
  /* 防止过高 */
  max-height: calc(100vw / 1.1);
  /* 防止过宽 */
  margin: auto;
  position: relative;
}

.scroll-area {
  /* 滚动区域 */
  flex: 1;
  overflow-y: auto;
  margin: 8px 0;
}

.pagination {
  /* 分页固定底部 */
  position: sticky;
  bottom: 0;
  background: var(--n-color);
  padding: 8px 0;
}
</style>