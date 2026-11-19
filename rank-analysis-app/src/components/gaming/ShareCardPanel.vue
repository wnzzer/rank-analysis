<script setup lang="ts">
/**
 * 战报图面板：卡片预览 + 「复制战报图」「换个角度」「隐藏名字」。
 *
 * 入口按标签分级（LABEL_COPY.tier）：
 * - primary（Carry / 尽力 / 被连累）：直接展开卡片；
 * - secondary（正常 / 被爆）：收起，点「生成战报图」展开；
 * - opt-in（犯罪 / 缚地灵）：只给「来张自嘲版」入口，必须本人主动点开。
 * 卡片展开时打一次 shown，复制成功打 copied，用来看分享漏斗。
 * @property model - 复盘视图模型（时间线到达后会整体替换，卡片随之刷新）
 * @property meta - 时长 / LP / 隐藏分等小字
 */
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox } from 'naive-ui'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import type { ReviewModel } from '@renderer/services/ai/review/buildReviewModel'
import { angleCount, buildShareCard } from '@renderer/services/ai/review/shareFacts'
import { copyCardImage, toDataUrl, trackShareCard } from '@renderer/services/shareCard'
import ShareCard from './ShareCard.vue'

const props = defineProps<{ model: ReviewModel; meta: string[] }>()

const { getChampionUrl, getSplashUrl } = useAssetUrl()

const card = computed(() => buildShareCard(props.model))
const tier = computed(() => card.value?.copy.tier ?? 'secondary')

const expanded = ref(false)
const angle = ref(0)
const hideName = ref(false)
const iconUrl = ref<string | null>(null)
const splashUrl = ref<string | null>(null)
const copying = ref(false)
const status = ref<{ ok: boolean; text: string } | null>(null)
const cardEl = ref<{ $el: HTMLElement } | null>(null)

const angles = computed(() => (card.value ? angleCount(card.value.facts) : 0))
/** Windows 粘贴键 Ctrl，mac 为 ⌘ */
const pasteKey = /Mac/i.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V'

let shownTracked = false
watch(
  expanded,
  v => {
    if (v && !shownTracked) {
      shownTracked = true
      trackShareCard('shown')
    }
  },
  { immediate: true }
)

// 时间线晚到会让标签变化（无时间线 → 有时间线重新判）：变成 primary 时自动展开，从不自动收起
watch(
  tier,
  t => {
    if (t === 'primary') expanded.value = true
  },
  { immediate: true }
)

watch(
  () => card.value?.championId,
  async id => {
    // 头像与原画都转成 data URL：导出时不再跨源取图（见 services/shareCard.ts）
    const [icon, splash] = id
      ? await Promise.all([toDataUrl(getChampionUrl(id)), toDataUrl(getSplashUrl(id))])
      : [null, null]
    iconUrl.value = icon
    splashUrl.value = splash
  },
  { immediate: true }
)

function openSelfRoast(): void {
  expanded.value = true
  trackShareCard('self_roast')
}

function nextAngle(): void {
  angle.value++
  trackShareCard('angle')
}

async function copy(): Promise<void> {
  const el = cardEl.value?.$el
  if (!el || copying.value) return
  copying.value = true
  status.value = null
  try {
    await copyCardImage(el)
    status.value = { ok: true, text: `已复制，去群里 ${pasteKey} 粘贴` }
    trackShareCard('copied')
  } catch (e) {
    console.error('share card copy failed', e)
    status.value = { ok: false, text: `复制失败：${String(e)}` }
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <section v-if="card" class="share-panel" data-test="share-panel">
    <template v-if="!expanded">
      <n-button
        v-if="tier === 'opt-in'"
        size="small"
        secondary
        data-test="share-open-roast"
        @click="openSelfRoast"
        >来张自嘲版战报图</n-button
      >
      <n-button v-else size="small" secondary data-test="share-open" @click="expanded = true"
        >生成战报图</n-button
      >
    </template>

    <div v-else class="share-body">
      <div class="share-preview">
        <ShareCard
          ref="cardEl"
          :card="card"
          :angle="angle"
          :hide-name="hideName"
          :icon-url="iconUrl"
          :splash-url="splashUrl"
          :meta="meta"
        />
      </div>
      <div class="share-actions">
        <n-button type="primary" :loading="copying" data-test="share-copy" @click="copy"
          >复制战报图</n-button
        >
        <n-button v-if="angles > 1" secondary data-test="share-angle" @click="nextAngle"
          >换个角度</n-button
        >
        <n-checkbox v-model:checked="hideName" data-test="share-hide-name">隐藏名字</n-checkbox>
        <div
          v-if="status"
          class="share-status"
          :class="status.ok ? 'is-ok' : 'is-err'"
          data-test="share-status"
        >
          {{ status.text }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.share-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.share-body {
  display: flex;
  gap: var(--space-16);
  align-items: flex-start;
  flex-wrap: wrap;
}
.share-preview {
  flex: none;
}
.share-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-8);
}
.share-status {
  font-size: var(--font-size-xs);
}
.share-status.is-ok {
  color: var(--semantic-win);
}
.share-status.is-err {
  color: var(--semantic-loss);
}
</style>
