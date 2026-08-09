<template>
  <n-card class="record-card-skeleton" content-style="padding: var(--space-8) var(--space-12);">
    <n-flex align="center" justify="space-between">
      <n-flex align="center" :size="12">
        <n-skeleton :width="4" :height="44" :sharp="true" />
        <n-skeleton circle :width="44" />
        <n-flex vertical :size="6">
          <n-skeleton :width="60" :height="12" />
          <n-skeleton :width="100" :height="10" />
        </n-flex>
      </n-flex>
      <n-skeleton :width="80" :height="20" />
      <n-skeleton :width="160" :height="32" />
    </n-flex>
  </n-card>
</template>

<script setup lang="ts">
import { NCard, NFlex, NSkeleton } from 'naive-ui'
</script>

<style scoped>
.record-card-skeleton {
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-8);
}
</style>
