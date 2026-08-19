<template>
  <div class="growth-page">
    <div class="growth-header">
      <div>
        <h2>成长</h2>
        <p class="growth-sub">跨局聚合的重复性短板与改错清单——数据全部来自本机收集的对局</p>
      </div>
      <n-button size="small" :loading="refreshingTags" @click="refreshAll">重新分析</n-button>
    </div>

    <div v-if="loading" class="growth-hint">正在聚合本机对局…</div>

    <div v-else-if="tagsMsg" class="growth-hint">{{ tagsMsg }}</div>

    <!-- 习惯标签卡：短板最明显在前（avgVsPeer 升序） -->
    <div v-else-if="tags.length" class="tag-grid">
      <div
        v-for="t in tags"
        :key="t.dimension"
        class="tag-card"
        :class="{ 'tag-card--long': t.streak >= 3 }"
      >
        <div class="tag-card-head">
          <span class="tag-card-dim">{{ DIMENSION_LABELS[t.dimension] ?? t.dimension }}</span>
          <span class="tag-card-delta">{{ formatDelta(t.avgVsPeer) }}</span>
        </div>
        <div class="tag-card-meta">
          <span
            >持续落后 <b>{{ t.streak }}</b> 局</span
          >
          <span class="tag-card-seen">最近检出 {{ shortDate(t.lastSeen) }}</span>
        </div>
        <p class="tag-card-hint">
          {{ DIMENSION_FIX_HINTS[t.dimension] ?? '对局中主动复盘该维度' }}
        </p>
      </div>
    </div>

    <div v-else class="growth-hint">暂无标签——收集满 5 局后会自动产出</div>

    <!-- 改错清单：可勾选、跨局追踪 -->
    <div class="goals-block">
      <div class="goals-head">
        <span>改错清单</span>
        <div class="goals-actions">
          <n-select
            v-model:value="newGoalDimension"
            size="small"
            class="goal-dim-select"
            :options="dimensionOptions"
            placeholder="维度"
          />
          <n-input
            v-model:value="newGoalTitle"
            size="small"
            class="goal-title-input"
            placeholder="目标（如：排眼数 +1）"
            @keyup.enter="submitGoal"
          />
          <n-button size="small" :disabled="!newGoalTitle.trim()" @click="submitGoal">
            添加
          </n-button>
        </div>
      </div>
      <ul v-if="goals.length" class="goals-list">
        <li v-for="g in goals" :key="g.id" class="goal-item">
          <n-checkbox :checked="g.done" :label="g.title" @update:checked="() => toggleGoal(g)" />
          <span class="goal-dim">{{ DIMENSION_LABELS[g.dimension] ?? g.dimension }}</span>
        </li>
      </ul>
      <div v-else class="growth-hint">暂无目标——把上面的标签转成一条可执行目标吧</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 成长页（M3 战场三）：习惯标签 + 改错清单。
 * 重算一体：点「重新分析」后端聚合全量收集、幂等落库、返回最新标签。
 */
import { computed, onMounted, ref } from 'vue'
import { NButton, NCheckbox, NInput, NSelect } from 'naive-ui'
import {
  addHabitGoal,
  DIMENSION_FIX_HINTS,
  DIMENSION_LABELS,
  getHabitTags,
  listHabitGoals,
  toggleHabitGoal,
  type HabitGoal,
  type HabitTag
} from '@renderer/services/insight'

const loading = ref(false)
const refreshingTags = ref(false)
const tags = ref<HabitTag[]>([])
const goals = ref<HabitGoal[]>([])
const tagsMsg = ref('')
const newGoalTitle = ref('')
const newGoalDimension = ref('vision')

const dimensionOptions = computed(() =>
  Object.entries(DIMENSION_LABELS).map(([value, label]) => ({ value, label }))
)

function formatDelta(v: number): string {
  const sign = v < 0 ? '' : '+'
  return `${sign}${v.toFixed(1)} vs 对手`
}

function shortDate(iso: string): string {
  return iso.slice(0, 10)
}

async function loadGoals(): Promise<void> {
  try {
    goals.value = await listHabitGoals()
  } catch {
    goals.value = []
  }
}

async function refreshAll(): Promise<void> {
  refreshingTags.value = true
  tagsMsg.value = ''
  try {
    const result = await getHabitTags()
    tags.value = result
    if (!result.length) {
      tagsMsg.value = '已分析本机对局，暂未发现持续落后的维度'
    }
  } catch (err) {
    tagsMsg.value = String(err)
  } finally {
    refreshingTags.value = false
  }
}

async function submitGoal(): Promise<void> {
  const title = newGoalTitle.value.trim()
  if (!title) return
  try {
    await addHabitGoal(newGoalDimension.value, title)
    newGoalTitle.value = ''
    await loadGoals()
  } catch {
    // 后端报错时保持输入，让用户改文案重试
  }
}

async function toggleGoal(g: HabitGoal): Promise<void> {
  try {
    await toggleHabitGoal(g.id)
    g.done = !g.done
  } catch {
    // 后端报错，状态不变（不做乐观更新）
  }
}

onMounted(async () => {
  loading.value = true
  await Promise.all([refreshAll(), loadGoals()])
  loading.value = false
})
</script>

<style lang="css" scoped>
.growth-page {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 960px;
}
.growth-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.growth-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
}
.growth-sub {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  opacity: 0.65;
}
.growth-hint {
  padding: var(--space-6);
  text-align: center;
  font-size: var(--font-size-sm);
  opacity: 0.6;
  border: 1px dashed rgba(128, 128, 128, 0.3);
  border-radius: var(--radius-lg);
}
.tag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
}
.tag-card {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  background: rgba(128, 128, 128, 0.06);
}
.tag-card--long {
  border-color: color-mix(in srgb, var(--semantic-loss, #d03050) 40%, transparent);
}
.tag-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.tag-card-dim {
  font-size: var(--font-size-md);
  font-weight: 600;
}
.tag-card-delta {
  font-size: var(--font-size-sm);
  color: var(--semantic-loss, #d03050);
}
.tag-card-meta {
  margin-top: var(--space-2);
  font-size: var(--font-size-3xs);
  opacity: 0.7;
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.tag-card-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-3xs);
  opacity: 0.8;
}
.goals-block {
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  padding-top: var(--space-4);
}
.goals-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-md);
  font-weight: 600;
}
.goals-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}
.goal-dim-select {
  width: 110px;
}
.goal-title-input {
  width: 260px;
}
.goals-list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.goal-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: rgba(128, 128, 128, 0.06);
}
.goal-dim {
  font-size: var(--font-size-3xs);
  opacity: 0.6;
}
@media (min-width: 720px) {
  .goals-head {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
