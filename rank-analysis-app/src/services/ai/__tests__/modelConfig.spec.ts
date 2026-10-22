import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc } from '../../ipc'
import { DEFAULT_CLAUDE_MODEL, prewarmAi, resolveModel } from '../modelConfig'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../ipc', () => ({ getConfigByIpc: vi.fn() }))

const mockInvoke = invoke as ReturnType<typeof vi.fn>
const mockGetConfig = getConfigByIpc as ReturnType<typeof vi.fn>

describe('resolveModel', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockGetConfig.mockReset()
    mockGetConfig.mockResolvedValue(undefined)
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

describe('resolveModel with Claude provider', () => {
  const config = {
    schemaVersion: 1,
    models: { default: 'deepseek-v4.1-flash-1017' },
    claudeModels: { default: 'claude-opus-5-5', tagSuggest: 'claude-haiku-5-5' }
  }

  /** get_ai_config 返回 cfg，check_claude_region 返回 region */
  const mockIpc = (cfg: unknown, region: { allowed: boolean }) =>
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'check_claude_region' ? { country: 'US', error: null, ...region } : cfg
    )

  beforeEach(() => {
    mockInvoke.mockReset()
    mockGetConfig.mockReset()
    mockGetConfig.mockResolvedValue('claude')
  })

  it('should use claudeModels when provider is claude and region allowed', async () => {
    mockIpc(config, { allowed: true })
    expect(await resolveModel('inGame', 'x')).toBe('claude-opus-5-5')
    expect(await resolveModel('tagSuggest', 'x')).toBe('claude-haiku-5-5')
  })

  it('should fall back to DashScope when region is not allowed', async () => {
    mockIpc(config, { allowed: false })
    expect(await resolveModel('inGame', 'x')).toBe('deepseek-v4.1-flash-1017')
  })

  it('should use built-in Claude model when manifest has no claudeModels', async () => {
    mockIpc({ schemaVersion: 1, models: { default: 'ds' } }, { allowed: true })
    expect(await resolveModel('inGame', 'x')).toBe(DEFAULT_CLAUDE_MODEL)
  })

  it('should reject non-claude names in claudeModels', async () => {
    mockIpc({ ...config, claudeModels: { default: 'qwen-plus' } }, { allowed: true })
    expect(await resolveModel('inGame', 'x')).toBe(DEFAULT_CLAUDE_MODEL)
  })

  it('should not call region check when provider is dashscope', async () => {
    mockGetConfig.mockResolvedValue('dashscope')
    mockIpc(config, { allowed: true })
    expect(await resolveModel('inGame', 'x')).toBe('deepseek-v4.1-flash-1017')
    expect(mockInvoke).not.toHaveBeenCalledWith('check_claude_region', expect.anything())
  })
})

describe('prewarmAi', () => {
  const flush = () => new Promise(r => setTimeout(r, 0))

  beforeEach(() => {
    mockInvoke.mockReset()
    mockGetConfig.mockReset()
  })

  it('should warm relay connection only when provider is claude', async () => {
    mockGetConfig.mockResolvedValue('claude')
    mockInvoke.mockResolvedValue(undefined)
    prewarmAi()
    await flush()
    expect(mockInvoke).toHaveBeenCalledWith('prewarm_claude_relay')

    mockInvoke.mockReset()
    mockGetConfig.mockResolvedValue('dashscope')
    prewarmAi()
    await flush()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('should swallow failures', async () => {
    mockGetConfig.mockResolvedValue('claude')
    mockInvoke.mockRejectedValue(new Error('relay down'))
    expect(() => prewarmAi()).not.toThrow()
    await flush()
  })
})
