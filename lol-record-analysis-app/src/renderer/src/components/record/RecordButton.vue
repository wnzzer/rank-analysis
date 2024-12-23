<template>
    <n-button ghost :type="buttonType" size="tiny">
      <slot></slot>
      <template v-if="recordType === 'good'">
        <n-icon style="margin-left: 5px;">
          <ArrowUp />
        </n-icon>
      </template>
      <template v-else-if="recordType === 'bad'">
        <n-icon style="margin-left: 5px;">
          <ArrowDown />
        </n-icon>
      </template>
    </n-button>
  </template>
  

<script lang="ts" setup>
import { computed } from "vue";
import { ArrowDown, ArrowUp } from "@vicons/ionicons5";

// 接收 props
const props = defineProps<{
    recordType?: 'good' | 'bad' | '';
}>();

// 计算按钮类型
const buttonType = computed(() => {
    if (props.recordType === 'good') {
        return 'success';
    } else if (props.recordType === 'bad') {
        return 'error';
    } else {
        return '';
    }
});
</script>