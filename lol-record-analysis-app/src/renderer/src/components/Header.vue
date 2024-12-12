<template>
    <n-flex justify="space-between" style="width: 100%;    pointer-events: auto;
">
        <div style="width: 33%; text-align: center;">左侧固定</div>
        <div style="flex: 1; text-align: center;">
            <n-input class="input-lolid" type="text" size="tiny" placeholder="输入召唤师">
                <template #suffix>
                    <!-- <n-icon :component="FlashOutline" /> -->
                </template>
            </n-input>
        </div>
        <div style="width: 33%; text-align: center;"></div>
    </n-flex>
</template>
<script lang="ts" setup>
</script>
<style lang="css">
.input-lolid{
    -webkit-app-region: no-drag;
    pointer-events: auto;
}
</style>