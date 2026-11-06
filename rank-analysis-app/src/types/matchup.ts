/** OP.GG 传统召唤师峡谷对位领域契约，比例均为 0..1。 */
import type { OpggTier } from '@renderer/services/opgg'

/** OP.GG 接口支持的五种分路，不等同 LCU 的 middle/bottom/utility。 */
export type MatchupPosition = 'top' | 'jungle' | 'mid' | 'adc' | 'support'
/** 推荐组以敌方整场胜率分类，不承诺个人操作优劣。 */
export type MatchupGroup = 'good' | 'bad'

/** 对位查询上下文，详情必须指定列表返回的版本。 */
export interface MatchupQuery {
  /** 本局敌方英雄 ID。 */
  enemyId: number
  /** 待分析的分路。 */
  position: MatchupPosition
  /** 当前统计段位集合。 */
  tier: OpggTier
  /** 列表首次查询可省略以发现当前版本。 */
  version?: string
}

/** 源数据身份与时间；不能把本地获取时间冒充统计更新时间。 */
export interface MatchupSource extends MatchupQuery {
  /** 服务端确认的实际版本。 */
  version: string
  /** OP.GG 缓存时间；源未提供时为 null。 */
  cachedAt: string | null
  /** 本地获取时间，unix 秒。 */
  fetchedAt: number
  /** 网络失败时是否回退到同上下文旧缓存。 */
  stale: boolean
}

/** 列表记录，胜率属于被分析的敌方英雄。 */
export interface MatchupCandidate {
  /** 候选英雄 ID。 */
  championId: number
  /** 敌方英雄对该候选的整场胜率，用于排序。 */
  enemyWinRate: number
  /** 列表统计样本局数。 */
  play: number
}

/** 指定英雄、段位和分路的完整可用候选集。 */
export interface MatchupList extends MatchupSource {
  /** 接口实际返回的候选，不承诺覆盖全部英雄。 */
  candidates: MatchupCandidate[]
}

/** 双方详情；展示数值从候选自身统计计算。 */
export interface MatchupDetail extends MatchupSource {
  /** 当前候选英雄 ID。 */
  candidateId: number
  /** 候选 win/play；缺失或非法为 null，0 是有效胜率。 */
  candidateWinRate: number | null
  /** 候选 lane_kill/双方 lane_kill 总和；打野及无数据为 null。 */
  laneKillRate: number | null
  /** 候选自身的统计样本；无效为 null。 */
  play: number | null
}

/** 当前公开可见的敌方槽位，与召唤师身份无关。 */
export interface MatchupEnemy {
  /** 本局队伍内稳定槽位索引。 */
  slot: number
  /** 尚未亮英雄时为 0。 */
  championId: number
  /** 原选人状态，用于显示选择中/已锁定。 */
  pickState?: string
}

/** 可注入的数据与资源访问接口，演示复用正式组件而不伪造客户端连接。 */
export interface MatchupApi {
  /** 按上下文获取候选列表，网络失败拒绝 Promise。 */
  getList: (query: MatchupQuery) => Promise<MatchupList>
  /** 获取双方详情；query.version 必须来自列表。 */
  getDetail: (query: MatchupQuery, candidateId: number) => Promise<MatchupDetail>
  /** 查询英雄主流分路；无法推测时为 null，由用户手动选择。 */
  getPosition: (enemyId: number) => Promise<MatchupPosition | null>
  /** 预加载英雄中文名。 */
  loadNames: () => Promise<void>
  /** 返回英雄中文名，未加载时可用 ID 占位。 */
  name: (id: number) => string
  /** 返回与应用资源协议一致的头像地址。 */
  icon: (id: number) => string
  /** 当前英雄、分路及段位的 OP.GG 页面；别名未知时返回 null。 */
  sourceUrl?: (id: number, position: MatchupPosition, tier: OpggTier) => string | null
  /** 正式应用使用系统浏览器打开来源；演示省略以保留普通链接行为。 */
  openSource?: (url: string) => Promise<void>
  /** 仅演示提供器设为 true，组件持续标注示例数据。 */
  demo?: boolean
}

/** 候选行异步状态，不把错误当空统计。 */
export interface MatchupRow extends MatchupCandidate {
  /** 该行详情是否正在获取。 */
  loading: boolean
  /** 获取成功的候选视角统计。 */
  data?: MatchupDetail
  /** 可读错误提示；存在时显示重试。 */
  error?: string
}
