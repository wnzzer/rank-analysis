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
                :style="{ borderColor: borderFor(identity) }"
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
import { computed } from 'vue'
import { NTag, NFlex, NPopover, NButton, NAvatar } from 'naive-ui'
import type { MatchPlayerIdentity, Participant } from '@renderer/types/domain/match'
import itemNull from '@renderer/assets/imgs/item/null.png'
import { assetPrefix } from '@renderer/services/http'

const props = defineProps<{
  identities: MatchPlayerIdentity[]
  participants: Participant[]
  teamOffset: 0 | 5
  currentPlayerKey: string
  isDark: boolean
}>()

const emit = defineEmits<{
  'nav-to-name': [name: string]
}>()

const slotIdentities = computed(() => props.identities.slice(props.teamOffset, props.teamOffset + 5))

function nameOf(identity: MatchPlayerIdentity | undefined) {
  if (!identity) return ''
  return `${identity.player.gameName}#${identity.player.tagLine}`
}

function avatarSrcAt(idx: number) {
  const championId = props.participants[props.teamOffset + idx]?.championId
  return championId ? `${assetPrefix}/champion/${championId}` : itemNull
}

function borderFor(identity: MatchPlayerIdentity | undefined) {
  if (nameOf(identity) === props.currentPlayerKey) {
    return props.isDark ? '#63e2b7' : '#0d9488'
  }
  return props.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.25)'
}

function navigate(identity: MatchPlayerIdentity | undefined) {
  const name = nameOf(identity)
  if (name) emit('nav-to-name', name)
}
</script>
