<script setup lang="ts">
/**
 * 复盘页「你怎么看这局？」标注卡：玩家标注最关键 / 最犯罪的人，提交后显示与模型的对比。
 *
 * - 提交前不显示模型结论，避免先入为主；两项各自可选可不选，至少一项才可提交。
 * - 首次提交时询问是否匿名分享（配置键 matchLabelShare），之后按选择保存 / 上传。
 * - 上传失败照常显示对比，标注已存本地，下次打开复盘时补传。
 * @property players - 本局 10 人（复盘视图模型）
 * @property gameId / platform / queueId - 对局标识
 */
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NModal } from 'naive-ui'
import { getVersion } from '@tauri-apps/api/app'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import { BASELINE } from '@renderer/services/ai/shared/scoring/data'
import {
  MATCH_LABEL_NOTE_MAX,
  MATCH_LABEL_SHARE_KEY,
  buildModelSnapshot,
  compareText,
  getMatchLabel,
  retryMatchLabelUploads,
  saveMatchLabel,
  toPick,
  type MatchLabel
} from '@renderer/services/matchLabel'

const props = defineProps<{
  players: PlayerView[]
  gameId: number
  platform: string
  queueId: number
}>()

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

const canSubmit = computed(() => picks.value.key !== null || picks.value.blame !== null)

const ROWS: Array<{ kind: Kind; title: string }> = [
  { kind: 'key', title: '👑 最关键' },
  { kind: 'blame', title: '💣 最犯罪' }
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
  phase.value = 'done'
  const share = await getConfigByIpc<boolean>(MATCH_LABEL_SHARE_KEY)
  if (share !== true) shareState.value = 'local'
  else if (saved.uploaded) shareState.value = 'shared'
  else shareState.value = (await retryMatchLabelUploads()) > 0 ? 'shared' : 'failed'
})

async function modelVersion(): Promise<string> {
  let app = 'unknown'
  try {
    app = await getVersion()
  } catch {
    // 非 Tauri 环境（单测 / 浏览器预览）拿不到版本号
  }
  return `${BASELINE.meta.builtAt}@${app}`
}

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

async function persist(share: boolean): Promise<void> {
  saving.value = true
  saveError.value = null
  const me = props.players.find(p => p.isMe)
  const label: MatchLabel = {
    gameId: props.gameId,
    platform: props.platform,
    queueId: props.queueId,
    keyPick: byPid(picks.value.key) ? toPick(byPid(picks.value.key)!) : null,
    blamePick: byPid(picks.value.blame) ? toPick(byPid(picks.value.blame)!) : null,
    labelerSide: me ? (me.win ? 'win' : 'lose') : null,
    note: note.value.trim() || null,
    model: buildModelSnapshot(props.players),
    modelVersion: await modelVersion()
  }
  try {
    const r = await saveMatchLabel(label, share)
    shareState.value = !share ? 'local' : r.uploaded ? 'shared' : 'failed'
    phase.value = 'done'
  } catch (e) {
    saveError.value = `保存失败：${String(e)}`
  } finally {
    saving.value = false
  }
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
      <n-button
        v-if="phase === 'done'"
        text
        size="small"
        data-test="label-edit"
        @click="phase = 'edit'"
        >修改</n-button
      >
      <span v-else class="label-card-hint">帮助改进评分 · 可跳过</span>
    </div>

    <template v-if="phase === 'edit'">
      <div v-for="row in ROWS" :key="row.kind" class="label-row">
        <div class="label-row-title">{{ row.title }}</div>
        <div class="label-row-avatars">
          <template v-for="(team, ti) in [blue, red]" :key="ti">
            <span v-if="ti === 1" class="label-row-gap" aria-hidden="true"></span>
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
        v-model:value="note"
        type="textarea"
        size="small"
        class="label-note"
        :maxlength="MATCH_LABEL_NOTE_MAX"
        show-count
        :autosize="{ minRows: 1, maxRows: 3 }"
        placeholder="可选：说说理由，比如「下路被克制」「打野一直没来」"
        data-test="label-note"
      />
      <div class="label-card-foot">
        <span v-if="saveError" class="label-error">{{ saveError }}</span>
        <n-button
          size="small"
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
        <span class="label-row-title">{{ r.title }}</span>
        <span
          class="label-avatar"
          :class="[r.mine.teamId === 100 ? 'is-blue' : 'is-red', `picked-${r.kind}`]"
        >
          <img :src="getChampionUrl(r.mine.championId)" :alt="r.mine.champion" />
        </span>
        <span
          class="label-result-text"
          :class="r.agree === true ? 'agree' : r.agree === false ? 'differ' : ''"
          >{{ r.text }}<template v-if="r.agree"> ✓</template></span
        >
      </div>
      <div v-if="note.trim()" class="label-note-done" data-test="label-note-done">
        <span class="label-row-title">📝 说明</span><span>{{ note.trim() }}</span>
      </div>
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
.label-row-title {
  flex: 0 0 64px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.label-row-avatars {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.label-row-gap {
  width: var(--space-12);
}
.label-avatar {
  appearance: none;
  position: relative;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--surface-group);
  cursor: pointer;
  opacity: 0.7;
  transition:
    opacity var(--dur-fast),
    border-color var(--dur-fast),
    transform var(--dur-fast);
}
.label-avatar img {
  width: 100%;
  height: 100%;
  border-radius: calc(var(--radius-sm) - 2px);
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
  transform: translateY(-1px);
}
.label-avatar.picked-key {
  opacity: 1;
  border-color: var(--accent-gold);
}
.label-avatar.picked-blame {
  opacity: 1;
  border-color: var(--semantic-loss);
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
  justify-content: flex-end;
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
.label-result-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.label-result-text.agree {
  color: var(--semantic-win);
}
.label-result-text.differ {
  color: var(--semantic-warn);
}
.label-consent-text {
  margin: 0;
  line-height: 1.7;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}
</style>
