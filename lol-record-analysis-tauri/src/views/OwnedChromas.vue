<template>
  <main class="chroma-page">
    <header class="chroma-header">
      <button type="button" class="back-link" @click="router.push(libraryPath)">
        ← 返回游戏资料库
      </button>
      <span>ACCOUNT INVENTORY · 账号只读</span>
      <h1>我的炫彩</h1>
      <p>只有这个页面需要连接并登录英雄联盟客户端；读取过程不会修改客户端或账号内容。</p>
    </header>

    <section class="chroma-panel">
      <div class="panel-heading">
        <div>
          <small>当前账号</small>
          <strong>{{ collection?.summonerName ?? '等待客户端连接' }}</strong>
        </div>
        <span v-if="collection">{{ collection.chromas.length }} 个炫彩</span>
      </div>

      <div v-if="loading" class="center-state"><n-spin size="large" /></div>
      <n-result v-else-if="error" status="warning" title="暂时无法读取炫彩" :description="error">
        <template #footer><n-button @click="load">连接客户端后重试</n-button></template>
      </n-result>
      <n-empty
        v-else-if="collection && !collection.chromas.length"
        description="客户端返回成功，但当前账号没有可显示的炫彩"
      />
      <template v-else-if="collection">
        <div v-if="collection.warning" class="warning">{{ collection.warning }}</div>
        <OwnedChromaGrid :chromas="collection.chromas" />
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NResult, NSpin } from 'naive-ui'
import OwnedChromaGrid from '@renderer/components/champions/OwnedChromaGrid.vue'
import { getOwnedChromas } from '@renderer/services/championCollection'
import type { OwnedChromaCollection } from '@renderer/types/domain/championCollection'

const props = withDefaults(defineProps<{ demo?: boolean }>(), { demo: false })
const router = useRouter()
const collection = ref<OwnedChromaCollection | null>(null)
const loading = ref(false)
const error = ref('')
const libraryPath = computed(() => (props.demo ? '/Champions/Demo' : '/Champions'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (props.demo && import.meta.env.DEV) {
      const { ownedChromaDemo } = await import('@renderer/dev/championCollectionDemo')
      collection.value = ownedChromaDemo
    } else {
      collection.value = await getOwnedChromas()
    }
  } catch (reason) {
    collection.value = null
    const detail = reason instanceof Error ? reason.message : String(reason)
    error.value = `${detail}。请确认客户端已启动并完成登录。`
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.chroma-page {
  min-height: 100%;
  padding: clamp(22px, 3vw, 42px);
  background:
    radial-gradient(
      circle at 12% 0,
      color-mix(in srgb, var(--semantic-win) 9%, transparent),
      transparent 28%
    ),
    var(--bg-base);
}
.chroma-header,
.chroma-panel {
  max-width: 1400px;
  margin-inline: auto;
}
.back-link {
  margin-bottom: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.chroma-header > span {
  display: block;
  color: var(--semantic-win-bright);
  font-size: 10px;
  letter-spacing: 0.18em;
}
h1 {
  margin: 7px 0 4px;
  color: var(--text-primary);
  font-size: 36px;
}
.chroma-header p {
  margin: 0 0 24px;
  color: var(--text-tertiary);
}
.chroma-panel {
  min-height: 420px;
  padding: 18px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-subtle);
}
.panel-heading div {
  display: grid;
  gap: 4px;
}
.panel-heading small {
  color: var(--text-disabled);
}
.panel-heading strong {
  color: var(--text-primary);
}
.panel-heading > span {
  color: var(--semantic-win-bright);
}
.center-state {
  display: grid;
  min-height: 340px;
  place-items: center;
}
.warning {
  margin-bottom: 12px;
  padding: 10px;
  border-left: 2px solid var(--semantic-warn);
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 8%, transparent);
}
</style>
