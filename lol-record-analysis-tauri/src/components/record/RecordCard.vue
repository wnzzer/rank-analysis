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

        <span class="record-card-meta">
          <n-icon style="margin-right: 1px"><Time /></n-icon>
          {{ Math.ceil(games.gameDuration / 60) }}分
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
        <span class="record-card-meta">
          <n-icon style="margin-right: 1px"><CalendarNumber /></n-icon>
          {{ formattedDate }}
        </span>
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
          <span class="record-card-spell-icons">
            <img
              :src="
                assetPrefix + '/spell/' + games.participants[0].spell1Id
                  ? assetPrefix + '/spell/' + games.participants[0].spell1Id
                  : itemNull
              "
              class="record-card-icon-slot"
              alt="spell"
            />
            <img
              :src="
                assetPrefix + '/spell/' + games.participants[0].spell2Id
                  ? assetPrefix + '/spell/' + games.participants[0].spell2Id
                  : itemNull
              "
              class="record-card-icon-slot"
              alt="spell"
            />
          </span>
        </n-flex>
        <n-flex class="record-card-item-slots" style="gap: 2px">
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
      <div class="record-card-stats-block">
        <div class="record-card-stat-row">
          <n-tooltip trigger="hover" placement="top">
            <template #trigger>
              <div class="record-card-stat-icon-wrap record-card-stat-icon-damage">
                <n-icon size="11"><FlameOutline /></n-icon>
              </div>
            </template>
            对英雄伤害占比
          </n-tooltip>
          <div
            class="record-card-stat-dots"
            :style="{ '--stat-dot-color': otherColor(games.participants[0].stats?.damageDealtToChampionsRate) }"
          >
            <span
              v-for="i in 5"
              :key="i"
              class="stat-dot"
              :class="{ 'stat-dot-filled': i <= dotFillCount(games.participants[0].stats?.damageDealtToChampionsRate) }"
            />
          </div>
          <div class="record-card-stat-values">
            <span class="font-number">{{ Math.round(games.participants[0].stats?.totalDamageDealtToChampions / 1000) }}k</span>
            <span class="font-number" :style="{ color: otherColor(games.participants[0].stats?.damageDealtToChampionsRate) }">
              {{ games.participants[0].stats?.damageDealtToChampionsRate }}%
            </span>
          </div>
        </div>

        <div class="record-card-stat-row">
          <n-tooltip trigger="hover" placement="top">
            <template #trigger>
              <div class="record-card-stat-icon-wrap record-card-stat-icon-tank">
                <n-icon size="11"><ShieldOutline /></n-icon>
              </div>
            </template>
            承伤占比
          </n-tooltip>
          <div
            class="record-card-stat-dots"
            :style="{ '--stat-dot-color': healColorAndTaken(games.participants[0].stats?.damageTakenRate) }"
          >
            <span
              v-for="i in 5"
              :key="i"
              class="stat-dot"
              :class="{ 'stat-dot-filled': i <= dotFillCount(games.participants[0].stats?.damageTakenRate) }"
            />
          </div>
          <div class="record-card-stat-values">
            <span class="font-number">{{ Math.round(games.participants[0].stats?.totalDamageTaken / 1000) }}k</span>
            <span class="font-number" :style="{ color: healColorAndTaken(games.participants[0].stats?.damageTakenRate) }">
              {{ games.participants[0].stats?.damageTakenRate }}%
            </span>
          </div>
        </div>

        <div class="record-card-stat-row">
          <n-tooltip trigger="hover" placement="top">
            <template #trigger>
              <div class="record-card-stat-icon-wrap record-card-stat-icon-heal">
                <n-icon size="11"><HeartOutline /></n-icon>
              </div>
            </template>
            治疗占比
          </n-tooltip>
          <div
            class="record-card-stat-dots"
            :style="{ '--stat-dot-color': healColorAndTaken(games.participants[0].stats?.healRate) }"
          >
            <span
              v-for="i in 5"
              :key="i"
              class="stat-dot"
              :class="{ 'stat-dot-filled': i <= dotFillCount(games.participants[0].stats?.healRate) }"
            />
          </div>
          <div class="record-card-stat-values">
            <span class="font-number">{{ Math.round(games.participants[0].stats?.totalHeal / 1000) }}k</span>
            <span class="font-number" :style="{ color: healColorAndTaken(games.participants[0].stats?.healRate) }">
              {{ games.participants[0].stats?.healRate }}%
            </span>
          </div>
        </div>
      </div>
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
import { Time, CalendarNumber, FlameOutline, ShieldOutline, HeartOutline } from '@vicons/ionicons5'
import itemNull from '../../assets/imgs/item/null.png'
import { computed } from 'vue'
import { Game } from './MatchHistory.vue'
import { useRouter } from 'vue-router'
import { healColorAndTaken, otherColor } from './composition'
import { assetPrefix } from '../../services/http'
import { useSettingsStore } from '../../pinia/setting'

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

const themeColors = computed(() => ({
  win: '#3d9b7a',
  loss: '#c45c5c',
  kill: '#3d9b7a',
  death: '#c45c5c',
  assist: '#b8860b'
}))

const cardStyle = computed(() => {
  const isWin = props.games.participants[0].stats.win
  const leftColor = isWin ? '#3d9b7a' : '#c45c5c'
  if (isDark.value) {
    return {
      borderLeft: `3px solid ${leftColor}`,
      boxShadow: 'var(--shadow-card)'
    }
  }
  return {
    backgroundColor: 'var(--bg-elevated)',
    boxShadow: 'var(--shadow-card)',
    border: '1px solid var(--border-subtle)',
    borderLeft: `3px solid ${leftColor}`,
    borderRadius: 'var(--radius-md)'
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

/** 将占比 0–100 映射为 5 个圆点中填充的数量 */
function dotFillCount(rate: number | undefined): number {
  return Math.min(5, Math.max(0, Math.round((rate ?? 0) / 100 * 5)))
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
  --n-border: 1px solid var(--semantic-win);
  --n-border-hover: 1px solid var(--semantic-win);
  --n-border-pressed: 1px solid var(--semantic-win);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-normal);
}

.win-class:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}

.defeat-class {
  --n-border: 1px solid var(--semantic-loss);
  --n-border-hover: 1px solid var(--semantic-loss);
  --n-border-pressed: 1px solid var(--semantic-loss);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-normal);
}

.defeat-class:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
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
  height: 11px;
  color: #000;
  font-weight: bold;
  font-size: 8px;
  line-height: 11px;
  text-align: center;
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* 伤害/承伤/治疗统计块 - 保留表格、缩小高度 */
.record-card-stats-block {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 8px 5px;
  background: rgba(0, 0, 0, 0.025);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  min-width: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.theme-light .record-card-stats-block {
  background: rgba(0, 0, 0, 0.02);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.record-card-stat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  letter-spacing: 0.02em;
}

.record-card-stat-row:last-child {
  border-bottom: none;
}

.theme-light .record-card-stat-row {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

.record-card-stat-icon-wrap {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--stat-color);
}

.record-card-stat-icon-damage {
  background: rgba(229, 167, 50, 0.18);
  color: #c9941e;
}

.theme-light .record-card-stat-icon-damage {
  background: rgba(229, 167, 50, 0.14);
  color: #b8860b;
}

.record-card-stat-icon-tank {
  background: rgba(92, 163, 234, 0.2);
  color: #4a8fc9;
}

.theme-light .record-card-stat-icon-tank {
  background: rgba(92, 163, 234, 0.12);
  color: #0369a1;
}

.record-card-stat-icon-heal {
  background: rgba(88, 182, 109, 0.2);
  color: #3d9b5a;
}

.theme-light .record-card-stat-icon-heal {
  background: rgba(88, 182, 109, 0.14);
  color: #2d8a6c;
}

/* 圆点进度：5 个点表示占比 */
.record-card-stat-dots {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 3px;
}

.stat-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--border-subtle);
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.stat-dot-filled {
  background: var(--stat-dot-color) !important;
}

.record-card-stat-values {
  display: flex;
  align-items: baseline;
  gap: 3px;
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* 数值(53k)用次要色，占比(26%)用语义色，层次更清晰 */
.record-card-stat-values .font-number:first-child {
  color: var(--text-tertiary);
  font-weight: 500;
  width: 24px;
  text-align: right;
}

.record-card-stat-values .font-number:last-child {
  font-weight: 600;
  width: 26px;
  text-align: right;
}

.record-card-meta {
  color: var(--text-secondary);
  font-size: 11px;
}

/* 装备格与技能图标统一圆角与边框 */
.record-card-item-slots :deep(.n-image),
.record-card-item-slots :deep(.n-image img),
.record-card-spell-icons .record-card-icon-slot {
  width: 23px;
  height: 23px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-sizing: border-box;
  object-fit: contain;
}
.record-card-spell-icons {
  display: inline-flex;
  gap: 2px;
}

/* 对局玩家头像网格精致化 */
:deep(.n-tag .n-avatar),
:deep(.n-button .n-avatar) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: box-shadow var(--transition-fast);
}
:deep(.n-tag .n-avatar:hover),
:deep(.n-button .n-avatar:hover) {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.18);
}
</style>
