<template>
  <div v-if="groups.length" class="chroma-groups">
    <section v-for="group in groups" :key="group.skinId" class="chroma-group">
      <LazyImg
        class="skin-tile"
        :src="group.skinImageUrl ?? `${assetPrefix}/skin/${group.skinId}`"
        :alt="group.skinName"
      />
      <div class="skin-overlay" />
      <div class="skin-copy">
        <span>{{ group.championName }}</span>
        <strong>{{ group.skinName }}</strong>
        <div class="chroma-list">
          <article v-for="chroma in group.chromas" :key="chroma.chromaId" class="chroma-chip">
            <div class="chroma-icon" :style="{ background: chromaGradient(chroma.colors) }">
              <LazyImg
                v-if="chroma.chromaImageUrl"
                :src="chroma.chromaImageUrl"
                :alt="chroma.chromaName"
              />
              <LazyImg
                v-else-if="!chroma.skinImageUrl"
                :src="`${assetPrefix}/chroma/${chroma.chromaId}`"
                :alt="chroma.chromaName"
              />
            </div>
            <div class="chroma-copy">
              <span>{{ chroma.chromaName }}</span>
              <div class="color-row" aria-hidden="true">
                <i
                  v-for="color in chroma.colors"
                  :key="color"
                  :style="{ backgroundColor: color }"
                />
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import { assetPrefix } from '@renderer/services/http'
import type { OwnedChroma } from '@renderer/types/domain/championCollection'

const props = defineProps<{
  chromas: OwnedChroma[]
}>()

interface ChromaGroup {
  skinId: number
  championName: string
  skinName: string
  skinImageUrl?: string
  chromas: OwnedChroma[]
}

const groups = computed(() => {
  const bySkin = new Map<number, ChromaGroup>()
  for (const chroma of props.chromas) {
    const group = bySkin.get(chroma.skinId)
    if (group) {
      group.chromas.push(chroma)
    } else {
      bySkin.set(chroma.skinId, {
        skinId: chroma.skinId,
        championName: chroma.championName,
        skinName: chroma.skinName,
        skinImageUrl: chroma.skinImageUrl,
        chromas: [chroma]
      })
    }
  }
  return [...bySkin.values()]
})

function chromaGradient(colors: string[]): string {
  if (!colors.length) return 'var(--bg-elevated)'
  return `conic-gradient(${colors.join(', ')})`
}
</script>

<style scoped>
.chroma-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: var(--space-16);
}

.chroma-group {
  position: relative;
  min-height: 220px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  box-shadow: var(--shadow-card);
}

.skin-tile {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.skin-tile :deep(img) {
  object-fit: cover;
}

.skin-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(8, 10, 12, 0.96) 0%,
    rgba(8, 10, 12, 0.82) 62%,
    rgba(8, 10, 12, 0.42) 100%
  );
}

.skin-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-20);
}

.skin-copy > span {
  color: rgba(255, 255, 255, 0.58);
  font-size: var(--font-size-xs);
}

.skin-copy > strong {
  color: rgba(255, 255, 255, 0.95);
  font-size: var(--font-size-lg);
}

.chroma-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  margin-top: var(--space-12);
}

.chroma-chip {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 130px;
  padding: var(--space-6) var(--space-8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md);
  background: rgba(6, 8, 10, 0.62);
  backdrop-filter: blur(8px);
}

.chroma-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.14);
}

.chroma-icon :deep(.lazy-img) {
  width: 100%;
  height: 100%;
}

.chroma-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  color: rgba(255, 255, 255, 0.86);
  font-size: var(--font-size-xs);
}

.color-row {
  display: flex;
  gap: 3px;
}

.color-row i {
  width: 13px;
  height: 4px;
  border-radius: var(--radius-pill);
}
</style>
