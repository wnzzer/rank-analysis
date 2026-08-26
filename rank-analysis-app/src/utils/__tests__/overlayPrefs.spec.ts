import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadOverlayPrefs, saveOverlayPrefs } from '../overlayPrefs'

describe('overlayPrefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing stored', () => {
    expect(loadOverlayPrefs()).toEqual({ maxItems: 3, opacity: 0.9 })
  })

  it('round-trips saved prefs', () => {
    saveOverlayPrefs({ maxItems: 5, opacity: 0.7 })
    expect(loadOverlayPrefs()).toEqual({ maxItems: 5, opacity: 0.7 })
  })

  it('clamps maxItems into [1,6] and opacity into [0.5,1] on load', () => {
    localStorage.setItem('ra.overlay.prefs', JSON.stringify({ maxItems: 99, opacity: 0.1 }))
    expect(loadOverlayPrefs()).toEqual({ maxItems: 6, opacity: 0.5 })
  })

  it('fills missing fields with defaults when partial JSON stored', () => {
    localStorage.setItem('ra.overlay.prefs', JSON.stringify({ maxItems: 2 }))
    expect(loadOverlayPrefs()).toEqual({ maxItems: 2, opacity: 0.9 })
  })

  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem('ra.overlay.prefs', '{not json')
    expect(loadOverlayPrefs()).toEqual({ maxItems: 3, opacity: 0.9 })
  })

  it('clamps and rounds on save', () => {
    saveOverlayPrefs({ maxItems: 9.7, opacity: 1.5 })
    expect(loadOverlayPrefs()).toEqual({ maxItems: 6, opacity: 1 })
  })

  it('swallow storage failures silently', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveOverlayPrefs({ maxItems: 4, opacity: 0.8 })).not.toThrow()
    spy.mockRestore()
  })
})
