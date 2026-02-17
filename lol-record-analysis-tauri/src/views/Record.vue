<template>
  <n-layout has-sider style="height: 100%" :collapsed="windowWidth < 500">
    <n-layout-sider
      :collapsed-width="windowWidth < 500 ? '100%' : undefined"
      :width="windowWidth < 500 ? '100%' : undefined"
    >
      <UserRecord></UserRecord>
    </n-layout-sider>
    <n-layout-content class="record-content" style="flex: 3" v-show="windowWidth >= 500">
      <div>
        <MatchHistory />
      </div>
    </n-layout-content>
  </n-layout>
</template>
<script lang="ts" setup>
import MatchHistory from '../components/record/MatchHistory.vue'
import UserRecord from '../components/record/UserRecord.vue'
import { ref, onMounted, onUnmounted } from 'vue'

const windowWidth = ref(window.innerWidth)

const updateWidth = () => {
  windowWidth.value = window.innerWidth
}

onMounted(async () => {
  window.addEventListener('resize', updateWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateWidth)
})
</script>
<style scoped>
.record-content {
  padding: var(--space-20);
  padding-top: var(--space-16);
}
</style>
