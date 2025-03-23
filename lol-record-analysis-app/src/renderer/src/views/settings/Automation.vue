<template>
  <n-space vertical>
    <!-- Display Settings -->
    <n-card>
      <n-text tag="div" class="setting-title">基本设置</n-text>

      <n-space vertical>
        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#2080f0"><Flash /></n-icon>
            自动接受对局
          </span>
          <n-switch v-model:value="autoAccept" />
        </div>

        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#18a058"><CheckmarkCircle /></n-icon>
            自动选择英雄
          </span>
          <n-switch v-model:value="autoPick" />
        </div>
        <n-flex>
          <VueDraggable ref="el" v-model="myListData">
            <n-tag v-for="item in myListData" round closable :bordered="false" style="margin-right: 15px;">
              {{ item.label }}
              <template #avatar>
                <n-avatar :src="assetPrefix + 'champion' + item.value" />
              </template>
            </n-tag>
          </VueDraggable>
          <n-select v-model:value="selectChampionId" filterable :filter="filterChampionFunc" placeholder="添加英雄"
            :render-tag="renderSingleSelectTag" :render-label="renderLabel" :options="championOptions" size="small"
            style="width: 170px" @update:value="handleUpdateValue" />
        </n-flex>
        <n-text depth="3" style="font-size: 12px">拖动可以改变选择英雄的优先级</n-text>
        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" color="#d03050"><Close /></n-icon>
            自动禁止英雄
          </span>
          <n-switch v-model:value="autoBan" />
        </div>
        <n-flex>
          <VueDraggable ref="el" v-model="myListData">
          <n-tag v-for="item in myListData" round closable :bordered="false" style="margin-right: 15px;">
            {{ item.label }}
            <template #avatar>
              <n-avatar :src="assetPrefix + 'champion' + item.value" />
            </template>
          </n-tag>
        </VueDraggable>
        <n-select v-model:value="selectChampionId" filterable :filter="filterChampionFunc" placeholder="添加英雄"
          :render-tag="renderSingleSelectTag" :render-label="renderLabel" :options="championOptions" size="small"
          style="width: 170px" @update:value="handleUpdateValue" />
        </n-flex>
        <n-text depth="3" style="font-size: 12px">拖动可以改变禁用英雄的优先级</n-text>

      </n-space>
    </n-card>

  </n-space>
</template>
<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { ref } from 'vue'
import { renderSingleSelectTag, renderLabel, championOptions, filterChampionFunc } from '@renderer/components/composition'
import { CheckmarkCircle, Flash, Close } from '@vicons/ionicons5'
import { assetPrefix } from '@renderer/services/http'

const autoAccept = ref(false)
const autoPick = ref(false)
const autoBan = ref(false)

const selectChampionId = ref(null)

const myListData = ref([
  { label: '山隐之焰', value: 516, realName: '奥恩', nickname: '山羊' },
  { label: '正义巨像', value: 517, realName: '加里奥', nickname: '雕像' },
  // More items...
]);

const handleOrderChange = (newList) => {
  console.log('Order changed:', newList);
};

// Helper settings
</script>

<style scoped>
.setting-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 16px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.setting-label {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon {
  font-style: normal;
}
</style>