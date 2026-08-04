import type {
  ChampionAbility,
  ChampionCollection,
  ChampionCollectionItem,
  ChampionDetail,
  ChampionLane,
  MatchupSnapshot,
  MatchupTier,
  OwnedChromaCollection
} from '@renderer/types/domain/championCollection'

const ROOT =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons'
const ASSET_ROOT =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets'

const demoChampions: ChampionCollectionItem[] = [
  [12, '阿利斯塔', '牛头酋长', 'Alistar', ['support']],
  [22, '艾希', '寒冰射手', 'Ashe', ['bottom', 'support']],
  [51, '凯特琳', '皮城女警', 'Caitlyn', ['bottom']],
  [64, '李青', '盲僧', 'LeeSin', ['jungle']],
  [81, '伊泽瑞尔', '探险家', 'Ezreal', ['bottom']],
  [103, '阿狸', '九尾妖狐', 'Ahri', ['middle']],
  [117, '璐璐', '仙灵女巫', 'Lulu', ['support']],
  [157, '亚索', '疾风剑豪', 'Yasuo', ['middle', 'top']],
  [266, '亚托克斯', '暗裔剑魔', 'Aatrox', ['top']],
  [412, '锤石', '魂锁典狱长', 'Thresh', ['support']],
  [555, '派克', '血港鬼影', 'Pyke', ['support']],
  [777, '永恩', '封魔剑魂', 'Yone', ['middle', 'top']]
].map(([id, name, title, alias, lanes]) => ({
  id: id as number,
  name: name as string,
  title: title as string,
  alias: alias as string,
  lanes: lanes as ChampionLane[],
  portraitUrl: `${ROOT}/${id}.png`
}))

export const championCollectionDemo: ChampionCollection = {
  source: 'bundledSnapshot',
  dataPatch: '16.15',
  generatedAt: '2026-07-29T08:00:00Z',
  champions: demoChampions,
  patch: {
    label: '16.15 版本演示',
    publishedAt: '2026-07-29',
    sourceUrl: 'https://lol.qq.com/',
    isFresh: true,
    changes: [
      { championId: 12, direction: 'buff', lines: ['基础护甲提升。', 'Q 技能法力消耗降低。'] },
      {
        championId: 103,
        direction: 'adjusted',
        lines: ['被动治疗机制调整，前期效果降低、后期效果提升。']
      },
      {
        championId: 157,
        direction: 'nerf',
        lines: ['Q 技能后期伤害降低。', 'R 技能冷却时间提升。']
      }
    ]
  }
}

function icon(alias: string, key: string) {
  return `${ASSET_ROOT}/characters/${alias.toLowerCase()}/hud/icons2d/icons_${alias.toLowerCase()}_${key.toLowerCase()}.png`
}

function demoAbilities(alias: string): ChampionAbility[] {
  return [
    {
      slot: 'P',
      name: '战术被动',
      description: '参与战斗会逐步积累优势。这里演示被动技能的独立说明布局。',
      iconUrl: icon(alias, 'passive'),
      maxRank: 1,
      cooldowns: [],
      costs: [],
      ranges: [],
      rankValues: []
    },
    {
      slot: 'Q',
      name: '主要伤害技能',
      description: '命中敌人造成魔法伤害。技能等级与英雄等级分开切换。',
      iconUrl: icon(alias, 'q'),
      maxRank: 5,
      cooldowns: [7, 7, 7, 7, 7],
      costs: [55, 65, 75, 85, 95],
      ranges: [970, 970, 970, 970, 970],
      rankValues: [{ label: '基础伤害', values: [35, 60, 85, 110, 135] }]
    },
    {
      slot: 'W',
      name: '机动技能',
      description: '短暂提升移动能力，并对附近目标造成伤害。',
      iconUrl: icon(alias, 'w'),
      maxRank: 5,
      cooldowns: [9, 8, 7, 6, 5],
      costs: [30, 30, 30, 30, 30],
      ranges: [700, 700, 700, 700, 700],
      rankValues: [{ label: '移动速度', values: ['40%', '40%', '40%', '40%', '40%'] }]
    },
    {
      slot: 'E',
      name: '控制技能',
      description: '命中首个敌人并施加控制效果。',
      iconUrl: icon(alias, 'e'),
      maxRank: 5,
      cooldowns: [12, 12, 12, 12, 12],
      costs: [60, 60, 60, 60, 60],
      ranges: [975, 975, 975, 975, 975],
      rankValues: [
        { label: '控制时间', values: [1.2, 1.35, 1.5, 1.65, 1.8], suffix: '秒' },
        { label: '基础伤害', values: [80, 120, 160, 200, 240] }
      ]
    },
    {
      slot: 'R',
      name: '终极技能',
      description: '向目标方向突进并攻击附近敌人。',
      iconUrl: icon(alias, 'r'),
      maxRank: 3,
      cooldowns: [130, 105, 80],
      costs: [100, 100, 100],
      ranges: [450, 450, 450],
      rankValues: [{ label: '基础伤害', values: [75, 125, 175] }]
    }
  ]
}

export function championDetailDemo(championId: number): ChampionDetail {
  const champion = demoChampions.find(item => item.id === championId) ?? demoChampions[5]
  return {
    ...champion,
    shortBio: `${champion.name}的演示战术档案。正式应用会读取当前国服快照中的中文背景、属性和技能说明。`,
    roles: ['mage', 'assassin'],
    splashUrl: `${ASSET_ROOT}/characters/${champion.alias.toLowerCase()}/skins/base/images/${champion.alias.toLowerCase()}_splash_centered_0.jpg`,
    difficulty: 2,
    attackType: 'ranged',
    damageType: 'magic',
    stats: {
      health: { base: 590, growth: 104 },
      healthRegen: { base: 2.5, growth: 0.6, precision: 1 },
      resourceName: '法力值',
      resource: { base: 418, growth: 25 },
      resourceRegen: { base: 8, growth: 0.8, precision: 1 },
      attackDamage: { base: 53, growth: 3, precision: 1 },
      armor: { base: 21, growth: 4.2, precision: 1 },
      magicResist: { base: 30, growth: 1.3, precision: 1 },
      attackSpeed: { base: 0.668, ratio: 0.625, growth: 2.2 },
      moveSpeed: 330,
      attackRange: 550
    },
    abilities: demoAbilities(champion.alias)
  }
}

export function matchupDemo(
  championId: number,
  tier: MatchupTier,
  lane: ChampionLane
): MatchupSnapshot {
  const candidates = demoChampions.filter(item => item.id !== championId).slice(0, 8)
  return {
    patch: '16.15',
    tier,
    lane,
    region: '全球服',
    generatedAt: '2026-07-29T08:00:00Z',
    source: '构建期统计快照演示',
    isPartial: true,
    rows: candidates.map((item, index) => ({
      opponentId: item.id,
      winRate: 0.44 + index * 0.017,
      games: 680 + index * 431,
      goldDiffAt15: -185 + index * 52,
      csDiffAt15: -4.2 + index * 1.1,
      xpDiffAt15: -120 + index * 37
    }))
  }
}

export const ownedChromaDemo: OwnedChromaCollection = {
  summonerName: '演示账号#DEMO',
  isPartial: false,
  warning: null,
  chromas: [
    {
      championId: 103,
      championName: '阿狸',
      skinId: 103027,
      skinName: '灵魂莲华 阿狸',
      chromaId: 1030271,
      chromaName: '红宝石',
      colors: ['#d34b55', '#f1c7d0'],
      skinImageUrl: `${ROOT}/103.png`
    },
    {
      championId: 103,
      championName: '阿狸',
      skinId: 103027,
      skinName: '灵魂莲华 阿狸',
      chromaId: 1030272,
      chromaName: '青花瓷',
      colors: ['#4b78a8', '#e7e2d5'],
      skinImageUrl: `${ROOT}/103.png`
    },
    {
      championId: 157,
      championName: '亚索',
      skinId: 157036,
      skinName: '黑夜使者 亚索',
      chromaId: 1570361,
      chromaName: '神话炫彩',
      colors: ['#6d4bb7', '#d7a955'],
      skinImageUrl: `${ROOT}/157.png`
    }
  ]
}
