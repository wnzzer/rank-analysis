<template>
<div style="width: 100%;">
    <n-layout has-sider>
          <n-layout-sider>
         <UserRecord></UserRecord>
        </n-layout-sider>
        <n-layout-content style="flex: 3; padding-left: 24px; padding-right: 24px; padding-top: 4px;">
        <div style="width: 100%;">
          <MatchHistory />
        </div>
      </n-layout-content>
      </n-layout>
</div>
</template>
<script lang="ts" setup>
import MatchHistory from '@renderer/components/record/MatchHistory.vue';
import UserRecord from '@renderer/components/record/UserRecord.vue';

</script>