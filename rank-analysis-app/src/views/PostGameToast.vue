<script setup lang="ts">
/**
 * 赛后右下角弹卡窗口（label `postgame-toast-{gameId}`，Rust 在排位结算时隐藏创建）。
 *
 * 自己取数据，不依赖主窗口推送（主窗口最小化后会被节流）：
 * 刚结束那局 → 复盘视图模型 → 本地是否已有标注。复盘模型（无时间线版，很快）就绪后才 show，
 * 取不到（POSTGAME_TOAST_GIVE_UP_MS 内）或是重开局就直接关掉，玩家什么都看不到。
 *
 * 先猜再揭晓：还没标注时卡上不出现 AI 结论，玩家直接在卡上点头像猜（不跳主窗口）；
 * 猜完——或已标注 / 本队列没有标注卡——就地揭晓标签与一条事实，可一键复制战报图。
 * 卡上猜的结果与对局页标注卡存的是同一份标注；是否上传沿用已有的分享设置，
 * 还没决定过就只存本地（弹卡上不弹同意询问，留给标注卡第一次提交时问）。
 * 复制用离屏渲染的 ShareCard（与对局页战报图同一组件、同一导出逻辑）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PostGameToastCard, {
  type ToastAvatar,
  type ToastCopyState,
  type ToastGuess,
  type ToastState
} from '@renderer/components/gaming/PostGameToastCard.vue'
import ShareCard from '@renderer/components/gaming/ShareCard.vue'
import { formatLp, loadEndedGameReport, reportMeta } from '@renderer/composables/usePostGameReport'
import { useReviewModel } from '@renderer/composables/useReviewModel'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { buildShareCard, pickAngle } from '@renderer/services/ai/review/shareFacts'
import { getConfigByIpc } from '@renderer/services/ipc'
import {
  MATCH_LABEL_SHARE_KEY,
  buildMatchLabel,
  compareSummary,
  currentModelVersion,
  getMatchLabel,
  saveMatchLabel,
  type MatchLabel
} from '@renderer/services/matchLabel'
import { copyCardImage, toDataUrl } from '@renderer/services/shareCard'
import {
  POSTGAME_TOAST_GIVE_UP_MS,
  POSTGAME_TOAST_TTL_MS,
  closeToastWindow,
  openMainFromToast,
  showToastWindow,
  trackPostGameToast
} from '@renderer/services/postGameToast'

/** 复制成功后停留多久再关，让玩家看到「已复制」 */
const CLOSE_AFTER_COPY_MS = 2000

const { report } = loadEndedGameReport()
const game = computed(() => report.value?.game ?? null)
const { model, isRemake, failed } = useReviewModel(game)
const { getChampionUrl, getSplashUrl } = useAssetUrl()

const players = computed(() => (model.value ? Object.values(model.value.players) : []))

/** 本局本地已有的标注（在复盘页 / 对局页标过）；undefined = 还没查到，null = 没标过 */
const savedLabel = ref<MatchLabel | null | undefined>(undefined)
/** 玩家在卡上的猜测；猜完（或跳过）即就地揭晓 */
const guess = ref<ToastGuess | null>(null)
watch(
  () => game.value?.gameId,
  async id => {
    savedLabel.value = undefined
    guess.value = null
    if (!id) return
    try {
      savedLabel.value = await getMatchLabel(id)
    } catch {
      savedLabel.value = null
    }
  },
  { immediate: true }
)
const hasLabel = computed(() => (savedLabel.value === undefined ? null : !!savedLabel.value))

/** 揭晓后「你 vs AI」的一行对比：卡上刚猜的优先，其次是之前存过的标注 */
const compare = computed(() => {
  const g =
    guess.value ??
    (savedLabel.value
      ? {
          keyPid: savedLabel.value.keyPick?.slot ?? null,
          blamePid: savedLabel.value.blamePick?.slot ?? null
        }
      : null)
  return g ? compareSummary(g, players.value) : null
})
const me = computed(() => players.value.find(p => p.isMe) ?? null)
const card = computed(() => (model.value ? buildShareCard(model.value) : null))

const state = computed<ToastState>(() => {
  if (!model.value || !card.value || hasLabel.value === null) return 'loading'
  return model.value.hasBaseline && !hasLabel.value && !guess.value ? 'guess' : 'revealed'
})

/** 顶行：本人英雄、胜负、KDA */
const self = computed(() => {
  const p = me.value
  return {
    championId: p?.championId ?? 0,
    champion: p?.champion ?? '',
    win: p?.win ?? false,
    kda: p ? `${p.kills}/${p.deaths}/${p.assists}` : ''
  }
})

const lineup = computed(() => {
  const myTeam = me.value?.teamId
  const byPid = [...players.value].sort((a, b) => a.participantId - b.participantId)
  const avatar = (p: (typeof byPid)[number]): ToastAvatar => ({
    pid: p.participantId,
    url: getChampionUrl(p.championId),
    name: p.isMe ? `${p.champion}（你）` : p.champion
  })
  return {
    allies: byPid.filter(p => p.teamId === myTeam).map(avatar),
    enemies: byPid.filter(p => p.teamId !== myTeam).map(avatar)
  }
})

const headline = computed(() => (card.value ? pickAngle(card.value.facts, 0).headline : null))

// ── 窗口生命周期：取到对局才亮出；放弃 / 重开局直接关 ──
let shown = false
const giveUp = setTimeout(() => {
  if (!shown) void closeToastWindow()
}, POSTGAME_TOAST_GIVE_UP_MS)

watch(
  [model, isRemake, failed],
  async ([m, remake, broken]) => {
    if (shown) return
    // 重开局 / 数据形状异常：这局没什么可说的，直接关
    if (remake || broken) {
      void closeToastWindow()
      return
    }
    if (!m) return
    shown = true
    await nextTick()
    await showToastWindow()
    trackPostGameToast('shown')
  },
  { immediate: true }
)

onMounted(() => {
  // 窗口透明：页面也必须透明，否则卡片四周的投影边是一圈底色
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
})
onBeforeUnmount(() => clearTimeout(giveUp))

// ── 按钮 ──
function close(): void {
  trackPostGameToast('closed')
  void closeToastWindow()
}

function expire(): void {
  trackPostGameToast('expired')
  void closeToastWindow()
}

/**
 * 玩家在卡上猜完：立刻揭晓，标注在后台保存。
 *
 * 揭晓不等保存——保存失败只是少一条标注，不该让玩家卡在「猜完没反应」。
 * 两项都跳过时不保存（后端也不收空标注），效果等同对局页的「跳过，直接看战报图」。
 */
async function submitGuess(g: ToastGuess): Promise<void> {
  trackPostGameToast('guess')
  guess.value = g
  const current = game.value
  if (!current || (g.keyPid === null && g.blamePid === null)) return
  try {
    const share = (await getConfigByIpc<boolean>(MATCH_LABEL_SHARE_KEY)) === true
    await saveMatchLabel(
      buildMatchLabel({
        players: players.value,
        gameId: current.gameId,
        platform: current.platformId,
        queueId: current.queueId,
        keyPid: g.keyPid,
        blamePid: g.blamePid,
        modelVersion: await currentModelVersion()
      }),
      share
    )
  } catch (e) {
    console.warn('post-game toast: save label failed', e)
  }
}

function open(): void {
  trackPostGameToast('open')
  void openMainFromToast()
}

const copyState = ref<ToastCopyState>('idle')
const shareIcon = ref<string | null>(null)
const shareSplash = ref<string | null>(null)
const shareEl = ref<{ $el: HTMLElement } | null>(null)
const shareMeta = computed(() => (report.value ? reportMeta(report.value) : []))

async function copy(): Promise<void> {
  const id = card.value?.championId
  if (!id || copyState.value === 'copying') return
  copyState.value = 'copying'
  try {
    // 图片先转 data URL 再渲染（导出时不跨源取图，见 services/shareCard.ts）
    if (!shareIcon.value || !shareSplash.value) {
      ;[shareIcon.value, shareSplash.value] = await Promise.all([
        toDataUrl(getChampionUrl(id)),
        toDataUrl(getSplashUrl(id))
      ])
      await nextTick()
    }
    const el = shareEl.value?.$el
    if (!el) throw new Error('战报图未渲染')
    await copyCardImage(el)
    copyState.value = 'copied'
    trackPostGameToast('copied')
    setTimeout(() => void closeToastWindow(), CLOSE_AFTER_COPY_MS)
  } catch (e) {
    console.error('post-game toast copy failed', e)
    copyState.value = 'failed'
  }
}
</script>

<template>
  <div class="pgt-window" data-test="pgt-window">
    <PostGameToastCard
      v-if="model"
      :state="state"
      :win="self.win"
      :champion="self.champion"
      :kda="self.kda"
      :lp-text="formatLp(report?.lpDelta ?? null)"
      :label="card?.label ?? null"
      :tone="card?.copy.tone ?? 'neutral'"
      :tagline="card?.copy.tagline ?? null"
      :headline="headline?.headline ?? null"
      :splash-url="self.championId ? getSplashUrl(self.championId) : null"
      :icon-url="self.championId ? getChampionUrl(self.championId) : null"
      :allies="lineup.allies"
      :enemies="lineup.enemies"
      :compare="compare"
      :copy-state="copyState"
      :ttl-ms="POSTGAME_TOAST_TTL_MS"
      @submit="submitGuess"
      @open="open"
      @copy="copy"
      @close="close"
      @expire="expire"
    />

    <!-- 离屏战报图：只用于复制导出，不可见 -->
    <div v-if="card" class="pgt-offscreen" aria-hidden="true">
      <ShareCard
        ref="shareEl"
        :card="card"
        :angle="0"
        :hide-name="true"
        :icon-url="shareIcon"
        :splash-url="shareSplash"
        :meta="shareMeta"
      />
    </div>
  </div>
</template>

<style scoped>
.pgt-window {
  /* 四周留 20px 透明边给投影（与 Rust SHADOW_PAD 一致；mac 无透明边） */
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  overflow: hidden;
}
.pgt-offscreen {
  position: fixed;
  left: -10000px;
  top: 0;
  pointer-events: none;
}
</style>
