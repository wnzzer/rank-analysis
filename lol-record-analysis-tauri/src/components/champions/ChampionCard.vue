<template>
  <article class="champion-card" :class="direction ? `champion-card--${direction}` : ''">
    <LazyImg class="champion-portrait" :src="portraitUrl" :alt="champion.name" />
    <button
      v-if="change"
      type="button"
      class="change-corner"
      :class="`change-corner--${change.direction}`"
      :aria-label="`查看${champion.name}的${directionLabel}内容`"
      @click="$emit('show-change', change)"
    >
      <span>{{ directionIcon }}</span>
    </button>
    <div class="champion-copy">
      <strong>{{ champion.name }}</strong>
      <span>{{ champion.title }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import { assetPrefix } from '@renderer/services/http'
import type {
  ChampionCollectionItem,
  PatchChangeItem
} from '@renderer/types/domain/championCollection'

const props = defineProps<{
  champion: ChampionCollectionItem
  change?: PatchChangeItem
}>()

defineEmits<{
  'show-change': [change: PatchChangeItem]
}>()

const portraitUrl = computed(
  () => props.champion.portraitUrl ?? `${assetPrefix}/champion/${props.champion.id}`
)
const direction = computed(() => props.change?.direction)
const directionLabel = computed(() => {
  if (direction.value === 'buff') return '增强'
  if (direction.value === 'nerf') return '削弱'
  return '调整'
})
const directionIcon = computed(() => {
  if (direction.value === 'buff') return '↑'
  if (direction.value === 'nerf') return '↓'
  return '•'
})
</script>

<style scoped>
.champion-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: var(--shadow-card);
  transition:
    transform var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease-expo),
    box-shadow var(--dur-fast) var(--ease-expo);
}

.champion-card:hover {
  transform: translateY(-2px);
  border-color: var(--glass-border);
  box-shadow: var(--shadow-card-hover);
}

.champion-portrait {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-elevated);
}

.champion-portrait :deep(img) {
  object-fit: cover;
}

.champion-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px 10px;
  min-width: 0;
}

.champion-copy strong,
.champion-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.champion-copy strong {
  color: var(--text-primary);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
}

.champion-copy span {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.change-corner {
  position: absolute;
  top: 0;
  right: 0;
  width: 38px;
  height: 38px;
  padding: 0 5px 12px 17px;
  border: 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  color: white;
  cursor: pointer;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  transition: filter var(--dur-fast) var(--ease-expo);
}

.change-corner:hover {
  filter: brightness(1.18);
}

.change-corner--buff {
  background: var(--semantic-win);
}

.change-corner--nerf {
  background: var(--semantic-loss);
}

.change-corner--adjusted {
  background: var(--semantic-warn);
}
</style>
