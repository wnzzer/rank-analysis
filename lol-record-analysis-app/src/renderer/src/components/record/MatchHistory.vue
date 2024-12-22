<template>
 <n-flex vertical style="height: 85vh;">
    <div
      style="background-color: aliceblue; flex: 1; display: flex; justify-content: center; align-items: center;"
      v-for="i in 10"
      :key="i"
      class="item"
    >
      {{ i }}
    </div>
  </n-flex>

</template>
<script setup lang="ts">
</script>