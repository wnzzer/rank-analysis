<script setup lang="ts">
/** 用真实战绩卡和对位组件进行无客户端交互验收。 */
import { computed, provide, ref, watch } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import SubteamCard from '@renderer/components/gaming/SubteamCard.vue'
import { MATCHUP_API } from '@renderer/services/matchup'
import { DEFAULT_OPGG_TIER, TIER_OPTIONS, type OpggTier } from '@renderer/services/opgg'
import { buildThemeOverrides } from '@renderer/theme/overrides'
import { useSettingsStore } from '@renderer/pinia/setting'
import { createDemoTeams, demoApi, demoState } from './data'
provide(MATCHUP_API, demoApi)
const teams = ref(createDemoTeams())
const tier = ref<OpggTier>(DEFAULT_OPGG_TIER)
const changing = ref(false)
const phase = ref('ChampSelect')
const dark = ref(true)
const anonymous = ref(false)
const settings = useSettingsStore()
const theme = computed(() => (dark.value ? darkTheme : lightTheme))
const overrides = ref(buildThemeOverrides())
const renderKey = ref(0)
const options = [...TIER_OPTIONS]
/** 演示段位使用原组件的未定级占位，避免空地址破图。 */
const demoTiers = {
  1: Array.from({ length: 5 }, () => ({ imgUrl: 'unranked', tierCn: '铂金 I' })),
  2: Array.from({ length: 5 }, () => ({ imgUrl: 'unranked', tierCn: '铂金 II' }))
}
const scenarios = [
  { label: '正常数据', value: 'ready' },
  { label: '慢响应', value: 'slow' },
  { label: '暂无数据', value: 'empty' },
  { label: '请求失败', value: 'error' }
]
const unavailable = computed(() =>
  teams.value.flatMap(team => team.players.map(player => player.championId))
)
watch(
  dark,
  value => {
    document.documentElement.classList.toggle('theme-light', !value)
    settings.theme = value ? darkTheme : lightTheme
    overrides.value = buildThemeOverrides()
  },
  { immediate: true }
)
watch(anonymous, value => {
  teams.value[1].players.forEach((player, i) => {
    player.summoner.puuid = value ? '' : `demo-false-${i}`
  })
})
/** 模拟共享段位成功切换；筛选数字始终明显标注为演示。
 * @param next 用户选择的段位。
 */
async function switchTier(next: OpggTier): Promise<void> {
  if (changing.value || next === tier.value) return
  changing.value = true
  await new Promise(resolve => setTimeout(resolve, 400))
  tier.value = next
  changing.value = false
}
/** 模拟同槽位更换英雄，检验旧目标与手动分路失效。 */
function swapChampion(): void {
  teams.value[1].players[2].championId = teams.value[1].players[2].championId === 103 ? 517 : 103
}
/** 切换固定故障场景后重新建立演示会话。 */
function resetScenario(): void {
  renderKey.value++
}
</script>
<template>
  <n-config-provider :theme="theme" :theme-overrides="overrides">
    <n-message-provider>
      <div class="demo-app">
        <header>
          <div>
            <h1>Rank Analysis · 对位内页演示</h1>
            <p>使用正式战绩卡与内页组件 · 未连接客户端 · 所有统计均为示例</p>
          </div>
          <n-button size="small" @click="dark = !dark">{{ dark ? '浅色' : '深色' }}主题</n-button>
        </header>
        <div class="demo-controls">
          <n-select
            v-model:value="demoState.scenario"
            :options="scenarios"
            aria-label="演示场景"
            @update:value="resetScenario"
          /><n-button @click="swapChampion">模拟中路换英雄</n-button
          ><n-button @click="anonymous = !anonymous"
            >{{ anonymous ? '显示' : '隐藏' }}玩家战绩</n-button
          ><n-button @click="phase = phase === 'ChampSelect' ? 'InProgress' : 'ChampSelect'">{{
            phase === 'ChampSelect' ? '模拟开始对局' : '返回选人'
          }}</n-button
          ><n-button @click="demoState.imageFailure = !demoState.imageFailure">{{
            demoState.imageFailure ? '恢复头像' : '模拟头像失败'
          }}</n-button>
        </div>
        <section class="demo-frame">
          <div class="demo-title">Rank Analysis <span>离线开发演示</span></div>
          <div class="demo-body">
            <nav>
              <div>战绩</div>
              <div class="active">对局</div>
              <div>设置</div>
            </nav>
            <main>
              <div class="demo-banner">
                <strong>{{
                  phase === 'ChampSelect' ? '正在选择英雄' : '对局中 · 对位入口已隐藏'
                }}</strong
                ><span>OP.GG · 全球</span
                ><n-select
                  :value="tier"
                  :options="options"
                  :loading="changing"
                  :disabled="changing"
                  aria-label="页面统计段位"
                  @update:value="switchTier"
                />
              </div>
              <div class="demo-teams">
                <SubteamCard
                  v-for="(team, i) in teams"
                  :key="`${renderKey}-${team.subteamId}`"
                  :subteam="team"
                  :is-mine="i === 0"
                  :expected-size="5"
                  type-cn="单双排"
                  mode-type="CLASSIC"
                  :queue-id="420"
                  :tiers-by-subteam="demoTiers"
                  density="normal"
                  :phase="phase"
                  opgg-mode="ranked"
                  :matchup-enabled="true"
                  :opgg-tier="tier"
                  :opgg-tier-loading="changing"
                  :unavailable-ids="unavailable"
                  @change-tier="switchTier"
                />
              </div>
            </main>
          </div>
        </section>
        <p class="demo-foot">
          从敌方“近期数据”下方进入。返回时原战绩、展开状态和滚动保留。原应用的其他操作在此演示中不连接真实客户端。
        </p>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>
<style scoped>
:global(body) {
  margin: 0;
  background: var(--bg-base);
}
.demo-app {
  max-width: 1640px;
  margin: 0 auto;
  padding: 20px;
  color: var(--text-primary);
  font-size: 13px;
}
.demo-app header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
h1 {
  font-size: 18px;
  margin: 0 0 4px;
}
p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.demo-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.demo-controls .n-select {
  width: 130px;
}
.demo-frame {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-base);
  height: calc(100vh - 180px);
  min-height: 620px;
}
.demo-title {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border-subtle);
  height: 36px;
}
.demo-title span {
  float: right;
  color: var(--text-tertiary);
  font-size: 11px;
}
.demo-body {
  display: flex;
  height: calc(100% - 36px);
}
.demo-body nav {
  width: 62px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  padding: 14px 6px;
}
.demo-body nav div {
  padding: 14px 0;
  text-align: center;
  color: var(--text-secondary);
}
.demo-body nav .active {
  color: var(--semantic-win);
  background: color-mix(in srgb, var(--semantic-win) 10%, transparent);
  border-radius: 6px;
}
.demo-body main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: 12px;
  gap: 12px;
}
.demo-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-surface);
}
.demo-banner strong {
  color: var(--semantic-win);
  font-size: 13px;
}
.demo-banner > span {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 11px;
}
.demo-banner .n-select {
  width: 130px;
}
.demo-teams {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.demo-foot {
  font-size: 11px;
  margin-top: 10px;
}
@media (max-width: 1050px) {
  .demo-app {
    padding: 12px;
  }
  .demo-body nav {
    width: 48px;
  }
  .demo-teams {
    gap: 8px;
  }
  .demo-body main {
    padding: 8px;
  }
}
</style>
