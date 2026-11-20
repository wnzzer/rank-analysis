<script setup lang="ts">
/** BP 操作台的无客户端演示：用假数据走完 ban → pick 全流程，验收视觉与交互。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import BpCommandPanel from '@renderer/components/gaming/BpCommandPanel.vue'
import { buildThemeOverrides } from '@renderer/theme/overrides'
import { useSettingsStore } from '@renderer/pinia/setting'
import type { BpPanelAction, BpPanelStage } from '@renderer/types/bpPanel'
import { ALLIES, BY_ID, CHAMPIONS, ENEMY_REVEALS } from './data'
import { mixOf, rankBans, rankPicks } from './score'

/** 演示时间线上的六个节点。 */
type Step = 'ban-wait' | 'ban-act' | 'ban-done' | 'pick-wait' | 'pick-act' | 'pick-done'

const STEPS: { label: string; value: Step }[] = [
  { label: '等待 ban', value: 'ban-wait' },
  { label: '轮到我 ban', value: 'ban-act' },
  { label: 'ban 完成', value: 'ban-done' },
  { label: '等待 pick', value: 'pick-wait' },
  { label: '轮到我 pick', value: 'pick-act' },
  { label: 'pick 完成', value: 'pick-done' }
]

/** 每回合总秒数，与客户端排位的回合时长量级一致。 */
const TOTAL_SECS = 27

/** 地址栏参数可指定初始节点与已亮敌人，方便直接分享某个状态，如 `?step=ban-act&enemies=157` */
const query = new URLSearchParams(window.location.search)
const initialStep = STEPS.find(s => s.value === query.get('step'))?.value ?? 'pick-act'
const initialEnemies = (query.get('enemies') ?? '')
  .split(',')
  .map(Number)
  .filter(id => ENEMY_REVEALS.includes(id))

const step = ref<Step>(initialStep)
const autoEnabled = ref(true)
const enemies = ref<number[]>(initialEnemies)
const hoveredId = ref<number | null>(null)
const overridden = ref(false)
const secsLeft = ref(TOTAL_SECS)
const resultName = ref('')
const dark = ref(true)

const settings = useSettingsStore()
const theme = computed(() => (dark.value ? darkTheme : lightTheme))
const overrides = ref(buildThemeOverrides())

const action = computed<BpPanelAction>(() => (step.value.startsWith('ban') ? 'ban' : 'pick'))
const stage = computed<BpPanelStage>(() =>
  step.value.endsWith('wait') ? 'waiting' : step.value.endsWith('act') ? 'acting' : 'done'
)

const ranked = computed(() =>
  action.value === 'ban' ? rankBans(autoEnabled.value) : rankPicks(enemies.value, autoEnabled.value)
)

/** 我方构成条把当前预选也算进去，点卡片能立刻看到阵容变化 */
const allyMix = computed(() =>
  mixOf(action.value === 'pick' && hoveredId.value ? [...ALLIES, hoveredId.value] : ALLIES)
)
const enemyMix = computed(() => mixOf(enemies.value))

const championOptions = CHAMPIONS.map(champion => ({ value: champion.id, label: champion.name }))

/** 进入新节点时重置回合内状态 */
watch(step, () => {
  hoveredId.value = null
  overridden.value = false
  secsLeft.value = TOTAL_SECS
})

/** 自动兜底开着且用户没接管时，客户端里的预选跟随自动目标 */
watch(
  () => [ranked.value.autoTargetId, stage.value, overridden.value] as const,
  ([target, currentStage, taken]) => {
    if (currentStage === 'acting' && !taken && target !== null) hoveredId.value = target
  },
  { immediate: true }
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

/** 用户点卡片或搜索：预选并接管 */
function onHover(id: number): void {
  hoveredId.value = id
  overridden.value = true
}

/** 确认当前预选，进入对应的完成节点 */
function finish(): void {
  if (!hoveredId.value) return
  resultName.value = BY_ID[hoveredId.value]?.name ?? ''
  step.value = action.value === 'ban' ? 'ban-done' : 'pick-done'
}

const timer = window.setInterval(() => {
  if (stage.value !== 'acting' || secsLeft.value <= 0) return
  secsLeft.value -= 1
  // 到点兜底：只有开关开着且用户没接管才会自动执行
  if (secsLeft.value <= 0 && ranked.value.autoTargetId !== null && !overridden.value) finish()
}, 1000)
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="overrides">
    <main class="demo">
      <h1>BP 操作台演示 <small>全部为假数据</small></h1>

      <section class="controls">
        <div class="row">
          <span class="label">流程节点</span>
          <n-radio-group v-model:value="step" size="small">
            <n-radio-button v-for="s in STEPS" :key="s.value" :value="s.value" :label="s.label" />
          </n-radio-group>
        </div>
        <div class="row">
          <span class="label">敌方亮出</span>
          <n-checkbox-group v-model:value="enemies">
            <n-checkbox v-for="id in ENEMY_REVEALS" :key="id" :value="id" :label="BY_ID[id].name" />
          </n-checkbox-group>
        </div>
        <div class="row">
          <span class="label">自动{{ action === 'ban' ? '禁用' : '选择' }}</span>
          <n-switch v-model:value="autoEnabled" />
          <span class="label">暗色</span>
          <n-switch v-model:value="dark" />
          <n-button size="small" @click="secsLeft = TOTAL_SECS">重置倒计时</n-button>
          <n-button size="small" @click="secsLeft = 6">跳到最后 6 秒</n-button>
        </div>
        <p class="note">
          我打中路；上单锐雯已锁、打野李青已预选，下路两人未亮。英雄池：阿狸、玛尔扎哈、辛德拉、奥莉安娜、劫。
        </p>
      </section>

      <BpCommandPanel
        :action="action"
        :stage="stage"
        :candidates="ranked.candidates"
        :auto-target-id="ranked.autoTargetId"
        :hovered-id="hoveredId"
        :overridden="overridden"
        :secs-left="secsLeft"
        :total-secs="TOTAL_SECS"
        :ally-mix="allyMix"
        :enemy-mix="enemyMix"
        :champion-options="championOptions"
        :result-name="resultName"
        @hover="onHover"
        @confirm="finish"
      />
    </main>
  </n-config-provider>
</template>

<style>
/* 演示页没有应用外壳，自己铺底色，否则暗色文字落在浏览器默认白底上 */
body {
  margin: 0;
  background: var(--bg-base);
}
</style>

<style scoped>
.demo {
  max-width: 1040px;
  margin: 0 auto;
  padding: var(--space-24);
  color: var(--text-primary);
}

h1 {
  font-size: var(--font-size-xl);
  margin: 0 0 var(--space-16);
}

h1 small {
  font-size: var(--font-size-sm);
  font-weight: normal;
  color: var(--text-tertiary);
}

.controls {
  display: grid;
  gap: var(--space-10);
  margin-bottom: var(--space-20);
  padding: var(--space-12) var(--space-16);
  border: 1px dashed var(--border-control);
  border-radius: var(--radius-md);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.note {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>
