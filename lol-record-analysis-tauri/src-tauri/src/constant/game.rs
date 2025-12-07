use phf::phf_map;

// 服务器名称映射
pub static SGP_SERVER_NAME: phf::Map<&'static str, &'static str> = phf_map! {
    "TENCENT_HN1" => "艾欧尼亚",
    "TENCENT_HN10" => "黑色玫瑰",
    "TENCENT_TJ100" => "联盟四区",
    "TENCENT_TJ101" => "联盟五区",
    "TENCENT_NJ100" => "联盟一区",
    "TENCENT_GZ100" => "联盟二区",
    "TENCENT_CQ100" => "联盟三区",
    "TENCENT_BGP2" => "峡谷之巅",
    "TENCENT_PBE" => "体验服",
    "TW2" => "台湾",
    "SG2" => "新加坡",
    "PH2" => "菲律宾",
    "VN2" => "越南",
    "PBE" => "PBE",
};

// 服务器 ID 到名称映射
pub static SGP_SERVER_ID_TO_NAME: phf::Map<&'static str, &'static str> = phf_map! {
    "HN1" => "艾欧尼亚",
    "HN10" => "黑色玫瑰",
    "TJ100" => "联盟四区",
    "TJ101" => "联盟五区",
    "NJ100" => "联盟一区",
    "GZ100" => "联盟二区",
    "CQ100" => "联盟三区",
    "BGP2" => "峡谷之巅",
    "PBE" => "体验服",
    "TW2" => "台湾",
    "SG2" => "新加坡",
    "PH2" => "菲律宾",
    "VN2" => "越南",
    "" => "暂无",
};

// 英文段位到中文映射
pub static TIER_EN_TO_CN: phf::Map<&'static str, &'static str> = phf_map! {
    "UNRANKED" => "无",
    "IRON" => "坚韧黑铁",
    "BRONZE" => "英勇黄铜",
    "SILVER" => "不屈白银",
    "GOLD" => "荣耀黄金",
    "PLATINUM" => "华贵铂金",
    "EMERALD" => "流光翡翠",
    "DIAMOND" => "璀璨钻石",
    "MASTER" => "超凡大师",
    "GRANDMASTER" => "傲世宗师",
    "CHALLENGER" => "最强王者",
    "" => "无",
};

// 队列类型到中文映射
pub static QUEUE_TYPE_TO_CN: phf::Map<&'static str, &'static str> = phf_map! {
    "RANKED_SOLO_5x5" => "单双排",
    "RANKED_FLEX_SR" => "灵活组排",
    "" => "其他",
};

// 队列 ID 到中文映射
pub static QUEUE_ID_TO_CN: phf::Map<u32, &'static str> = phf_map! {
    420u32 => "单双排",
    430u32 => "匹配",
    440u32 => "灵活排",
    450u32 => "大乱斗",
    490u32 => "匹配",
    890u32 => "人机",
    900u32 => "无限乱斗",
    1700u32 => "斗魂竞技场",
    1900u32 => "无限火力",
    2400u32 => "海克斯乱斗",
    0u32 => "其他",
};

// 腾讯服务器 ID 常量
pub const TENCENT_HN1: &str = "TENCENT_HN1";
pub const TENCENT_HN10: &str = "TENCENT_HN10";
pub const TENCENT_TJ100: &str = "TENCENT_TJ100";
pub const TENCENT_TJ101: &str = "TENCENT_TJ101";
pub const TENCENT_NJ100: &str = "TENCENT_NJ100";
pub const TENCENT_GZ100: &str = "TENCENT_GZ100";
pub const TENCENT_CQ100: &str = "TENCENT_CQ100";
pub const TENCENT_BGP2: &str = "TENCENT_BGP2";
pub const TENCENT_PBE: &str = "TENCENT_PBE";

// 服务器 ID 常量
pub const HN1: &str = "HN1";
pub const HN10: &str = "HN10";
pub const TJ100: &str = "TJ100";
pub const TJ101: &str = "TJ101";
pub const NJ100: &str = "NJ100";
pub const GZ100: &str = "GZ100";
pub const CQ100: &str = "CQ100";
pub const BGP2: &str = "BGP2";
pub const PBE: &str = "PBE";
pub const TW2: &str = "TW2";
pub const SG2: &str = "SG2";
pub const PH2: &str = "PH2";
pub const VN2: &str = "VN2";

// 英文段位常量
pub const UNRANKED: &str = "UNRANKED";
pub const IRON: &str = "IRON";
pub const BRONZE: &str = "BRONZE";
pub const SILVER: &str = "SILVER";
pub const GOLD: &str = "GOLD";
pub const PLATINUM: &str = "PLATINUM";
pub const EMERALD: &str = "EMERALD";
pub const DIAMOND: &str = "DIAMOND";
pub const MASTER: &str = "MASTER";
pub const GRANDMASTER: &str = "GRANDMASTER";
pub const CHALLENGER: &str = "CHALLENGER";

// 排位模式类型常量
pub const RANKED_SOLO_5X5: &str = "RANKED_SOLO_5x5";
pub const RANKED_FLEX_SR: &str = "RANKED_FLEX_SR";

// 排位队列 ID 常量
pub const QUEUE_SOLO_5X5: i32 = 420;
pub const QUEUE_MATCH: i32 = 430;
pub const QUEUE_FLEX: i32 = 440;
pub const QUEUE_ARAM: i32 = 450;
pub const QUEUE_MATCH2: i32 = 490;
pub const QUEUE_OD: i32 = 900;
pub const QUEUE_TFT: i32 = 1700;
pub const QUEUE_URF: i32 = 1900;

// 游戏状态常量
pub const MATCHMAKING: &str = "Matchmaking"; // 正在匹配
pub const CHAMPSELECT: &str = "ChampSelect"; // 英雄选择中
pub const READYCHECK: &str = "ReadyCheck"; // 等待接受状态中
pub const INPROGRESS: &str = "InProgress"; // 游戏进行中
pub const ENDOFGAME: &str = "EndOfGame"; // 游戏结算
pub const LOBBY: &str = "Lobby"; // 房间
pub const GAMESTART: &str = "GameStart"; // 游戏开始
pub const NONE: &str = "None"; // 无
pub const RECONNECT: &str = "Reconnect"; // 重新连接
pub const WAITINGFORSTATS: &str = "WaitingForStats"; // 等待结果
pub const PREENDOFGAME: &str = "PreEndOfGame"; // 结束游戏之前
pub const WATCHINPROGRESS: &str = "WatchInProgress"; // 在观战中
pub const TERMINATEDINERROR: &str = "TerminatedInError"; // 错误终止

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ChampionOption {
    pub label: &'static str,
    pub value: i32,
    pub real_name: &'static str,
    pub nickname: &'static str,
}

pub static CHAMPION_MAP: phf::Map<u16, ChampionOption> = phf_map! {
    0u16 => ChampionOption { label: "全部", value: 0, real_name: "", nickname: "" },
    1u16 => ChampionOption { label: "黑暗之女", value: 1, real_name: "安妮", nickname: "火女" },
    2u16 => ChampionOption { label: "狂战士", value: 2, real_name: "奥拉夫", nickname: "大头" },
    3u16 => ChampionOption { label: "正义巨像", value: 3, real_name: "加里奥", nickname: "城墙" },
    4u16 => ChampionOption { label: "卡牌大师", value: 4, real_name: "崔斯特", nickname: "卡牌" },
    5u16 => ChampionOption { label: "德邦总管", value: 5, real_name: "赵信", nickname: "菊花信|赵神王" },
    6u16 => ChampionOption { label: "无畏战车", value: 6, real_name: "厄加特", nickname: "螃蟹" },
    7u16 => ChampionOption { label: "诡术妖姬", value: 7, real_name: "乐芙兰", nickname: "LB" },
    8u16 => ChampionOption { label: "猩红收割者", value: 8, real_name: "弗拉基米尔", nickname: "吸血鬼" },
    9u16 => ChampionOption { label: "远古恐惧", value: 9, real_name: "费德提克", nickname: "稻草人" },
    10u16 => ChampionOption { label: "正义天使", value: 10, real_name: "凯尔", nickname: "天使" },
    11u16 => ChampionOption { label: "无极剑圣", value: 11, real_name: "易", nickname: "" },
    12u16 => ChampionOption { label: "牛头酋长", value: 12, real_name: "阿利斯塔", nickname: "牛头" },
    13u16 => ChampionOption { label: "符文法师", value: 13, real_name: "瑞兹", nickname: "光头" },
    14u16 => ChampionOption { label: "亡灵战神", value: 14, real_name: "赛恩", nickname: "老司机" },
    15u16 => ChampionOption { label: "战争女神", value: 15, real_name: "希维尔", nickname: "轮子妈" },
    16u16 => ChampionOption { label: "众星之子", value: 16, real_name: "索拉卡", nickname: "奶妈" },
    17u16 => ChampionOption { label: "迅捷斥候", value: 17, real_name: "提莫", nickname: "蘑菇" },
    18u16 => ChampionOption { label: "麦林炮手", value: 18, real_name: "崔丝塔娜", nickname: "小炮" },
    19u16 => ChampionOption { label: "祖安怒兽", value: 19, real_name: "沃里克", nickname: "狼人" },
    20u16 => ChampionOption { label: "雪原双子", value: 20, real_name: "努努和威朗普", nickname: "雪人" },
    21u16 => ChampionOption { label: "赏金猎人", value: 21, real_name: "厄运小姐", nickname: "女枪" },
    22u16 => ChampionOption { label: "寒冰射手", value: 22, real_name: "艾希", nickname: "刮痧女王" },
    23u16 => ChampionOption { label: "蛮族之王", value: 23, real_name: "泰达米尔", nickname: "蛮王" },
    24u16 => ChampionOption { label: "武器大师", value: 24, real_name: "贾克斯", nickname: "武器" },
    25u16 => ChampionOption { label: "堕落天使", value: 25, real_name: "莫甘娜", nickname: "" },
    26u16 => ChampionOption { label: "时光守护者", value: 26, real_name: "基兰", nickname: "时光老头" },
    27u16 => ChampionOption { label: "炼金术士", value: 27, real_name: "辛吉德", nickname: "炼金" },
    28u16 => ChampionOption { label: "痛苦之拥", value: 28, real_name: "伊芙琳", nickname: "寡妇" },
    29u16 => ChampionOption { label: "瘟疫之源", value: 29, real_name: "图奇", nickname: "老鼠" },
    30u16 => ChampionOption { label: "死亡颂唱者", value: 30, real_name: "卡尔萨斯", nickname: "死歌" },
    31u16 => ChampionOption { label: "虚空恐惧", value: 31, real_name: "科加斯", nickname: "大虫子" },
    32u16 => ChampionOption { label: "殇之木乃伊", value: 32, real_name: "阿木木", nickname: "木乃伊" },
    33u16 => ChampionOption { label: "披甲龙龟", value: 33, real_name: "拉莫斯", nickname: "龙龟" },
    34u16 => ChampionOption { label: "冰晶凤凰", value: 34, real_name: "艾尼维亚", nickname: "凤凰" },
    35u16 => ChampionOption { label: "恶魔小丑", value: 35, real_name: "萨科", nickname: "小丑" },
    36u16 => ChampionOption { label: "祖安狂人", value: 36, real_name: "蒙多医生", nickname: "蒙多" },
    37u16 => ChampionOption { label: "琴瑟仙女", value: 37, real_name: "娑娜", nickname: "琴女" },
    38u16 => ChampionOption { label: "虚空行者", value: 38, real_name: "卡萨丁", nickname: "电耗子" },
    39u16 => ChampionOption { label: "刀锋舞者", value: 39, real_name: "卡特琳娜", nickname: "卡特" },
    40u16 => ChampionOption { label: "风暴之怒", value: 40, real_name: "杰娜", nickname: "风女" },
    41u16 => ChampionOption { label: "海洋之灾", value: 41, real_name: "普朗克", nickname: "船长" },
    42u16 => ChampionOption { label: "英勇投弹手", value: 42, real_name: "库奇", nickname: "飞机" },
    43u16 => ChampionOption { label: "天启者", value: 43, real_name: "卡尔玛", nickname: "扇子妈" },
    44u16 => ChampionOption { label: "瓦洛兰之盾", value: 44, real_name: "塔里克", nickname: "宝石" },
    45u16 => ChampionOption { label: "邪恶小法师", value: 45, real_name: "维迦", nickname: "小法" },
    48u16 => ChampionOption { label: "巨魔之王", value: 48, real_name: "特朗德尔", nickname: "巨魔" },
    50u16 => ChampionOption { label: "诺克萨斯统领", value: 50, real_name: "斯维因", nickname: "乌鸦" },
    51u16 => ChampionOption { label: "皮城女警", value: 51, real_name: "凯特琳", nickname: "女警" },
    53u16 => ChampionOption { label: "蒸汽机器人", value: 53, real_name: "布里茨", nickname: "机器人" },
    54u16 => ChampionOption { label: "熔岩巨兽", value: 54, real_name: "墨菲特", nickname: "石头人" },
    55u16 => ChampionOption { label: "不祥之刃", value: 55, real_name: "卡特琳娜", nickname: "卡特" },
    56u16 => ChampionOption { label: "永恒梦魇", value: 56, real_name: "魔腾", nickname: "梦魇" },
    57u16 => ChampionOption { label: "扭曲树精", value: 57, real_name: "茂凯", nickname: "大树" },
    58u16 => ChampionOption { label: "荒漠屠夫", value: 58, real_name: "雷克顿", nickname: "鳄鱼" },
    59u16 => ChampionOption { label: "德玛西亚皇子", value: 59, real_name: "嘉文四世", nickname: "皇子" },
    60u16 => ChampionOption { label: "蜘蛛女皇", value: 60, real_name: "伊莉丝", nickname: "蜘蛛" },
    61u16 => ChampionOption { label: "发条魔灵", value: 61, real_name: "奥莉安娜", nickname: "发条" },
    62u16 => ChampionOption { label: "齐天大圣", value: 62, real_name: "孙悟空", nickname: "猴子" },
    63u16 => ChampionOption { label: "复仇焰魂", value: 63, real_name: "布兰德", nickname: "火男" },
    64u16 => ChampionOption { label: "盲僧", value: 64, real_name: "李青", nickname: "瞎子" },
    67u16 => ChampionOption { label: "暗夜猎手", value: 67, real_name: "薇恩", nickname: "VN|uzi|UZI" },
    68u16 => ChampionOption { label: "机械公敌", value: 68, real_name: "兰博", nickname: "机器人" },
    69u16 => ChampionOption { label: "魔蛇之拥", value: 69, real_name: "卡西奥佩娅", nickname: "蛇女" },
    72u16 => ChampionOption { label: "上古领主", value: 72, real_name: "斯卡纳", nickname: "蝎子" },
    74u16 => ChampionOption { label: "大发明家", value: 74, real_name: "海默丁格", nickname: "大头" },
    75u16 => ChampionOption { label: "沙漠死神", value: 75, real_name: "内瑟斯", nickname: "狗头" },
    76u16 => ChampionOption { label: "狂野女猎手", value: 76, real_name: "奈德丽", nickname: "豹女" },
    77u16 => ChampionOption { label: "兽灵行者", value: 77, real_name: "乌迪尔", nickname: "德鲁伊" },
    78u16 => ChampionOption { label: "圣锤之毅", value: 78, real_name: "波比", nickname: "锤石" },
    79u16 => ChampionOption { label: "酒桶", value: 79, real_name: "古拉加斯", nickname: "酒桶" },
    80u16 => ChampionOption { label: "不屈之枪", value: 80, real_name: "潘森", nickname: "斯巴达" },
    81u16 => ChampionOption { label: "探险家", value: 81, real_name: "伊泽瑞尔", nickname: "EZ" },
    82u16 => ChampionOption { label: "铁铠冥魂", value: 82, real_name: "莫德凯撒", nickname: "铁男" },
    83u16 => ChampionOption { label: "牧魂人", value: 83, real_name: "约里克", nickname: "掘墓者" },
    84u16 => ChampionOption { label: "离群之刺", value: 84, real_name: "阿卡丽", nickname: "阿卡丽" },
    85u16 => ChampionOption { label: "狂暴之心", value: 85, real_name: "凯南", nickname: "电耗子" },
    86u16 => ChampionOption { label: "德玛西亚之力", value: 86, real_name: "盖伦", nickname: "草丛伦" },
    89u16 => ChampionOption { label: "曙光女神", value: 89, real_name: "蕾欧娜", nickname: "日女" },
    90u16 => ChampionOption { label: "虚空先知", value: 90, real_name: "玛尔扎哈", nickname: "蚂蚱" },
    91u16 => ChampionOption { label: "刀锋之影", value: 91, real_name: "泰隆", nickname: "男刀" },
    92u16 => ChampionOption { label: "放逐之刃", value: 92, real_name: "锐雯", nickname: "兔女郎" },
    96u16 => ChampionOption { label: "深渊巨口", value: 96, real_name: "克格莫", nickname: "大嘴" },
    98u16 => ChampionOption { label: "暮光之眼", value: 98, real_name: "慎", nickname: "慎" },
    99u16 => ChampionOption { label: "光辉女郎", value: 99, real_name: "拉克丝", nickname: "光辉" },
    101u16 => ChampionOption { label: "远古巫灵", value: 101, real_name: "泽拉斯", nickname: "死亡射线|挠头怪" },
    102u16 => ChampionOption { label: "龙血武姬", value: 102, real_name: "希瓦娜", nickname: "龙女" },
    103u16 => ChampionOption { label: "九尾妖狐", value: 103, real_name: "阿狸", nickname: "狐狸" },
    104u16 => ChampionOption { label: "法外狂徒", value: 104, real_name: "格雷福斯", nickname: "男枪" },
    105u16 => ChampionOption { label: "潮汐海灵", value: 105, real_name: "菲兹", nickname: "小鱼人" },
    106u16 => ChampionOption { label: "不灭狂雷", value: 106, real_name: "沃利贝尔", nickname: "雷熊" },
    107u16 => ChampionOption { label: "傲之追猎者", value: 107, real_name: "雷恩加尔", nickname: "狮子狗" },
    110u16 => ChampionOption { label: "惩戒之箭", value: 110, real_name: "韦鲁斯", nickname: "维鲁斯" },
    111u16 => ChampionOption { label: "深海泰坦", value: 111, real_name: "诺提勒斯", nickname: "泰坦" },
    112u16 => ChampionOption { label: "奥术先驱", value: 112, real_name: "维克托", nickname: "三只手" },
    113u16 => ChampionOption { label: "北地之怒", value: 113, real_name: "瑟庄妮", nickname: "猪妹" },
    114u16 => ChampionOption { label: "无双剑姬", value: 114, real_name: "菲奥娜", nickname: "剑姬" },
    115u16 => ChampionOption { label: "爆破鬼才", value: 115, real_name: "吉格斯", nickname: "炸弹人" },
    117u16 => ChampionOption { label: "仙灵女巫", value: 117, real_name: "璐璐", nickname: "露露" },
    119u16 => ChampionOption { label: "荣耀行刑官", value: 119, real_name: "德莱文", nickname: "德莱文" },
    120u16 => ChampionOption { label: "战争之影", value: 120, real_name: "赫卡里姆", nickname: "人马" },
    121u16 => ChampionOption { label: "虚空掠夺者", value: 121, real_name: "卡兹克", nickname: "螳螂" },
    122u16 => ChampionOption { label: "诺克萨斯之手", value: 122, real_name: "德莱厄斯", nickname: "诺手" },
    126u16 => ChampionOption { label: "未来守护者", value: 126, real_name: "杰斯", nickname: "杰斯" },
    127u16 => ChampionOption { label: "冰霜女巫", value: 127, real_name: "丽桑卓", nickname: "冰女" },
    131u16 => ChampionOption { label: "皎月女神", value: 131, real_name: "戴安娜", nickname: "皎月" },
    133u16 => ChampionOption { label: "德玛西亚之翼", value: 133, real_name: "奎因", nickname: "鸟人" },
    134u16 => ChampionOption { label: "暗黑元首", value: 134, real_name: "辛德拉", nickname: "球女" },
    136u16 => ChampionOption { label: "铸星龙王", value: 136, real_name: "奥瑞利安·索尔", nickname: "龙王" },
    141u16 => ChampionOption { label: "影流之镰", value: 141, real_name: "凯隐&拉亚斯特", nickname: "" },
    142u16 => ChampionOption { label: "暮光星灵", value: 142, real_name: "佐伊", nickname: "佐a" },
    143u16 => ChampionOption { label: "荆棘之兴", value: 143, real_name: "婕拉", nickname: "植物人" },
    145u16 => ChampionOption { label: "虚空之女", value: 145, real_name: "卡莎", nickname: "" },
    147u16 => ChampionOption { label: "星籁歌姬", value: 147, real_name: "萨勒芬妮", nickname: "轮椅人" },
    150u16 => ChampionOption { label: "迷失之牙", value: 150, real_name: "纳尔", nickname: "" },
    154u16 => ChampionOption { label: "生化魔人", value: 154, real_name: "扎克", nickname: "粑粑人" },
    157u16 => ChampionOption { label: "疾风剑豪", value: 157, real_name: "亚索", nickname: "索子哥|孤儿索" },
    161u16 => ChampionOption { label: "虚空之眼", value: 161, real_name: "维克兹", nickname: "大眼" },
    163u16 => ChampionOption { label: "岩雀", value: 163, real_name: "塔莉垭", nickname: "" },
    164u16 => ChampionOption { label: "青钢影", value: 164, real_name: "卡米尔", nickname: "" },
    166u16 => ChampionOption { label: "影哨", value: 166, real_name: "阿克尚", nickname: "" },
    200u16 => ChampionOption { label: "虚空女皇", value: 200, real_name: "卑尔维斯", nickname: "阿尔卑斯|棒棒糖" },
    201u16 => ChampionOption { label: "弗雷尔卓德之心", value: 201, real_name: "布隆", nickname: "" },
    202u16 => ChampionOption { label: "戏命师", value: 202, real_name: "烬", nickname: "瘸子" },
    203u16 => ChampionOption { label: "永猎双子", value: 203, real_name: "千珏", nickname: "" },
    221u16 => ChampionOption { label: "祖安花火", value: 221, real_name: "泽丽", nickname: "" },
    222u16 => ChampionOption { label: "暴走萝莉", value: 222, real_name: "金克丝", nickname: "" },
    223u16 => ChampionOption { label: "河流之王", value: 223, real_name: "塔姆", nickname: "" },
    233u16 => ChampionOption { label: "狂厄蔷薇", value: 233, real_name: "狱卒", nickname: "" },
    234u16 => ChampionOption { label: "破败之王", value: 234, real_name: "佛耶戈", nickname: "" },
    235u16 => ChampionOption { label: "涤魂圣枪", value: 235, real_name: "塞纳", nickname: "" },
    236u16 => ChampionOption { label: "圣枪游侠", value: 236, real_name: "卢锡安", nickname: "" },
    238u16 => ChampionOption { label: "影流之主", value: 238, real_name: "劫", nickname: "幽默飞镖人" },
    240u16 => ChampionOption { label: "暴怒骑士", value: 240, real_name: "克烈", nickname: "" },
    245u16 => ChampionOption { label: "时间刺客", value: 245, real_name: "艾克", nickname: "" },
    246u16 => ChampionOption { label: "元素女皇", value: 246, real_name: "奇亚娜", nickname: "超模" },
    254u16 => ChampionOption { label: "皮城执法官", value: 254, real_name: "蔚", nickname: "" },
    266u16 => ChampionOption { label: "暗裔剑魔", value: 266, real_name: "亚托克斯", nickname: "" },
    267u16 => ChampionOption { label: "唤潮鲛姬", value: 267, real_name: "娜美", nickname: "" },
    268u16 => ChampionOption { label: "沙漠皇帝", value: 268, real_name: "阿兹尔", nickname: "黄鸡" },
    350u16 => ChampionOption { label: "魔法猫咪", value: 350, real_name: "悠米", nickname: "" },
    360u16 => ChampionOption { label: "沙漠玫瑰", value: 360, real_name: "莎米拉", nickname: "" },
    412u16 => ChampionOption { label: "魂锁典狱长", value: 412, real_name: "锤石", nickname: "" },
    420u16 => ChampionOption { label: "海兽祭司", value: 420, real_name: "俄洛伊", nickname: "触手妈" },
    421u16 => ChampionOption { label: "虚空遁地兽", value: 421, real_name: "雷克赛", nickname: "挖掘机" },
    427u16 => ChampionOption { label: "翠神", value: 427, real_name: "艾翁", nickname: "小树" },
    429u16 => ChampionOption { label: "复仇之矛", value: 429, real_name: "卡莉丝塔", nickname: "" },
    432u16 => ChampionOption { label: "星界游神", value: 432, real_name: "巴德", nickname: "" },
    497u16 => ChampionOption { label: "幻翎", value: 497, real_name: "洛", nickname: "" },
    498u16 => ChampionOption { label: "逆羽", value: 498, real_name: "霞", nickname: "" },
    516u16 => ChampionOption { label: "山隐之焰", value: 516, real_name: "奥恩", nickname: "山羊" },
    517u16 => ChampionOption { label: "解脱者", value: 517, real_name: "塞拉斯", nickname: "" },
    518u16 => ChampionOption { label: "万花通灵", value: 518, real_name: "妮蔻", nickname: "" },
    523u16 => ChampionOption { label: "残月之肃", value: 523, real_name: "厄斐琉斯", nickname: "efls" },
    526u16 => ChampionOption { label: "镕铁少女", value: 526, real_name: "芮尔", nickname: "" },
    555u16 => ChampionOption { label: "血港鬼影", value: 555, real_name: "派克", nickname: "" },
    711u16 => ChampionOption { label: "愁云使者", value: 711, real_name: "薇古斯", nickname: "" },
    777u16 => ChampionOption { label: "封魔剑魂", value: 777, real_name: "永恩", nickname: "" },
    799u16 => ChampionOption { label: "铁血狼母", value: 799, real_name: "安蓓萨", nickname: "" },
    800u16 => ChampionOption { label: "流光镜影", value: 800, real_name: "梅尔", nickname: "三体人" },
    875u16 => ChampionOption { label: "腕豪", value: 875, real_name: "瑟提", nickname: "" },
    876u16 => ChampionOption { label: "含羞蓓蕾", value: 876, real_name: "莉莉娅", nickname: "" },
    887u16 => ChampionOption { label: "灵罗娃娃", value: 887, real_name: "格温", nickname: "" },
    888u16 => ChampionOption { label: "炼金男爵", value: 888, real_name: "烈娜塔・戈拉斯克", nickname: "" },
    893u16 => ChampionOption { label: "双界灵兔", value: 893, real_name: "阿萝拉", nickname: "兔子" },
    895u16 => ChampionOption { label: "不羁之悦", value: 895, real_name: "尼菈", nickname: "水米拉|水弥拉" },
    897u16 => ChampionOption { label: "纳祖芒荣耀", value: 897, real_name: "奎桑提", nickname: "黑哥" },
    901u16 => ChampionOption { label: "炽炎雏龙", value: 901, real_name: "斯莫德", nickname: "小火龙" },
    902u16 => ChampionOption { label: "明烛", value: 902, real_name: "米利欧", nickname: "顶真|丁真" },
    910u16 => ChampionOption { label: "异画师", value: 910, real_name: "慧", nickname: "毛笔人" },
    950u16 => ChampionOption { label: "百裂冥犬", value: 950, real_name: "纳亚菲利", nickname: "狼狗|狗比" },
};
pub const ROBOTPUUID: &str = "00000000-0000-0000-0000-000000000000";

// 公共访问函数
pub fn get_sgp_server_name(key: &str) -> Option<&'static str> {
    SGP_SERVER_NAME.get(key).copied()
}

pub fn get_sgp_server_id_to_name(key: &str) -> Option<&'static str> {
    SGP_SERVER_ID_TO_NAME.get(key).copied()
}

pub fn get_tier_en_to_cn(key: &str) -> Option<&'static str> {
    TIER_EN_TO_CN.get(key).copied()
}

pub fn get_queue_type_to_cn(key: &str) -> Option<&'static str> {
    QUEUE_TYPE_TO_CN.get(key).copied()
}

pub fn get_queue_id_to_cn(key: u32) -> Option<&'static str> {
    QUEUE_ID_TO_CN.get(&key).copied()
}
