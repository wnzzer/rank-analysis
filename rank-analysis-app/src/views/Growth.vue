<template>
  <div class="growth">
    <!-- ===== Hero 横幅：熔炉余烬同语 ===== -->
    <section class="ghero">
      <canvas ref="emberCanvas" class="ghero__canvas" aria-hidden="true"></canvas>
      <div class="ghero__veil" aria-hidden="true"></div>
      <div class="ghero__inner">
        <p class="ghero__kicker reveal" style="--d: 0">
          <span class="ghero__rule" aria-hidden="true"></span>
          GROWTH REPORT · 跨局聚合
        </p>
        <h1 class="ghero__title reveal" style="--d: 60ms">成 长</h1>
        <p class="ghero__sub reveal" style="--d: 140ms">
          重复性短板与改错清单——数据全部来自本机收集的对局
        </p>
        <div class="ghero__acts reveal" style="--d: 220ms">
          <button class="btn pri" :disabled="refreshingTags" @click="refreshAll">
            <RefreshCw class="btn-glyph" :class="{ spin: refreshingTags }" />
            {{ refreshingTags ? '分析中…' : '重新分析' }}
          </button>
        </div>
      </div>
    </section>

    <div class="growth__inner">
      <!-- 加载 / 全局错误 -->
      <p v-if="loading" class="psub growth-hint">正在聚合本机对局…</p>
      <EmptyState
        v-else-if="tagsMsg && !tags.length"
        :icon="TriangleAlert"
        title="暂时拿不到短板数据"
        :description="tagsMsg"
      >
        <template #action><button class="btn gho sm" @click="refreshAll">重试</button></template>
      </EmptyState>

      <!-- 短板卡：avgVsPeer 升序，最明显在前 -->
      <template v-else-if="tags.length">
        <div class="growth-grid">
          <CornerCard
            v-for="(t, i) in tags"
            :key="t.dimension"
            :emphasis="t.streak >= 3"
            class="reveal"
            :style="{ '--d': 120 + i * 70 + 'ms' }"
          >
            <template #extra>
              <span class="statc"
                ><span class="l">vs 同段位</span
                ><span class="v num" :class="deltaClass(t.avgVsPeer)">{{
                  formatDelta(t.avgVsPeer)
                }}</span></span
              >
            </template>
            <div class="tag-head">
              <span class="tagp loss">{{ DIMENSION_LABELS[t.dimension] ?? t.dimension }}</span>
              <span class="flames" aria-hidden="true">
                <Flame
                  v-for="n in Math.min(t.streak, 5)"
                  :key="n"
                  class="flame"
                  :class="{ 'flame--hot': n <= 3 }"
                />
                <span v-if="t.streak > 5" class="psub num">+{{ t.streak - 5 }}</span>
              </span>
              <span class="psub"
                >持续落后 <b class="num">{{ t.streak }}</b> 局 · 最近检出
                {{ shortDate(t.lastSeen) }}</span
              >
            </div>
            <p class="psub tag-hint">
              {{ DIMENSION_FIX_HINTS[t.dimension] ?? '对局中主动复盘该维度' }}
            </p>
            <button class="btn gho sm tag-fix" @click="turnToGoal(t)">转为本周目标</button>
          </CornerCard>
        </div>
      </template>

      <EmptyState
        v-else
        :icon="TrendingUp"
        title="暂无短板检出"
        description="收集满 5 局对局后会自动产出习惯标签；点「重新分析」可立即聚合一次。"
      />

      <!-- 改错清单 -->
      <CornerCard
        class="goals-card reveal"
        style="--d: 200ms"
        title="改错清单"
        subtitle="可勾选 · 跨局追踪"
      >
        <template #extra>
          <div class="goal-add">
            <select v-model="newGoalDimension" class="goal-select">
              <option v-for="o in dimensionOptions" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
            <input
              v-model="newGoalTitle"
              class="goal-input"
              placeholder="目标（如：排眼数 +1）"
              @keyup.enter="submitGoal"
            />
            <button class="btn pri sm" :disabled="!newGoalTitle.trim()" @click="submitGoal">
              添加
            </button>
          </div>
        </template>

        <p v-if="goals.length" class="goal-progress psub">
          已完成 <b class="num">{{ doneCount }}</b> / {{ goals.length }}
          <span class="goal-progress-bar" aria-hidden="true"
            ><i :style="{ width: progressPct }"></i
          ></span>
        </p>
        <ul v-if="goals.length" class="goals-list">
          <li v-for="g in goals" :key="g.id" class="goal-item">
            <label class="goal-check" :class="{ done: g.done }">
              <input type="checkbox" :checked="g.done" @change="() => toggleGoal(g)" />
              <span class="goal-box" aria-hidden="true"><Check class="goal-tick" /></span>
              <span>{{ g.title }}</span>
            </label>
            <span class="tagp info goal-dim">{{
              DIMENSION_LABELS[g.dimension] ?? g.dimension
            }}</span>
          </li>
        </ul>
        <EmptyState
          v-else
          :icon="Target"
          title="还没有目标"
          description="把上面的短板标签转成一条可执行目标吧。"
        />
      </CornerCard>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 成长页（设计系统 v3 §C4）：习惯标签 + 改错清单。
 * 重算一体：点「重新分析」后端聚合全量收集、幂等落库、返回最新标签。
 * 标杆语言（4A）：熔炉余烬横幅 + 入场 stagger + 连败火焰可视化 + 目标进度条。
 */
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'

import CornerCard from '../components/ui/CornerCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { useEmberField } from '../composables/useEmberField'
import { TriangleAlert, TrendingUp, Target, RefreshCw, Flame, Check } from 'lucide-vue-next'
import {
  addHabitGoal,
  DIMENSION_FIX_HINTS,
  DIMENSION_LABELS,
  getHabitTags,
  listHabitGoals,
  toggleHabitGoal,
  type HabitGoal,
  type HabitTag
} from '../services/insight'

const message = useMessage()

const loading = ref(false)
const refreshingTags = ref(false)
const tags = ref<HabitTag[]>([])
const goals = ref<HabitGoal[]>([])
/** 全局失败信息（区别于"无标签"空态） */
const tagsMsg = ref('')

const newGoalTitle = ref('')
const newGoalDimension = ref('vision')

const emberCanvas = ref<HTMLCanvasElement | null>(null)
useEmberField(emberCanvas)

const doneCount = computed(() => goals.value.filter(g => g.done).length)
const progressPct = computed(() =>
  goals.value.length ? `${Math.round((doneCount.value / goals.value.length) * 100)}%` : '0%'
)

const dimensionOptions = computed(() =>
  Object.entries(DIMENSION_LABELS).map(([value, label]) => ({ value, label }))
)

function formatDelta(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)} vs 对手`
}
function deltaClass(v: number): string {
  return v > 0 ? 'w' : 'l'
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
    message.success('已添加目标')
    await loadGoals()
  } catch {
    // 后端报错时保持输入，让用户改文案重试
    message.error('添加失败，请重试')
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

/** 短板 → 目标一键转化（主转化路径：W3） */
async function turnToGoal(t: HabitTag): Promise<void> {
  const label = DIMENSION_LABELS[t.dimension] ?? t.dimension
  try {
    await addHabitGoal(t.dimension, `改善「${label}」`)
    message.success('已加入改错清单')
    await loadGoals()
  } catch {
    message.error('添加失败，请到下方手动创建')
  }
}

onMounted(async () => {
  loading.value = true
  await Promise.all([refreshAll(), loadGoals()])
  loading.value = false
})
</script>

<style scoped>
.growth {
  max-width: 1080px;
  margin: 0 auto;
}

/* ===== Hero 横幅 ===== */
.ghero {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--border-subtle);
  background:
    radial-gradient(
      110% 100% at 20% 0%,
      color-mix(in srgb, var(--info) 7%, transparent),
      transparent 55%
    ),
    var(--bg-sunken);
}
.ghero__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.ghero__veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent 60%, var(--bg-base));
}
.ghero__veil::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--noise-img);
  opacity: 0.05;
}
.ghero__inner {
  position: relative;
  z-index: 1;
  padding: 40px var(--space-24) 32px;
}
.ghero__kicker {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  font-family: var(--font-num);
  font-size: var(--font-size-xs);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
}
.ghero__rule {
  width: 30px;
  height: 1px;
  background: var(--brand-gradient);
  box-shadow: var(--glow-brand);
}
.ghero__title {
  margin: var(--space-8) 0 var(--space-6);
  font-size: clamp(30px, 4.4vw, 48px);
  font-weight: var(--font-weight-black);
  letter-spacing: 0.08em;
  line-height: 1.05;
  color: var(--text-primary);
}
.ghero__sub {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.ghero__acts {
  margin-top: var(--space-16);
}
.btn-glyph {
  width: 12px;
  height: 12px;
}
.btn-glyph.spin {
  animation: growth-spin 1s linear infinite;
}

/* ===== 功能区 ===== */
.growth__inner {
  padding: var(--space-20) var(--space-24) var(--space-28);
}
.growth-hint {
  padding: var(--space-24) 0;
  text-align: center;
}
.psub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.statc {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-6);
}
.statc .l {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.statc .v {
  font-family: var(--font-num);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
}
.statc .v.w {
  color: var(--win);
}
.statc .v.l {
  color: var(--loss);
}
.tagp {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-2xs);
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-subtle);
}
.tagp.loss {
  background: var(--loss-soft);
  border-color: var(--loss-border);
  color: var(--loss);
}
.tagp.info {
  background: var(--info-soft);
  border-color: var(--info-border);
  color: var(--info);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  padding: 8px 16px;
  cursor: pointer;
  border: none;
  clip-path: var(--clip-notch);
  transition: filter var(--dur-fast) var(--ease-expo);
}
.btn.pri {
  background: var(--brand-gradient);
  color: var(--text-on-brand);
}
.btn.pri:hover:not(:disabled) {
  filter: brightness(1.08);
}
.btn.pri:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn.gho {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
}
.btn.gho:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
}
.btn.sm {
  padding: 5px 11px;
  font-size: var(--font-size-xs);
}

.growth-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-16);
  margin-bottom: var(--space-20);
}
.tag-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  margin-bottom: var(--space-8);
}
.flames {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.flame {
  width: 13px;
  height: 13px;
  color: var(--loss-border);
}
.flame--hot {
  color: var(--loss);
  filter: drop-shadow(0 0 3px var(--loss-border));
}
.tag-hint {
  margin-bottom: var(--space-12);
}
.tag-fix {
  width: 100%;
  justify-content: center;
}

.goals-card {
  margin-top: var(--space-4);
}
.goal-add {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}
.goal-select,
.goal-input {
  height: 30px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: var(--bg-base);
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  padding: 0 var(--space-8);
}
.goal-input {
  width: 200px;
}
.goal-progress {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  margin-bottom: var(--space-8);
}
.goal-progress .num {
  color: var(--win);
}
.goal-progress-bar {
  flex: 1;
  max-width: 220px;
  height: 3px;
  background: var(--bg-active);
  clip-path: var(--clip-notch);
  overflow: hidden;
}
.goal-progress-bar i {
  display: block;
  height: 100%;
  background: var(--brand-gradient);
  transition: width var(--dur-spring) var(--ease-spring);
}
.goals-list {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.goal-item {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  padding: 9px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.goal-item:last-child {
  border-bottom: none;
}
.goal-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}
.goal-check input[type='checkbox'] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.goal-box {
  width: 15px;
  height: 15px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-notch);
  background: var(--bg-base);
  transition:
    background var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}
.goal-tick {
  width: 10px;
  height: 10px;
  color: var(--text-on-brand);
  opacity: 0;
  transform: scale(0.5);
  transition:
    opacity var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}
.goal-check.done .goal-box {
  background: var(--brand-gradient);
  border-color: transparent;
}
.goal-check.done .goal-tick {
  opacity: 1;
  transform: scale(1);
}
.goal-check.done span:not(.goal-box):not(.goal-tick) {
  color: var(--text-tertiary);
  text-decoration: line-through;
}
.goal-dim {
  margin-left: auto;
}

.reveal {
  animation: growth-rise 0.7s var(--ease-expo) both;
  animation-delay: calc(var(--d, 0) * 1ms);
}
@keyframes growth-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes growth-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal,
  .btn-glyph.spin {
    animation: none;
  }
}
</style>
