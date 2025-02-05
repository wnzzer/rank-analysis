<template>
  <n-layout has-sider style="height: 100%;">
    <n-layout-sider>

      <UserRecord></UserRecord>
    </n-layout-sider>
    <n-layout-content style="flex: 3; padding-left: 5px; padding-right: 5x; padding-top: 5px;padding-bottom: 1px;">
      <div>
        <MatchHistory />
      </div>
    </n-layout-content>
  </n-layout>
</template>
<script lang="ts" setup>
import MatchHistory from '@renderer/components/record/MatchHistory.vue';
import UserRecord from '@renderer/components/record/UserRecord.vue';

</script>