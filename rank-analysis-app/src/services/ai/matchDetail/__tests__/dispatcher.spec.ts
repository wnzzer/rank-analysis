import { describe, it, expect } from 'vitest'
import { getModePromptAddon } from '../dispatcher'
import { classifyMode } from '../../shared/modeContext'

describe('getModePromptAddon', () => {
  it('returns ranked addon for queueId 420', () => {
    const ctx = classifyMode(420, 'CLASSIC')
    const addon = getModePromptAddon(ctx)
    expect(typeof addon.rules).toBe('string')
    expect(addon.kind).toBe('ranked')
  })

  it('returns aram addon for queueId 450', () => {
    const ctx = classifyMode(450, 'ARAM')
    const addon = getModePromptAddon(ctx)
    expect(addon.kind).toBe('aram')
  })

  it('returns augment addon for CHERRY', () => {
    const ctx = classifyMode(1700, 'CHERRY')
    const addon = getModePromptAddon(ctx)
    expect(addon.kind).toBe('augment')
  })

  it('returns augment addon for queueId 2400 (hexflash)', () => {
    const ctx = classifyMode(2400, 'ARAM')
    const addon = getModePromptAddon(ctx)
    expect(addon.kind).toBe('augment')
  })

  it('unknown mode falls back to aram', () => {
    const ctx = classifyMode(9999, 'UNKNOWN')
    const addon = getModePromptAddon(ctx)
    expect(addon.kind).toBe('aram')
  })
})
