<template>
    <div style="max-width: 520px;">
        <n-flex>
            <n-card v-for="meetGame in meetGames" style="width: 250px;"
                content-style="padding: 0;  margin-left:5px;margin-right:5px;" footer-style="padding:0">
                <n-flex justify="space-between" style="gap: 0px; align-items: center;">

                    <span :style="{
                        fontWeight: '600',
                        color: meetGame.win ? '#8BDFB7' : '#BA3F53',


                    }"> {{ meetGame.win ? '胜' : '负' }}

                    </span>
                    <span style="font-size: 11px;">
                        <n-icon style="margin-right: 3px;">
                        <CalendarNumber></CalendarNumber>
                    </n-icon>
                        {{ getFormattedDate(meetGame?.gameCreatedAt) }}

                    </span>

                   
                    <img :src="assetPrefix + meetGame.championKey"
                        style="width: auto; height: 24px;       vertical-align: middle;" />
                    <span style=" font-size: 12px;">
                        <span style="font-weight: 500; font-size: 12px;color: #8BDFB7">
                            {{ meetGame?.kills }}
                        </span>
                        /
                        <span style="font-weight: 500;font-size: 12px; color: #BA3F53">
                            {{ meetGame.deaths }}
                        </span>
                        /

                        <span style="font-weight: 500;font-size: 12px; color: #D38B2A">
                            {{ meetGame?.assists }}
                        </span>

                    </span>

                    <span style="font-size: 11px;">
                        {{ meetGame.queueIdCn ? meetGame.queueIdCn : '其他' }}
                    </span>
                    
                    <span style="font-size: 9px;margin-right: 3px;">
                        <!-- {{ meetGame. ? game.queueName : '其他' }} -->
                    </span>
                    <span :style="{
                        fontWeight: '600',
                        color: meetGame.isMyTeam ? '#8BDFB7' : '#BA3F53',


                    }"> {{ meetGame.isMyTeam ? '友' : '敌' }}

                    </span>

                </n-flex>
            </n-card></n-flex>
    </div>
</template>
<script setup lang="ts">
import { OneGamePlayer } from '../record/type';
import { CalendarNumber } from '@vicons/ionicons5';
import {assetPrefix} from '../../services/http';
function getFormattedDate(dateString: string) {
    const date = new Date(dateString);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');  // 月份从0开始，所以加1
    const day = date.getDate().toString().padStart(2, '0');  // 确保两位数格式
    return `${month} / ${day}`;
};
defineProps<{
    meetGames: OneGamePlayer[]
}>();
</script>