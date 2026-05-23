import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Mock Tauri IPC so onMounted's invoke calls resolve to harmless empty data
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve({ games: { games: [] }, begIndex: 0, endIndex: 9 }))
}))

// Stub useLoadingBar (only available inside <n-loading-bar-provider>)
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<typeof import('naive-ui')>('naive-ui')
  return {
    ...actual,
    useLoadingBar: () => ({ start: vi.fn(), finish: vi.fn(), error: vi.fn() })
  }
})

// Stub vue-router useRoute so the `name` query read doesn't blow up.
// Use importOriginal so other modules importing createRouter/createWebHashHistory still work.
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => ({ query: {} })
  }
})

describe('MatchHistory', () => {
  it('mounts without crashing', async () => {
    const MatchHistory = (await import('../MatchHistory.vue')).default
    const wrapper = mount(MatchHistory, {
      global: {
        stubs: {
          RecordCard: true,
          RecordCardSkeleton: true,
          NPagination: true,
          NEmpty: true,
          NButton: true,
          NSelect: true,
          NFlex: false,
          NIcon: true,
          NTooltip: true
        }
      }
    })
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })
})
