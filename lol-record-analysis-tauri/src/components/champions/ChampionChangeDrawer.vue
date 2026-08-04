<template>
  <n-drawer :show="show" :width="430" placement="right" @update:show="$emit('update:show', $event)">
    <n-drawer-content closable>
      <template #header>
        <div class="drawer-heading">
          <span class="direction-dot" :class="`direction-dot--${change?.direction}`" />
          <div>
            <strong>{{ champion?.name }}</strong>
            <span>{{ directionLabel }}</span>
          </div>
        </div>
      </template>

      <div v-if="change" class="change-content">
        <div class="patch-meta">
          <span>{{ patchLabel }}</span>
          <span>{{ publishedAt }}</span>
        </div>
        <ol class="change-lines">
          <li v-for="(line, index) in change.lines" :key="`${index}-${line}`">{{ line }}</li>
        </ol>
        <button v-if="sourceUrl" type="button" class="source-link" @click="openSource">
          查看国服官方公告 ↗
        </button>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  ChampionCollectionItem,
  PatchChangeItem
} from '@renderer/types/domain/championCollection'

const props = defineProps<{
  show: boolean
  champion: ChampionCollectionItem | null
  change: PatchChangeItem | null
  patchLabel: string
  publishedAt: string
  sourceUrl: string
}>()

defineEmits<{
  'update:show': [show: boolean]
}>()

const directionLabel = computed(() => {
  if (props.change?.direction === 'buff') return '本版本增强'
  if (props.change?.direction === 'nerf') return '本版本削弱'
  return '本版本机制调整'
})

async function openSource() {
  if (!props.sourceUrl) return
  if ('__TAURI_INTERNALS__' in window) {
    await openUrl(props.sourceUrl)
  } else {
    window.open(props.sourceUrl, '_blank', 'noopener,noreferrer')
  }
}
</script>

<style scoped>
.drawer-heading {
  display: flex;
  align-items: center;
  gap: var(--space-10);
}

.drawer-heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drawer-heading strong {
  color: var(--text-primary);
  font-size: var(--font-size-lg);
}

.drawer-heading span:last-child {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.direction-dot {
  width: 9px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--semantic-warn);
}

.direction-dot--buff {
  background: var(--semantic-win);
}

.direction-dot--nerf {
  background: var(--semantic-loss);
}

.patch-meta {
  display: flex;
  justify-content: space-between;
  padding-bottom: var(--space-16);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.change-lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  margin: var(--space-20) 0;
  padding-left: 22px;
  color: var(--text-secondary);
  font-size: var(--font-size-base);
  line-height: 1.65;
}

.change-lines li::marker {
  color: var(--semantic-win);
  font-weight: var(--font-weight-semibold);
}

.source-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--semantic-win-bright);
  cursor: pointer;
  font-size: var(--font-size-sm);
  text-decoration: none;
}

.source-link:hover {
  text-decoration: underline;
}
</style>
