<template>
  <n-card
    content-style="padding: 8px 12px;"
    class="win-class"
    :class="{ 'defeat-class': !games.participants[0].stats.win }"
    :style="cardStyle"
  >
    <n-flex align="center" justify="space-between">
      <n-flex vertical style="gap: 1px">
        <span
          class="font-number"
          :style="{
            fontWeight: '700',
            fontSize: '14px',
            color: games.participants[0].stats.win ? themeColors.win : themeColors.loss,
            marginLeft: '4px',
            marginTop: '2px'
          }"
        >
          {{ games.participants[0].stats.win ? '胜利' : '失败' }}
          <n-divider style="margin: 1px 0; line-height: 1px" />
        </span>

        <span style="color: #676768; font-size: 11px">
          <n-icon style="margin-right: 1px"> <Time></Time> </n-icon
          >{{ Math.ceil(games.gameDuration / 60) }}分
        </span>
      </n-flex>
      <div style="height: 42px; position: relative">
        <img
          style="height: 42px"
          :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
        />
        <template v-if="!!games.mvp">
          <div
            style="position: absolute; left: 0; bottom: 0"
            class="mvp-box"
            :style="{ backgroundColor: games.mvp == 'MVP' ? '#FFD700' : '#FFFFFF' }"
          >
            {{ games.mvp == 'MVP' ? 'MVP' : 'SVP' }}
          </div>
        </template>
      </div>

      <n-flex vertical>
        <span class="font-number" style="font-size: 14px; font-weight: 700">{{
          games.queueName
        }}</span>
        <span style="color: #676768; font-size: 11px">
          <n-icon style="margin-right: 1px">
            <CalendarNumber></CalendarNumber>
          </n-icon>
          {{ formattedDate }}</span
        >
      </n-flex>

      <n-flex justify="space-between" vertical style="gap: 0px">
        <n-flex justify="space-between">
          <span class="font-number">
            <span :style="{ fontWeight: '500', fontSize: '13px', color: themeColors.kill }">
              {{ games.participants[0].stats?.kills }}
            </span>
            /
            <span :style="{ fontWeight: '500', fontSize: '13px', color: themeColors.death }">
              {{ games.participants[0].stats?.deaths }}
            </span>
            /
            <span :style="{ fontWeight: '500', fontSize: '13px', color: themeColors.assist }">
              {{ games.participants[0].stats?.assists }}
            </span>
          </span>
          <span style="margin-left: 20px">
            <img
              :src="
                assetPrefix + '/spell/' + games.participants[0].spell1Id
                  ? assetPrefix + '/spell/' + games.participants[0].spell1Id
                  : itemNull
              "
              style="width: 23px; height: 23px"
              alt="item image"
            />
            <img
              :src="
                assetPrefix + '/spell/' + games.participants[0].spell2Id
                  ? assetPrefix + '/spell/' + games.participants[0].spell2Id
                  : itemNull
              "
              style="width: 23px; height: 23px"
              alt="item image"
            />
          </span>
        </n-flex>
        <n-flex style="gap: 2px">
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item0"
            preview-disabled
            :fallback-src="itemNull"
          >
          </n-image>
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item1"
            preview-disabled
            :fallback-src="itemNull"
          >
          </n-image>
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item2"
            preview-disabled
            :fallback-src="itemNull"
          >
          </n-image>
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item3"
            preview-disabled
            :fallback-src="itemNull"
          >
          </n-image>
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item4"
            preview-disabled
            :fallback-src="itemNull"
          >
          </n-image>
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item5"
            preview-disabled
            fallback-src="https://07akioni.oss-cn-beijing.aliyuncs.com/07akioni.jpeg"
          >
            <template #error>
              <img :src="itemNull" />
            </template>
          </n-image>
          <n-image
            width="23px"
            :src="assetPrefix + '/item/' + games.participants[0].stats?.item6"
            preview-disabled
            :fallback-src="itemNull"
          >
          </n-image>
        </n-flex>
      </n-flex>
      <n-flex vertical justify="space-between" style="gap: 6px; font-size: 11px">
        <n-flex
          align="center"
          :style="{
            gap: '8px',
            color: otherColor(games.participants[0].stats?.damageDealtToChampionsRate)
          }"
        >
          <n-icon size="13" color="#EEB43E">
            <Flame></Flame>
          </n-icon>
          <span style="width: 60px">
            <n-progress
              type="line"
              :percentage="games.participants[0].stats?.damageDealtToChampionsRate"
              :height="6"
              :show-indicator="false"
              processing
              :stroke-width="13"
              :color="otherColor(games.participants[0].stats?.damageDealtToChampionsRate)"
              style="position: relative; top: 2px"
            ></n-progress>
          </span>
          <span class="font-number" style="width: 30px; text-align: right">
            {{ Math.round(games.participants[0].stats?.totalDamageDealtToChampions / 1000) }}k
          </span>
          <span class="font-number" style="width: 30px; text-align: right">
            {{ games.participants[0].stats?.damageDealtToChampionsRate }}%
          </span>
        </n-flex>

        <n-flex
          align="center"
          :style="{
            gap: '8px',
            color: healColorAndTaken(games.participants[0].stats?.damageTakenRate)
          }"
        >
          <n-icon size="13" color="#5CA3EA">
            <Shield></Shield>
          </n-icon>
          <span style="width: 60px">
            <n-progress
              type="line"
              :percentage="games.participants[0].stats?.damageTakenRate"
              :height="6"
              :show-indicator="false"
              processing
              :stroke-width="13"
              :color="healColorAndTaken(games.participants[0].stats?.damageTakenRate)"
              style="position: relative; top: 2px"
            ></n-progress>
          </span>
          <span class="font-number" style="width: 30px; text-align: right"
            >{{ Math.round(games.participants[0].stats?.totalDamageTaken / 1000) }}k</span
          >
          <span class="font-number" style="width: 30px; text-align: right"
            >{{ games.participants[0].stats?.damageTakenRate }}%</span
          >
        </n-flex>
        <n-flex
          align="center"
          :style="{ gap: '8px', color: healColorAndTaken(games.participants[0].stats?.healRate) }"
        >
          <n-icon size="13" color="#58B66D">
            <Heart></Heart>
          </n-icon>
          <span style="width: 60px">
            <n-progress
              type="line"
              :percentage="games.participants[0].stats?.healRate"
              :height="6"
              :show-indicator="false"
              processing
              :stroke-width="13"
              :color="healColorAndTaken(games.participants[0].stats?.healRate)"
              style="position: relative; top: 2px"
            ></n-progress>
          </span>
          <span class="font-number" style="width: 30px; text-align: right"
            >{{ Math.round(games.participants[0].stats?.totalHeal / 1000) }}k</span
          >
          <span class="font-number" style="width: 30px; text-align: right"
            >{{ games.participants[0].stats?.healRate }}%</span
          >
        </n-flex>
      </n-flex>
      <n-flex vertical justify="space-between" style="gap: 0px">
        <n-tag :bordered="false" size="small">
          <template #avatar>
            <n-flex>
              <n-popover v-for="i in 5" :key="i" trigger="hover">
                <template #trigger>
                  <n-button
                    text
                    @click="
                      toNameRecord(
                        games.gameDetail.participantIdentities[i - 1].player.gameName +
                          '#' +
                          games.gameDetail.participantIdentities[i - 1].player.tagLine
                      )
                    "
                  >
                    <n-avatar
                      :bordered="true"
                      :src="
                        assetPrefix +
                        '/champion/' +
                        games.gameDetail.participants[i - 1]?.championId
                      "
                      :fallback-src="itemNull"
                      :style="{
                        borderColor: getIsMeBorderedColor(
                          games.gameDetail.participantIdentities[i - 1]?.player.gameName +
                            '#' +
                            games.gameDetail.participantIdentities[i - 1]?.player.tagLine
                        )
                      }"
                    />
                  </n-button>
                </template>
                <span>{{
                  games.gameDetail.participantIdentities[i - 1].player.gameName +
                  '#' +
                  games.gameDetail.participantIdentities[i - 1].player.tagLine
                }}</span>
              </n-popover>
            </n-flex>
          </template>
        </n-tag>

        <n-tag :bordered="false" size="small">
          <template #avatar>
            <n-flex>
              <n-popover v-for="i in 5" :key="i + 5" trigger="hover">
                <template #trigger>
                  <n-button
                    text
                    @click="
                      toNameRecord(
                        games.gameDetail.participantIdentities[i + 4]?.player.gameName +
                          '#' +
                          games.gameDetail.participantIdentities[i + 4]?.player.tagLine
                      )
                    "
                  >
                    <n-avatar
                      :bordered="true"
                      :src="
                        assetPrefix +
                        '/champion/' +
                        games.gameDetail.participants[i + 4]?.championId
                      "
                      :fallback-src="itemNull"
                      :style="{
                        borderColor: getIsMeBorderedColor(
                          games.gameDetail.participantIdentities[i + 4]?.player.gameName +
                            '#' +
                            games.gameDetail.participantIdentities[i + 4]?.player.tagLine
                        )
                      }"
                    />
                  </n-button>
                </template>
                <span>{{
                  games.gameDetail.participantIdentities[i + 4]?.player.gameName +
                  '#' +
                  games.gameDetail.participantIdentities[i + 4]?.player.tagLine
                }}</span>
              </n-popover>
            </n-flex>
          </template>
        </n-tag>
      </n-flex>
    </n-flex>
  </n-card>
</template>

<script lang="ts" setup>
import { Time, CalendarNumber, Flame, Shield, Heart } from '@vicons/ionicons5'
import itemNull from '../../assets/imgs/item/null.png'
import { computed } from 'vue'
import { Game } from './MatchHistory.vue'
import { useRouter } from 'vue-router'
import { healColorAndTaken, otherColor } from './composition'
import { assetPrefix } from '../../services/http'
import { useSettingsStore } from '../../pinia/setting'

const settingsStore = useSettingsStore()
const isDark = computed(() => settingsStore.theme?.name === 'dark')

const themeColors = computed(() => ({
  win: isDark.value ? '#50E3C2' : '#18a058',
  loss: isDark.value ? '#FF5C5C' : '#d03050',
  kill: isDark.value ? '#50E3C2' : '#18a058',
  death: isDark.value ? '#FF5C5C' : '#d03050',
  assist: isDark.value ? '#D38B2A' : '#f0a020'
}))

const cardStyle = computed(() => {
  const isWin = props.games.participants[0].stats.win
  if (isDark.value) {
    return {}
  }
  // Light Mode Styles
  return {
    backgroundColor: '#ffffff',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.06)', // Softer, more diffused shadow
    border: 'none', // Remove full border
    borderLeft: `4px solid ${isWin ? '#18a058' : '#d03050'}`, // Left accent strip
    borderRadius: '4px'
  }
})

const router = useRouter()
// 接收 props
const props = defineProps<{
  recordType?: boolean // 确保这里是 boolean 类型
  games: Game
}>()

const formattedDate = computed(() => {
  const date = new Date(props.games.gameCreationDate)
  // const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0') // 月份从0开始，所以加1
  const day = date.getDate().toString().padStart(2, '0') // 确保两位数格式
  return `${month}/${day}`
})

function getIsMeBorderedColor(name: string) {
  if (
    name ==
    props.games.participantIdentities[0].player.gameName +
      '#' +
      props.games.participantIdentities[0].player.tagLine
  ) {
    return '#63e2b7'
  } else {
    return '#000000'
  }
}
function toNameRecord(name: string) {
  return router.push({
    path: '/Record',
    query: { name, t: Date.now() }
  }) // 添加动态时间戳作为查询参数
}
</script>

<style scoped>
/* 默认背景颜色，避免没有 recordType 时出现空白 */
.record-card {
  background: linear-gradient(120deg, rgb(133, 133, 133) 30%, rgba(44, 44, 44, 0.5));
}

.win-font {
  color: #03c2f7;
  font-weight: 300;
  font-size: small;
}

.responsive-img {
  width: auto;
  /* 保持宽高比 */
  object-fit: contain;
  /* 根据需求可以选择 contain, cover 等 */
}

.win-class {
  /* 默认的边框颜色 */
  --n-border: 1px solid #63e2b7;
  /* 静态绿色边框 */
  --n-border-hover: 1px solid #7fe7c4;
  /* 悬停时的绿色边框 */
  --n-border-pressed: 1px solid #5acea7;

  /* 添加平滑过渡效果 */
  transition:
    border-color 0.3s ease,
    color 0.3s ease;
  /* 为边框颜色和文本颜色添加过渡 */
}

.defeat-class {
  /* 默认的边框颜色 */
  --n-border: 1px solid #ba3f53;
  /* 静态绿色边框 */
  --n-border-hover: 1px solid #ba3f53;
  /* 悬停时的绿色边框 */
  --n-border-pressed: 1px solid #ba3f53;

  /* 添加平滑过渡效果 */
  transition:
    border-color 0.3s ease,
    color 0.3s ease;
  /* 为边框颜色和文本颜色添加过渡 */
}

.bordered {
  border: red;
  /* 边框宽度2px，实线，红色 */
}

.win-class:hover {
  border: var(--n-border-hover);
}

.win-class:active {
  border: var(--n-border-pressed);
}

.win-class:focus {
  border: var(--n-border-focus);
}

.win-class:disabled {
  border: var(--n-border-disabled);
}

.mvp-box {
  display: inline-block;
  width: 20px;
  /* 调整宽度 */
  height: 11px;
  /* 调整高度 */
  color: #000;
  /* 黑色字体 */
  font-weight: bold;
  /* 字体加粗 */
  font-size: 8px;
  /* 小字体 */
  line-height: 11px;
  /* 垂直居中 */
  text-align: center;
  /* 水平居中 */
  border-radius: 2px;
  /* 圆角 */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  /* 添加阴影效果 */
}
</style>
