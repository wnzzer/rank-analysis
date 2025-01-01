<template>
    <n-layout has-sider style="height: 100%;">
          <n-layout-sider>
         <UserRecord></UserRecord>
        </n-layout-sider>
        <n-layout-content style="flex: 3; padding-left: 14px; padding-right: 14px; padding-top: 3px;padding-bottom: 1px;">
        <div style=" ">
          <MatchHistory />
        </div>
      </n-layout-content>
      </n-layout>
</template>
<script lang="ts" setup>
import MatchHistory from '@renderer/components/record/MatchHistory.vue';
import UserRecord from '@renderer/components/record/UserRecord.vue';

</script>