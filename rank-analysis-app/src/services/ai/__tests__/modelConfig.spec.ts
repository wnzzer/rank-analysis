import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { resolveModel } from '../modelConfig'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const mockInvoke = invoke as ReturnType<typeof vi.fn>

describe('resolveModel', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('should prefer scene-specific model over default', async () => {
    mockInvoke.mockResolvedValue({
      schemaVersion: 1,
      models: { default: 'deepseek-v4.1-flash-1017', tagSuggest: 'qwen-plus' }
    })

    expect(await resolveModel('tagSuggest', 'x')).toBe('qwen-plus')
    expect(await resolveModel('inGame', 'x')).toBe('deepseek-v4.1-flash-1017')
  })

  it('should re-read config on every call so remote switches reach long-running clients', async () => {
    mockInvoke.mockResolvedValueOnce({ schemaVersion: 1, models: { default: 'old' } })
    mockInvoke.mockResolvedValueOnce({ schemaVersion: 1, models: { default: 'new' } })

    expect(await resolveModel('inGame', 'x')).toBe('old')
    expect(await resolveModel('inGame', 'x')).toBe('new')
    expect(mockInvoke).toHaveBeenCalledWith('get_ai_config')
  })

  it('should fall back to built-in model when IPC fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('ipc down'))
    expect(await resolveModel('inGame', 'builtin')).toBe('builtin')

    mockInvoke.mockResolvedValue({ schemaVersion: 1, models: { default: 'remote' } })
    expect(await resolveModel('inGame', 'builtin')).toBe('remote')
  })

  it('should ignore malformed config values', async () => {
    mockInvoke.mockResolvedValue({ models: { inGame: '', default: 42 } })
    expect(await resolveModel('inGame', 'builtin')).toBe('builtin')
  })
})
