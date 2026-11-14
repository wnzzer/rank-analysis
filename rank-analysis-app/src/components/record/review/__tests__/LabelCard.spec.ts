/**
 * LabelCard：选中 / 取消、提交门槛、提交前不剧透模型、首次同意询问、对比文案、上传失败、恢复已标注。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { MatchLabel } from '@renderer/services/matchLabel'
import LabelCard from '../LabelCard.vue'
import { modelB } from './fixtureModels'

const ipc = vi.hoisted(() => ({ config: new Map<string, unknown>() }))
const api = vi.hoisted(() => ({
  saved: null as MatchLabel | null,
  save: vi.fn(),
  retry: vi.fn()
}))

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '9.9.9' }))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: async (k: string) => ipc.config.get(k),
  putConfigByIpc: async (k: string, v: unknown) => void ipc.config.set(k, v)
}))
vi.mock('@renderer/services/matchLabel', async importActual => ({
  ...(await importActual<typeof import('@renderer/services/matchLabel')>()),
  getMatchLabel: async () => api.saved,
  saveMatchLabel: api.save,
  retryMatchLabelUploads: api.retry
}))

const model = modelB()
const players = Object.values(model.players).sort((a, b) => a.participantId - b.participantId)

function mountCard() {
  return mount(LabelCard, {
    attachTo: document.body,
    props: { players, gameId: 42, platform: 'TJ100', queueId: 420 }
  })
}

beforeEach(() => {
  ipc.config.clear()
  api.saved = null
  api.save.mockReset().mockResolvedValue({ uploaded: true, error: null })
  api.retry.mockReset().mockResolvedValue(0)
  document.body.innerHTML = ''
})

const submitBtn = (w: ReturnType<typeof mountCard>) => w.get('[data-test="label-submit"]')
const keyPid = players[0].participantId
const blamePid = players[9].participantId

describe('LabelCard', () => {
  it('没选任何人时不能提交；提交前不显示模型结论', async () => {
    const w = mountCard()
    await flushPromises()
    expect(submitBtn(w).attributes('disabled')).toBeDefined()
    expect(w.text()).not.toContain('模型')
  })

  it('点头像选中，再点同一人取消', async () => {
    const w = mountCard()
    await flushPromises()
    const btn = w.get(`[data-test="pick-key-${keyPid}"]`)
    await btn.trigger('click')
    expect(btn.attributes('aria-pressed')).toBe('true')
    expect(submitBtn(w).attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(btn.attributes('aria-pressed')).toBe('false')
  })

  it('首次提交先问是否分享；选「只保存在本地」→ 不上传并记住选择', async () => {
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-blame-${blamePid}"]`).trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('分享你的判断，帮助改进评分？')
    expect(api.save).not.toHaveBeenCalled()
    const local = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent?.includes('只保存在本地')
    )!
    local.click()
    await flushPromises()
    expect(ipc.config.get('matchLabelShare')).toBe(false)
    expect(api.save).toHaveBeenCalledTimes(1)
    const [label, share] = api.save.mock.calls[0]
    expect(share).toBe(false)
    expect(label.keyPick).toBeNull()
    expect(label.blamePick.slot).toBe(blamePid)
    expect(label.modelVersion).toMatch(/@9\.9\.9$/)
    expect(JSON.stringify(label)).not.toMatch(/puuid|"name"/)
    expect(w.get('[data-test="label-share"]').text()).toContain('仅保存在本地')
  })

  it('已同意分享：直接上传，提交后显示你 vs 模型', async () => {
    ipc.config.set('matchLabelShare', true)
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-key-${keyPid}"]`).trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(api.save.mock.calls[0][1]).toBe(true)
    expect(w.find('[data-test="result-key"]').text()).toMatch(/模型(也选了|选的是)/)
    expect(w.find('[data-test="result-blame"]').exists()).toBe(false)
    expect(w.get('[data-test="label-share"]').text()).toContain('已分享')
  })

  it('上传失败：照常显示对比，提示已存本地', async () => {
    ipc.config.set('matchLabelShare', true)
    api.save.mockResolvedValue({ uploaded: false, error: '云端连接失败' })
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-key-${keyPid}"]`).trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(w.find('[data-test="result-key"]').exists()).toBe(true)
    expect(w.get('[data-test="label-share"]').text()).toContain('分享失败，已保存在本地')
  })

  it('打开已标注过的对局：直接显示结果，未上传的会补传；「修改」回到编辑并保留选择', async () => {
    ipc.config.set('matchLabelShare', true)
    api.retry.mockResolvedValue(1)
    api.saved = {
      gameId: 42,
      platform: 'TJ100',
      queueId: 420,
      keyPick: null,
      blamePick: { slot: blamePid, teamId: 200, championId: 1, position: '' },
      labelerSide: null,
      model: null,
      modelVersion: 'x',
      uploaded: false
    }
    const w = mountCard()
    await flushPromises()
    expect(api.retry).toHaveBeenCalledTimes(1)
    expect(w.find('[data-test="result-blame"]').exists()).toBe(true)
    expect(w.get('[data-test="label-share"]').text()).toContain('已分享')
    await w.get('[data-test="label-edit"]').trigger('click')
    expect(w.get(`[data-test="pick-blame-${blamePid}"]`).attributes('aria-pressed')).toBe('true')
  })
})
