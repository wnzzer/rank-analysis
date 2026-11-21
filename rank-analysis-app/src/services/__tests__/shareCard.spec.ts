import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_ATTEMPTS, writeImageWithRetry } from '@renderer/services/shareCard'

const writeImage = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeImage }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('modern-screenshot', () => ({ domToBlob: vi.fn() }))

describe('writeImageWithRetry', () => {
  const png = new Uint8Array([1, 2, 3])

  beforeEach(() => {
    vi.useFakeTimers()
    writeImage.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should write once when the clipboard is free', async () => {
    writeImage.mockResolvedValue(undefined)

    await writeImageWithRetry(png)

    expect(writeImage).toHaveBeenCalledTimes(1)
    expect(writeImage).toHaveBeenCalledWith(png)
  })

  it('should retry after a transient clipboard failure', async () => {
    writeImage.mockRejectedValueOnce('os error 1418').mockResolvedValue(undefined)

    const done = writeImageWithRetry(png)
    await vi.runAllTimersAsync()
    await done

    expect(writeImage).toHaveBeenCalledTimes(2)
  })

  it('should give up with the last error after all attempts fail', async () => {
    writeImage.mockRejectedValue('clipboard occupied')

    const done = writeImageWithRetry(png)
    const settled = expect(done).rejects.toBe('clipboard occupied')
    await vi.runAllTimersAsync()
    await settled

    expect(writeImage).toHaveBeenCalledTimes(CLIPBOARD_ATTEMPTS)
  })
})
