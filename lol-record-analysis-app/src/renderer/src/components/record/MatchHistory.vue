<template>
  <n-flex vertical style="height: 100%;">
    <div >
      <RecordCard :record-type="'win'" v-for="i in 10" :key="i" class="item">

        >
      </RecordCard>
    </div>

  </n-flex>

</template>
<script setup lang="ts">
import RecordCard from './RecordCard.vue';

</script>
