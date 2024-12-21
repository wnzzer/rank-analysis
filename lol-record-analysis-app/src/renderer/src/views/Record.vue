<template>
<div>
    <n-layout has-sider>
        <n-layout-sider>
         <UserRecord></UserRecord>
        </n-layout-sider>
        <n-layout-content content-style="padding: 24px; width: 1000px">
          <div style="width: 1000px;">
            <MatchHistory></MatchHistory>

          </div>
        </n-layout-content>
      </n-layout>
</div>
</template>
<script lang="ts" setup>
import MatchHistory from '@renderer/components/record/MatchHistory.vue';
import UserRecord from '@renderer/components/record/UserRecord.vue';

</script>