<template>
    <el-card :style="divStyle">
        <n-flex>
            <div style=" display: flex; flex-direction: column; height: 7%; width: 7%; position: relative;">
                <span class="win-font">胜利</span>
                <img src="https://07akioni.oss-cn-beijing.aliyuncs.com/07akioni.jpeg" style=" object-fit: cover;" />
                <!-- <div class="mvp">mvp</div> -->

            </div>

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
        background = 'linear-gradient(120deg, rgba(2,63,80,1.00) 30%, rgba(44, 44, 44, 0.5))';
    } else if (props.recordType === 'loss') {
        // 失败背景颜色
        background = 'linear-gradient(120deg, rgba(245, 6, 6, 0.2) 30%, rgba(44, 44, 44, 0.5))';
    } else if (props.recordType === 'remake') {
        // 重开背景颜色（假设用默认灰色背景）
        background = 'linear-gradient(120deg, rgba(133, 133, 133, 1) 30%, rgba(44, 44, 44, 0.5))';
    }

    return { background };

});
</script>

<style>
/* 默认背景颜色，避免没有 recordType 时出现空白 */
.record-card {
    background: linear-gradient(120deg, rgb(133, 133, 133) 30%, rgba(44, 44, 44, 0.5));
}

.win-font {
    color: #03c2f7;
    font-weight: 300;
}

.mvp {
    --color-main100: #28344E;
    --color-main200: #2F436E;
    --color-main300: #2F436E;
    --color-main400: #4171D6;
    --color-main500: #5383E8;
    --color-main600: #5383E8;
    --color-main700: #5383E8;
    --color-main800: #81ACFF;
    --color-main900: #81ACFF;
    --color-gray0: #31313C;
    --color-gray100: #282830;
    --color-gray200: #1C1C1F;
    --color-gray250: #424254;
    --color-gray300: #515163;
    --color-gray400: #7B7A8E;
    --color-gray500: #9E9EB1;
    --color-gray600: #9E9EB1;
    --color-gray700: #B7B7C9;
    --color-gray800: #B7B7C9;
    --color-gray900: #FFF;
    --color-red100: #59343B;
    --color-red200: #703C47;
    --color-red300: #703C47;
    --color-red400: #D31A45;
    --color-red500: #E84057;
    --color-red600: #E84057;
    --color-red700: #E84057;
    --color-red800: #FF6C81;
    --color-red900: #FF6C81;
    --color-orange100: #703100;
    --color-orange200: #8E3E00;
    --color-orange300: #8E3E00;
    --color-orange400: #F06F00;
    --color-orange500: #FF8200;
    --color-orange600: #FF8200;
    --color-orange700: #FF8200;
    --color-orange800: #FF9F4A;
    --color-orange900: #FF9F4A;
    --color-yellow100: #4A340E;
    --color-yellow200: #76480F;
    --color-yellow300: #76480F;
    --color-yellow400: #E28400;
    --color-yellow500: #EB9C00;
    --color-yellow600: #EB9C00;
    --color-yellow700: #EB9C00;
    --color-yellow800: #FFB900;
    --color-yellow900: #FFB900;
    --color-green100: #304A1D;
    --color-green200: #24662B;
    --color-green300: #24662B;
    --color-green400: #139020;
    --color-green500: #00AE0A;
    --color-green600: #00AE0A;
    --color-green700: #00AE0A;
    --color-green800: #6CC92D;
    --color-green900: #6CC92D;
    --color-teal100: #1D4346;
    --color-teal200: #00666E;
    --color-teal300: #00666E;
    --color-teal400: #00A399;
    --color-teal500: #00BBA3;
    --color-teal600: #00BBA3;
    --color-teal700: #00BBA3;
    --color-teal800: #00D7B0;
    --color-teal900: #00D7B0;
    --color-blue100: #183955;
    --color-blue200: #114882;
    --color-blue300: #114882;
    --color-blue400: #006DE2;
    --color-blue500: #0093FF;
    --color-blue600: #0093FF;
    --color-blue700: #0093FF;
    --color-blue800: #00B8ED;
    --color-blue900: #00B8ED;
    --color-purple100: #332353;
    --color-purple200: #3F2A75;
    --color-purple300: #3F2A75;
    --color-purple400: #6B42DC;
    --color-purple500: #7D59EA;
    --color-purple600: #7D59EA;
    --color-purple700: #7D59EA;
    --color-purple800: #A072FF;
    --color-purple900: #A072FF;
    --color-pink100: #5F225E;
    --color-pink200: #8F178D;
    --color-pink300: #8F178D;
    --color-pink400: #D932D6;
    --color-pink500: #E537A2;
    --color-pink600: #D932D6;
    --color-pink700: #D932D6;
    --color-pink800: #B920B7;
    --color-pink900: #B920B7;
    --color-bronze100: #3A3734;
    --color-bronze200: #52493F;
    --color-bronze300: #52493F;
    --color-bronze400: #7C6750;
    --color-bronze500: #907659;
    --color-bronze600: #907659;
    --color-bronze700: #907659;
    --color-bronze800: #A88A67;
    --color-bronze900: #A88A67;
    --color-homeDesktop: #1C1C1F;
    --color-homeMobile: #1C1C1F;
    --color-badgeGray400: #57646F;
    --color-darkpurple700: #424254;
    --color-darkpurple300: #9E9EB1;
    text-size-adjust: 100%;
    --main100: #ECF2FF;
    --main200: #D5E3FF;
    --main300: #B3CDFF;
    --main400: #81ACFF;
    --main500: #5383E8;
    --main600: #4171D6;
    --main700: #2F5EC0;
    --main800: #2F436E;
    --main900: #28344E;
    --gray0: #FFF;
    --gray100: #F7F7F9;
    --gray200: #ebeef1;
    --gray250: #DBE0E4;
    --gray300: #C3CBD1;
    --gray400: #9AA4AF;
    --gray500: #758592;
    --gray600: #57646F;
    --gray700: #44515C;
    --gray800: #34414D;
    --gray900: #202D37;
    --red100: #FFF1F3;
    --red200: #FFD8D9;
    --red300: #FFBAC3;
    --red400: #FF6C81;
    --red500: #E84057;
    --red600: #D31A45;
    --red700: #B61337;
    --red800: #703C47;
    --red900: #59343B;
    --orange100: #FFF1E6;
    --orange200: #FFD1A9;
    --orange300: #FCB77A;
    --orange400: #FF9F4A;
    --orange500: #FF8200;
    --orange600: #F06F00;
    --orange700: #C55900;
    --orange800: #8E3E00;
    --orange900: #703100;
    --yellow100: #FFF9DB;
    --yellow200: #FEEC9C;
    --yellow300: #FFD424;
    --yellow400: #FFB900;
    --yellow500: #EB9C00;
    --yellow600: #E28400;
    --yellow700: #AC6306;
    --yellow800: #76480F;
    --yellow900: #4A340E;
    --green100: #E6F7DB;
    --green200: #D0F1BB;
    --green300: #A8E082;
    --green400: #6CC92D;
    --green500: #00AE0A;
    --green600: #139020;
    --green700: #1B7D25;
    --green800: #24662B;
    --green900: #304A1D;
    --teal100: #E5FAF3;
    --teal200: #BBECDB;
    --teal300: #89DFC4;
    --teal400: #00D7B0;
    --teal500: #00BBA3;
    --teal600: #00A399;
    --teal700: #008889;
    --teal800: #00666E;
    --teal900: #1D4346;
    --blue100: #DDF9FF;
    --blue200: #90E5F7;
    --blue300: #52D5F3;
    --blue400: #00B8ED;
    --blue500: #0093FF;
    --blue600: #006DE2;
    --blue700: #095BB3;
    --blue800: #114882;
    --blue900: #183955;
    --purple100: #F3EEFF;
    --purple200: #DECFFF;
    --purple300: #C0A5FF;
    --purple400: #A072FF;
    --purple500: #7D59EA;
    --purple600: #6B42DC;
    --purple700: #5836B2;
    --purple800: #3F2A75;
    --purple900: #332353;
    --pink100: #FFE4F4;
    --pink200: #FFCDEA;
    --pink300: #FF9BD2;
    --pink400: #F56CB6;
    --pink500: #E537A2;
    --pink600: #D932D6;
    --pink700: #B920B7;
    --pink800: #8F178D;
    --pink900: #5F225E;
    --bronze100: #F6EDE3;
    --bronze200: #E6D4BF;
    --bronze300: #D7B792;
    --bronze400: #A88A67;
    --bronze500: #907659;
    --bronze600: #7C6750;
    --bronze700: #6B5D4D;
    --bronze800: #52493F;
    --bronze900: #3A3734;
    --homeDesktop: #5383E8;
    --homeMobile: #ebeef1;
    --badgeGray400: #9AA4AF;
    --darkpurple700: #424254;
    --darkpurple300: #9E9EB1;
    border-collapse: collapse;
    border-spacing: 0px;
    text-align: center;
    white-space: nowrap;
    font-family: Roboto, sans-serif;
    background-color: var(--yellow500);
    color: rgb(255, 255, 255);
    border-radius: 9px;
    margin-left: 4px;
    padding: 0px 8px;
    height: 14px;
    line-height: 16px;
    font-size: 10px;
    font-weight: normal;
    max-width: 40px;
    box-sizing: border-box;
    position: absolute;
    right: 0;
    bottom: 0;
}
</style>