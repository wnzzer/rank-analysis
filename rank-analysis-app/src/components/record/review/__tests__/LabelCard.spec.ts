/**
 * LabelCard：选中 / 取消、提交门槛、提交前不剧透模型、首次同意询问、对比文案、上传失败、恢复已标注，
 * 以及与模型有分歧时的 AI 回应（触发时机、入口、保存、重试、修改后是否重调）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { modelPicks, type MatchLabel } from '@renderer/services/matchLabel'
import LabelCard from '../LabelCard.vue'
import { modelB } from './fixtureModels'

const ipc = vi.hoisted(() => ({ config: new Map<string, unknown>() }))
const api = vi.hoisted(() => ({
  saved: null as MatchLabel | null,
  save: vi.fn(),
  retry: vi.fn(),
  rebut: vi.fn()
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

vi.mock('@renderer/services/ai/review/rebuttal', async importActual => ({
  ...(await importActual<typeof import('@renderer/services/ai/review/rebuttal')>()),
  requestRebuttal: api.rebut
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
  api.rebut.mockReset().mockResolvedValue({
    stance: 'concede',
    category: 'absence',
    reply: '你说的单带不参团，评分确实没算。',
    model: 'test-model'
  })
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

  it('可选说明：去首尾空白后随标注提交，提交后显示；不填为 null', async () => {
    ipc.config.set('matchLabelShare', true)
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-key-${keyPid}"]`).trigger('click')
    await w.get('[data-test="label-note"] textarea').setValue('  下路被克制  ')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(api.save.mock.calls[0][0].note).toBe('下路被克制')
    expect(w.get('[data-test="label-note-done"]').text()).toContain('下路被克制')
  })

  it('不填说明时 note 为 null', async () => {
    ipc.config.set('matchLabelShare', true)
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-key-${keyPid}"]`).trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(api.save.mock.calls[0][0].note).toBeNull()
    expect(w.find('[data-test="label-note-done"]').exists()).toBe(false)
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

  it('进入已提交状态时发 done：提交后发一次，恢复已标注也发（战报据此揭晓战报图）', async () => {
    ipc.config.set('matchLabelShare', true)
    const w = mountCard()
    await flushPromises()
    expect(w.emitted('done')).toBeUndefined()
    await w.get(`[data-test="pick-key-${keyPid}"]`).trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(w.emitted('done')).toHaveLength(1)

    api.saved = {
      gameId: 42,
      keyPick: null,
      blamePick: null,
      uploaded: true
    } as unknown as MatchLabel
    const restored = mountCard()
    await flushPromises()
    expect(restored.emitted('done')).toHaveLength(1)
  })
})

describe('LabelCard · AI 回应', () => {
  const agreed = modelPicks(players)
  /** 模型没选作最犯罪的人：选他就是分歧 */
  const disputed = players.find(p => p.participantId !== agreed.blamePid)!.participantId

  /** 选最犯罪、填说明、提交（已同意分享） */
  async function submitBlame(pid: number, reason = '') {
    ipc.config.set('matchLabelShare', true)
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-blame-${pid}"]`).trigger('click')
    if (reason) await w.get('[data-test="label-note"] textarea').setValue(reason)
    await submitBtn(w).trigger('click')
    await flushPromises()
    return w
  }

  it('should not involve the AI when the player agrees with the model', async () => {
    const w = await submitBlame(agreed.blamePid!, '他全程单带不参团')

    expect(api.rebut).not.toHaveBeenCalled()
    expect(w.find('[data-test="rebuttal"]').exists()).toBe(false)
    expect(w.find('[data-test="label-rebut"]').exists()).toBe(false)
  })

  it('should ask the AI automatically on a dispute with a reason, then save the reply', async () => {
    const w = await submitBlame(disputed, '他全程单带不参团')

    expect(api.rebut).toHaveBeenCalledTimes(1)
    const [disputes, , reason] = api.rebut.mock.calls[0]
    expect(disputes).toHaveLength(1)
    expect(disputes[0].kind).toBe('blame')
    expect(reason).toBe('他全程单带不参团')
    expect(w.get('[data-test="rebuttal-text"]').text()).toBe('你说的单带不参团，评分确实没算。')
    // 先存标注，回应回来后带着回应再存一次
    expect(api.save).toHaveBeenCalledTimes(2)
    expect(api.save.mock.calls[0][0].rebuttal).toBeNull()
    expect(api.save.mock.calls[1][0].rebuttal).toMatchObject({
      stance: 'concede',
      category: 'absence',
      verdict: null,
      model: 'test-model'
    })
    expect(api.save.mock.calls[1][1]).toBe(true)
  })

  it('should show the label result while the AI is still thinking', async () => {
    let finish: (v: unknown) => void = () => {}
    api.rebut.mockReturnValue(new Promise(r => (finish = r)))

    const w = await submitBlame(disputed, '他全程单带不参团')

    expect(w.find('[data-test="result-blame"]').exists()).toBe(true)
    expect(w.find('[data-test="rebuttal-loading"]').exists()).toBe(true)
    finish({ stance: 'hold', category: 'other', reply: '这火我懂。', model: 'm' })
    await flushPromises()
    expect(w.get('[data-test="rebuttal-text"]').text()).toBe('这火我懂。')
  })

  it('should offer an entry to add a reason when there is a dispute without one', async () => {
    const w = await submitBlame(disputed)

    expect(api.rebut).not.toHaveBeenCalled()
    const entry = w.get('[data-test="label-rebut"]')
    expect(entry.text()).toContain('不服？说说理由')

    await entry.trigger('click')
    await flushPromises()
    // 回到编辑态，可以补理由
    expect(w.find('[data-test="label-note"]').exists()).toBe(true)

    await w.get('[data-test="label-note"] textarea').setValue('他全程单带不参团')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(api.rebut).toHaveBeenCalledTimes(1)
  })

  it('should not call the AI for a reason shorter than four characters', async () => {
    const w = await submitBlame(disputed, '他菜')

    expect(api.rebut).not.toHaveBeenCalled()
    expect(w.get('[data-test="label-rebut"]').text()).toContain('不服？说说理由')
  })

  it('should not call the AI again when nothing changed on resubmit', async () => {
    const w = await submitBlame(disputed, '他全程单带不参团')

    await w.get('[data-test="label-edit"]').trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()

    expect(api.rebut).toHaveBeenCalledTimes(1)
    expect(w.find('[data-test="rebuttal-text"]').exists()).toBe(true)
  })

  it('should call the AI again when the reason changed', async () => {
    const w = await submitBlame(disputed, '他全程单带不参团')

    await w.get('[data-test="label-edit"]').trigger('click')
    await w.get('[data-test="label-note"] textarea').setValue('他一直在送人头')
    await submitBtn(w).trigger('click')
    await flushPromises()

    expect(api.rebut).toHaveBeenCalledTimes(2)
    expect(api.rebut.mock.calls[1][2]).toBe('他一直在送人头')
  })

  it('should drop the reply when the player changes the pick to agree with the model', async () => {
    const w = await submitBlame(disputed, '他全程单带不参团')

    await w.get('[data-test="label-edit"]').trigger('click')
    await w.get(`[data-test="pick-blame-${agreed.blamePid}"]`).trigger('click')
    await submitBtn(w).trigger('click')
    await flushPromises()

    expect(w.find('[data-test="rebuttal"]').exists()).toBe(false)
    expect(api.save.mock.calls.at(-1)![0].rebuttal).toBeNull()
  })

  it('should offer a retry when the AI call fails, without touching the saved label', async () => {
    api.rebut.mockRejectedValueOnce(new Error('网络错误'))
    const w = await submitBlame(disputed, '他全程单带不参团')

    expect(w.find('[data-test="rebuttal-failed"]').exists()).toBe(true)
    expect(api.save).toHaveBeenCalledTimes(1)

    await w.get('[data-test="rebuttal-retry"]').trigger('click')
    await flushPromises()

    expect(api.rebut).toHaveBeenCalledTimes(2)
    expect(w.find('[data-test="rebuttal-text"]').exists()).toBe(true)
  })

  it('should discard a late reply after the player goes back to editing', async () => {
    let finish: (v: unknown) => void = () => {}
    api.rebut.mockReturnValue(new Promise(r => (finish = r)))
    const w = await submitBlame(disputed, '他全程单带不参团')

    await w.get('[data-test="label-edit"]').trigger('click')
    finish({ stance: 'hold', category: 'other', reply: '迟到的回复', model: 'm' })
    await flushPromises()

    expect(w.text()).not.toContain('迟到的回复')
    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it('should save the verdict the player clicks and allow switching', async () => {
    const w = await submitBlame(disputed, '他全程单带不参团')
    api.save.mockClear()

    await w.get('[data-test="rebuttal-unconvinced"]').trigger('click')
    await flushPromises()
    expect(api.save.mock.calls[0][0].rebuttal.verdict).toBe('unconvinced')

    await w.get('[data-test="rebuttal-convinced"]').trigger('click')
    await flushPromises()
    expect(api.save.mock.calls[1][0].rebuttal.verdict).toBe('convinced')

    // 再点同一个不重复保存
    await w.get('[data-test="rebuttal-convinced"]').trigger('click')
    await flushPromises()
    expect(api.save).toHaveBeenCalledTimes(2)
  })

  /** 选最犯罪、填说明、提交；首次询问时选「只保存在本地」 */
  async function submitLocalOnly(pid: number, reason: string) {
    ipc.config.set('matchLabelShare', false)
    api.save.mockResolvedValue({ uploaded: false, error: null })
    const w = mountCard()
    await flushPromises()
    await w.get(`[data-test="pick-blame-${pid}"]`).trigger('click')
    await w.get('[data-test="label-note"] textarea').setValue(reason)
    await submitBtn(w).trigger('click')
    await flushPromises()
    return w
  }

  it('should confirm the feedback was uploaded when the player shares', async () => {
    const w = await submitBlame(disputed, '他全程单带不参团')

    expect(w.get('[data-test="rebuttal-feedback"]').text()).toContain('已反馈成功')
  })

  it('should not claim an upload for a player who keeps labels local', async () => {
    const w = await submitLocalOnly(disputed, '他全程单带不参团')

    expect(w.get('[data-test="rebuttal-not-uploaded"]').text()).toContain('只存在你的电脑上')
    expect(w.text()).not.toContain('已反馈成功')
  })

  it('should upload and turn sharing on when the player clicks upload feedback', async () => {
    const w = await submitLocalOnly(disputed, '他全程单带不参团')
    api.save.mockClear().mockResolvedValue({ uploaded: true, error: null })

    await w.get('[data-test="rebuttal-share"]').trigger('click')
    await flushPromises()

    expect(ipc.config.get('matchLabelShare')).toBe(true)
    expect(api.save).toHaveBeenCalledTimes(1)
    const [label, share] = api.save.mock.calls[0]
    expect(share).toBe(true)
    expect(label.rebuttal).toMatchObject({ stance: 'concede', category: 'absence' })
    expect(w.get('[data-test="rebuttal-feedback"]').text()).toContain('已反馈成功')
  })

  it('should not show success when the upload fails, and let the player retry', async () => {
    const w = await submitLocalOnly(disputed, '他全程单带不参团')
    api.save.mockClear().mockResolvedValue({ uploaded: false, error: '网络错误' })

    await w.get('[data-test="rebuttal-share"]').trigger('click')
    await flushPromises()

    expect(w.text()).not.toContain('已反馈成功')
    expect(w.get('[data-test="rebuttal-not-uploaded"]').text()).toContain('上传没成功')

    api.save.mockResolvedValue({ uploaded: true, error: null })
    await w.get('[data-test="rebuttal-share"]').trigger('click')
    await flushPromises()

    expect(w.get('[data-test="rebuttal-feedback"]').text()).toContain('已反馈成功')
  })

  it('should not show success when saving throws', async () => {
    const w = await submitLocalOnly(disputed, '他全程单带不参团')
    api.save.mockClear().mockRejectedValue(new Error('disk full'))

    await w.get('[data-test="rebuttal-share"]').trigger('click')
    await flushPromises()

    expect(w.text()).not.toContain('已反馈成功')
    expect(w.get('[data-test="rebuttal-share"]').text()).toBe('重试上传')
  })

  it('should restore a saved reply without calling the AI', async () => {
    const blame = players.find(p => p.participantId === disputed)!
    api.saved = {
      gameId: 42,
      platform: 'TJ100',
      queueId: 420,
      keyPick: null,
      blamePick: {
        slot: blame.participantId,
        teamId: blame.teamId,
        championId: blame.championId,
        position: blame.position
      },
      labelerSide: 'lose',
      note: '他全程单带不参团',
      model: null,
      modelVersion: 'x',
      rebuttal: {
        stance: 'partial',
        category: 'absence',
        reply: '存下来的回复',
        verdict: 'unconvinced',
        model: 'm',
        basis: `|${blame.participantId}|他全程单带不参团`
      }
    }

    const w = mountCard()
    await flushPromises()

    expect(api.rebut).not.toHaveBeenCalled()
    expect(w.get('[data-test="rebuttal-text"]').text()).toBe('存下来的回复')
    expect(w.get('[data-test="rebuttal-unconvinced"]').classes()).toContain('is-picked')
  })

  it('should let the player ask for a reply on a saved dispute that never got one', async () => {
    const blame = players.find(p => p.participantId === disputed)!
    api.saved = {
      gameId: 42,
      platform: 'TJ100',
      queueId: 420,
      keyPick: null,
      blamePick: {
        slot: blame.participantId,
        teamId: blame.teamId,
        championId: blame.championId,
        position: blame.position
      },
      labelerSide: 'lose',
      note: '他全程单带不参团',
      model: null,
      modelVersion: 'x'
    }
    const w = mountCard()
    await flushPromises()

    const entry = w.get('[data-test="label-rebut"]')
    expect(entry.text()).toContain('让 AI 回应你的理由')
    await entry.trigger('click')
    await flushPromises()

    expect(api.rebut).toHaveBeenCalledTimes(1)
    expect(w.find('[data-test="rebuttal-text"]').exists()).toBe(true)
  })
})
