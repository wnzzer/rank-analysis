<template>
  <Teleport to="body">
    <Transition name="pal">
      <div v-if="show" class="pal-mask" @mousedown.self="close">
        <div ref="panelEl" class="pal" role="dialog" aria-modal="true" aria-label="命令面板">
          <input
            ref="inputEl"
            v-model="q"
            class="pal__input"
            placeholder="搜索页面、动作，或输入 召唤师名称#Tag 查战绩…"
            spellcheck="false"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="runActive"
          />
          <div class="pal__list" ref="listEl">
            <template v-for="(c, i) in filtered" :key="c.key">
              <div v-if="i === 0 || filtered[i - 1].group !== c.group" class="pal__group">
                {{ c.group }}
              </div>
              <button
                class="pal__item"
                :class="{ 'pal__item--on': i === active }"
                :ref="el => setActiveEl(i, el)"
                @click="run(c)"
                @mousemove="active = i"
              >
                <span class="pal__icon"><component :is="c.icon ?? Circle" /></span>
                <span class="pal__label">{{ c.label }}</span>
                <span v-if="c.hint" class="pal__hint">{{ c.hint }}</span>
              </button>
            </template>
            <div v-if="filtered.length === 0" class="pal__empty">没有匹配的命令</div>
          </div>
          <div class="pal__foot">
            <KeyHint keys="↑↓" /> 选择 <KeyHint keys="Enter" /> 执行 <KeyHint keys="Esc" /> 关闭
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * CommandPalette —— 全局命令面板（设计系统 v3 §7.10）
 *
 * 打开方式：Ctrl+K（全局）/ 顶栏搜索按钮。
 * 命令源：页面导航 + 动作 + 动态「查询战绩」；纯逻辑抽在 commandPalette.ts 便于单测。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  House,
  ScrollText,
  Swords,
  TrendingUp,
  LibraryBig,
  Settings,
  Search,
  Circle
} from 'lucide-vue-next'
import KeyHint from '../ui/KeyHint.vue'
import { filterCommands, nextIndex, parsePlayerQuery, type PaletteCommand } from './commandPalette'

const show = defineModel<boolean>('show', { default: false })
const router = useRouter()
const q = ref('')
const active = ref(0)

/** 组装命令表：静态项 + 输入非空时的动态查人项 */
const commands = computed<PaletteCommand[]>(() => {
  const go = (name: string) => () => router.push({ name })
  const list: PaletteCommand[] = [
    {
      key: 'nav-home',
      group: '页面',
      label: '主页',
      icon: markRaw(House),
      hint: 'Home',
      run: go('Home')
    },
    {
      key: 'nav-record',
      group: '页面',
      label: '战绩查询',
      icon: markRaw(ScrollText),
      run: go('Record')
    },
    {
      key: 'nav-gaming',
      group: '页面',
      label: '对局分析',
      icon: markRaw(Swords),
      run: go('Gaming')
    },
    {
      key: 'nav-growth',
      group: '页面',
      label: '成长',
      icon: markRaw(TrendingUp),
      run: go('Growth')
    },
    {
      key: 'nav-library',
      group: '页面',
      label: '资产库',
      icon: markRaw(LibraryBig),
      run: go('Library')
    },
    {
      key: 'nav-settings',
      group: '页面',
      label: '设置',
      icon: markRaw(Settings),
      run: go('Settings')
    }
  ]
  const playerQuery = parsePlayerQuery(q.value)
  if (playerQuery && playerQuery.includes('#')) {
    list.unshift({
      key: 'act-player',
      group: '查询',
      label: `查询战绩「${playerQuery}」`,
      icon: markRaw(Search),
      hint: 'Enter',
      run: () => router.push({ path: '/Record', query: { name: playerQuery } })
    })
  }
  return list
})

const filtered = computed(() => filterCommands(commands.value, q.value))

watch([show, filtered], async () => {
  active.value = 0
  if (show.value) {
    await nextTick()
    inputEl.value?.focus()
    scrollActive()
  }
})

const inputEl = ref<HTMLInputElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const itemEls = new Map<number, HTMLElement>()

/* 焦点管理：打开时记忆触发元素，关闭后归还；Tab 在面板内循环（焦点陷阱） */
let lastFocused: HTMLElement | null = null

watch([show, filtered], async () => {
  active.value = 0
  if (show.value) {
    await nextTick()
    inputEl.value?.focus()
    scrollActive()
  }
})

watch(show, s => {
  if (s) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  } else if (lastFocused) {
    lastFocused.focus()
    lastFocused = null
  }
})

function setActiveEl(i: number, el: unknown) {
  if (el) itemEls.set(i, el as HTMLElement)
}
function scrollActive() {
  itemEls.get(active.value)?.scrollIntoView({ block: 'nearest' })
}

function move(delta: 1 | -1) {
  active.value = nextIndex(active.value, filtered.value.length, delta)
  scrollActive()
}
function runActive() {
  const c = filtered.value[active.value]
  if (c) run(c)
}
function run(c: PaletteCommand) {
  close()
  c.run()
}
function close() {
  show.value = false
  q.value = ''
}

function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    show.value = !show.value
    return
  }
  if (!show.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  // 焦点陷阱：Tab/Shift+Tab 在面板内循环（input + 命令项）
  if (e.key === 'Tab' && panelEl.value) {
    const focusables = Array.from(panelEl.value.querySelectorAll<HTMLElement>('input, button'))
    if (focusables.length === 0) return
    e.preventDefault()
    const activeEl = document.activeElement as HTMLElement | null
    const idx = focusables.indexOf(activeEl ?? focusables[0])
    const next = e.shiftKey
      ? focusables[(idx - 1 + focusables.length) % focusables.length]
      : focusables[(idx + 1) % focusables.length]
    next?.focus()
  }
}
/** 主页快捷入口通过该事件打开面板（解耦：Home 不持有面板实例） */
function onOpenEvent() {
  show.value = true
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('ra:open-palette', onOpenEvent)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('ra:open-palette', onOpenEvent)
})
</script>

<style scoped>
.pal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: color-mix(in srgb, var(--bg-sunken) 55%, transparent);
  backdrop-filter: blur(4px);
}
.pal {
  width: min(640px, 92vw);
  margin: 14vh auto 0;
  background: var(--bg-raised);
  border: 1px solid var(--brand-border);
  clip-path: var(--clip-corner-md);
  box-shadow: var(--shadow-3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* 暗色主题叠加辉光；--glow-brand 在亮色为 none，
   不能与实值阴影逗号并列（整条声明会失效） */
.theme-dark .pal {
  box-shadow: var(--shadow-3), var(--glow-brand);
}
.pal__input {
  padding: 15px 18px;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-md);
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;
  border-bottom: 1px solid var(--border-subtle);
}
.pal__input::placeholder {
  color: var(--text-tertiary);
}
.pal__list {
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px;
}
.pal__group {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--text-secondary);
  padding: 10px 12px 4px;
}
.pal__group::before {
  content: '';
  width: 12px;
  height: 1px;
  background: var(--brand-gradient);
}
.pal__item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
  clip-path: var(--clip-notch);
  transition:
    background var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
}
.pal__item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.pal__item--on {
  background: var(--brand-soft);
  color: var(--text-primary);
  box-shadow: inset 2px 0 0 var(--brand);
}
.pal__item--on .pal__icon {
  color: var(--brand);
}
.pal__icon {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--text-tertiary);
  transition: color var(--dur-fast) var(--ease-expo);
}
.pal__item:hover .pal__icon {
  color: var(--brand);
}
.pal__icon svg {
  width: 100%;
  height: 100%;
}
.pal__label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pal__hint {
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
}
.pal__empty {
  padding: 22px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
.pal__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-subtle);
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.pal-enter-active,
.pal-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}
.pal-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.985);
}
.pal-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.99);
}
</style>
