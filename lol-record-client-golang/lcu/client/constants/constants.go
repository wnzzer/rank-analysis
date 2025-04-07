package constants

var SGPServerName = map[string]string{
	"TENCENT_HN1":   "艾欧尼亚",
	"TENCENT_HN10":  "黑色玫瑰",
	"TENCENT_TJ100": "联盟四区",
	"TENCENT_TJ101": "联盟五区",
	"TENCENT_NJ100": "联盟一区",
	"TENCENT_GZ100": "联盟二区",
	"TENCENT_CQ100": "联盟三区",
	"TENCENT_BGP2":  "峡谷之巅",
	"TENCENT_PBE":   "体验服",
	"TW2":           "台湾",
	"SG2":           "新加坡",
	"PH2":           "菲律宾",
	"VN2":           "越南",
	"PBE":           "PBE",
}
var SGPServerIdToName = map[string]string{
	"HN1":   "艾欧尼亚",
	"HN10":  "黑色玫瑰",
	"TJ100": "联盟四区",
	"TJ101": "联盟五区",
	"NJ100": "联盟一区",
	"GZ100": "联盟二区",
	"CQ100": "联盟三区",
	"BGP2":  "峡谷之巅",
	"PBE":   "体验服",
	"TW2":   "台湾",
	"SG2":   "新加坡",
	"PH2":   "菲律宾",
	"VN2":   "越南",
	"":      "暂无",
}
var TierEnToCn = map[string]string{
	"UNRANKED":    "无",
	"IRON":        "坚韧黑铁",
	"BRONZE":      "英勇黄铜",
	"SILVER":      "不屈白银",
	"GOLD":        "荣耀黄金",
	"PLATINUM":    "华贵铂金",
	"EMERALD":     "流光翡翠",
	"DIAMOND":     "璀璨钻石",
	"MASTER":      "超凡大师",
	"GRANDMASTER": "傲世宗师",
	"CHALLENGER":  "最强王者",
	"":            "无",
}
var QueueTypeToCn = map[string]string{
	"RANKED_SOLO_5x5": "单双排",
	"RANKED_FLEX_SR":  "灵活组排",
	"":                "其他",
}
var QueueIdToCn = map[int]string{
	420:  "单双排",
	430:  "匹配",
	440:  "灵活排",
	450:  "大乱斗",
	490:  "匹配",
	890:  "人机",
	900:  "无限乱斗",
	1700: "斗魂竞技场",
	1900: "无限火力",
	0:    "其他",
}

const (
	TENCENT_HN1   = "TENCENT_HN1"
	TENCENT_HN10  = "TENCENT_HN10"
	TENCENT_TJ100 = "TENCENT_TJ100"
	TENCENT_TJ101 = "TENCENT_TJ101"
	TENCENT_NJ100 = "TENCENT_NJ100"
	TENCENT_GZ100 = "TENCENT_GZ100"
	TENCENT_CQ100 = "TENCENT_CQ100"
	TENCENT_BGP2  = "TENCENT_BGP2"
	TENCENT_PBE   = "TENCENT_PBE"
)

// 服务器 ID 常量
const (
	HN1   = "HN1"
	HN10  = "HN10"
	TJ100 = "TJ100"
	TJ101 = "TJ101"
	NJ100 = "NJ100"
	GZ100 = "GZ100"
	CQ100 = "CQ100"
	BGP2  = "BGP2"
	PBE   = "PBE"
	TW2   = "TW2"
	SG2   = "SG2"
	PH2   = "PH2"
	VN2   = "VN2"
)

// 英文段位常量
const (
	UNRANKED    = "UNRANKED"
	IRON        = "IRON"
	BRONZE      = "BRONZE"
	SILVER      = "SILVER"
	GOLD        = "GOLD"
	PLATINUM    = "PLATINUM"
	EMERALD     = "EMERALD"
	DIAMOND     = "DIAMOND"
	MASTER      = "MASTER"
	GRANDMASTER = "GRANDMASTER"
	CHALLENGER  = "CHALLENGER"
)

// 排位模式类型常量
const (
	RANKED_SOLO_5x5 = "RANKED_SOLO_5x5"
	RANKED_FLEX_SR  = "RANKED_FLEX_SR"
)

// 排位队列 ID 常量
const (
	QueueSolo5x5 = 420
	QueueMatch   = 430
	QueueFlex    = 440
	QueueAram    = 450
	QueueMatch2  = 490
	QueueOD      = 900
	QueueTFT     = 1700
	QueueURF     = 1900
)

// 游戏状态常量
const (
	Matchmaking       = "Matchmaking"       // 正在匹配
	ChampSelect       = "ChampSelect"       // 英雄选择中
	ReadyCheck        = "ReadyCheck"        // 等待接受状态中
	InProgress        = "InProgress"        // 游戏进行中
	EndOfGame         = "EndOfGame"         // 游戏结算
	Lobby             = "Lobby"             // 房间
	GameStart         = "GameStart"         // 游戏开始
	None              = "None"              // 无
	Reconnect         = "Reconnect"         // 重新连接
	WaitingForStats   = "WaitingForStats"   // 等待结果
	PreEndOfGame      = "PreEndOfGame"      // 结束游戏之前
	WatchInProgress   = "WatchInProgress"   // 在观战中
	TerminatedInError = "TerminatedInError" // 错误终止
)

type ChampionOption struct {
	Label    string `json:"label"`
	Value    int    `json:"value"`
	RealName string `json:"realName"`
	Nickname string `json:"nickname"`
}

var ChampionOptions = []ChampionOption{
	{Label: "全部", Value: 0, RealName: "", Nickname: ""},
	{Label: "黑暗之女", Value: 1, RealName: "安妮", Nickname: "火女"},
	{Label: "狂战士", Value: 2, RealName: "奥拉夫", Nickname: "大头"},
	{Label: "正义巨像", Value: 3, RealName: "加里奥", Nickname: "城墙"},
	{Label: "卡牌大师", Value: 4, RealName: "崔斯特", Nickname: "卡牌"},
	{Label: "德邦总管", Value: 5, RealName: "赵信", Nickname: "菊花信|赵神王"},
	{Label: "无畏战车", Value: 6, RealName: "厄加特", Nickname: "螃蟹"},
	{Label: "诡术妖姬", Value: 7, RealName: "乐芙兰", Nickname: "LB"},
	{Label: "猩红收割者", Value: 8, RealName: "弗拉基米尔", Nickname: "吸血鬼"},
	{Label: "远古恐惧", Value: 9, RealName: "费德提克", Nickname: "稻草人"},
	{Label: "正义天使", Value: 10, RealName: "凯尔", Nickname: "天使"},
	{Label: "无极剑圣", Value: 11, RealName: "易", Nickname: ""},
	{Label: "牛头酋长", Value: 12, RealName: "阿利斯塔", Nickname: "牛头"},
	{Label: "符文法师", Value: 13, RealName: "瑞兹", Nickname: "光头"},
	{Label: "亡灵战神", Value: 14, RealName: "赛恩", Nickname: "老司机"},
	{Label: "战争女神", Value: 15, RealName: "希维尔", Nickname: "轮子妈"},
	{Label: "众星之子", Value: 16, RealName: "索拉卡", Nickname: "奶妈"},
	{Label: "迅捷斥候", Value: 17, RealName: "提莫", Nickname: "蘑菇"},
	{Label: "麦林炮手", Value: 18, RealName: "崔丝塔娜", Nickname: "小炮"},
	{Label: "祖安怒兽", Value: 19, RealName: "沃里克", Nickname: "狼人"},
	{Label: "雪原双子", Value: 20, RealName: "努努和威朗普", Nickname: "雪人"},
	{Label: "赏金猎人", Value: 21, RealName: "厄运小姐", Nickname: "女枪"},
	{Label: "寒冰射手", Value: 22, RealName: "艾希", Nickname: "刮痧女王"},
	{Label: "蛮族之王", Value: 23, RealName: "泰达米尔", Nickname: "蛮王"},
	{Label: "武器大师", Value: 24, RealName: "贾克斯", Nickname: "武器"},
	{Label: "堕落天使", Value: 25, RealName: "莫甘娜", Nickname: ""},
	{Label: "时光守护者", Value: 26, RealName: "基兰", Nickname: "时光老头"},
	{Label: "炼金术士", Value: 27, RealName: "辛吉德", Nickname: "炼金"},
	{Label: "痛苦之拥", Value: 28, RealName: "伊芙琳", Nickname: "寡妇"},
	{Label: "瘟疫之源", Value: 29, RealName: "图奇", Nickname: "老鼠"},
	{Label: "死亡颂唱者", Value: 30, RealName: "卡尔萨斯", Nickname: "死歌"},
	{Label: "虚空恐惧", Value: 31, RealName: "科加斯", Nickname: "大虫子"},
	{Label: "殇之木乃伊", Value: 32, RealName: "阿木木", Nickname: "木乃伊"},
	{Label: "披甲龙龟", Value: 33, RealName: "拉莫斯", Nickname: "龙龟"},
	{Label: "冰晶凤凰", Value: 34, RealName: "艾尼维亚", Nickname: "凤凰"},
	{Label: "恶魔小丑", Value: 35, RealName: "萨科", Nickname: "小丑"},
	{Label: "祖安狂人", Value: 36, RealName: "蒙多医生", Nickname: "蒙多"},
	{Label: "琴瑟仙女", Value: 37, RealName: "娑娜", Nickname: "琴女"},
	{Label: "虚空行者", Value: 38, RealName: "卡萨丁", Nickname: "电耗子"},
	{Label: "刀锋舞者", Value: 39, RealName: "卡特琳娜", Nickname: "卡特"},
	{Label: "风暴之怒", Value: 40, RealName: "杰娜", Nickname: "风女"},
	{Label: "海洋之灾", Value: 41, RealName: "普朗克", Nickname: "船长"},
	{Label: "英勇投弹手", Value: 42, RealName: "库奇", Nickname: "飞机"},
	{Label: "天启者", Value: 43, RealName: "卡尔玛", Nickname: "扇子妈"},
	{Label: "瓦洛兰之盾", Value: 44, RealName: "塔里克", Nickname: "宝石"},
	{Label: "邪恶小法师", Value: 45, RealName: "维迦", Nickname: "小法"},
	{Label: "巨魔之王", Value: 48, RealName: "特朗德尔", Nickname: "巨魔"},
	{Label: "诺克萨斯统领", Value: 50, RealName: "斯维因", Nickname: "乌鸦"},
	{Label: "皮城女警", Value: 51, RealName: "凯特琳", Nickname: "女警"},
	{Label: "蒸汽机器人", Value: 53, RealName: "布里茨", Nickname: "机器人"},
	{Label: "熔岩巨兽", Value: 54, RealName: "墨菲特", Nickname: "石头人"},
	{Label: "不祥之刃", Value: 55, RealName: "卡特琳娜", Nickname: "卡特"},
	{Label: "永恒梦魇", Value: 56, RealName: "魔腾", Nickname: "梦魇"},
	{Label: "扭曲树精", Value: 57, RealName: "茂凯", Nickname: "大树"},
	{Label: "荒漠屠夫", Value: 58, RealName: "雷克顿", Nickname: "鳄鱼"},
	{Label: "德玛西亚皇子", Value: 59, RealName: "嘉文四世", Nickname: "皇子"},
	{Label: "蜘蛛女皇", Value: 60, RealName: "伊莉丝", Nickname: "蜘蛛"},
	{Label: "发条魔灵", Value: 61, RealName: "奥莉安娜", Nickname: "发条"},
	{Label: "齐天大圣", Value: 62, RealName: "孙悟空", Nickname: "猴子"},
	{Label: "复仇焰魂", Value: 63, RealName: "布兰德", Nickname: "火男"},
	{Label: "盲僧", Value: 64, RealName: "李青", Nickname: "瞎子"},
	{Label: "暗夜猎手", Value: 67, RealName: "薇恩", Nickname: "VN|uzi|UZI"},
	{Label: "机械公敌", Value: 68, RealName: "兰博", Nickname: "机器人"},
	{Label: "魔蛇之拥", Value: 69, RealName: "卡西奥佩娅", Nickname: "蛇女"},
	{Label: "上古领主", Value: 72, RealName: "斯卡纳", Nickname: "蝎子"},
	{Label: "大发明家", Value: 74, RealName: "海默丁格", Nickname: "大头"},
	{Label: "沙漠死神", Value: 75, RealName: "内瑟斯", Nickname: "狗头"},
	{Label: "狂野女猎手", Value: 76, RealName: "奈德丽", Nickname: "豹女"},
	{Label: "兽灵行者", Value: 77, RealName: "乌迪尔", Nickname: "德鲁伊"},
	{Label: "圣锤之毅", Value: 78, RealName: "波比", Nickname: "锤石"},
	{Label: "酒桶", Value: 79, RealName: "古拉加斯", Nickname: "酒桶"},
	{Label: "不屈之枪", Value: 80, RealName: "潘森", Nickname: "斯巴达"},
	{Label: "探险家", Value: 81, RealName: "伊泽瑞尔", Nickname: "EZ"},
	{Label: "铁铠冥魂", Value: 82, RealName: "莫德凯撒", Nickname: "铁男"},
	{Label: "牧魂人", Value: 83, RealName: "约里克", Nickname: "掘墓者"},
	{Label: "离群之刺", Value: 84, RealName: "阿卡丽", Nickname: "阿卡丽"},
	{Label: "狂暴之心", Value: 85, RealName: "凯南", Nickname: "电耗子"},
	{Label: "德玛西亚之力", Value: 86, RealName: "盖伦", Nickname: "草丛伦"},
	{Label: "曙光女神", Value: 89, RealName: "蕾欧娜", Nickname: "日女"},
	{Label: "虚空先知", Value: 90, RealName: "玛尔扎哈", Nickname: "蚂蚱"},
	{Label: "刀锋之影", Value: 91, RealName: "泰隆", Nickname: "男刀"},
	{Label: "放逐之刃", Value: 92, RealName: "锐雯", Nickname: "兔女郎"},
	{Label: "深渊巨口", Value: 96, RealName: "克格莫", Nickname: "大嘴"},
	{Label: "暮光之眼", Value: 98, RealName: "慎", Nickname: "慎"},
	{Label: "光辉女郎", Value: 99, RealName: "拉克丝", Nickname: "光辉"},
	{Label: "远古巫灵", Value: 101, RealName: "泽拉斯", Nickname: "死亡射线|挠头怪"},
	{Label: "龙血武姬", Value: 102, RealName: "希瓦娜", Nickname: "龙女"},
	{Label: "九尾妖狐", Value: 103, RealName: "阿狸", Nickname: "狐狸"},
	{Label: "法外狂徒", Value: 104, RealName: "格雷福斯", Nickname: "男枪"},
	{Label: "潮汐海灵", Value: 105, RealName: "菲兹", Nickname: "小鱼人"},
	{Label: "不灭狂雷", Value: 106, RealName: "沃利贝尔", Nickname: "雷熊"},
	{Label: "傲之追猎者", Value: 107, RealName: "雷恩加尔", Nickname: "狮子狗"},
	{Label: "惩戒之箭", Value: 110, RealName: "韦鲁斯", Nickname: "维鲁斯"},
	{Label: "深海泰坦", Value: 111, RealName: "诺提勒斯", Nickname: "泰坦"},
	{Label: "奥术先驱", Value: 112, RealName: "维克托", Nickname: "三只手"},
	{Label: "北地之怒", Value: 113, RealName: "瑟庄妮", Nickname: "猪妹"},
	{Label: "无双剑姬", Value: 114, RealName: "菲奥娜", Nickname: "剑姬"},
	{Label: "爆破鬼才", Value: 115, RealName: "吉格斯", Nickname: "炸弹人"},
	{Label: "仙灵女巫", Value: 117, RealName: "璐璐", Nickname: "露露"},
	{Label: "荣耀行刑官", Value: 119, RealName: "德莱文", Nickname: "德莱文"},
	{Label: "战争之影", Value: 120, RealName: "赫卡里姆", Nickname: "人马"},
	{Label: "虚空掠夺者", Value: 121, RealName: "卡兹克", Nickname: "螳螂"},
	{Label: "诺克萨斯之手", Value: 122, RealName: "德莱厄斯", Nickname: "诺手"},
	{Label: "未来守护者", Value: 126, RealName: "杰斯", Nickname: "杰斯"},
	{Label: "冰霜女巫", Value: 127, RealName: "丽桑卓", Nickname: "冰女"},
	{Label: "皎月女神", Value: 131, RealName: "戴安娜", Nickname: "皎月"},
	{Label: "德玛西亚之翼", Value: 133, RealName: "奎因", Nickname: "鸟人"},
	{Label: "暗黑元首", Value: 134, RealName: "辛德拉", Nickname: "球女"},
	{Label: "铸星龙王", Value: 136, RealName: "奥瑞利安·索尔", Nickname: "龙王"},
	{Label: "影流之镰", Value: 141, RealName: "凯隐&拉亚斯特", Nickname: ""},
	{Label: "暮光星灵", Value: 142, RealName: "佐伊", Nickname: "佐a"},
	{Label: "荆棘之兴", Value: 143, RealName: "婕拉", Nickname: "植物人"},
	{Label: "虚空之女", Value: 145, RealName: "卡莎", Nickname: ""},
	{Label: "星籁歌姬", Value: 147, RealName: "萨勒芬妮", Nickname: "轮椅人"},
	{Label: "迷失之牙", Value: 150, RealName: "纳尔", Nickname: ""},
	{Label: "生化魔人", Value: 154, RealName: "扎克", Nickname: "粑粑人"},
	{Label: "疾风剑豪", Value: 157, RealName: "亚索", Nickname: "索子哥|孤儿索"},
	{Label: "虚空之眼", Value: 161, RealName: "维克兹", Nickname: "大眼"},
	{Label: "岩雀", Value: 163, RealName: "塔莉垭", Nickname: ""},
	{Label: "青钢影", Value: 164, RealName: "卡米尔", Nickname: ""},
	{Label: "影哨", Value: 166, RealName: "阿克尚", Nickname: ""},
	{Label: "虚空女皇", Value: 200, RealName: "卑尔维斯", Nickname: "阿尔卑斯|棒棒糖"},
	{Label: "弗雷尔卓德之心", Value: 201, RealName: "布隆", Nickname: ""},
	{Label: "戏命师", Value: 202, RealName: "烬", Nickname: "瘸子"},
	{Label: "永猎双子", Value: 203, RealName: "千珏", Nickname: ""},
	{Label: "祖安花火", Value: 221, RealName: "泽丽", Nickname: ""},
	{Label: "暴走萝莉", Value: 222, RealName: "金克丝", Nickname: ""},
	{Label: "河流之王", Value: 223, RealName: "塔姆", Nickname: ""},
	{Label: "狂厄蔷薇", Value: 233, RealName: "狱卒", Nickname: ""},
	{Label: "破败之王", Value: 234, RealName: "佛耶戈", Nickname: ""},
	{Label: "涤魂圣枪", Value: 235, RealName: "塞纳", Nickname: ""},
	{Label: "圣枪游侠", Value: 236, RealName: "卢锡安", Nickname: ""},
	{Label: "影流之主", Value: 238, RealName: "劫", Nickname: "幽默飞镖人"},
	{Label: "暴怒骑士", Value: 240, RealName: "克烈", Nickname: ""},
	{Label: "时间刺客", Value: 245, RealName: "艾克", Nickname: ""},
	{Label: "元素女皇", Value: 246, RealName: "奇亚娜", Nickname: "超模"},
	{Label: "皮城执法官", Value: 254, RealName: "蔚", Nickname: ""},
	{Label: "暗裔剑魔", Value: 266, RealName: "亚托克斯", Nickname: ""},
	{Label: "唤潮鲛姬", Value: 267, RealName: "娜美", Nickname: ""},
	{Label: "沙漠皇帝", Value: 268, RealName: "阿兹尔", Nickname: "黄鸡"},
	{Label: "魔法猫咪", Value: 350, RealName: "悠米", Nickname: ""},
	{Label: "沙漠玫瑰", Value: 360, RealName: "莎米拉", Nickname: ""},
	{Label: "魂锁典狱长", Value: 412, RealName: "锤石", Nickname: ""},
	{Label: "海兽祭司", Value: 420, RealName: "俄洛伊", Nickname: "触手妈"},
	{Label: "虚空遁地兽", Value: 421, RealName: "雷克赛", Nickname: "挖掘机"},
	{Label: "翠神", Value: 427, RealName: "艾翁", Nickname: "小树"},
	{Label: "复仇之矛", Value: 429, RealName: "卡莉丝塔", Nickname: ""},
	{Label: "星界游神", Value: 432, RealName: "巴德", Nickname: ""},
	{Label: "幻翎", Value: 497, RealName: "洛", Nickname: ""},
	{Label: "逆羽", Value: 498, RealName: "霞", Nickname: ""},
	{Label: "山隐之焰", Value: 516, RealName: "奥恩", Nickname: "山羊"},
	{Label: "解脱者", Value: 517, RealName: "塞拉斯", Nickname: ""},
	{Label: "万花通灵", Value: 518, RealName: "妮蔻", Nickname: ""},
	{Label: "残月之肃", Value: 523, RealName: "厄斐琉斯", Nickname: "efls"},
	{Label: "镕铁少女", Value: 526, RealName: "芮尔", Nickname: ""},
	{Label: "血港鬼影", Value: 555, RealName: "派克", Nickname: ""},
	{Label: "愁云使者", Value: 711, RealName: "薇古斯", Nickname: ""},
	{Label: "封魔剑魂", Value: 777, RealName: "永恩", Nickname: ""},
	{Label: "铁血狼母", Value: 799, RealName: "安蓓萨", Nickname: ""},
	{Label: "流光镜影", Value: 800, RealName: "梅尔", Nickname: "三体人"},
	{Label: "腕豪", Value: 875, RealName: "瑟提", Nickname: ""},
	{Label: "含羞蓓蕾", Value: 876, RealName: "莉莉娅", Nickname: ""},
	{Label: "灵罗娃娃", Value: 887, RealName: "格温", Nickname: ""},
	{Label: "炼金男爵", Value: 888, RealName: "烈娜塔・戈拉斯克", Nickname: ""},
	{Label: "双界灵兔", Value: 893, RealName: "阿萝拉", Nickname: "兔子"},
	{Label: "不羁之悦", Value: 895, RealName: "尼菈", Nickname: "水米拉|水弥拉"},
	{Label: "纳祖芒荣耀", Value: 897, RealName: "奎桑提", Nickname: "黑哥"},
	{Label: "炽炎雏龙", Value: 901, RealName: "斯莫德", Nickname: "小火龙"},
	{Label: "明烛", Value: 902, RealName: "米利欧", Nickname: "顶真|丁真"},
	{Label: "异画师", Value: 910, RealName: "慧", Nickname: "毛笔人"},
	{Label: "百裂冥犬", Value: 950, RealName: "纳亚菲利", Nickname: "狼狗|狗比"},
}

const RobotPuuid = "00000000-0000-0000-0000-000000000000"
