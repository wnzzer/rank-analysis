<template>
  <n-popover
    trigger="click"
    placement="bottom-start"
    :show="show"
    :style="{ padding: '0' }"
    @update:show="onToggle"
  >
    <template #trigger>
      <!-- 有备注：彩色圆点（hover 微亮）；无备注：淡色"加备注"图标 -->
      <button
        class="note-trigger"
        :class="{ 'has-note': hasNote, [`size-${size}`]: true }"
        :title="triggerTitle"
        type="button"
      >
        <span v-if="hasNote" class="note-dot" :style="{ background: meta.cssVar }" />
        <n-icon v-else class="note-add-icon"><BookmarkOutline /></n-icon>
      </button>
    </template>

    <!-- 弹层：读写合一 -->
    <div class="note-panel" :class="{ 'has-encounters': encounters.length > 0 }">
      <div class="note-panel-header">
        <span class="note-panel-title">玩家备注</span>
        <n-ellipsis class="note-panel-name" style="max-width: 140px">
          {{ gameName }}<span class="note-panel-tag">#{{ tagLine }}</span>
        </n-ellipsis>
      </div>

      <!-- 颜色四档 -->
      <div class="note-swatches">
        <button
          v-for="l in NOTE_LABELS"
          :key="l.value"
          type="button"
          class="note-swatch"
          :class="{ active: draftLabel === l.value }"
          :style="{ '--swatch-color': l.cssVar }"
          @click="draftLabel = l.value"
        >
          <span class="note-swatch-dot" :style="{ background: l.cssVar }" />
          {{ l.text }}
        </button>
      </div>

      <!-- 备注文本 -->
      <n-input
        v-model:value="draftNote"
        type="textarea"
        size="small"
        placeholder="可选：写点备注，比如「上次一起赢的辅助」"
        :autosize="{ minRows: 2, maxRows: 4 }"
        :maxlength="100"
        show-count
        class="note-input"
      />

      <!-- 遇见记录（复刻"遇见过"，点一条可开那局详情） -->
      <div v-if="encounters.length" class="note-encounters">
        <div class="note-encounters-head">
          遇见记录
          <span class="note-encounters-count">{{ encounters.length }}</span>
        </div>
        <div class="note-encounters-scroll">
          <MettingPlayersCard :meet-games="encounters" />
        </div>
      </div>

      <div class="note-panel-footer">
        <n-button v-if="hasNote" text size="small" type="error" @click="onDelete">删除</n-button>
        <span class="note-footer-spacer" />
        <n-button size="small" @click="show = false">取消</n-button>
        <n-button size="small" type="primary" :loading="saving" @click="onSave">保存</n-button>
      </div>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
/**
 * 玩家备注徽标
 *
 * 在玩家卡 / 详情页展示一个色块（有备注）或"加备注"图标（无备注），
 * 点击弹出读写合一的编辑面板：四档颜色 + 文本框 + 保存/删除。
 * 数据走 {@link usePlayerNotesStore}，组件不直接碰 IPC。
 *
 * @see issue #67
 */
import { computed, ref, watch } from 'vue'
import { NPopover, NIcon, NInput, NButton, NEllipsis, useMessage } from 'naive-ui'
import { BookmarkOutline } from '@vicons/ionicons5'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import { NOTE_LABELS, getNoteLabelMeta, type NoteLabel } from '@renderer/types/domain/playerNote'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import MettingPlayersCard from '@renderer/components/gaming/MettingPlayersCard.vue'

interface Props {
  /** 玩家唯一标识 */
  puuid: string
  /** 游戏名（保存时冗余写入，供设置列表展示） */
  gameName: string
  /** 标签 */
  tagLine: string
  /** 尺寸：卡片用 small，详情页用 normal */
  size?: 'small' | 'normal'
  /**
   * 当前所在对局上下文（仅战绩详情页等"单局"场景传入）。
   * 保存备注时会并入该玩家的遇见记录，复刻"遇见过"效果。
   */
  encounter?: OneGamePlayer
}
const props = withDefaults(defineProps<Props>(), { size: 'small', encounter: undefined })

const store = usePlayerNotesStore()
const message = useMessage()

const show = ref(false)
const saving = ref(false)
const draftLabel = ref<NoteLabel>('normal')
const draftNote = ref('')

/** 当前已保存的备注（响应式跟随 store） */
const note = computed(() => store.getNote(props.puuid))
const hasNote = computed(() => !!note.value)
const meta = computed(() => getNoteLabelMeta(note.value?.label ?? 'normal'))
/** 已记录的遇见对局（最近在前） */
const encounters = computed<OneGamePlayer[]>(() => note.value?.encounters ?? [])

/** 触发按钮的 hover 提示：无备注显示"添加备注"，有备注显示档位（+备注文本） */
const triggerTitle = computed(() => {
  const n = note.value
  if (!n) return '添加备注'
  return n.note ? `${meta.value.text}：${n.note}` : meta.value.text
})

/** 打开面板时把草稿同步成当前值 */
function onToggle(next: boolean) {
  if (next) {
    draftLabel.value = note.value?.label ?? 'normal'
    draftNote.value = note.value?.note ?? ''
  }
  show.value = next
}

// puuid 变化（卡片复用）时复位草稿
watch(
  () => props.puuid,
  () => {
    show.value = false
  }
)

async function onSave() {
  if (!props.puuid) {
    message.error('无法获取玩家标识')
    return
  }
  saving.value = true
  try {
    await store.setNote(props.puuid, {
      note: draftNote.value.trim(),
      label: draftLabel.value,
      gameName: props.gameName,
      tagLine: props.tagLine,
      encounter: props.encounter
    })
    message.success('备注已保存')
    show.value = false
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  try {
    await store.removeNote(props.puuid)
    message.success('备注已删除')
    show.value = false
  } catch {
    message.error('删除失败')
  }
}
</script>

<style scoped>
.note-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: var(--space-2);
  border-radius: var(--radius-pill);
  transition: background var(--dur-fast, 0.15s) var(--ease-expo, ease);
}
.note-trigger:hover {
  background: var(--glass-bg-low, rgba(255, 255, 255, 0.06));
}
.note-trigger.size-normal {
  padding: 3px;
}

.note-dot {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--bg-base, transparent);
}
.size-normal .note-dot {
  width: 11px;
  height: 11px;
}

.note-add-icon {
  font-size: var(--font-size-base);
  color: var(--text-tertiary);
  opacity: 0.55;
  transition: opacity var(--dur-fast, 0.15s) var(--ease-expo, ease);
}
.note-trigger:hover .note-add-icon {
  opacity: 1;
  color: var(--text-secondary);
}
.size-normal .note-add-icon {
  font-size: var(--font-size-lg);
}

/* ---- 弹层 ---- */
.note-panel {
  width: 248px;
  padding: var(--space-12, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--space-10, 10px);
  transition: width var(--dur-normal, 0.28s) var(--ease-expo, ease);
}
/* 有遇见记录时加宽，容纳 MettingPlayersCard 的双列卡片 */
.note-panel.has-encounters {
  width: 360px;
}

.note-encounters {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 6px);
}
.note-encounters-head {
  display: flex;
  align-items: center;
  gap: var(--space-6, 6px);
  font-size: var(--font-size-xs, 12px);
  font-weight: 600;
  color: var(--text-secondary);
}
.note-encounters-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-pill, 999px);
  background: var(--glass-bg-low, rgba(255, 255, 255, 0.06));
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}
.note-encounters-scroll {
  max-height: 196px;
  overflow-y: auto;
  margin: 0 calc(-1 * var(--space-4, 4px));
  padding: 0 var(--space-4, 4px);
}
.note-panel-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8, 8px);
}
.note-panel-title {
  font-size: var(--font-size-sm, 13px);
  font-weight: 700;
  color: var(--text-primary);
}
.note-panel-name {
  font-size: var(--font-size-xs, 12px);
  color: var(--text-tertiary);
}
.note-panel-tag {
  opacity: 0.7;
}

.note-swatches {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-6, 6px);
}
.note-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: 5px var(--space-2);
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
  background: var(--glass-bg-low, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--glass-border, transparent);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition:
    border-color var(--dur-fast, 0.15s) var(--ease-expo, ease),
    background var(--dur-fast, 0.15s) var(--ease-expo, ease);
}
.note-swatch:hover {
  border-color: var(--swatch-color);
}
.note-swatch.active {
  border-color: var(--swatch-color);
  background: color-mix(in srgb, var(--swatch-color) 16%, transparent);
  color: var(--text-primary);
  font-weight: 600;
}
.note-swatch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.note-input {
  font-size: var(--font-size-xs, 12px);
}

.note-panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-6, 6px);
}
.note-footer-spacer {
  flex: 1;
}
</style>
