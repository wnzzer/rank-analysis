<template>
<div>
    <n-layout has-sider>
        <n-layout-sider content-style="padding: 24px;">
         <UserRecord></UserRecord>
        </n-layout-sider>
        <n-layout-content content-style="padding: 24px;">
          平山道
        </n-layout-content>
      </n-layout>
</div>
</template>
<script lang="ts" setup>
import UserRecord from '@renderer/components/record/UserRecord.vue';

</script>