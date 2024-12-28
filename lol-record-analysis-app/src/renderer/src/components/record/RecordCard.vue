<template>
    <el-card :style="divStyle" style="height: 100%;">
        <n-flex>
            <n-flex vertical style="height: 100%; overflow: hidden;">
                <span style="flex: 1; overflow: hidden;">胜利</span>
                <n-image src="https://07akioni.oss-cn-beijing.aliyuncs.com/07akioni.jpeg"
                    style="flex: 9; object-fit: cover; max-height: 100%;" />
            </n-flex>

        </n-flex>
    </el-card>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

// 接收 props
const props = defineProps<{
    recordType?: 'win' | 'loss' | 'remake';
}>();

// 计算样式
const divStyle = computed(() => {
    console.log(props.recordType);
    let background = '';
    if (props.recordType === 'win') {
        // 胜利背景颜色
        background = 'linear-gradient(120deg, rgba(139, 223, 183, 1) 30%, rgba(44, 44, 44, 0.5))';
    } else if (props.recordType === 'loss') {
        // 失败背景颜色
        background = 'linear-gradient(120deg, rgba(245, 6, 6, 0.2) 30%, rgba(44, 44, 44, 0.5))';
    } else if (props.recordType === 'remake') {
        // 重开背景颜色（假设用默认灰色背景）
        background = 'linear-gradient(120deg, rgba(133, 133, 133, 1) 30%, rgba(44, 44, 44, 0.5))';
    }
    const height = '2vh';

    return { background, height };
});
</script>

<style>
/* 默认背景颜色，避免没有 recordType 时出现空白 */
.record-card {
    background: linear-gradient(120deg, rgba(133, 133, 133, 1) 30%, rgba(44, 44, 44, 0.5));
}
</style>