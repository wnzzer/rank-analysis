import type {
  ChampionCollection,
  OwnedChromaCollection
} from '@renderer/types/domain/championCollection'

const ROOT =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons'

const demoChampions = [
  [12, '阿利斯塔', '牛头酋长', 'Alistar'],
  [22, '艾希', '寒冰射手', 'Ashe'],
  [51, '凯特琳', '皮城女警', 'Caitlyn'],
  [64, '李青', '盲僧', 'LeeSin'],
  [81, '伊泽瑞尔', '探险家', 'Ezreal'],
  [103, '阿狸', '九尾妖狐', 'Ahri'],
  [117, '璐璐', '仙灵女巫', 'Lulu'],
  [157, '亚索', '疾风剑豪', 'Yasuo'],
  [266, '亚托克斯', '暗裔剑魔', 'Aatrox'],
  [412, '锤石', '魂锁典狱长', 'Thresh'],
  [555, '派克', '血港鬼影', 'Pyke'],
  [777, '永恩', '封魔剑魂', 'Yone']
] as const

export const championCollectionDemo: ChampionCollection = {
  source: 'communityDragon',
  champions: demoChampions.map(([id, name, title, alias]) => ({
    id,
    name,
    title,
    alias,
    portraitUrl: `${ROOT}/${id}.png`
  })),
  patch: {
    label: '当前版本演示',
    publishedAt: '2026-07-29',
    sourceUrl: 'https://lol.qq.com/',
    isFresh: true,
    changes: [
      {
        championId: 12,
        direction: 'buff',
        lines: ['基础护甲提升。', 'Q 技能法力消耗降低。']
      },
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
