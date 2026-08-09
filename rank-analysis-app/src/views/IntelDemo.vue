<template>
  <div class="intel-demo">
    <div class="intel-demo-bar">
      <span>情报卡动画演示（模拟征召选人：禁用 → 意向 → 选择中 → 锁定）</span>
      <n-button size="small" @click="replay">重播</n-button>
    </div>

    <!-- 假 ban 条：静态展示，验证图标弹入动画（scale .5→1 + fade） -->
    <div class="intel-demo-bans">
      <div class="ban-group">
        <span class="ban-group-label">我方禁用</span>
        <div class="ban-icons">
          <img
            v-for="id in DEMO_MY_BANS"
            :key="`my-ban-${id}`"
            class="ban-icon"
            :src="getChampionUrl(id)"
            :alt="`ban-${id}`"
          />
        </div>
      </div>
      <div class="ban-group">
        <span class="ban-group-label">敌方禁用</span>
        <div class="ban-icons">
          <img
            v-for="id in DEMO_THEIR_BANS"
            :key="`their-ban-${id}`"
            class="ban-icon"
            :src="getChampionUrl(id)"
            :alt="`ban-${id}`"
          />
        </div>
      </div>
    </div>

    <div class="intel-demo-grid" :key="round">
      <ChampionIntelCard
        v-for="(cell, i) in cells"
        :key="`${round}-${i}`"
        :champion-id="cell.shownChampionId"
        :pick-state="cell.state"
        mode="ranked"
        :my-champion-ids="MY_TEAM"
        density="normal"
        :style="{ '--stagger-i': i }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 开发用演示页：不进真实对局即可预览 ChampionIntelCard 的
 * 入场错峰与三态动画。仅通过 #/IntelDemo 直达，无导航入口。
 */
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { NButton } from 'naive-ui'
import ChampionIntelCard from '@renderer/components/gaming/ChampionIntelCard.vue'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'

const { getChampionUrl } = useAssetUrl()

/** 模拟敌方五人（盖伦/阿狸/盲僧/女警/锤石） */
const ENEMY = [86, 103, 64, 51, 412]
/** 模拟我方已锁英雄（用于克制提示）：剑魔/佐伊/赵信/EZ/璐璐 */
const MY_TEAM = [266, 142, 5, 81, 117]
/** 假 ban 数据（静态，仅用于演示弹入动画）：我方禁塞特/男刀，敌方禁疾风剑豪/劫 */
const DEMO_MY_BANS = [875, 92]
const DEMO_THEIR_BANS = [157, 238]

interface DemoCell {
  championId: number
  shownChampionId: number
  state: string
}

const round = ref(0)
const cells = reactive<DemoCell[]>(
  ENEMY.map(id => ({ championId: id, shownChampionId: 0, state: 'none' }))
)
const timers: ReturnType<typeof setTimeout>[] = []

function at(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms))
}

/** 依次演出：每人 禁用中(1.2s，未亮英雄) → 意向(亮英雄) → 选择中 → 锁定，节奏仿真实征召 */
function play() {
  timers.forEach(clearTimeout)
  timers.length = 0
  cells.forEach(c => {
    c.shownChampionId = 0
    c.state = 'none'
  })
  cells.forEach((cell, i) => {
    const base = 600 + i * 1600
    at(base, () => {
      cell.state = 'banning'
    })
    at(base + 1200, () => {
      cell.shownChampionId = cell.championId
      cell.state = 'intent'
    })
    at(base + 1200 + 700, () => {
      cell.state = 'picking'
    })
    at(base + 1200 + 1500, () => {
      cell.state = 'locked'
    })
  })
}

function replay() {
  round.value++
  // key 变化触发整组重挂载，重播入场错峰
  at(50, play)
}

onMounted(play)
onUnmounted(() => timers.forEach(clearTimeout))
</script>

<style scoped>
.intel-demo {
  padding: 24px;
  max-width: 560px;
  margin: 0 auto;
}
.intel-demo-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  font-size: 13px;
  opacity: 0.85;
}
.intel-demo-bans {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  font-size: 12px;
}
.ban-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ban-group-label {
  opacity: 0.6;
  white-space: nowrap;
}
.ban-icons {
  display: flex;
  gap: 4px;
}
.ban-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  filter: grayscale(1) brightness(0.7);
  border: 1px solid rgba(196, 92, 92, 0.5);
  animation: ban-pop 0.3s var(--ease-expo) both;
}
@keyframes ban-pop {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ban-icon {
    animation: none;
  }
}
.intel-demo-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
