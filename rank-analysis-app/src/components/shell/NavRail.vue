<template>
  <!-- 战绩子窗口：精简模式，只保留「回主窗口 / 并排对比」两个动作 -->
  <aside v-if="isChild" class="rail rail--child">
    <button class="rail-i" title="回主窗口" @click="backMain">
      <span><AppWindow /></span><em>主窗口</em>
    </button>
    <button class="rail-i" title="并排对比" @click="tileSide">
      <span><Columns2 /></span><em>并排对比</em>
    </button>
  </aside>

  <aside
    v-else
    class="rail"
    :class="{ 'rail--open': open || pinned }"
    @mouseenter="open = true"
    @mouseleave="open = false"
  >
    <div class="rail__logo" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2 L20 5 V11 C20 16.5 16.6 20.4 12 22 C7.4 20.4 4 16.5 4 11 V5 Z"
          stroke="currentColor"
          stroke-width="1.6"
        />
        <polyline
          points="7.5,14.5 10.5,10.5 12.5,12.5 16.5,7.5"
          stroke="currentColor"
          stroke-width="1.6"
        />
      </svg>
      <em class="rail__brand">RANK ANALYSIS</em>
    </div>

    <nav class="rail__nav">
      <template v-for="sec in sections" :key="sec.label">
        <div class="rail__sec">{{ sec.label }}</div>
        <button
          v-for="it in sec.items"
          :key="it.name"
          class="rail-i"
          :class="{ 'rail-i--on': route.name === it.name }"
          :title="it.label"
          @click="go(it.name)"
        >
          <span><component :is="it.icon" /></span><em>{{ it.label }}</em>
        </button>
      </template>
    </nav>

    <div class="rail__foot">
      <n-dropdown
        trigger="click"
        placement="top-end"
        :options="statusOptions"
        @select="onStatusSelect"
      >
        <button class="rail-status" :class="{ 'rail-status--on': connected }">
          <span class="dot"></span><em>{{ connected ? statusName : '未连接' }}</em>
        </button>
      </n-dropdown>
      <button class="rail-pin" :title="pinned ? '取消固定展开' : '固定展开'" @click="togglePin">
        <PinOff v-if="pinned" />
        <Pin v-else />
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * NavRail —— 舰桥导航（设计系统 v3 §7.11）
 *
 * - 64px 收起 / hover 展开 200px，可钉住（会话内记忆）；
 * - 分区：分析 / 库 / 系统；激活项 = 左侧金色菱形 + brand-soft 底；
 * - 底部状态舱：连接状态灯 + 菜单（关闭客户端为两步确认的危险动作，
 *   就近原则承接自旧标题栏——状态在哪，操作在哪）。
 */
import { computed, h, markRaw, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NDropdown } from 'naive-ui'
import {
  House,
  ScrollText,
  Swords,
  TrendingUp,
  LibraryBig,
  Settings,
  AppWindow,
  Columns2,
  Pin,
  PinOff
} from 'lucide-vue-next'
import { isRecordChildWindow, focusMainWindow, tileWindowsSideBySide } from '../../utils/windows'
import { closeLeagueByIpc } from '../../services/ipc'
import { useGameState } from '../../composables/useGameState'
import { useMessage } from 'naive-ui'

const open = ref(false)
const pinned = ref(false)
const confirmingClose = ref(false)
const message = useMessage()
const route = useRoute()
const router = useRouter()

const isChild = isRecordChildWindow()
const { isConnected: connected, summoner } = useGameState()

const sections = [
  {
    label: '分析',
    items: [
      { name: 'Home', label: '主页', icon: markRaw(House) },
      { name: 'Record', label: '战绩', icon: markRaw(ScrollText) },
      { name: 'Gaming', label: '对局', icon: markRaw(Swords) },
      { name: 'Growth', label: '成长', icon: markRaw(TrendingUp) }
    ]
  },
  { label: '库', items: [{ name: 'Library', label: '资产库', icon: markRaw(LibraryBig) }] },
  { label: '系统', items: [{ name: 'Settings', label: '设置', icon: markRaw(Settings) }] }
]

function go(name: string) {
  const summonerValue = summoner.value
  router.push({
    name,
    query:
      name === 'Record' && summonerValue?.gameName
        ? { name: `${summonerValue.gameName}#${summonerValue.tagLine}` }
        : undefined
  })
}

function togglePin() {
  pinned.value = !pinned.value
}

const statusName = computed(() =>
  summoner.value?.gameName ? `${summoner.value.gameName}#${summoner.value.tagLine}` : '已连接'
)

const statusOptions = computed(() => [
  {
    key: 'state',
    label: connected.value ? `已连接：${statusName.value}` : '未连接客户端',
    disabled: true
  },
  { type: 'divider' as const, key: 'd1' },
  {
    key: 'close-game',
    label: confirmingClose.value ? '再点一次确认关闭游戏' : '关闭游戏客户端',
    props: { class: confirmingClose.value ? 'ra-menu-danger-armed' : '' }
  },
  { key: 'github', label: () => h('span', null, '项目主页 GitHub') }
])

async function onStatusSelect(key: string) {
  if (key === 'close-game') {
    if (!connected.value) return
    if (!confirmingClose.value) {
      confirmingClose.value = true
      setTimeout(() => (confirmingClose.value = false), 3000)
      return
    }
    confirmingClose.value = false
    try {
      await closeLeagueByIpc()
      message.success('已发送关闭指令')
    } catch {
      message.error('关闭失败')
    }
  }
}

function backMain() {
  void focusMainWindow()
}
function tileSide() {
  void tileWindowsSideBySide()
}
</script>

<style scoped>
.rail {
  width: 64px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0 12px;
  gap: 2px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
  transition: width var(--dur-normal) var(--ease-expo);
  user-select: none;
}
.rail--open {
  width: 200px;
  align-items: stretch;
  padding: 10px 10px 12px;
}
.rail--child {
  width: 64px;
}

.rail__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  color: var(--brand);
  margin-bottom: 6px;
  filter: drop-shadow(var(--glow-brand));
}
.rail--open .rail__logo {
  justify-content: flex-start;
  padding-left: 8px;
}
.rail__brand {
  font-style: normal;
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--tracking-label);
  white-space: nowrap;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-expo);
}
.rail--open .rail__brand {
  opacity: 1;
}

.rail__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  flex: 1;
}
.rail__sec {
  display: none;
  font-size: 9px;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 10px 8px 4px;
}
.rail--open .rail__sec {
  display: block;
}

.rail-i {
  position: relative;
  height: 42px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
  clip-path: var(--clip-notch);
  transition:
    background-color var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
}
.rail-i span {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rail-i span svg {
  width: 17px;
  height: 17px;
}
.rail-i em {
  font-style: normal;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-expo);
}
.rail--open .rail-i {
  justify-content: flex-start;
  padding-left: 10px;
}
.rail--open .rail-i em {
  opacity: 1;
}
.rail-i:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.rail-i--on {
  background: var(--brand-soft);
  color: var(--brand);
}
.rail-i--on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 7px;
  height: 7px;
  transform: translate(0, -50%) rotate(45deg);
  background: var(--brand);
  box-shadow: var(--glow-brand);
}

.rail__foot {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: auto;
}
.rail--open .rail__foot {
  align-items: stretch;
}
.rail-status {
  position: relative;
  height: 36px;
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  cursor: pointer;
  background: transparent;
  color: var(--text-tertiary);
  clip-path: var(--clip-notch);
}
.rail--open .rail-status {
  width: 100%;
  padding-left: 10px;
  justify-content: flex-start;
}
.rail-status em {
  font-style: normal;
  font-size: var(--font-size-2xs);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-status .dot {
  width: 8px;
  height: 8px;
  flex: none;
  transform: rotate(45deg);
  background: var(--text-tertiary);
  opacity: 0.6;
}
.rail-status--on .dot {
  background: var(--win);
  box-shadow: var(--glow-win);
  animation: dot-pulse 2s ease-in-out infinite;
}
.rail-status--on {
  color: var(--win);
}
@keyframes dot-pulse {
  50% {
    opacity: 0.55;
  }
}

.rail-pin {
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rail-pin svg {
  width: 15px;
  height: 15px;
}
.rail-pin:hover {
  color: var(--text-secondary);
}
</style>

<style global>
.ra-menu-danger-armed {
  color: var(--loss) !important;
  font-weight: 700;
}
</style>
