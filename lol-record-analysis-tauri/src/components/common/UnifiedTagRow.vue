<template>
  <div class="unified-tag-row">
    <!-- 备注 chip：有备注时排最前，hover 显示完整「[色档] 备注全文」 -->
    <n-popover v-if="note" trigger="hover">
      <template #trigger>
        <n-tag data-test="note-chip" size="small" round :type="noteMeta.naiveType">
          ✎ {{ note.note ? truncated(note.note) : noteMeta.text }}
        </n-tag>
      </template>
      <span>[{{ noteMeta.text }}] {{ note.note || '（未填写文字）' }}</span>
    </n-popover>

    <!-- 系统标签 chips：hover 看 tagDesc，点击弹「存为备注」确认 -->
    <n-popover v-for="tag in tags" :key="tag.tagName" trigger="click">
      <template #trigger>
        <n-tooltip trigger="hover" :disabled="!tag.tagDesc">
          <template #trigger>
            <n-tag
              size="small"
              round
              :type="tag.good ? 'success' : 'error'"
              :bordered="false"
              class="unified-tag-chip"
            >
              {{ tag.tagName }}
            </n-tag>
          </template>
          <span>{{ tag.tagDesc }}</span>
        </n-tooltip>
      </template>
      <div class="solidify-pop">
        <div class="solidify-pop-text">把「{{ tag.tagName }}」存为对该玩家的备注？</div>
        <n-button size="tiny" type="primary" @click="solidifyTag(tag)">存为备注</n-button>
      </div>
    </n-popover>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一标签行：系统标签 + 手动备注同排展示，并支持一键固化
 *
 * - 备注 chip（有备注时排最前）：色档颜色 + 文本截断，hover 看全文
 * - 系统标签 chips（good 绿 / bad 红）：hover 看 tagDesc，点击可把该标签
 *   「固化」为对该玩家的持久备注（追加文本、保留已有色档）
 *
 * 数据走 {@link usePlayerNotesStore}，组件不直接碰 IPC。props 保持通用
 * （puuid + 名字 + 标签数组），不依赖 session 特有结构，供玩家卡 /
 * 战绩页 / 对局详情三处复用。
 *
 * @see issue #67（手动打备注费劲 → 系统先算标签、用户点一下固化）
 */
import { computed } from 'vue'
import { NPopover, NTooltip, NTag, NButton, useMessage } from 'naive-ui'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import { getNoteLabelMeta } from '@renderer/types/domain/playerNote'
import type { RankTag } from '@renderer/types/domain/analysis'

/**
 * 组件属性
 * @property tags - 系统计算出的标签列表（后端 camelCase: tagName/tagDesc/good）
 * @property puuid - 玩家唯一标识（备注存取的 key）
 * @property gameName - 游戏名（固化备注时冗余写入，供设置列表展示）
 * @property tagLine - 标签行
 */
interface Props {
  tags: RankTag[]
  puuid: string
  gameName: string
  tagLine: string
}
const props = defineProps<Props>()

const store = usePlayerNotesStore()
const message = useMessage()

/** 当前玩家已保存的备注（响应式跟随 store） */
const note = computed(() => store.getNote(props.puuid))
/** 备注色档元信息（无备注时回退 normal，仅在 note 存在时被渲染使用） */
const noteMeta = computed(() => getNoteLabelMeta(note.value?.label ?? 'normal'))

/** 备注 chip 文本最多展示的字符数（全文放 hover popover） */
const NOTE_PREVIEW_LEN = 8

/**
 * 截断备注文本用于 chip 展示
 * @param text - 备注全文
 * @returns 超过 {@link NOTE_PREVIEW_LEN} 字时截断并加省略号
 */
function truncated(text: string): string {
  const chars = Array.from(text)
  return chars.length > NOTE_PREVIEW_LEN ? chars.slice(0, NOTE_PREVIEW_LEN).join('') + '…' : text
}

/** 备注最大长度（与 PlayerNoteBadge 手动输入框的 :maxlength="100" 对齐） */
const NOTE_MAX_LEN = 100

/**
 * 把系统标签一键固化为持久备注
 *
 * - 文本行：`tagName`（tagDesc 非空则 `tagName：tagDesc`）
 * - 已有备注：文本追加（`\n` 分隔），色档保留原值
 * - 无备注：色档 = good→friendly / bad→careful
 * - 去重：已有备注按行包含完全相同的一行时不重复写入
 * - 上限：拼接后超过 {@link NOTE_MAX_LEN} 字时不写入（不截断，避免静默丢内容）
 *
 * @param tag - 要固化的系统标签
 */
async function solidifyTag(tag: RankTag): Promise<void> {
  const line = tag.tagDesc ? `${tag.tagName}：${tag.tagDesc}` : tag.tagName
  const existing = note.value
  // 按行精确匹配去重（不能用 includes 子串匹配：「专精」是「专精：xxx」的子串会误判）
  if (existing?.note?.split('\n').includes(line)) {
    message.info('该标签已在备注中')
    return
  }
  const nextNote = existing?.note ? `${existing.note}\n${line}` : line
  if (Array.from(nextNote).length > NOTE_MAX_LEN) {
    message.warning('备注已达长度上限，请先在备注面板整理')
    return
  }
  const label = existing?.label ?? (tag.good ? 'friendly' : 'careful')
  try {
    await store.setNote(props.puuid, {
      note: nextNote,
      label,
      gameName: props.gameName,
      tagLine: props.tagLine
    })
    message.success('已存为备注')
  } catch {
    message.error('保存失败')
  }
}

defineExpose({ solidifyTag })
</script>

<style scoped>
.unified-tag-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.unified-tag-chip {
  cursor: pointer;
}

.solidify-pop {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6, 6px);
}

.solidify-pop-text {
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
}
</style>
