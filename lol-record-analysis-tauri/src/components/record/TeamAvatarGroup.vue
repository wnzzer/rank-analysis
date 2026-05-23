<template>
  <n-tag :bordered="false" size="small">
    <template #avatar>
      <n-flex>
        <n-popover v-for="(identity, idx) in slotIdentities" :key="idx" trigger="hover">
          <template #trigger>
            <n-button text @click.stop="navigate(identity)">
              <n-avatar
                :bordered="true"
                :src="avatarSrcAt(idx)"
                :fallback-src="itemNull"
                class="team-avatar"
                :class="{ 'team-avatar-current': isCurrentPlayer(identity) }"
              />
            </n-button>
          </template>
          <span>{{ nameOf(identity) }}</span>
        </n-popover>
      </n-flex>
    </template>
  </n-tag>
</template>

<script setup lang="ts">
/**
 * 队伍头像列表
 *
 * 在战绩卡右侧展示一队 5 个队友的英雄头像，
 * 当前查询的玩家用 `--semantic-win` 高亮边框，其他人用淡描边，
 * 颜色随 CSS 主题变量自动切换。
 */
import { computed } from 'vue'
import { NTag, NFlex, NPopover, NButton, NAvatar } from 'naive-ui'
import type { MatchPlayerIdentity, Participant } from '@renderer/types/domain/match'
import itemNull from '@renderer/assets/imgs/item/null.png'
import { assetPrefix } from '@renderer/services/http'

const props = defineProps<{
  /** 全部 10 名玩家的身份信息（蓝队 5 + 红队 5） */
  identities: MatchPlayerIdentity[]
  /** 全部 10 名玩家的对局参与数据 */
  participants: Participant[]
  /** 当前队伍偏移：0 表示蓝队，5 表示红队 */
  teamOffset: 0 | 5
  /** 当前正在查询的玩家 key（gameName#tagLine） */
  currentPlayerKey: string
  /**
   * 是否暗色主题（仅保留以兼容父组件调用签名，
   * 实际配色已迁到 CSS 变量自动跟随主题）
   */
  isDark?: boolean
}>()

const emit = defineEmits<{
  'nav-to-name': [name: string]
}>()

const slotIdentities = computed(() =>
  props.identities.slice(props.teamOffset, props.teamOffset + 5)
)

function nameOf(identity: MatchPlayerIdentity | undefined) {
  if (!identity) return ''
  return `${identity.player.gameName}#${identity.player.tagLine}`
}

function avatarSrcAt(idx: number) {
  const championId = props.participants[props.teamOffset + idx]?.championId
  return championId ? `${assetPrefix}/champion/${championId}` : itemNull
}

function isCurrentPlayer(identity: MatchPlayerIdentity | undefined) {
  return nameOf(identity) === props.currentPlayerKey
}

function navigate(identity: MatchPlayerIdentity | undefined) {
  const name = nameOf(identity)
  if (name) emit('nav-to-name', name)
}
</script>

<style scoped>
/* 普通队友头像：使用 text-tertiary 作为淡描边，跟随主题自动切换 */
.team-avatar {
  border-color: var(--text-tertiary);
}

/* 当前查询玩家：用 win 色高亮边框 */
.team-avatar.team-avatar-current {
  border-color: var(--semantic-win);
}
</style>
