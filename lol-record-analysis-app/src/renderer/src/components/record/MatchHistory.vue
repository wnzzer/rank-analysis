<template>
  <n-scrollbar style="max-height: 800px">

    <div class="ratio-container">

      <n-flex vertical class="content-wrapper" style="height: 100%; position: relative">
        <n-flex>
          <n-select v-model:value="filterQueueId" placeholder="按模式筛选" :options="modeOptions" size="small"
            style="width: 100px" @update:value="handleUpdateValue" />
          <n-select v-model:value="filterChampionId" filterable :filter="filterChampionFunc" placeholder="按英雄筛选"
            :render-tag="renderSingleSelectTag" :render-label="renderLabel" :options="championOptions" size="small"
            style="width: 170px" @update:value="handleUpdateValue" />

          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text style="font-size: 24px" @click="resetFilter">
                <n-icon>
                  <Repeat />
                </n-icon>
              </n-button>
            </template>
            复位
          </n-tooltip>
        </n-flex>

        <RecordCard v-for="(game, index) in matchHistory?.games?.games || []" :key="index" :record-type="true"
          :games="game">
        </RecordCard>

        <!-- 自定义分页组件 -->

        <div class="pagination">
          <n-pagination style="margin-top: 0px">
            <template #prev>
              <n-button size="tiny" :disabled="page == 1 || isRequestingMatchHostory" @click="prevPage">
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
              <n-button size="tiny" @click="nextPage" :disabled="isRequestingMatchHostory">
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
    </div>
  </n-scrollbar>

</template>

<script setup lang="ts">
import http from '@renderer/services/http'
import { assetPrefix } from '@renderer/services/http'
import RecordCard from './RecordCard.vue'
import { ArrowBack, ArrowForward, Repeat } from '@vicons/ionicons5'
import { h, onMounted, ref } from 'vue'
import {NAvatar, SelectRenderLabel, SelectRenderTag, useLoadingBar } from 'naive-ui'
import { useRoute } from 'vue-router'

const filterQueueId = ref(0)
const filterChampionId = ref(0)
const modeOptions = [
  { label: '全部', value: 0 },
  { label: '单双排', value: 420 },
  { label: '匹配', value: 430 },
  { label: '灵活排', value: 440 },
  { label: '大乱斗', value: 450 },
  { label: '匹配', value: 490 },
  { label: '人机', value: 890 },
  { label: '无限乱斗', value: 900 },
  { label: '斗魂竞技场', value: 1700 },
  { label: '无限火力', value: 1900 }
]
function filterChampionFunc(input, option) {
  if (!input) return true
  const searchText = input.toLowerCase()
  // 对 label、realName、nickname 都进行过滤判断，注意需要判断字符串是否存在
  const { label, realName, nickname } = option
  return (
    (label && label.toLowerCase().includes(searchText)) ||
    (realName && realName.toLowerCase().includes(searchText)) ||
    (nickname && nickname.toLowerCase().includes(searchText))
  )
}
const championOptions = [
  {
    label: '全部', value: 0, realName: '', nickname: '', icon: () => h(NAvatar, {
      src: `${assetPrefix}/assets/champion1`,
      round: true,
      size: 24
    })
  },
  {
    label: '黑暗之女', value: 1, realName: '安妮', nickname: '火女', icon: () => h(NAvatar, {
      src: `${assetPrefix}/assets/champion1`,
      round: true,
      size: 24
    })
  },
  { label: '狂战士', value: 2, realName: '奥拉夫', nickname: '大头' },
  { label: '正义巨像', value: 3, realName: '加里奥', nickname: '城墙' },
  { label: '卡牌大师', value: 4, realName: '崔斯特', nickname: '卡牌' },
  { label: '德邦总管', value: 5, realName: '赵信', nickname: '菊花信|赵神王' },
  { label: '无畏战车', value: 6, realName: '厄加特', nickname: '螃蟹' },
  { label: '诡术妖姬', value: 7, realName: '乐芙兰', nickname: 'LB' },
  { label: '猩红收割者', value: 8, realName: '弗拉基米尔', nickname: '吸血鬼' },
  { label: '远古恐惧', value: 9, realName: '费德提克', nickname: '稻草人' },
  { label: '正义天使', value: 10, realName: '凯尔', nickname: '天使' },
  { label: '无极剑圣', value: 11, realName: '易', nickname: '' },
  { label: '牛头酋长', value: 12, realName: '阿利斯塔', nickname: '牛头' },
  { label: '符文法师', value: 13, realName: '瑞兹', nickname: '光头' },
  { label: '亡灵战神', value: 14, realName: '赛恩', nickname: '老司机' },
  { label: '战争女神', value: 15, realName: '希维尔', nickname: '轮子妈' },
  { label: '众星之子', value: 16, realName: '索拉卡', nickname: '奶妈' },
  { label: '迅捷斥候', value: 17, realName: '提莫', nickname: '蘑菇' },
  { label: '麦林炮手', value: 18, realName: '崔丝塔娜', nickname: '小炮' },
  { label: '祖安怒兽', value: 19, realName: '沃里克', nickname: '狼人' },
  { label: '雪原双子', value: 20, realName: '努努和威朗普', nickname: '雪人' },
  { label: '赏金猎人', value: 21, realName: '厄运小姐', nickname: '女枪' },
  { label: '寒冰射手', value: 22, realName: '艾希', nickname: '刮痧女王' },
  { label: '蛮族之王', value: 23, realName: '泰达米尔', nickname: '蛮王' },
  { label: '武器大师', value: 24, realName: '贾克斯', nickname: '武器' },
  { label: '堕落天使', value: 25, realName: '莫甘娜', nickname: '' },
  { label: '时光守护者', value: 26, realName: '基兰', nickname: '时光老头' },
  { label: '炼金术士', value: 27, realName: '辛吉德', nickname: '炼金' },
  { label: '痛苦之拥', value: 28, realName: '伊芙琳', nickname: '寡妇' },
  { label: '瘟疫之源', value: 29, realName: '图奇', nickname: '老鼠' },
  { label: '死亡颂唱者', value: 30, realName: '卡尔萨斯', nickname: '死歌' },
  { label: '虚空恐惧', value: 31, realName: '科加斯', nickname: '大虫子' },
  { label: '殇之木乃伊', value: 32, realName: '阿木木', nickname: '木乃伊' },
  { label: '披甲龙龟', value: 33, realName: '拉莫斯', nickname: '龙龟' },
  { label: '冰晶凤凰', value: 34, realName: '艾尼维亚', nickname: '凤凰' },
  { label: '恶魔小丑', value: 35, realName: '萨科', nickname: '小丑' },
  { label: '祖安狂人', value: 36, realName: '蒙多医生', nickname: '蒙多' },
  { label: '琴瑟仙女', value: 37, realName: '娑娜', nickname: '琴女' },
  { label: '虚空行者', value: 38, realName: '卡萨丁', nickname: '电耗子' },
  { label: '刀锋舞者', value: 39, realName: '卡特琳娜', nickname: '卡特' },
  { label: '风暴之怒', value: 40, realName: '杰娜', nickname: '风女' },
  { label: '海洋之灾', value: 41, realName: '普朗克', nickname: '船长' },
  { label: '英勇投弹手', value: 42, realName: '库奇', nickname: '飞机' },
  { label: '天启者', value: 43, realName: '卡尔玛', nickname: '扇子妈' },
  { label: '瓦洛兰之盾', value: 44, realName: '塔里克', nickname: '宝石' },
  { label: '邪恶小法师', value: 45, realName: '维迦', nickname: '小法' },
  { label: '巨魔之王', value: 48, realName: '特朗德尔', nickname: '巨魔' },
  { label: '诺克萨斯统领', value: 50, realName: '斯维因', nickname: '乌鸦' },
  { label: '皮城女警', value: 51, realName: '凯特琳', nickname: '女警' },
  { label: '蒸汽机器人', value: 53, realName: '布里茨', nickname: '机器人' },
  { label: '熔岩巨兽', value: 54, realName: '墨菲特', nickname: '石头人' },
  { label: '不祥之刃', value: 55, realName: '卡特琳娜', nickname: '卡特' },
  { label: '永恒梦魇', value: 56, realName: '魔腾', nickname: '梦魇' },
  { label: '扭曲树精', value: 57, realName: '茂凯', nickname: '大树' },
  { label: '荒漠屠夫', value: 58, realName: '雷克顿', nickname: '鳄鱼' },
  { label: '德玛西亚皇子', value: 59, realName: '嘉文四世', nickname: '皇子' },
  { label: '蜘蛛女皇', value: 60, realName: '伊莉丝', nickname: '蜘蛛' },
  { label: '发条魔灵', value: 61, realName: '奥莉安娜', nickname: '发条' },
  { label: '齐天大圣', value: 62, realName: '孙悟空', nickname: '猴子' },
  { label: '复仇焰魂', value: 63, realName: '布兰德', nickname: '火男' },
  { label: '盲僧', value: 64, realName: '李青', nickname: '瞎子' },
  { label: '暗夜猎手', value: 67, realName: '薇恩', nickname: 'VN|uzi|UZI' },
  { label: '机械公敌', value: 68, realName: '兰博', nickname: '机器人' },
  { label: '魔蛇之拥', value: 69, realName: '卡西奥佩娅', nickname: '蛇女' },
  { label: '上古领主', value: 72, realName: '斯卡纳', nickname: '蝎子' },
  { label: '大发明家', value: 74, realName: '海默丁格', nickname: '大头' },
  { label: '沙漠死神', value: 75, realName: '内瑟斯', nickname: '狗头' },
  { label: '狂野女猎手', value: 76, realName: '奈德丽', nickname: '豹女' },
  { label: '兽灵行者', value: 77, realName: '乌迪尔', nickname: '德鲁伊' },
  { label: '圣锤之毅', value: 78, realName: '波比', nickname: '锤石' },
  { label: '酒桶', value: 79, realName: '古拉加斯', nickname: '酒桶' },
  { label: '不屈之枪', value: 80, realName: '潘森', nickname: '斯巴达' },
  { label: '探险家', value: 81, realName: '伊泽瑞尔', nickname: 'EZ' },
  { label: '铁铠冥魂', value: 82, realName: '莫德凯撒', nickname: '铁男' },
  { label: '牧魂人', value: 83, realName: '约里克', nickname: '掘墓者' },
  { label: '离群之刺', value: 84, realName: '阿卡丽', nickname: '阿卡丽' },
  { label: '狂暴之心', value: 85, realName: '凯南', nickname: '电耗子' },
  { label: '德玛西亚之力', value: 86, realName: '盖伦', nickname: '草丛伦' },
  { label: '曙光女神', value: 89, realName: '蕾欧娜', nickname: '日女' },
  { label: '虚空先知', value: 90, realName: '玛尔扎哈', nickname: '蚂蚱' },
  { label: '刀锋之影', value: 91, realName: '泰隆', nickname: '男刀' },
  { label: '放逐之刃', value: 92, realName: '锐雯', nickname: '兔女郎' },
  { label: '深渊巨口', value: 96, realName: '克格莫', nickname: '大嘴' },
  { label: '暮光之眼', value: 98, realName: '慎', nickname: '慎' },
  { label: '光辉女郎', value: 99, realName: '拉克丝', nickname: '光辉' },
  { label: '远古巫灵', value: 101, realName: '泽拉斯', nickname: '死亡射线|挠头怪' },
  { label: '龙血武姬', value: 102, realName: '希瓦娜', nickname: '龙女' },
  { label: '九尾妖狐', value: 103, realName: '阿狸', nickname: '狐狸' },
  { label: '法外狂徒', value: 104, realName: '格雷福斯', nickname: '男枪' },
  { label: '潮汐海灵', value: 105, realName: '菲兹', nickname: '小鱼人' },
  { label: '不灭狂雷', value: 106, realName: '沃利贝尔', nickname: '雷熊' },
  { label: '傲之追猎者', value: 107, realName: '雷恩加尔', nickname: '狮子狗' },
  { label: '惩戒之箭', value: 110, realName: '韦鲁斯', nickname: '维鲁斯' },
  { label: '深海泰坦', value: 111, realName: '诺提勒斯', nickname: '泰坦' },
  { label: '奥术先驱', value: 112, realName: '维克托', nickname: '三只手' },
  { label: '北地之怒', value: 113, realName: '瑟庄妮', nickname: '猪妹' },
  { label: '无双剑姬', value: 114, realName: '菲奥娜', nickname: '剑姬' },
  { label: '爆破鬼才', value: 115, realName: '吉格斯', nickname: '炸弹人' },
  { label: '仙灵女巫', value: 117, realName: '璐璐', nickname: '露露' },
  { label: '荣耀行刑官', value: 119, realName: '德莱文', nickname: '德莱文' },
  { label: '战争之影', value: 120, realName: '赫卡里姆', nickname: '人马' },
  { label: '虚空掠夺者', value: 121, realName: '卡兹克', nickname: '螳螂' },
  { label: '诺克萨斯之手', value: 122, realName: '德莱厄斯', nickname: '诺手' },
  { label: '未来守护者', value: 126, realName: '杰斯', nickname: '杰斯' },
  { label: '冰霜女巫', value: 127, realName: '丽桑卓', nickname: '冰女' },
  { label: '皎月女神', value: 131, realName: '戴安娜', nickname: '皎月' },
  { label: '德玛西亚之翼', value: 133, realName: '奎因', nickname: '鸟人' },
  { label: '暗黑元首', value: 134, realName: '辛德拉', nickname: '球女' },
  { label: '铸星龙王', value: 136, realName: '奥瑞利安·索尔', nickname: '龙王' },
  { label: '影流之镰', value: 141, realName: '凯隐&拉亚斯特', nickname: '' },
  { label: '暮光星灵', value: 142, realName: '佐伊', nickname: '佐a' },
  { label: '荆棘之兴', value: 143, realName: '婕拉', nickname: '植物人' },
  { label: '虚空之女', value: 145, realName: '卡莎', nickname: '' },
  { label: '星籁歌姬', value: 147, realName: '萨勒芬妮', nickname: '轮椅人' },
  { label: '迷失之牙', value: 150, realName: '纳尔', nickname: '' },
  { label: '生化魔人', value: 154, realName: '扎克', nickname: '粑粑人' },
  { label: '疾风剑豪', value: 157, realName: '亚索', nickName: '索子哥|孤儿索' },
  { label: '虚空之眼', value: 161, realName: '维克兹', nickname: '大眼' },
  { label: '岩雀', value: 163, realName: '塔莉垭', nickname: '' },
  { label: '青钢影', value: 164, realname: '卡米尔', nickname: '' },
  { label: '影哨', value: 166, realName: '阿克尚', nickname: '' },
  { label: '虚空女皇', value: 200, realname: '卑尔维斯', nickname: '阿尔卑斯|棒棒糖' },
  { label: '弗雷尔卓德之心', value: 201, realName: '布隆', nickname: '' },
  { label: '戏命师', value: 202, realName: '烬', nickname: '瘸子' },
  { label: '永猎双子', value: 203, realName: '千珏', nickName: '' },
  { label: '祖安花火', value: 221, realName: '泽丽', nickName: '' },
  { label: '暴走萝莉', value: 222, realName: '金克丝', nickname: '' },
  { label: '河流之王', value: 223, realName: '塔姆', nickname: '' },
  { label: '狂厄蔷薇', value: 233, realName: '狱卒', nickname: '' },
  { label: '破败之王', value: 234, realName: '佛耶戈', nickname: '' },
  { label: '涤魂圣枪', value: 235, realName: '塞纳', nickname: '' },
  { label: '圣枪游侠', value: 236, realName: '卢锡安', nickname: '' },
  { label: '影流之主', value: 238, realName: '劫', nickname: '幽默飞镖人' },
  { label: '暴怒骑士', value: 240, realName: '克烈', nickname: '' },
  { label: '时间刺客', value: 245, realName: '艾克', nickname: '' },
  { label: '元素女皇', value: 246, realName: '奇亚娜', nickname: '超模' },
  { label: '皮城执法官', value: 254, realName: '蔚', nickname: '' },
  { label: '暗裔剑魔', value: 266, realName: '亚托克斯', nickname: '' },
  { label: '唤潮鲛姬', value: 267, realName: '娜美', nickname: '' },
  { label: '沙漠皇帝', value: 268, realName: '阿兹尔', nickname: '黄鸡' },
  { label: '魔法猫咪', value: 350, realName: '悠米', nickname: '' },
  { label: '沙漠玫瑰', value: 360, realName: '莎米拉', nickname: '' },
  { label: '魂锁典狱长', value: 412, realName: '锤石', nickname: '' },
  { label: '海兽祭司', value: 420, realName: '俄洛伊', nickname: '触手妈' },
  { label: '虚空遁地兽', value: 421, realName: '雷克赛', nickname: '挖掘机' },
  { label: '翠神', value: 427, realName: '艾翁', nickName: '小树' },
  { label: '复仇之矛', value: 429, realName: '卡莉丝塔', nickname: '' },
  { label: '星界游神', value: 432, realName: '巴德', nickname: '' },
  { label: '幻翎', value: 497, realName: '洛', nickname: '' },
  { label: '逆羽', value: 498, realName: '霞', nickname: '' },
  { label: '山隐之焰', value: 516, realName: '奥恩', nickname: '山羊' },
  { label: '解脱者', value: 517, realName: '塞拉斯', nickname: '' },
  { label: '万花通灵', value: 518, realName: '妮蔻', nickname: '' },
  { label: '残月之肃', value: 523, realName: '厄斐琉斯', nickname: 'efls' },
  { label: '镕铁少女', value: 526, realName: '芮尔', nickname: '' },
  { label: '血港鬼影', value: 555, realName: '派克', nickname: '' },
  { label: '愁云使者', value: 711, realName: '薇古斯', nickname: '' },
  { label: '封魔剑魂', value: 777, realName: '永恩', nickname: '' },
  { label: '铁血狼母', value: 799, realNmae: '安蓓萨', nickname: '' },
  { label: '流光镜影', value: 800, realName: '梅尔', nickname: '三体人' },
  { label: '腕豪', value: 875, realName: '瑟提', nickname: '' },
  { label: '含羞蓓蕾', value: 876, realName: '莉莉娅', nickname: '' },
  { label: '灵罗娃娃', value: 887, realName: '格温', nickname: '' },
  { label: '炼金男爵', value: 888, realname: '烈娜塔・戈拉斯克', nickname: '' },
  { label: '双界灵兔', value: 893, realName: '阿萝拉', nickname: '兔子' },
  { label: '不羁之悦', value: 895, realName: '尼菈', nickname: '水米拉|水弥拉' },
  { label: '纳祖芒荣耀', value: 897, realName: '奎桑提', nickname: '黑哥' },
  { label: '炽炎雏龙', value: 901, realName: '斯莫德', nickName: '小火龙' },
  { label: '明烛', value: 902, realName: '米利欧', nickname: '顶真|丁真' },
  { label: '异画师', value: 910, realName: '慧', nickname: '毛笔人' },
  { label: '百裂冥犬', value: 950, realName: '纳亚菲利', nickname: '狼狗|狗比' }
]

const renderSingleSelectTag: SelectRenderTag = ({ option }) => {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center'
      }
    },
    [
      h(NAvatar, {
        // Replace the hardcoded URL with a dynamic URL based on champion ID
        src: option.value !== 0 ? `${assetPrefix}champion${option.value}` : `${assetPrefix}champion-1`,
        round: true,
        size: 24,
        style: {
          marginRight: '12px'
        }
      }),
      option.label as string
    ]
  )
}
const renderLabel: SelectRenderLabel = (option) => {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center'
      }
    },
    [
      h(NAvatar, {
        src: option.value !== 0 ? `${assetPrefix}champion${option.value}` : `${assetPrefix}champion-1`,
        round: true,
        size: 'small'
      }),
      h(
        'div',
        {
          style: {
            marginLeft: '12px',
            padding: '4px 0'
          }
        },
        [
          h('div', null, [option.label as string]),

        ]
      )
    ]
  )
}

const resetFilter = () => {
  pageHistory.value = []
  filterQueueId.value = 0
  filterChampionId.value = 0
  handleUpdateValue()
}
const handleUpdateValue = () => {
  page.value = 1
  if (filterChampionId.value != 0 || filterQueueId.value != 0) {
    getHistoryMatch(route.query.name as string, 0, 800)
  } else {
    getHistoryMatch(route.query.name as string, 0, 9)
  }
}

// 类型定义
export interface GameDetail {
  endOfGameResult: string
  participantIdentities: {
    player: {
      accountId: string
      platformId: string
      gameName: string
      tagLine: string
      summonerName: string
      summonerId: string
    }
  }[]
  participants: {
    teamId: number
    participantId: number
    championId: number
    championKey: string
    summonerName: string
    summonerId: string
  }[]
}

export interface ParticipantStats {
  win: boolean
  item0: number
  item1: number
  item2: number
  item3: number
  item4: number
  item5: number
  item6: number
  item0Key: string
  item1Key: string
  item2Key: string
  item3Key: string
  item4Key: string
  item5Key: string
  item6Key: string
  perkPrimaryStyle: number
  perkSubStyle: number
  perkPrimaryStyleKey: string
  perkSubStyleKey: string
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  goldSpent: number
  totalDamageDealtToChampions: number
  totalDamageDealt: number
  totalDamageTaken: number
  totalHeal: number
  totalMinionsKilled: number
  groupRate: number
  goldEarnedRate: number
  damageDealtToChampionsRate: number
  damageTakenRate: number
  healRate: number
}

export interface Participant {
  win: boolean
  participantId: number
  teamId: number
  championId: number
  championKey: string
  spell1Id: number
  spell1Key: string
  spell2Id: number
  spell2Key: string
  stats: ParticipantStats
}

export interface Game {
  mvp: string
  gameDetail: GameDetail
  gameId: number
  gameCreationDate: string
  gameDuration: number
  gameMode: string
  gameType: string
  mapId: number
  queueId: number
  queueName: number
  participantIdentities: {
    player: {
      accountId: string
      platformId: string
      gameName: string
      tagLine: string
      summonerName: string
      summonerId: string
    }
  }[]
  participants: Participant[]
}

export interface MatchHistory {
  platformId: string
  beginIndex: number
  endIndex: number
  games: {
    gameDetail: GameDetail
    games: Game[]
  }
}

const matchHistory = ref<MatchHistory>()
const loadingBar = useLoadingBar()
const isRequestingMatchHostory = ref(false)
const page = ref(1)
const pageHistory = ref<{ begIndex: number; endIndex: number }[]>([])

let curBegIndex = 0
let curEndIndex = 0

const route = useRoute()
let name = ''

// 获取历史记录
const getHistoryMatch = async (name: string, begIndex: number, endIndex: number) => {
  loadingBar.start()
  isRequestingMatchHostory.value = true
  try {
    const res = await http.get<MatchHistory>('/GetMatchHistory', {
      params: {
        filterQueueId: filterQueueId.value,
        filterChampionId: filterChampionId.value,
        begIndex,
        endIndex,
        name,
      },
    })
    matchHistory.value = res.data
    curBegIndex = res.data.beginIndex
    curEndIndex = res.data.endIndex
    loadingBar.finish()
  } catch (error) {
    // 兜底请求默认数据，避免页面空白
    const res = await http.get<MatchHistory>('/GetMatchHistory')
    matchHistory.value = res.data
    loadingBar.error()
  } finally {
    isRequestingMatchHostory.value = false
  }
}

// 下一页
const nextPage = async () => {
  let begIndex = 0
  let endIndex = 0
  pageHistory.value.push({ begIndex: curBegIndex, endIndex: curEndIndex })

  if (filterQueueId.value !== 0 || filterChampionId.value !== 0) {
    begIndex = curEndIndex + 1
    endIndex = begIndex + 799
  } else {
    begIndex = page.value * 10
    endIndex = begIndex + 9
  }

  await getHistoryMatch(name, begIndex, endIndex)
  page.value++
}

// 上一页
const prevPage = async () => {
  const lastPage = pageHistory.value.pop()
  console.log(lastPage)

  if (!lastPage) {
    throw new Error("无上一页数据")
  }
  await getHistoryMatch(name, lastPage.begIndex, lastPage.endIndex)
  page.value = Math.max(1, page.value - 1)
}

onMounted(async () => {
  name = route.query.name as string
  await getHistoryMatch(name, 0, 9)
})

</script>

<style lang="css" scoped>
.ratio-container {
  /* 维持1.1:1宽高比的核心容器 */
  width: 100%;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: center;
}

.content-wrapper {
  /* 比例容器 */
  aspect-ratio: 1.1 / 1;
  width: 100%;
  max-width: calc(100vh * 1.1);
  /* 防止过高 */
  max-height: calc(100vw / 1.1);
  /* 防止过宽 */
  margin: auto;
  position: relative;
}

.scroll-area {
  /* 滚动区域 */
  flex: 1;
  overflow-y: auto;
  margin: 8px 0;
}

.pagination {
  /* 分页固定底部 */
  position: sticky;
  bottom: 0;
  background: var(--n-color);
  padding: 8px 0;
}
</style>