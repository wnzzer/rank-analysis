/**
 * NavRail（舰桥）冒烟测试：分区渲染 + 激活态跟随当前路由。
 * Tauri / 路由 / 游戏状态全部 mock；用 n-message-provider 宿主包裹以满足 useMessage。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn(() => ({ label: 'main' })) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
/** 切断 useGameState → router/index.ts → vue-router(createRouter) 的导入链 */
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref } = await import('vue')
  return {
    useGameState: () => ({
      isConnected: ref(false),
      summoner: ref(null)
    })
  }
})
vi.mock('@renderer/services/ipc', () => ({
  closeLeagueByIpc: vi.fn(() => Promise.resolve())
}))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => currentRoute,
  useRouter: () => ({ push: pushMock })
}))

import { defineComponent } from 'vue'
import naive from 'naive-ui'
import NavRail from '../NavRail.vue'
import { closeLeagueByIpc } from '@renderer/services/ipc'

const currentRoute = { name: 'Home' }
/** 宿主：提供 n-message-provider（useMessage 必需） */
const Host = defineComponent({
  components: { NavRail },
  template: '<n-message-provider><NavRail /></n-message-provider>'
})

function mountRail() {
  return mount(Host, { global: { plugins: [naive] } })
}

describe('NavRail', () => {
  beforeEach(() => {
    pushMock.mockClear()
    ;(closeLeagueByIpc as ReturnType<typeof vi.fn>).mockClear()
  })

  it('渲染三个分区的全部导航项', () => {
    const w = mountRail()
    const labels = w.findAll('.rail-i em').map(e => e.text())
    expect(labels).toEqual(['主页', '战绩', '对局', '成长', '大乱斗', '资产库', '设置'])
    w.unmount()
  })

  it('激活项跟随当前路由并挂激活类', () => {
    const w = mountRail()
    expect(w.find('.rail-i--on').text()).toContain('主页')
    w.unmount()
  })

  it('底部状态舱默认为未连接态', () => {
    const w = mountRail()
    expect(w.find('.rail-status--on').exists()).toBe(false)
    expect(w.find('.rail-status').text()).toContain('未连接')
    w.unmount()
  })
})
