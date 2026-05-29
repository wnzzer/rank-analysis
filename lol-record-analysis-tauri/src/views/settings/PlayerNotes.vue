<template>
  <n-space vertical :size="12">
    <n-card title="我标记过的人" size="small">
      <template #header-extra>
        <n-text :depth="3" style="font-size: 12px"> 共 {{ store.count }} 人 </n-text>
      </template>

      <n-alert type="default" :bordered="false" style="margin-bottom: 12px">
        <template #icon>
          <n-icon><InformationCircleOutline /></n-icon>
        </template>
        备注仅保存在本机，换电脑或重装会丢失，也无法与他人共享。在对局玩家卡、玩家详情页点名字旁的标记即可添加。
      </n-alert>

      <n-data-table
        v-if="store.count > 0"
        :columns="columns"
        :data="store.list"
        :row-key="row => row.puuid"
        :bordered="false"
        :pagination="pagination"
      />
      <n-empty v-else description="还没有标记过任何人" style="padding: 32px 0">
        <template #icon>
          <n-icon><BookmarksOutline /></n-icon>
        </template>
      </n-empty>
    </n-card>
  </n-space>
</template>

<script setup lang="ts">
/**
 * 设置页：我标记过的人
 *
 * 集中展示 / 管理本地玩家备注（issue #67）。表格行复用
 * {@link PlayerNoteBadge} 做行内编辑，配 popconfirm 删除。
 */
import { h, computed } from 'vue'
import {
  NSpace,
  NCard,
  NText,
  NAlert,
  NIcon,
  NTag,
  NButton,
  NPopconfirm,
  NEllipsis,
  NEmpty,
  NDataTable,
  useMessage,
  type DataTableColumns
} from 'naive-ui'
import { InformationCircleOutline, BookmarksOutline } from '@vicons/ionicons5'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import { getNoteLabelMeta } from '@renderer/types/domain/playerNote'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import MettingPlayersCard from '@renderer/components/gaming/MettingPlayersCard.vue'

const store = usePlayerNotesStore()
const message = useMessage()

const pagination = { pageSize: 12 } as const

/** 行类型：store.list 元素（puuid + PlayerNote 展开） */
type Row = (typeof store.list)[number]

/** 时间戳 -> 本地可读时间 */
function formatTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function handleDelete(row: Row) {
  try {
    await store.removeNote(row.puuid)
    message.success('已删除')
  } catch {
    message.error('删除失败')
  }
}

const columns = computed<DataTableColumns<Row>>(() => [
  {
    type: 'expand',
    expandable: row => (row.encounters?.length ?? 0) > 0,
    renderExpand: row =>
      h('div', { style: 'padding:4px 0 8px' }, [
        h(MettingPlayersCard, { meetGames: row.encounters ?? [] })
      ])
  },
  {
    title: '标记',
    key: 'label',
    width: 90,
    render(row) {
      const meta = getNoteLabelMeta(row.label)
      return h(
        NTag,
        { type: meta.naiveType, size: 'small', round: true, bordered: false },
        { default: () => meta.text }
      )
    }
  },
  {
    title: '玩家',
    key: 'gameName',
    render(row) {
      return h('div', { style: 'display:flex;align-items:baseline;gap:2px;min-width:0' }, [
        h(
          NEllipsis,
          { style: 'max-width:160px;font-weight:600' },
          { default: () => row.gameName || '(未知)' }
        ),
        h('span', { style: 'color:var(--text-tertiary);font-size:12px' }, `#${row.tagLine}`)
      ])
    }
  },
  {
    title: '备注',
    key: 'note',
    render(row) {
      if (!row.note) return h('span', { style: 'color:var(--text-tertiary)' }, '—')
      return h(NEllipsis, { style: 'max-width:240px' }, { default: () => row.note })
    }
  },
  {
    title: '遇见',
    key: 'encounters',
    width: 72,
    render(row) {
      const n = row.encounters?.length ?? 0
      if (!n) return h('span', { style: 'color:var(--text-tertiary)' }, '—')
      return h(NTag, { size: 'small', round: true, bordered: false }, { default: () => `${n} 局` })
    }
  },
  {
    title: '更新时间',
    key: 'updatedAt',
    width: 150,
    render: row => formatTime(row.updatedAt)
  },
  {
    title: '操作',
    key: 'actions',
    width: 110,
    render(row) {
      return h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
        h(PlayerNoteBadge, {
          puuid: row.puuid,
          gameName: row.gameName,
          tagLine: row.tagLine,
          size: 'normal'
        }),
        h(
          NPopconfirm,
          { onPositiveClick: () => handleDelete(row), positiveText: '删除', negativeText: '取消' },
          {
            trigger: () =>
              h(NButton, { text: true, size: 'small', type: 'error' }, { default: () => '删除' }),
            default: () => '确定删除该玩家的备注？'
          }
        )
      ])
    }
  }
])
</script>
