<template>
    <div>
        <n-flex justify="space-between">
            <n-flex vertical justify="space-between" style="gap: 0px; flex: 1; height: 90vh;">
                <n-card v-for="i in 5" key="i" style="flex:  1;">

                </n-card>
            </n-flex>
            <n-flex vertical justify="space-between" style="gap: 0px; flex: 1;">
                <n-card v-for="i in 5" key="i" style="flex:  1;">

                </n-card>
            </n-flex>

        </n-flex>
    </div>
</template>
<script lang="ts" setup>
</script>