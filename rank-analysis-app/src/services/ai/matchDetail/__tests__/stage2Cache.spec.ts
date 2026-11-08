/**
 * Stage 2 markdown 持久缓存：跨窗口命中（新模块实例 + 同一 localStorage）、LRU 上限淘汰、
 * 坏条目/配额错误降级为无缓存。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readStage2Cache,
  writeStage2Cache,
  STAGE2_CACHE_LIMIT,
  STAGE2_CACHE_PREFIX
} from '../stage2Cache'

const KEY = 'ai_match_detail_stage2_12345_ranked'
const storedKeys = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '').filter(k =>
    k.startsWith(STAGE2_CACHE_PREFIX)
  )

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('stage2Cache', () => {
  it('写入为带版本前缀的 JSON {v, t, markdown}', () => {
    writeStage2Cache(KEY, '## 定论')
    const raw = localStorage.getItem(STAGE2_CACHE_PREFIX + KEY)
    expect(JSON.parse(raw!)).toEqual({ v: 1, t: 1_000_000, markdown: '## 定论' })
    expect(readStage2Cache(KEY)).toBe('## 定论')
  })

  it('跨窗口命中：新模块实例读同一 localStorage', async () => {
    writeStage2Cache(KEY, '上个窗口的点评')
    vi.resetModules()
    const fresh = await import('../stage2Cache')
    expect(fresh.readStage2Cache(KEY)).toBe('上个窗口的点评')
  })

  it('超过上限按最近访问淘汰最久未用的条目', () => {
    for (let i = 0; i < STAGE2_CACHE_LIMIT; i++) {
      vi.setSystemTime(1_000_000 + i)
      writeStage2Cache(`k${i}`, `m${i}`)
    }
    // 读一次 k0：刷新访问时间，不再是最旧
    vi.setSystemTime(2_000_000)
    expect(readStage2Cache('k0')).toBe('m0')
    vi.setSystemTime(2_000_001)
    writeStage2Cache('new', 'm-new')
    expect(storedKeys()).toHaveLength(STAGE2_CACHE_LIMIT)
    expect(readStage2Cache('k1')).toBeNull()
    expect(readStage2Cache('k0')).toBe('m0')
    expect(readStage2Cache('new')).toBe('m-new')
  })

  it.each([
    ['非 JSON', 'not json{'],
    ['版本不符', JSON.stringify({ v: 0, t: 1, markdown: 'x' })],
    ['缺 markdown', JSON.stringify({ v: 1, t: 1 })],
    ['markdown 非字符串', JSON.stringify({ v: 1, t: 1, markdown: 42 })]
  ])('坏条目（%s）视为未命中', (_name, raw) => {
    localStorage.setItem(STAGE2_CACHE_PREFIX + KEY, raw)
    expect(readStage2Cache(KEY)).toBeNull()
  })

  it('坏条目不阻碍淘汰，且优先被清掉', () => {
    localStorage.setItem(STAGE2_CACHE_PREFIX + 'broken', '{oops')
    for (let i = 0; i < STAGE2_CACHE_LIMIT; i++) {
      vi.setSystemTime(1_000_000 + i)
      writeStage2Cache(`k${i}`, `m${i}`)
    }
    expect(localStorage.getItem(STAGE2_CACHE_PREFIX + 'broken')).toBeNull()
    expect(storedKeys()).toHaveLength(STAGE2_CACHE_LIMIT)
    expect(readStage2Cache('k0')).toBe('m0')
  })

  it('不动其他前缀的 localStorage 键', () => {
    localStorage.setItem('match-detail:1', '{}')
    for (let i = 0; i <= STAGE2_CACHE_LIMIT; i++) writeStage2Cache(`k${i}`, 'm')
    expect(localStorage.getItem('match-detail:1')).toBe('{}')
  })

  it('配额错误：写入静默失败，读取降级为无缓存', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => writeStage2Cache(KEY, 'x')).not.toThrow()
    vi.restoreAllMocks()
    expect(readStage2Cache(KEY)).toBeNull()
  })

  it('配额错误时先淘汰一半旧条目再重试一次', () => {
    for (let i = 0; i < STAGE2_CACHE_LIMIT; i++) {
      vi.setSystemTime(1_000_000 + i)
      writeStage2Cache(`k${i}`, `m${i}`)
    }
    vi.setSystemTime(2_000_000)
    const real = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string
    ) {
      if (!failed && k === STAGE2_CACHE_PREFIX + KEY) {
        failed = true
        throw new DOMException('full', 'QuotaExceededError')
      }
      real.call(this, k, v)
    })
    writeStage2Cache(KEY, '新内容')
    vi.restoreAllMocks()
    expect(readStage2Cache(KEY)).toBe('新内容')
    expect(readStage2Cache('k0')).toBeNull()
    expect(readStage2Cache(`k${STAGE2_CACHE_LIMIT - 1}`)).toBe(`m${STAGE2_CACHE_LIMIT - 1}`)
    expect(storedKeys()).toHaveLength(STAGE2_CACHE_LIMIT / 2 + 1)
  })

  it('读取时 localStorage 抛错：返回 null 不抛', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readStage2Cache(KEY)).toBeNull()
  })
})
