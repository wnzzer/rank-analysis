<template>
  <div class="library">
    <PageStage kicker="LIBRARY · 资产与标记" title="资 产 库" sub="标签规则 · 我标记过的人" compact>
      <template #actions>
        <button class="btn gho sm" @click="goTags">
          管理标签规则<ArrowUpRight class="btn-arrow" />
        </button>
      </template>
    </PageStage>

    <div class="lib-grid">
      <section class="lib-col">
        <h3 class="lib-h">我标记过的人</h3>
        <PlayerNotesView />
      </section>
      <section class="lib-col">
        <h3 class="lib-h">标签速览</h3>
        <p class="psub">
          标签规则的创建与条件编辑在独立页维护；命中后会在对局分析卡片上以统一标签行展示。
          我标记过的人支持展开查看历次相遇明细。
        </p>
        <button class="btn pri sm lib-go" @click="goTags">打开标签管理</button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Library —— 资产库（设计系统 v3 §C5）
 * 把「我标记过的人」从设置升格为高频资产页；标签管理保留在
 * /Settings/Tags（条件编辑器较重，不做双入口复用），此处给直达入口。
 */
import { useRouter } from 'vue-router'

import PageStage from '../components/ui/PageStage.vue'
import PlayerNotesView from './settings/PlayerNotes.vue'
import { ArrowUpRight } from 'lucide-vue-next'

const router = useRouter()
function goTags() {
  router.push({ name: 'Tags' })
}
</script>

<style scoped>
.library {
  max-width: 1180px;
  margin: 0 auto;
}
.lib-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  gap: var(--space-20);
  align-items: start;
  padding: var(--space-20) var(--space-24) var(--space-28);
}
.lib-h {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: var(--space-12);
}
.psub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  line-height: 1.7;
}
.btn {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  padding: 6px 14px;
  cursor: pointer;
  border: none;
  clip-path: var(--clip-notch);
}
.btn.pri {
  background: var(--brand-gradient);
  color: var(--text-on-brand);
}
.btn.gho {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
}
.btn.gho:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
}
.btn-arrow {
  width: 11px;
  height: 11px;
  margin-left: 4px;
}
.lib-go {
  margin-top: var(--space-12);
}
@media (max-width: 1080px) {
  .lib-grid {
    grid-template-columns: 1fr;
  }
}
</style>
