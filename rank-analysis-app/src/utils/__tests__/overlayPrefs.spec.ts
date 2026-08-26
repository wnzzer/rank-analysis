import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadOverlayPrefs, saveOverlayPrefs } from '../overlayPrefs'

const DEFAULTS = {
  maxItems: 3,
  opacity: 0.9,
  hotkeyEnabled: true,
  anchor: 'top-center' as const
}

describe('overlayPrefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing stored', () => {
    expect(loadOverlayPrefs()).toEqual(DEFAULTS)
  })

  it('round-trips saved prefs', () => {
    saveOverlayPrefs({ maxItems: 5, opacity: 0.7, hotkeyEnabled: false, anchor: 'top-left' })
    expect(loadOverlayPrefs()).toEqual({
      maxItems: 5,
      opacity: 0.7,
      hotkeyEnabled: false,
      anchor: 'top-left'
    })
  })

  it('clamps maxItems into [1,6] and opacity into [0.5,1] on load', () => {
    localStorage.setItem(
      'ra.overlay.prefs',
      JSON.stringify({ maxItems: 99, opacity: 0.1, hotkeyEnabled: true, anchor: 'top-right' })
    )
    expect(loadOverlayPrefs()).toEqual({
      maxItems: 6,
      opacity: 0.5,
      hotkeyEnabled: true,
      anchor: 'top-right'
    })
  })

  it('fills missing fields with defaults when partial JSON stored', () => {
    localStorage.setItem('ra.overlay.prefs', JSON.stringify({ maxItems: 2 }))
    expect(loadOverlayPrefs()).toEqual({ ...DEFAULTS, maxItems: 2 })
  })

  it('rejects unknown anchor values', () => {
    localStorage.setItem(
      'ra.overlay.prefs',
      JSON.stringify({ maxItems: 4, opacity: 1, hotkeyEnabled: true, anchor: 'bottom' })
    )
    expect(loadOverlayPrefs().anchor).toBe('top-center')
  })

  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem('ra.overlay.prefs', '{not json')
    expect(loadOverlayPrefs()).toEqual(DEFAULTS)
  })

  it('clamps and rounds on save', () => {
    saveOverlayPrefs({ maxItems: 9.7, opacity: 1.5, hotkeyEnabled: true, anchor: 'top-center' })
    expect(loadOverlayPrefs()).toEqual({
      maxItems: 6,
      opacity: 1,
      hotkeyEnabled: true,
      anchor: 'top-center'
    })
  })

  it('swallow storage failures silently', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() =>
      saveOverlayPrefs({ maxItems: 4, opacity: 0.8, hotkeyEnabled: false, anchor: 'top-left' })
    ).not.toThrow()
    spy.mockRestore()
  })
})
