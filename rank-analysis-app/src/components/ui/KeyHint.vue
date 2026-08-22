<template>
  <span class="kbd">{{ keys }}</span>
</template>

<script setup lang="ts">
/**
 * KeyHint —— 快捷键角标（设计系统 v3 §7.9）
 * 用法：<KeyHint keys="Ctrl K" /> 或嵌入按钮/tooltip 内。
 */
defineProps<{ /** 键位文本，如 "Ctrl K" / "/" / "ESC" */ keys: string }>()
</script>

<style scoped>
.kbd {
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  padding: 1px 6px;
  background: var(--bg-raised);
}
</style>
