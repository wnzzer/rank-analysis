import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useBreakpoint } from './useBreakpoint'

describe('useBreakpoint', () => {
  let originalInnerWidth: number

  beforeEach(() => {
    originalInnerWidth = window.innerWidth
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
  })

  function setWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    window.dispatchEvent(new Event('resize'))
  }

  function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
    let result!: T
    const Wrapper = defineComponent({
      setup() {
        result = composable()
        return () => null
      }
    })
    const wrapper = mount(Wrapper)
    return { result, unmount: () => wrapper.unmount() }
  }

  it('reports desktop when window >= 768', () => {
    setWidth(1024)
    const { result, unmount } = withSetup(() => useBreakpoint())
    expect(result.isMobile.value).toBe(false)
    expect(result.isDesktop.value).toBe(true)
    unmount()
  })

  it('reports mobile when window < 768', () => {
    setWidth(500)
    const { result, unmount } = withSetup(() => useBreakpoint())
    expect(result.isMobile.value).toBe(true)
    expect(result.isDesktop.value).toBe(false)
    unmount()
  })

  it('reacts to resize events', async () => {
    setWidth(1024)
    const { result, unmount } = withSetup(() => useBreakpoint())
    expect(result.isMobile.value).toBe(false)
    setWidth(600)
    await nextTick()
    expect(result.isMobile.value).toBe(true)
    unmount()
  })
})
