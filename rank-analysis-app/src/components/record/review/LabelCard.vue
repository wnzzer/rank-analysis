<script setup lang="ts">
/**
 * 复盘页「你怎么看这局？」标注卡：玩家标注最关键 / 最犯罪的人，提交后显示与模型的对比。
 *
 * - 提交前不显示模型结论，避免先入为主；两项各自可选可不选，至少一项才可提交。
 * - 首次提交时询问是否匿名分享（配置键 matchLabelShare），之后按选择保存 / 上传。
 * - 上传失败照常显示对比，标注已存本地，下次打开复盘时补传。
 * - 与模型有分歧且写了理由时，提交后 AI 针对理由回应一次（不改判；见
 *   docs/superpowers/specs/2026-11-21-label-rebuttal-design.md）。有分歧但没写理由时给一个入口
 *   回去补。回应随标注保存，再次打开直接显示，不重新调用。
 * @property players - 本局 10 人（复盘视图模型）
 * @property gameId / platform / queueId - 对局标识
 * @emits done - 进入「已提交」状态（本次提交，或打开时恢复了已有标注）；战报据此揭晓战报图
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NModal } from 'naive-ui'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import {
  findDisputes,
  rebuttalBasis,
  requestRebuttal,
  shouldRebut
} from '@renderer/services/ai/review/rebuttal'
import RebuttalReply, { type RebuttalState } from './RebuttalReply.vue'
import {
  MATCH_LABEL_NOTE_MAX,
  MATCH_LABEL_SHARE_KEY,
  buildMatchLabel,
  compareText,
  currentModelVersion,
  getMatchLabel,
  retryMatchLabelUploads,
  saveMatchLabel,
  type MatchLabelRebuttal,
  type RebuttalVerdict
} from '@renderer/services/matchLabel'

const props = defineProps<{
  players: PlayerView[]
  gameId: number
  platform: string
  queueId: number
}>()

const emit = defineEmits<{ (e: 'done'): void }>()

type Kind = 'key' | 'blame'

const { getChampionUrl } = useAssetUrl()

/** 蓝方在左、红方在右 */
const blue = computed(() => props.players.filter(p => p.teamId === 100))
const red = computed(() => props.players.filter(p => p.teamId !== 100))

const picks = ref<Record<Kind, number | null>>({ key: null, blame: null })
/** 可选说明 */
const note = ref('')
const phase = ref<'edit' | 'done'>('edit')
const saving = ref(false)
/** 分享状态：shared = 已上传；local = 未同意分享；failed = 上传失败已存本地 */
const shareState = ref<'shared' | 'local' | 'failed'>('local')
const consentOpen = ref(false)
const saveError = ref<string | null>(null)

/** AI 对玩家理由的回应；没触发过为 null */
const rebuttal = ref<MatchLabelRebuttal | null>(null)
/** 回应区的状态；idle = 不显示回应区 */
const rebuttalState = ref<RebuttalState | 'idle'>('idle')
/** 正在上传反馈（玩家点了「上传反馈」） */
const sharingNow = ref(false)
/** 回应区里「反馈去向」一栏的状态，由标注的分享状态换算 */
const feedback = computed(() =>
  shareState.value === 'shared' ? 'uploaded' : shareState.value === 'failed' ? 'failed' : 'local'
)
/** 调用代际：玩家点「修改」或重新提交后递增，在途调用的迟到结果据此作废 */
let rebuttalSeq = 0
/** 说明输入框（从「不服？说说理由」入口回到编辑态时聚焦） */
const noteInput = ref<{ focus: () => void } | null>(null)

watch(phase, p => {
  if (p === 'done') emit('done')
})

const guess = computed(() => ({ keyPid: picks.value.key, blamePid: picks.value.blame }))
/** 玩家与模型的分歧（只在已提交状态下有意义） */
const disputes = computed(() => findDisputes(guess.value, props.players))
/** 理由够长，可以直接让 AI 回应 */
const canRebutNow = computed(() => shouldRebut(disputes.value, note.value))

const canSubmit = computed(() => picks.value.key !== null || picks.value.blame !== null)

const ROWS: Array<{ kind: Kind; title: string }> = [
  { kind: 'key', title: '最关键' },
  { kind: 'blame', title: '最犯罪' }
]

/** 点头像：选中；再点同一人取消 */
function toggle(kind: Kind, pid: number): void {
  picks.value[kind] = picks.value[kind] === pid ? null : pid
}

const byPid = (pid: number | null): PlayerView | undefined =>
  pid === null ? undefined : props.players.find(p => p.participantId === pid)

/** 提交后的对比行（只列选了的项） */
const results = computed(() =>
  ROWS.flatMap(({ kind, title }) => {
    const pid = picks.value[kind]
    const mine = byPid(pid)
    if (pid === null || !mine) return []
    return [{ kind, title, mine, ...compareText(kind, pid, props.players) }]
  })
)

/** 恢复已标注状态（打开过的对局）；同意分享且有未上传条目时顺带补传 */
onMounted(async () => {
  const saved = await getMatchLabel(props.gameId)
  if (!saved) return
  picks.value = { key: saved.keyPick?.slot ?? null, blame: saved.blamePick?.slot ?? null }
  note.value = saved.note ?? ''
  // 已有回应直接显示，不重新调用
  rebuttal.value = saved.rebuttal ?? null
  rebuttalState.value = rebuttal.value ? 'ready' : 'idle'
  phase.value = 'done'
  const share = await getConfigByIpc<boolean>(MATCH_LABEL_SHARE_KEY)
  if (share !== true) shareState.value = 'local'
  else if (saved.uploaded) shareState.value = 'shared'
  else shareState.value = (await retryMatchLabelUploads()) > 0 ? 'shared' : 'failed'
})

/** 点「提交」：首次先问是否分享 */
async function submit(): Promise<void> {
  if (!canSubmit.value || saving.value) return
  const share = await getConfigByIpc<boolean>(MATCH_LABEL_SHARE_KEY)
  if (share === undefined || share === null) {
    consentOpen.value = true
    return
  }
  await persist(share)
}

/** 同意询问的回答：记进配置后保存 */
async function answerConsent(share: boolean): Promise<void> {
  consentOpen.value = false
  await putConfigByIpc(MATCH_LABEL_SHARE_KEY, share)
  await persist(share)
}

/** 按当前的选择、说明与回应保存一次标注，并更新分享状态 */
async function saveCurrent(share: boolean): Promise<void> {
  const label = buildMatchLabel({
    players: props.players,
    gameId: props.gameId,
    platform: props.platform,
    queueId: props.queueId,
    keyPid: picks.value.key,
    blamePid: picks.value.blame,
    note: note.value,
    modelVersion: await currentModelVersion(),
    rebuttal: rebuttal.value
  })
  const r = await saveMatchLabel(label, share)
  shareState.value = !share ? 'local' : r.uploaded ? 'shared' : 'failed'
}

/** 玩家是否同意分享（没决定过按不分享） */
async function sharing(): Promise<boolean> {
  return (await getConfigByIpc<boolean>(MATCH_LABEL_SHARE_KEY)) === true
}

async function persist(share: boolean): Promise<void> {
  saving.value = true
  saveError.value = null
  // 选择和说明都没变：上一次的回应仍然对得上，留着；变了就作废
  const basis = rebuttalBasis(guess.value, note.value)
  if (rebuttal.value?.basis !== basis) {
    rebuttal.value = null
    rebuttalState.value = 'idle'
  }
  try {
    await saveCurrent(share)
    phase.value = 'done'
  } catch (e) {
    saveError.value = `保存失败：${String(e)}`
    return
  } finally {
    saving.value = false
  }
  if (!rebuttal.value && canRebutNow.value) void runRebuttal()
}

/**
 * 让 AI 回应一次，成功后把回应写回标注。
 *
 * 标注本身已经存好了：这里失败只影响回应，不影响标注。
 */
async function runRebuttal(): Promise<void> {
  const seq = ++rebuttalSeq
  const basis = rebuttalBasis(guess.value, note.value)
  rebuttalState.value = 'loading'
  try {
    const r = await requestRebuttal(disputes.value, props.players, note.value)
    if (seq !== rebuttalSeq) return // 玩家已经点了「修改」或重新提交
    rebuttal.value = { ...r, verdict: null, basis }
    rebuttalState.value = 'ready'
  } catch (e) {
    if (seq !== rebuttalSeq) return
    console.warn('label rebuttal failed:', e)
    rebuttalState.value = 'failed'
    return
  }
  await saveQuietly()
}

/** 回应相关的保存：失败不打扰玩家（标注本身早已存好），留到下次保存一并写入 */
async function saveQuietly(): Promise<void> {
  try {
    await saveCurrent(await sharing())
  } catch (e) {
    console.warn('save rebuttal failed:', e)
  }
}

/** 玩家对回应的态度（可改选） */
async function setVerdict(verdict: RebuttalVerdict): Promise<void> {
  if (!rebuttal.value || rebuttal.value.verdict === verdict) return
  rebuttal.value = { ...rebuttal.value, verdict }
  await saveQuietly()
}

/**
 * 玩家在回应区点了「上传反馈」：等同于同意分享对局判断，记进配置并立即上传这一局。
 *
 * 上传是否成功由 saveCurrent 写进 shareState，回应区据此显示「已反馈成功」或「没成功」——
 * 不在这里乐观地先标成功。
 */
async function shareFeedback(): Promise<void> {
  if (sharingNow.value) return
  sharingNow.value = true
  try {
    await putConfigByIpc(MATCH_LABEL_SHARE_KEY, true)
    await saveCurrent(true)
  } catch (e) {
    console.warn('share rebuttal feedback failed:', e)
    shareState.value = 'failed'
  } finally {
    sharingNow.value = false
  }
}

/** 回到编辑态；在途的 AI 调用作废 */
function edit(): void {
  rebuttalSeq++
  if (rebuttalState.value === 'loading' || rebuttalState.value === 'failed') {
    rebuttalState.value = 'idle'
  }
  phase.value = 'edit'
}

/** 「不服？」入口：理由够长就直接让 AI 回应，否则回去补理由 */
async function onRebutEntry(): Promise<void> {
  if (canRebutNow.value) {
    void runRebuttal()
    return
  }
  edit()
  await nextTick()
  noteInput.value?.focus()
}

const shareText = computed(() => {
  switch (shareState.value) {
    case 'shared':
      return '已分享，谢谢'
    case 'failed':
      return '分享失败，已保存在本地，下次打开复盘时自动重试'
    default:
      return '仅保存在本地'
  }
})
</script>

<template>
  <section class="label-card" data-test="label-card">
    <div class="label-card-head">
      <div class="review-section-title">你怎么看这局？</div>
      <n-button v-if="phase === 'done'" quaternary size="tiny" data-test="label-edit" @click="edit"
        >修改</n-button
      >
      <span v-else class="label-card-hint">帮助改进评分 · 可跳过</span>
    </div>

    <template v-if="phase === 'edit'">
      <div v-for="row in ROWS" :key="row.kind" class="label-row">
        <span class="label-tag" :class="`is-${row.kind}`">{{ row.title }}</span>
        <div class="label-row-avatars">
          <template v-for="(team, ti) in [blue, red]" :key="ti">
            <span v-if="ti === 1" class="label-row-gap" aria-hidden="true">VS</span>
            <button
              v-for="p in team"
              :key="p.participantId"
              type="button"
              class="label-avatar"
              :class="[
                p.teamId === 100 ? 'is-blue' : 'is-red',
                { [`picked-${row.kind}`]: picks[row.kind] === p.participantId }
              ]"
              :aria-pressed="picks[row.kind] === p.participantId"
              :title="`${p.champion}${p.isMe ? '（你）' : ''}`"
              :data-test="`pick-${row.kind}-${p.participantId}`"
              @click="toggle(row.kind, p.participantId)"
            >
              <img :src="getChampionUrl(p.championId)" :alt="p.champion" />
              <span v-if="p.isMe" class="label-avatar-me">你</span>
            </button>
          </template>
        </div>
      </div>
      <n-input
        ref="noteInput"
        v-model:value="note"
        type="textarea"
        size="small"
        class="label-note"
        :maxlength="MATCH_LABEL_NOTE_MAX"
        show-count
        :autosize="{ minRows: 1, maxRows: 3 }"
        placeholder="说说理由，AI 会回应你，比如「下路被克制」「打野一直没来」"
        data-test="label-note"
      />
      <div class="label-card-foot">
        <span v-if="saveError" class="label-error">{{ saveError }}</span>
        <n-button
          size="small"
          type="primary"
          :disabled="!canSubmit"
          :loading="saving"
          data-test="label-submit"
          @click="submit"
          >提交</n-button
        >
      </div>
    </template>

    <template v-else>
      <div v-for="r in results" :key="r.kind" class="label-result" :data-test="`result-${r.kind}`">
        <span class="label-tag" :class="`is-${r.kind}`">{{ r.title }}</span>
        <span
          class="label-avatar"
          :class="[r.mine.teamId === 100 ? 'is-blue' : 'is-red', `picked-${r.kind}`]"
        >
          <img :src="getChampionUrl(r.mine.championId)" :alt="r.mine.champion" />
        </span>
        <span v-if="r.agree !== null" class="label-verdict" :class="r.agree ? 'agree' : 'differ'">{{
          r.agree ? '✓ 与 AI 一致' : 'AI 另有人选'
        }}</span>
        <span
          class="label-result-text"
          :class="r.agree === true ? 'agree' : r.agree === false ? 'differ' : ''"
          >{{ r.text }}</span
        >
      </div>
      <div v-if="note.trim()" class="label-note-done" data-test="label-note-done">
        <span class="label-tag">说明</span><span>{{ note.trim() }}</span>
      </div>
      <RebuttalReply
        v-if="rebuttalState !== 'idle'"
        :state="rebuttalState"
        :rebuttal="rebuttal"
        :feedback="feedback"
        :sharing="sharingNow"
        @verdict="setVerdict"
        @retry="runRebuttal"
        @share="shareFeedback"
      />
      <button
        v-else-if="disputes.length"
        type="button"
        class="label-rebut"
        data-test="label-rebut"
        @click="onRebutEntry"
      >
        {{ canRebutNow ? '让 AI 回应你的理由 ›' : '不服？说说理由 ›' }}
      </button>
      <div class="label-card-hint" data-test="label-share">{{ shareText }} · 模型判断仅供参考</div>
    </template>

    <n-modal
      v-model:show="consentOpen"
      preset="dialog"
      title="分享你的判断，帮助改进评分？"
      positive-text="分享"
      negative-text="只保存在本地"
      :closable="false"
      :mask-closable="false"
      @positive-click="answerConsent(true)"
      @negative-click="answerConsent(false)"
    >
      <p class="label-consent-text">
        只上传：对局 ID、你选的英雄与位置、你写的说明（如有）、当时模型的评分。<br />
        不上传召唤师名、账号或任何个人信息（说明里也请不要写）。可随时在设置里关闭。
      </p>
    </n-modal>
  </section>
</template>

<style scoped>
.label-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.label-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label-card-head .review-section-title {
  margin-bottom: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}
.label-card-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.label-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}
/* 行标签：最关键金、最犯罪红，颜色与头像选中圈一致 */
.label-tag {
  --tag-color: var(--text-secondary);
  flex: 0 0 auto;
  min-width: 52px;
  box-sizing: border-box;
  padding: 2px 8px;
  border-radius: 999px;
  text-align: center;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  color: var(--tag-color);
  background: color-mix(in srgb, var(--tag-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tag-color) 35%, transparent);
}
.label-tag.is-key {
  --tag-color: var(--accent-gold);
}
.label-tag.is-blame {
  --tag-color: var(--semantic-loss);
}
.label-row-avatars {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.label-row-gap {
  padding: 0 var(--space-4);
  font-size: var(--font-size-3xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 1px;
  color: var(--text-tertiary);
}
.label-avatar {
  appearance: none;
  position: relative;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  background: var(--surface-group);
  cursor: pointer;
  opacity: 0.72;
  transition:
    opacity var(--dur-fast),
    border-color var(--dur-fast),
    box-shadow var(--dur-fast),
    transform var(--dur-fast);
}
.label-avatar img {
  width: 100%;
  height: 100%;
  border-radius: calc(var(--radius-md) - 2px);
  display: block;
}
/* 阵营：底边一条细色带 */
.label-avatar.is-blue {
  box-shadow: inset 0 -2px 0 var(--side-blue);
}
.label-avatar.is-red {
  box-shadow: inset 0 -2px 0 var(--side-red);
}
.label-avatar:hover {
  opacity: 1;
  transform: translateY(-2px);
}
.label-avatar.picked-key {
  opacity: 1;
  border-color: var(--accent-gold);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-gold) 22%, transparent);
}
.label-avatar.picked-blame {
  opacity: 1;
  border-color: var(--semantic-loss);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--semantic-loss) 22%, transparent);
}
.label-avatar:focus-visible {
  outline: 1px solid var(--accent-hover);
  outline-offset: 1px;
}
.label-avatar-me {
  position: absolute;
  right: -6px;
  top: -6px;
  font-size: var(--font-size-3xs);
  line-height: 1;
  padding: 2px 3px;
  border-radius: var(--radius-xs);
  background: var(--semantic-win);
  color: var(--bg-base);
}
.label-note {
  max-width: 560px;
}
.label-note-done {
  display: flex;
  align-items: baseline;
  gap: var(--space-12);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.label-card-foot {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--space-8);
}
.label-error {
  font-size: var(--font-size-xs);
  color: var(--semantic-loss);
}
.label-result {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}
.label-result .label-avatar {
  cursor: default;
}
.label-result .label-avatar:hover {
  transform: none;
}
/* 结论先行：一致 / 不一致用色块说清，细节文字跟在后面 */
.label-verdict {
  flex: none;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}
.label-verdict.agree {
  color: var(--semantic-win);
}
.label-verdict.differ {
  color: var(--semantic-warn);
}
.label-result-text {
  min-width: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
/* 「不服？」入口：文字链接，不抢对比结果的视线 */
.label-rebut {
  appearance: none;
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--accent-blue);
  cursor: pointer;
}
.label-rebut:hover {
  text-decoration: underline;
}
.label-rebut:focus-visible {
  outline: 1px solid var(--accent-hover);
  outline-offset: 2px;
}
.label-consent-text {
  margin: 0;
  line-height: 1.7;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}
</style>
