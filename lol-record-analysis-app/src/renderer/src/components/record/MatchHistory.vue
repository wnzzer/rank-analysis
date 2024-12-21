<template>
<n-flex vertical style="height: 850px;">
    <div style="background-color: aliceblue;" v-for="i in 10" :key="i" class="item">
      {{ i }}
    </div>
</n-flex>


</template>
<script setup lang="ts">
</script>