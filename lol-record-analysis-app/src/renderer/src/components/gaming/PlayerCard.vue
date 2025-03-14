<template>
    <n-card style="flex: 1; height: 100%;" content-style="padding: 0; margin:5px">
        <div v-if="!sessionSummoner.summoner.gameName" style="position: relative; width: 100%; height: 100%;">
            <n-spin size="small" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" />
        </div>

        <n-flex style="gap: 1px;">
            <!-- 左侧卡片内容 -->
            <n-flex vertical style="flex: 3.1; gap: 4px;">
                <!-- 个人概览 -->
                <n-card :bordered="false" content-style="padding: 0;">
                    <n-flex>
                        <div style="position: relative;">
                            <img width="32x" height="32px"
                                :src="assetPrefix + sessionSummoner.championKey ? assetPrefix + sessionSummoner.championKey : nullImg"
                                style="vertical-align: middle;" />
                            <div
                                style="position: absolute; bottom: 9px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                {{ sessionSummoner?.summoner.summonerLevel }}
                            </div>
                        </div>
                        <n-flex vertical style="gap: 0;">
                            <n-flex>
                                <n-button text>

                                    <n-button text
                                        @click="searchSummoner(sessionSummoner?.summoner.gameName + '#' + sessionSummoner?.summoner.tagLine)">
                                        <n-ellipsis style="max-width: 110px">
                                            <span style="font-size: 13px; font-weight: bold;">
                                                {{ sessionSummoner?.summoner.gameName }}
                                            </span> </n-ellipsis>

                                    </n-button>
                                </n-button>

                            </n-flex>

                            <n-flex style="gap: 5px;">
                                <span style="color: #676768; font-size: 11px; margin-top: 2px;">
                                    #{{ sessionSummoner?.summoner.tagLine }}
                                </span>
                                <n-button text style="font-size: 12px; position: relative; bottom: 2px;"
                                    @click="copy(sessionSummoner.summoner.gameName + '#' + sessionSummoner.summoner.tagLine)">
                                    <n-icon>
                                        <copy-outline></copy-outline>
                                    </n-icon>
                                </n-button>
                                <span>
                                    <img style="width: 16px;height: 16px ;" :src="imgUrl" />
                                    <span style="font-size: 8px;">{{ tierCn
                                    }}</span>
                                </span>

                            </n-flex>
                        </n-flex>
                    </n-flex>
                </n-card>
                <!-- 战绩 -->


                <div>
                    <n-card v-for="(game, index) in sessionSummoner?.matchHistory.games.games.slice(0, 4)"
                    :key="index"                        content-style="padding: 0;  margin-left:5px;margin-right:5px" footer-style="padding:0">
                        <n-flex justify="space-between" style="gap: 0px; align-items: center;">
                            <span :style="{
                                fontWeight: '600',
                                color: game.participants[0].stats.win ? '#8BDFB7' : '#BA3F53',


                            }"> {{ game.participants[0].stats.win ? '胜' : '负' }}

                            </span>
                            <img :src="assetPrefix + game.participants[0]?.championKey"
                                style="width: auto; height: 24px;       vertical-align: middle;" />
                            <span style=" font-size: 12px;">
                                <span style="font-weight: 500; font-size: 12px;color: #8BDFB7">
                                    {{ game.participants[0].stats?.kills }}
                                </span>
                                /
                                <span style="font-weight: 500;font-size: 12px; color: #BA3F53">
                                    {{ game.participants[0].stats?.deaths }}
                                </span>
                                /

                                <span style="font-weight: 500;font-size: 12px; color: #D38B2A">
                                    {{ game.participants[0].stats?.assists }}
                                </span>

                            </span>
                            <span style="font-size: 9px;margin-right: 3px;">
                                {{ game.queueName ? game.queueName : '其他' }}
                            </span>

                        </n-flex>
                    </n-card>
                </div>
            </n-flex>
            <n-flex vertical style="flex: 3.1; gap: 4px; margin-right: 5px; margin-top: 11px;">

                <!-- 战绩 -->


                <div>
                    <n-card v-for="(game, index) in sessionSummoner?.matchHistory.games.games.slice(4, 9)"
                    :key="index + 4"                        content-style="padding: 0;  margin-left:5px;margin-right:5px" footer-style="padding:0">
                        <n-flex justify="space-between" style="gap: 0px; align-items: center;">
                            <span :style="{
                                fontWeight: '600',
                                color: game.participants[0].stats.win ? '#8BDFB7' : '#BA3F53',


                            }"> {{ game.participants[0].stats.win ? '胜' : '负' }}

                            </span>
                            <img :src="assetPrefix + game.participants[0]?.championKey"
                                style="width: auto; height: 24px;       vertical-align: middle;" />
                            <span style=" font-size: 12px;">
                                <span style="font-weight: 500; font-size: 12px;color: #8BDFB7">
                                    {{ game.participants[0].stats?.kills }}
                                </span>
                                /
                                <span style="font-weight: 500;font-size: 12px; color: #BA3F53">
                                    {{ game.participants[0].stats?.deaths }}
                                </span>
                                /

                                <span style="font-weight: 500;font-size: 12px; color: #D38B2A">
                                    {{ game.participants[0].stats?.assists }}
                                </span>

                            </span>
                            <span style="font-size: 9px;margin-right: 3px;">
                                {{ game.queueName ? game.queueName : '其他' }}
                            </span>

                        </n-flex>
                    </n-card>
                </div>
            </n-flex>

            <!-- 中间部分 -->
            <div style="flex: 4;">
                <n-flex vertical style="gap: 0px;">
                    <div style="margin-bottom: 2px;">

                        <n-flex>
                            <n-tag v-if="sessionSummoner.preGroupMarkers?.name" size="small"
                                :type="sessionSummoner.preGroupMarkers.type">
                                {{ sessionSummoner.preGroupMarkers.name }}
                            </n-tag>
                            <n-tag v-if="sessionSummoner.meetGames?.length > 0" type="warning" size="small" round>
                                <n-popover trigger="hover">
                                    <template #trigger>
                                        遇见过
                                    </template>
                                    <MettingPlayersCard :meet-games="sessionSummoner.meetGames"></MettingPlayersCard>
                                </n-popover>
                            </n-tag>
                            <n-tooltip trigger="hover" v-for="tag in sessionSummoner?.userTag.tag">
                                <template #trigger>
                                    <n-button size="tiny" :type="tag.good ? 'primary' : 'error'">
                                        {{ tag.tagName }}
                                    </n-button> </template>
                                <span>{{ tag.tagDesc }}</span>
                            </n-tooltip>



                        </n-flex>
                    </div>
                    <!-- 20场统计 -->
                    <n-card class="recent-card" :bordered="false" content-style="padding:5px">
                        <n-flex vertical style="position: relative; gap: 5px; ">

                            <n-flex class="stats-item" justify="space-between">

                                <span class="stats-label">
                                    <n-flex style="gap: 5px;">
                                        <n-progress style=" width: 10px; position: relative; bottom: 5px; "
                                            type="circle" :show-indicator="false" :percentage="70" :height="24"
                                            status="success" color="bule" />

                                        <span>KDA:</span>
                                    </n-flex>
                                </span>
                                <span class="stats-value">
                                    <n-flex>
                                        <span :style="{ color: kdaColor(sessionSummoner?.userTag.recentData.kda) }">{{
                                            sessionSummoner?.userTag.recentData.kda
                                        }}</span>
                                        <span>
                                            <span
                                                :style="{ color: killsColor(sessionSummoner?.userTag.recentData.kills) }">
                                                {{ sessionSummoner?.userTag.recentData.kills
                                                }}
                                            </span>
                                            /
                                            <span
                                                :style="{ color: deathsColor(sessionSummoner?.userTag.recentData.deaths) }">{{
                                                    sessionSummoner?.userTag.recentData.deaths
                                                }}</span>
                                            /
                                            <span
                                                :style="{ color: assistsColor(sessionSummoner?.userTag.recentData.assists) }">{{
                                                    sessionSummoner?.userTag.recentData.assists
                                                }}</span>
                                        </span>

                                    </n-flex>
                                </span>
                            </n-flex>
                            <n-flex class="stats-item" justify="space-between">
                                <span class="stats-label"> 胜率（{{ typeCn ?
                                    typeCn : "单双排" }}）:</span>
                                <n-flex>
                                    <span style="width: 65px;"
                                        :style="{ color: groupRateColor(sessionSummoner?.userTag.recentData.groupRate) }">
                                        <n-progress type="line"
                                            :percentage="winRate(sessionSummoner?.userTag.recentData, modeType)"
                                            :height="6" :show-indicator="false"
                                            :color="winRateColor(winRate(sessionSummoner?.userTag.recentData, modeType))"
                                            processing :stroke-width="10"
                                            style="position: relative; top: 7px;"></n-progress>
                                    </span>
                                    <span class="stats-value" :style="{
                                        color: winRateColor(winRate(sessionSummoner?.userTag.recentData, modeType))
                                    }">
                                        {{
                                            winRate(sessionSummoner?.userTag.recentData, modeType)
                                        }}%
                                    </span>

                                </n-flex>
                            </n-flex>
                            <n-flex class="stats-item" justify="space-between">
                                <span class="stats-label"> 参团率：</span>
                                <n-flex>
                                    <span style="width: 65px;"
                                        :style="{ color: groupRateColor(sessionSummoner?.userTag.recentData.groupRate) }">
                                        <n-progress type="line"
                                            :percentage="sessionSummoner?.userTag.recentData.groupRate" :height="6"
                                            :show-indicator="false"
                                            :color="groupRateColor(sessionSummoner?.userTag.recentData.groupRate)"
                                            processing :stroke-width="10"
                                            style="position: relative; top: 7px;"></n-progress>
                                    </span>
                                    <span class="stats-value"
                                        :style="{ color: groupRateColor(sessionSummoner?.userTag.recentData.groupRate) }">{{
                                            sessionSummoner?.userTag.recentData.groupRate
                                        }}%</span>

                                </n-flex>
                            </n-flex>
                            <n-flex class="stats-item" justify="space-between">
                                <span class="stats-label"> 伤害/占比：</span>
                                <span class="stats-value">
                                    <n-flex>
                                        <span>
                                            {{ sessionSummoner?.userTag.recentData.averageDamageDealtToChampions }}
                                        </span>
                                        <span style="width: 45px;"> <n-progress type="line"
                                                :percentage="sessionSummoner?.userTag.recentData.damageDealtToChampionsRate"
                                                :color="otherColor(sessionSummoner?.userTag.recentData.damageDealtToChampionsRate)"
                                                :height="6" :show-indicator="false" processing :stroke-width="13"
                                                style="position: relative; top: 7px;"></n-progress>
                                        </span>
                                        <span class="stats-value"
                                            :style="{ color: otherColor(sessionSummoner?.userTag.recentData.damageDealtToChampionsRate) }">
                                            {{ sessionSummoner?.userTag.recentData.damageDealtToChampionsRate }}%

                                        </span>
                                    </n-flex>
                                </span>
                            </n-flex>





                        </n-flex>
                    </n-card>
                </n-flex>
            </div>
        </n-flex>
    </n-card>
</template>
<script lang="ts" setup>
import MettingPlayersCard from './MettingPlayersCard.vue';
import { useCopy } from '@renderer/components/composition';
import { searchSummoner } from '@renderer/components/record/composition';
import { kdaColor, killsColor, deathsColor, assistsColor, otherColor, winRateColor, groupRateColor, } from '@renderer/components/record/composition'
import { SessionSummoner } from "../../components/gaming/type";
import nullImg from "../../assets/imgs/item/null.png";
import { RecentData } from '../record/type';
import { CopyOutline } from '@vicons/ionicons5';
import {assetPrefix} from '../../services/http';
const copy = useCopy().copy;
defineProps<{
    sessionSummoner: SessionSummoner
    typeCn: string
    modeType: string
    imgUrl: string
    tierCn: string
}>();
function winRate(rencentData: RecentData, type: string) {
    if (type === "") {
        return 0;
    }

    if (type === "RANKED_FLEX_SR") {
        // 处理分母为 0 的情况
        const totalFlexGames = rencentData.flexWins + rencentData.flexLosses;
        if (totalFlexGames === 0) {
            return 0; // 或者可以选择返回 null、-1、或者其他你认为合适的值
        }
        return Math.round((rencentData.flexWins) / totalFlexGames * 100);
    } else {
        // 处理分母为 0 的情况
        const totalGames = rencentData.wins + rencentData.losses;
        if (totalGames === 0) {
            return 0; // 同样可以根据需求返回其他值
        }
        return Math.round(rencentData.wins / totalGames * 100);
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