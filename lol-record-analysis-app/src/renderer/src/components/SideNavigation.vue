<template>
    <n-flex justify="space-between" style="height: 90vh;" vertical>
        <n-menu :collapsed="true" :collapsed-width="60" :collapsed-icon-size="20" :options="menuOptions" />
        <div class="loadingIcon" style="margin-left: 13px;">
            
            <n-popover trigger="hover">
    <template #trigger>
        <n-button circle>
                <n-icon size="20" class="rotating-icon">
                    <Reload />
                </n-icon>
            </n-button>    </template>
    <span>等待连接服务器</span>
  </n-popover>
        </div>
    </n-flex>
</template>

<script setup lang="ts">
import { Reload, BarChart } from '@vicons/ionicons5'
import { MenuOption, NIcon } from 'naive-ui';
import { Component, h } from 'vue';

function renderIcon(icon: Component) {
    return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: MenuOption[] = [
    {
        label: '战绩',
        key: 'record',
        icon: renderIcon(BarChart)
    },
    {
        label: '对局',
        key: 'load',
        icon: renderIcon(Reload)
    }
]
</script>

<style lang="css" scoped>
.left-container {
    width: 60px;
    height: 100vh;
}

@keyframes rotate {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}

.rotating-icon {
    animation: rotate 2s linear infinite;
}
</style>
