/**
 * Home 主页冒烟测试：
 * - 未连接态渲染「客户端状态」卡与启动按钮（Loading 职责并入的回归保障）；
 * - 短板提醒卡在无标签时给出空态引导；
 * - 快捷入口路由跳转。
 * useGameState / ipc / insight 全部 mock，宿主提供 n-message-provider。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import naive from 'naive-ui'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn(() => ({ label: 'main' })) }))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'Home' }),
  useRouter: () => ({ push: pushMock })
}))

const connectedRef = ref(false)
const summonerRef = ref<{ gameName: string; tagLine: string } | null>(null)
vi.mock('@renderer/composables/useGameState', () => ({
  useGameState: () => ({
    isConnected: connectedRef,
    summoner: summonerRef,
    reasonCode: ref(null),
    reasonMessage: ref(null),
    currentPhase: ref(null)
  })
}))
vi.mock('@renderer/services/ipc', () => ({
  launchLeagueByIpc: vi.fn(() => Promise.resolve())
}))
vi.mock('@renderer/services/insight', () => ({
  getHabitTags: vi.fn(() => Promise.resolve([])),
  addHabitGoal: vi.fn(() => Promise.resolve()),
  DIMENSION_LABELS: { vision: '视野' }
}))

import Home from '../Home.vue'

/** 宿主：提供 n-message-provider（useMessage 必需） */
const Host = defineComponent({
  components: { Home },
  template: '<n-message-provider><Home /></n-message-provider>'
})

function mountHome() {
  return mount(Host, { global: { plugins: [naive] } })
}

describe('Home 主页仪表盘', () => {
  beforeEach(() => {
    pushMock.mockClear()
    connectedRef.value = false
    summonerRef.value = null
  })

  it('未连接时状态卡展示启动入口（承接原 Loading 职责）', async () => {
    const w = mountHome()
    await w.vm.$nextTick()
    expect(w.text()).toContain('客户端状态')
    expect(w.text()).toContain('启动客户端')
    w.unmount()
  })

  it('连接后状态卡切换为在线并显示召唤师名', async () => {
    summonerRef.value = { gameName: '峡谷诗人', tagLine: '5207' }
    connectedRef.value = true
    const w = mountHome()
    await w.vm.$nextTick()
    expect(w.text()).toContain('峡谷诗人#5207')
    w.unmount()
  })

  it('无习惯标签时短板卡给空态引导而非空白', async () => {
    const w = mountHome()
    await flushPromises()
    await w.vm.$nextTick()
    expect(w.text()).toContain('暂无短板检出')
    w.unmount()
  })

  it('快捷入口可跳转资产库', async () => {
    const w = mountHome()
    await w.vm.$nextTick()
    const entries = w.findAll('.qentry')
    const lib = entries.find(e => e.text().includes('资产库'))
    await lib!.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'Library' })
    w.unmount()
  })
})
