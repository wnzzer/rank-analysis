import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LazyImg from '../LazyImg.vue'

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
})
