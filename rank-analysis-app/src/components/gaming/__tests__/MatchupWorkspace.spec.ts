import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MatchupWorkspace from '../MatchupWorkspace.vue'
import { MATCHUP_API } from '@renderer/services/matchup'
import type { MatchupApi } from '@renderer/types/matchup'

/** 不访问客户端的展示测试提供器。 */
const api: MatchupApi = {
  getList: async query => ({
    ...query,
    version: '16.21',
    cachedAt: null,
    fetchedAt: 100,
    stale: false,
    candidates: []
  }),
  getDetail: vi.fn(),
  getPosition: async () => 'mid',
  loadNames: async () => {},
  name: id => `英雄${id}`,
  icon: id => `/champion/${id}`
}

describe('对位内页导航', () => {
  it('返回原阵容保留节点和滚动，并恢复入口焦点', async () => {
    const wrapper = mount(MatchupWorkspace, {
      attachTo: document.body,
      props: { enabled: true, enemies: [{ slot: 0, championId: 103 }], tier: 'emerald_plus' },
      slots: {
        default:
          '<template #default="{ open }"><button id="record-entry" @click="open(0, $event)">对位</button><p>原有战绩内容</p></template>'
      },
      global: { provide: { [MATCHUP_API as symbol]: api } }
    })
    const original = wrapper.get('[data-records]').element
    original.scrollTop = 37
    await wrapper.get('#record-entry').trigger('click')
    await flushPromises()
    expect(original.hasAttribute('inert')).toBe(true)
    expect(wrapper.text()).toContain('原有战绩内容')
    await wrapper.get('[data-back]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-records]').element).toBe(original)
    expect(original.scrollTop).toBe(37)
    expect(original.hasAttribute('inert')).toBe(false)
    expect(document.activeElement?.id).toBe('record-entry')
    wrapper.unmount()
  })

  it('离开支持阶段退出内页且取消旧目标', async () => {
    const wrapper = mount(MatchupWorkspace, {
      props: { enabled: true, enemies: [{ slot: 0, championId: 103 }], tier: 'emerald_plus' },
      slots: {
        default:
          '<template #default="{ open }"><button @click="open(0, $event)">对位</button></template>'
      },
      global: { provide: { [MATCHUP_API as symbol]: api } }
    })
    await wrapper.get('[data-records] button').trigger('click')
    await wrapper.setProps({ enabled: false })
    expect(wrapper.find('.matchup-workspace').exists()).toBe(false)
    expect(wrapper.find('[data-page-nav]').exists()).toBe(false)
    wrapper.unmount()
  })
})
