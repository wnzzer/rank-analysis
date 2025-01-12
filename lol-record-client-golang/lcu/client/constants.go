package client

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
}
var TierEnToCn = map[string]string{
	"UNRANKED":    "未定级",
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
	"":            "未定级",
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
	1700: "斗魂竞技",
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
