<template>
  <n-flex vertical style="height: 100vh;">
      <RecordCard v-for="i in 10" :record-type="'win'" style="flex: 1; display: flex; ">
        
      </RecordCard>
      <div style="flex: 1; display: flex; flex-direction: column;"></div>
  </n-flex>
</template>
<script setup lang="ts">
import RecordCard from './RecordCard.vue';

</script>
