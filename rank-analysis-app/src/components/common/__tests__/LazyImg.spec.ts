import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LazyImg from '../LazyImg.vue'
import { LAZY_IMG_RETRY_DELAYS_MS } from '../lazyImgRetry'

describe('LazyImg', () => {
  it('renders an img with the given src and alt', () => {
    const wrapper = mount(LazyImg, { props: { src: '/x.png', alt: 'champion' } })
    const img = wrapper.find('img')
    expect(img.attributes('src')).toBe('/x.png')
    expect(img.attributes('alt')).toBe('champion')
  })

  it('shows loading class before load and removes it after load event', async () => {
    const wrapper = mount(LazyImg, { props: { src: '/x.png' } })
    expect(wrapper.classes()).toContain('lazy-img-loading')
    await wrapper.find('img').trigger('load')
    expect(wrapper.classes()).not.toContain('lazy-img-loading')
  })

  it('switches to error class when img fires error', async () => {
    const wrapper = mount(LazyImg, { props: { src: '/x.png' } })
    await wrapper.find('img').trigger('error')
    expect(wrapper.classes()).toContain('lazy-img-error')
  })

  describe('retry on error', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('re-requests with a cache-busting param after a delay', async () => {
      const wrapper = mount(LazyImg, { props: { src: 'asset://localhost/item/3145' } })
      await wrapper.find('img').trigger('error')

      await vi.advanceTimersByTimeAsync(LAZY_IMG_RETRY_DELAYS_MS[0])

      expect(wrapper.find('img').attributes('src')).toBe('asset://localhost/item/3145?retry=1')
      expect(wrapper.classes()).toContain('lazy-img-loading')
    })

    it('uses & when src already has a query string', async () => {
      const wrapper = mount(LazyImg, { props: { src: '/x.png?v=2' } })
      await wrapper.find('img').trigger('error')

      await vi.advanceTimersByTimeAsync(LAZY_IMG_RETRY_DELAYS_MS[0])

      expect(wrapper.find('img').attributes('src')).toBe('/x.png?v=2&retry=1')
    })

    it('gives up and stays in error after all retries are used', async () => {
      const wrapper = mount(LazyImg, { props: { src: '/x.png' } })
      for (const delay of LAZY_IMG_RETRY_DELAYS_MS) {
        await wrapper.find('img').trigger('error')
        await vi.advanceTimersByTimeAsync(delay)
      }
      await wrapper.find('img').trigger('error')
      await vi.advanceTimersByTimeAsync(60_000)

      expect(wrapper.find('img').attributes('src')).toBe(
        `/x.png?retry=${LAZY_IMG_RETRY_DELAYS_MS.length}`
      )
      expect(wrapper.classes()).toContain('lazy-img-error')
    })

    it('resets retries when src changes', async () => {
      const wrapper = mount(LazyImg, { props: { src: '/a.png' } })
      await wrapper.find('img').trigger('error')
      await wrapper.setProps({ src: '/b.png' })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(wrapper.find('img').attributes('src')).toBe('/b.png')
    })
  })
})
