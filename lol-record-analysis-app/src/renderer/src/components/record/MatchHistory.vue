<template>
  <n-flex vertical style="height: 100%; position: relative;">
    <n-flex>
      <n-select v-model:value="filterQueueId" placeholder="按模式筛选" @update:value="handleUpdateValue"
        :options="modeOptions" style="width: 150px" />
      <n-select v-model:value="filterChampionId" filterable placeholder="按英雄筛选" @update:value="handleUpdateValue"
        :options="championOptions" style="width: 150px" />
    </n-flex>
    <RecordCard v-for="(game, index) in matchHistory?.games?.games || []" :key="index" :record-type="true" :games="game"
      style="flex: 1; display: flex;">
    </RecordCard>

    <!-- 自定义分页组件 -->
    <div>
      <n-pagination style="margin-top: 0px;">
        <template #prev>
          <n-button size="tiny" @click="prevPage" :disabled="page == 1">
            <template #icon>
              <n-icon>
                <ArrowBack></ArrowBack>
              </n-icon>
            </template>
          </n-button>
        </template>
        <template #label>
          <span>{{ page }}</span>
        </template>
        <template #next>
          <n-button size="tiny" @click="nextPage">
            <template #icon>
              <n-icon>
                <ArrowForward></ArrowForward>
              </n-icon>
            </template>
          </n-button>
        </template>
      </n-pagination>
    </div>
  </n-flex>
</template>

<script setup lang="ts">
import http from '@renderer/services/http';
import RecordCard from './RecordCard.vue';
import { ArrowBack, ArrowForward } from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';
import { c, useLoadingBar } from 'naive-ui';
import { useRoute } from 'vue-router';

const filterQueueId = ref(0);
const filterChampionId = ref(0);
const modeOptions = [
  { label: "全部", value: 0 },
  { label: "单双排", value: 420 },
  { label: "匹配", value: 430 },
  { label: "灵活排", value: 440 },
  { label: "大乱斗", value: 450 },
  { label: "匹配", value: 490 },
  { label: "人机", value: 890 },
  { label: "无限乱斗", value: 900 },
  { label: "斗魂竞技场", value: 1700 },
  { label: "无限火力", value: 1900 },
];
const championOptions = [
  { label: "全部", value: 0 },
  { label: "黑暗之女", value: 1 },
  { label: "狂战士", value: 2 },
  { label: "正义巨像", value: 3 },
  { label: "卡牌大师", value: 4 },
  { label: "德邦总管", value: 5 },
  { label: "无畏战车", value: 6 },
  { label: "诡术妖姬", value: 7 },
  { label: "猩红收割者", value: 8 },
  { label: "远古恐惧", value: 9 },
  { label: "正义天使", value: 10 },
  { label: "无极剑圣", value: 11 },
  { label: "牛头酋长", value: 12 },
  { label: "符文法师", value: 13 },
  { label: "亡灵战神", value: 14 },
  { label: "战争女神", value: 15 },
  { label: "众星之子", value: 16 },
  { label: "迅捷斥候", value: 17 },
  { label: "麦林炮手", value: 18 },
  { label: "祖安怒兽", value: 19 },
  { label: "雪原双子", value: 20 },
  { label: "赏金猎人", value: 21 },
  { label: "寒冰射手", value: 22 },
  { label: "蛮族之王", value: 23 },
  { label: "武器大师", value: 24 },
  { label: "堕落天使", value: 25 },
  { label: "时光守护者", value: 26 },
  { label: "炼金术士", value: 27 },
  { label: "痛苦之拥", value: 28 },
  { label: "瘟疫之源", value: 29 },
  { label: "死亡颂唱者", value: 30 },
  { label: "虚空恐惧", value: 31 },
  { label: "殇之木乃伊", value: 32 },
  { label: "披甲龙龟", value: 33 },
  { label: "冰晶凤凰", value: 34 },
  { label: "恶魔小丑", value: 35 },
  { label: "祖安狂人", value: 36 },
  { label: "琴瑟仙女", value: 37 },
  { label: "虚空行者", value: 38 },
  { label: "刀锋舞者", value: 39 },
  { label: "风暴之怒", value: 40 },
  { label: "海洋之灾", value: 41 },
  { label: "英勇投弹手", value: 42 },
  { label: "天启者", value: 43 },
  { label: "瓦洛兰之盾", value: 44 },
  { label: "邪恶小法师", value: 45 },
  { label: "巨魔之王", value: 48 },
  { label: "诺克萨斯统领", value: 50 },
  { label: "皮城女警", value: 51 },
  { label: "蒸汽机器人", value: 53 },
  { label: "熔岩巨兽", value: 54 },
  { label: "不祥之刃", value: 55 },
  { label: "永恒梦魇", value: 56 },
  { label: "扭曲树精", value: 57 },
  { label: "荒漠屠夫", value: 58 },
  { label: "德玛西亚皇子", value: 59 },
  { label: "蜘蛛女皇", value: 60 },
  { label: "发条魔灵", value: 61 },
  { label: "齐天大圣", value: 62 },
  { label: "复仇焰魂", value: 63 },
  { label: "盲僧", value: 64 },
  { label: "暗夜猎手", value: 67 },
  { label: "机械公敌", value: 68 },
  { label: "魔蛇之拥", value: 69 },
  { label: "上古领主", value: 72 },
  { label: "大发明家", value: 74 },
  { label: "沙漠死神", value: 75 },
  { label: "狂野女猎手", value: 76 },
  { label: "兽灵行者", value: 77 },
  { label: "圣锤之毅", value: 78 },
  { label: "酒桶", value: 79 },
  { label: "不屈之枪", value: 80 },
  { label: "探险家", value: 81 },
  { label: "铁铠冥魂", value: 82 },
  { label: "牧魂人", value: 83 },
  { label: "离群之刺", value: 84 },
  { label: "狂暴之心", value: 85 },
  { label: "德玛西亚之力", value: 86 },
  { label: "曙光女神", value: 89 },
  { label: "虚空先知", value: 90 },
  { label: "刀锋之影", value: 91 },
  { label: "放逐之刃", value: 92 },
  { label: "深渊巨口", value: 96 },
  { label: "暮光之眼", value: 98 },
  { label: "光辉女郎", value: 99 },
  { label: "远古巫灵", value: 101 },
  { label: "龙血武姬", value: 102 },
  { label: "九尾妖狐", value: 103 },
  { label: "法外狂徒", value: 104 },
  { label: "潮汐海灵", value: 105 },
  { label: "不灭狂雷", value: 106 },
  { label: "傲之追猎者", value: 107 },
  { label: "惩戒之箭", value: 110 },
  { label: "深海泰坦", value: 111 },
  { label: "奥术先驱", value: 112 },
  { label: "北地之怒", value: 113 },
  { label: "无双剑姬", value: 114 },
  { label: "爆破鬼才", value: 115 },
  { label: "仙灵女巫", value: 117 },
  { label: "荣耀行刑官", value: 119 },
  { label: "战争之影", value: 120 },
  { label: "虚空掠夺者", value: 121 },
  { label: "诺克萨斯之手", value: 122 },
  { label: "未来守护者", value: 126 },
  { label: "冰霜女巫", value: 127 },
  { label: "皎月女神", value: 131 },
  { label: "德玛西亚之翼", value: 133 },
  { label: "暗黑元首", value: 134 },
  { label: "铸星龙王", value: 136 },
  { label: "影流之镰", value: 141 },
  { label: "暮光星灵", value: 142 },
  { label: "荆棘之兴", value: 143 },
  { label: "虚空之女", value: 145 },
  { label: "星籁歌姬", value: 147 },
  { label: "迷失之牙", value: 150 },
  { label: "生化魔人", value: 154 },
  { label: "疾风剑豪", value: 157 },
  { label: "虚空之眼", value: 161 },
  { label: "岩雀", value: 163 },
  { label: "青钢影", value: 164 },
  { label: "影哨", value: 166 },
  { label: "虚空女皇", value: 200 },
  { label: "弗雷尔卓德之心", value: 201 },
  { label: "戏命师", value: 202 },
  { label: "永猎双子", value: 203 },
  { label: "祖安花火", value: 221 },
  { label: "暴走萝莉", value: 222 },
  { label: "河流之王", value: 223 },
  { label: "狂厄蔷薇", value: 233 },
  { label: "破败之王", value: 234 },
  { label: "涤魂圣枪", value: 235 },
  { label: "圣枪游侠", value: 236 },
  { label: "影流之主", value: 238 },
  { label: "暴怒骑士", value: 240 },
  { label: "时间刺客", value: 245 },
  { label: "元素女皇", value: 246 },
  { label: "皮城执法官", value: 254 },
  { label: "暗裔剑魔", value: 266 },
  { label: "唤潮鲛姬", value: 267 },
  { label: "沙漠皇帝", value: 268 },
  { label: "魔法猫咪", value: 350 },
  { label: "沙漠玫瑰", value: 360 },
  { label: "魂锁典狱长", value: 412 },
  { label: "海兽祭司", value: 420 },
  { label: "虚空遁地兽", value: 421 },
  { label: "翠神", value: 427 },
  { label: "复仇之矛", value: 429 },
  { label: "星界游神", value: 432 },
  { label: "幻翎", value: 497 },
  { label: "逆羽", value: 498 },
  { label: "山隐之焰", value: 516 },
  { label: "解脱者", value: 517 },
  { label: "万花通灵", value: 518 },
  { label: "残月之肃", value: 523 },
  { label: "镕铁少女", value: 526 },
  { label: "血港鬼影", value: 555 },
  { label: "愁云使者", value: 711 },
  { label: "封魔剑魂", value: 777 },
  { label: "铁血狼母", value: 799 },
  { label: "流光镜影", value: 800 },
  { label: "腕豪", value: 875 },
  { label: "含羞蓓蕾", value: 876 },
  { label: "灵罗娃娃", value: 887 },
  { label: "炼金男爵", value: 888 },
  { label: "双界灵兔", value: 893 },
  { label: "不羁之悦", value: 895 },
  { label: "纳祖芒荣耀", value: 897 },
  { label: "炽炎雏龙", value: 901 },
  { label: "明烛", value: 902 },
  { label: "异画师", value: 910 },
  { label: "百裂冥犬", value: 950 }
];

const handleUpdateValue = () => {
  page.value = 1;
  console.log(filterQueueId.value)
  getHistoryMatch("", 0, 1500);
}

// 类型定义
export interface GameDetail {
  endOfGameResult: string;
  participantIdentities: {
    player: {
      accountId: string;
      platformId: string;
      gameName: string;
      tagLine: string;
      summonerName: string;
      summonerId: string;
    };
  }[];
  participants: {
    teamId: number;
    participantId: number;
    championId: number;
    championBase64: string;
    summonerName: string;
    summonerId: string;
  }[];
}

export interface ParticipantStats {
  win: boolean;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  item0Base64: string;
  item1Base64: string;
  item2Base64: string;
  item3Base64: string;
  item4Base64: string;
  item5Base64: string;
  item6Base64: string;
  perkPrimaryStyle: number;
  perkSubStyle: number;
  perkPrimaryStyleBase64: string;
  perkSubStyleBase64: string;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  goldSpent: number;
  totalDamageDealtToChampions: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHeal: number;
  totalMinionsKilled: number;
}

export interface Participant {
  win: boolean;
  participantId: number;
  teamId: number;
  championId: number;
  championBase64: string;
  spell1Id: number;
  spell1Base64: string;
  spell2Id: number;
  spell2Base64: string;
  stats: ParticipantStats;
}

export interface Game {
  mvp: string;
  gameDetail: GameDetail;
  gameId: number;
  gameCreationDate: string;
  gameDuration: number;
  gameMode: string;
  gameType: string;
  mapId: number;
  queueId: number;
  queueName: number;
  participantIdentities: {
    player: {
      accountId: string;
      platformId: string;
      gameName: string;
      tagLine: string;
      summonerName: string;
      summonerId: string;
    };
  }[];
  participants: Participant[];
}

export interface MatchHistory {
  platformId: string;
  beginIndex: number;
  endIndex: number;
  games: {
    gameDetail: GameDetail;
    games: Game[];
  };
}

const matchHistory = ref<MatchHistory>();

const loadingBar = useLoadingBar(); // 确保 useLoadingBar 在 setup 中正确调用

// 获取历史记录
const getHistoryMatch = async (name: string, begIndex: number, endIndex: number) => {
  loadingBar.start(); // 开始进度条


  try {
    const res = await http.get<MatchHistory>("/GetMatchHistory", {
      params: {
        filterQueueId: filterQueueId.value,
        filterChampionId: filterChampionId.value,
        begIndex: begIndex,
        endIndex: endIndex,
        name
      }
    });
    matchHistory.value = res.data;
    curBegIndex = res.data.beginIndex;
    curEndIndex = res.data.endIndex;

    loadingBar.finish(); // 加载完成时结束进度条
  } catch (error) {
    const res = await http.get<MatchHistory>("/GetMatchHistory");
    matchHistory.value = res.data;
    loadingBar.error(); // 发生错误时显示错误状态
  } finally {
    loadingBar.finish(); // 加载完成时结束进度条
  }

};
const page = ref(1)
var curBegIndex = 0;
var curEndIndex = 0;

const pageHistory = ref<{ begIndex: number, endIndex: number }[]>([]);


const nextPage = () => {
  if (filterQueueId.value != 0 || filterChampionId.value != 0) {
    getHistoryMatch(name, curEndIndex + 1, 1500).then(() => {
      page.value++
    });
  } else {
    getHistoryMatch(name, (page.value) * 10, (page.value) * 10 + 9).then(() => {
      page.value++
    });
  }
  pageHistory.value.push({ begIndex: curBegIndex, endIndex: curEndIndex });
}
const prevPage = () => {

  if (filterQueueId.value != 0 || filterChampionId.value != 0) {
    const lastPage = pageHistory.value.pop();
    if (!lastPage || lastPage.begIndex == null || lastPage.endIndex == null) {
      throw new Error("Last page's begIndex or endIndex is null or undefined");
    }
    getHistoryMatch(name, lastPage.begIndex, lastPage.endIndex).then(() => {
      page.value--
    });
  } else {
    getHistoryMatch(name, (page.value - 2) * 10, (page.value - 2) * 10 + 9).then(() => {
      page.value--
    })
  };

}

const route = useRoute()
let name = ""
onMounted(async () => {
  name = route.query.name as string
  await getHistoryMatch(name, 0, 9);
});
</script>
