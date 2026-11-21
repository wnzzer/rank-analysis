/**
 * 用户自己指定模型后的取值顺序：内置服务与自定义接入点各一套，
 * 以及设置页显示用的 explainModel 与 AI_SCENES 表。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  AI_SCENES,
  BUILTIN_DEFAULT_MODEL,
  explainModel,
  loadAiModels,
  loadModelSettings,
  pickModel,
  resolveModel,
  saveModelOverride
} from '../modelConfig'
import { STAGE2_MODEL } from '../matchDetail/critique'
import { REBUTTAL_MODEL } from '../review/rebuttal'
import { DEFAULT_MODEL } from '../stream'

const store = vi.hoisted(() => ({ config: new Map<string, unknown>() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }))
vi.mock('../../ipc', () => ({
  getConfigByIpc: async (k: string) => store.config.get(k),
  putConfigByIpc: async (k: string, v: unknown) => void store.config.set(k, v)
}))

const mockInvoke = invoke as ReturnType<typeof vi.fn>

/** 远程配置：有默认模型，标签建议与标注反驳各有专门的模型 */
const REMOTE = { default: 'remote-default', tagSuggest: 'remote-tag', labelRebuttal: 'remote-reb' }

beforeEach(() => {
  store.config.clear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string) =>
    cmd === 'check_claude_region'
      ? { country: 'CN', allowed: false, error: null }
      : { schemaVersion: 1, models: REMOTE }
  )
})

describe('pickModel · 内置服务', () => {
  it('没改过：远程的该功能 > 远程 default > 代码内置值', () => {
    expect(pickModel('dashscope', 'tagSuggest', {}, REMOTE, 'fb')).toEqual({
      model: 'remote-tag',
      source: 'recommended'
    })
    expect(pickModel('dashscope', 'inGame', {}, REMOTE, 'fb')).toEqual({
      model: 'remote-default',
      source: 'recommended'
    })
    expect(pickModel('dashscope', 'inGame', {}, undefined, 'fb')).toEqual({
      model: 'fb',
      source: 'recommended'
    })
  })

  it('sceneOnly：远程没有该功能的条目时跳过远程 default', () => {
    expect(pickModel('dashscope', 'labelRebuttal', {}, { default: 'd' }, 'fb', true).model).toBe(
      'fb'
    )
    expect(pickModel('dashscope', 'labelRebuttal', {}, REMOTE, 'fb', true).model).toBe('remote-reb')
  })

  it('用户改了默认模型：压过远程（包括远程给该功能专门配的）', () => {
    const overrides = { default: 'my-default' }
    expect(pickModel('dashscope', 'inGame', overrides, REMOTE, 'fb')).toEqual({
      model: 'my-default',
      source: 'default'
    })
    expect(pickModel('dashscope', 'tagSuggest', overrides, REMOTE, 'fb').model).toBe('my-default')
    expect(pickModel('dashscope', 'labelRebuttal', overrides, REMOTE, 'fb', true).model).toBe(
      'my-default'
    )
  })

  it('用户给功能单独指定的优先级最高', () => {
    const overrides = { default: 'my-default', inGame: 'my-ingame' }
    expect(pickModel('dashscope', 'inGame', overrides, REMOTE, 'fb')).toEqual({
      model: 'my-ingame',
      source: 'scene'
    })
    expect(pickModel('dashscope', 'champSelect', overrides, REMOTE, 'fb').model).toBe('my-default')
  })

  it('空白值等于没填', () => {
    expect(
      pickModel('dashscope', 'inGame', { inGame: '  ', default: '' }, REMOTE, 'fb').model
    ).toBe('remote-default')
  })
})

describe('pickModel · 自定义接入点', () => {
  it('不读远程配置、不用代码内置值：那些模型名别家没有', () => {
    expect(pickModel('custom', 'tagSuggest', {}, REMOTE, 'fb')).toEqual({
      model: '',
      source: 'default'
    })
  })

  it('功能单独指定 > 默认模型', () => {
    const overrides = { default: 'gpt-x', matchSearch: 'gpt-mini' }
    expect(pickModel('custom', 'matchSearch', overrides, REMOTE, 'fb')).toEqual({
      model: 'gpt-mini',
      source: 'scene'
    })
    expect(pickModel('custom', 'inGame', overrides, REMOTE, 'fb')).toEqual({
      model: 'gpt-x',
      source: 'default'
    })
  })
})

describe('resolveModel 读用户的设置', () => {
  it('内置服务：用户的覆盖生效，没改的继续跟远程', async () => {
    store.config.set('aiModels', { dashscope: { inGame: 'my-ingame' }, custom: { default: 'x' } })
    expect(await resolveModel('inGame', 'fb')).toBe('my-ingame')
    expect(await resolveModel('tagSuggest', 'fb')).toBe('remote-tag')
  })

  it('自定义接入点：只用 custom 那一边的填写', async () => {
    store.config.set('aiProvider', 'custom')
    store.config.set('aiModels', {
      dashscope: { default: 'ds-only' },
      custom: { default: 'gpt-x', tagSuggest: 'gpt-mini' }
    })
    expect(await resolveModel('inGame', 'fb')).toBe('gpt-x')
    expect(await resolveModel('tagSuggest', 'fb')).toBe('gpt-mini')
    expect(await resolveModel('labelRebuttal', 'qwen4-max', { sceneOnly: true })).toBe('gpt-x')
  })

  it('自定义接入点没填默认模型：返回空串，由 stream.ts 报「请先填写」', async () => {
    store.config.set('aiProvider', 'custom')
    expect(await resolveModel('inGame', 'fb')).toBe('')
  })

  it('Claude 地区不可用：回落到内置服务的取值（含用户在内置下的覆盖）', async () => {
    store.config.set('aiProvider', 'claude')
    store.config.set('aiModels', { dashscope: { default: 'my-default' } })
    expect(await resolveModel('inGame', 'fb')).toBe('my-default')
  })

  it('存储里的东西形状不对：当作没改过', async () => {
    for (const junk of ['oops', 42, ['a'], { dashscope: 'nope', custom: [1] }, null]) {
      store.config.set('aiModels', junk)
      expect(await resolveModel('inGame', 'fb')).toBe('remote-default')
    }
  })
})

describe('saveModelOverride', () => {
  it('只存改过的值；清空即删除；两边互不影响', async () => {
    await saveModelOverride('dashscope', 'default', ' my-default ')
    await saveModelOverride('custom', 'inGame', 'gpt-x')
    expect(store.config.get('aiModels')).toEqual({
      dashscope: { default: 'my-default' },
      custom: { inGame: 'gpt-x' }
    })

    const after = await saveModelOverride('dashscope', 'default', '  ')
    expect(after).toEqual({ dashscope: {}, custom: { inGame: 'gpt-x' } })
    expect(await loadAiModels()).toEqual(after)
  })
})

describe('设置页的显示', () => {
  it('explainModel 与实际发请求用的模型一致', async () => {
    store.config.set('aiModels', { dashscope: { champSelect: 'my-cs' } })
    const settings = await loadModelSettings()
    expect(settings.recommendedDefault).toBe('remote-default')
    for (const scene of AI_SCENES) {
      const shown = explainModel(scene, 'dashscope', settings).model
      const used = await resolveModel(scene.key, scene.fallback, { sceneOnly: scene.sceneOnly })
      expect(shown, scene.key).toBe(used)
    }
  })

  it('远程配置拉不到时推荐默认模型是代码内置值', async () => {
    mockInvoke.mockRejectedValue(new Error('ipc down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await loadModelSettings()).recommendedDefault).toBe(BUILTIN_DEFAULT_MODEL)
  })

  it('AI_SCENES 的内置值与各功能代码里传给 resolveModel 的一致', () => {
    // 表里的值只用于显示，真正调用处各自传 fallback；两边漂移会让设置页说一套、实际做一套
    const fallback = (key: string) => AI_SCENES.find(s => s.key === key)?.fallback
    expect(DEFAULT_MODEL).toBe(BUILTIN_DEFAULT_MODEL)
    expect(fallback('matchCritique')).toBe(STAGE2_MODEL)
    expect(fallback('inGame')).toBe(DEFAULT_MODEL)
    expect(fallback('champSelect')).toBe(DEFAULT_MODEL)
    expect(fallback('matchSearch')).toBe(DEFAULT_MODEL)
    expect(fallback('labelRebuttal')).toBe(REBUTTAL_MODEL)
    expect(AI_SCENES.find(s => s.key === 'labelRebuttal')?.sceneOnly).toBe(true)
  })
})
