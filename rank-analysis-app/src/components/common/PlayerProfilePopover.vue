<template>
  <n-popover
    v-if="active"
    trigger="hover"
    placement="right"
    :delay="250"
    :flip="true"
    :style="{ padding: '0', background: 'var(--bg-elevated)' }"
  >
    <template #trigger>
      <slot />
    </template>
    <PlayerProfileCard :puuid="puuid" :name="name" :champion-id="championId" :region="region" />
  </n-popover>
  <slot v-else />
</template>

<script setup lang="ts">
/**
 * 玩家画像 hover 弹层：把任意触发器（玩家名等）包上 NPopover，
 * 内容是 PlayerProfileCard。用于战绩详情/对局内各挂载点。
 *
 * - active=false（无 puuid / 隐藏战绩）时原样渲染 trigger，不包弹层
 * - 走 fetchPlayerProfile（LRU 缓存），hover 才触发查询
 * - region 非空（跨区战绩页等 SGP 来源场景）时画像卡启用 SGP 战绩兜底
 */
import PlayerProfileCard from '@renderer/components/common/PlayerProfileCard.vue'
import { NPopover } from 'naive-ui'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    puuid?: string
    /** 展示名（缺省时画像卡用 puuid 前 8 位） */
    name?: string
    /** 本局英雄 id（有则画像卡显示熟练度小节） */
    championId?: number
    /** 跨区大区 platformId（SGP 战绩兜底用） */
    region?: string
  }>(),
  { puuid: '', name: '', championId: 0, region: '' }
)

const active = computed(() => props.puuid.length > 0)
</script>
