<template>
    <template v-if="!sessionData.phase">
        <LoadingComponent>等待加入游戏...</LoadingComponent>
    </template>
    <template v-else>
        <div>
            <n-flex justify="space-between" style="height: 93vh;;">
                <!-- 左侧部分 -->

                <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <PlayerCard v-for="(sessionSummoner,i) of sessionData.teamOne" :key="'teamOne' + i" :session-summoner="sessionSummoner" :mode-type="sessionData.type" :type-cn="sessionData.typeCn" :img-url="comImgTier.teamOne[i]?.imgUrl" :tier-cn="comImgTier.teamOne[i]?.tierCn"></PlayerCard>
                </n-flex>

                <!-- 右侧部分 -->
                <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <PlayerCard v-for="(sessionSummoner,i) of sessionData.teamTwo" :key="'teamTwo' + i" :session-summoner="sessionSummoner" :mode-type="sessionData.type" :type-cn="sessionData.typeCn" :img-url="comImgTier.teamTwo[i]?.imgUrl" :tier-cn="comImgTier.teamTwo[i]?.tierCn"></PlayerCard>
                </n-flex>
                </n-flex>
            </n-flex>
        </div>
    </template>
</template>

<script lang="ts" setup>

import http from '../services/http';
import { computed, onMounted, onUnmounted, reactive } from 'vue';

import unranked from '../assets/imgs/tier/unranked.png';
import bronze from '../assets/imgs/tier/bronze.png';
import silver from '../assets/imgs/tier/silver.png';
import gold from '../assets/imgs/tier/gold.png';
import platinum from '../assets/imgs/tier/platinum.png';
import diamond from '../assets/imgs/tier/diamond.png';
import master from '../assets/imgs/tier/master.png';
import grandmaster from '../assets/imgs/tier/grandmaster.png';
import challenger from '../assets/imgs/tier/challenger.png';
import iron from '../assets/imgs/tier/iron.png';
import emerald from '../assets/imgs/tier/emerald.png';
import LoadingComponent from '../components/LoadingComponent.vue';
import PlayerCard from '../components/gaming/PlayerCard.vue';
import { SessionData } from '../components/gaming/type';
/**
* Returns the image path for the given rank tier.
* This function dynamically requires the image based on the provided tier string,
* converting it to lowercase to ensure correct file name matching.
*
* @param {string} tier - The rank tier to get the image for.
* @returns {string} - The path to the rank tier image.
*/
interface ComImgTier {
    teamOne: { imgUrl: string, tierCn: string }[];
    teamTwo: { imgUrl: string, tierCn: string }[];
}

const comImgTier = computed(() => {
    const comImgTier: ComImgTier = {
        teamOne: [],
        teamTwo: [],
    };


    const tierImages: { [key: string]: any } = {
        unranked: unranked,
        bronze: bronze,
        silver: silver,
        gold: gold,
        platinum: platinum,
        diamond: diamond,
        master: master,
        grandmaster: grandmaster,
        challenger: challenger,
        iron: iron,
        emerald: emerald,
    };





    // 处理 teamOne
    for (const sessionSummoner of sessionData.teamOne) {
        let tierNormalized = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier
            ? tierImages[sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase()]
            : unranked;

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier) {
            tierNormalized = tierImages[sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase()];
        }


        let tierCn = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn
            ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2) + " " +  sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.division 
            : '无';

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn) {
            tierCn = sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2) + " " +  sessionSummoner.rank.queueMap.RANKED_FLEX_SR.division;
        }


        comImgTier.teamOne.push({
            imgUrl: tierNormalized,
            tierCn: tierCn,
        });
    }

    // 处理 teamTwo
    for (const sessionSummoner of sessionData.teamTwo) {
        let tierNormalized = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier
            ? tierImages[sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase()]
            : unranked;

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier) {
            tierNormalized = tierImages[sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase()];
        }


        let tierCn = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn
            ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2) + " " +  sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.division
            : '无';

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn) {
            tierCn = sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2) + " " +  sessionSummoner.rank.queueMap.RANKED_FLEX_SR.division;
        }


        comImgTier.teamTwo.push({
            imgUrl: tierNormalized,
            tierCn: tierCn,
        });
    }

    return comImgTier;
});

const sessionData = reactive<SessionData>(
    {
        phase: "",
        type: "",
        typeCn: "",
        teamOne: [],
        teamTwo: [],

    },

);
let timer: ReturnType<typeof setInterval> | null = null;
var isRequesting = false;

onMounted(async () => {
    // 第一次请求
    await GetSessionData();

    // 启动定时器
    timer = setInterval(async () => {
        if (!isRequesting) {
            try {
                isRequesting = true; // 设置为请求中
                await GetSessionData(); // 等待请求完成
            } catch (error) {
                console.error('请求失败', error);
                // 错误处理，例如重试机制等
            } finally {
                isRequesting = false; // 请求完成，允许下一个请求
            }
        }
    }, 5000);
});

onUnmounted(() => {
    if (timer) {
        clearInterval(timer); // 在组件卸载时清理定时器
    }
});
async function GetSessionData() {

    const res = await http.get<SessionData>("/GetSessionData");
    if (res.status == 200) {
        if (res.data.phase != "") {
            sessionData.phase = res.data.phase;
            sessionData.type = res.data.type;
            sessionData.typeCn = res.data.typeCn;
            if (Array.isArray(res.data.teamOne)) {
                sessionData.teamOne = res.data.teamOne;
            } else {
                sessionData.teamOne = [];
            }
            if (Array.isArray(res.data.teamTwo)) {
                sessionData.teamTwo = res.data.teamTwo;
            } else {
                sessionData.teamTwo = [];
            }
        }
    }
}


</script>
<style lang="css" scoped>
.champion-img {
    width: 100%;
    ;
    /* 限制图片宽度不超过容器 */
    height: 100%;
    /* 限制图片高度不超过容器 */
    object-fit: cover;
    /* 保持图片的比例并裁剪溢出的部分 */
    display: inline-block;

}

.stats-title {
    font-weight: bold;
}

.stats-item {
    display: flex;
    justify-content: space-between;
}

.stats-label {
    font-size: 10px;

    color: #ccc;
}

.stats-value {
    font-size: 10px;
    color: #ffffff;
    /* 绿色表示积极数据 */
}

.recent-card {
    background: #28282B;
    /* 半透明背景 */
    border-radius: 8px;
    /* 圆角边框 */
    color: #fff;
    /* 白色字体 */
}


</style>
