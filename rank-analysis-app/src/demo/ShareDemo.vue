<script setup lang="ts">
/**
 * 开发用：赛后弹卡与战报图的全部视觉状态，一页摆开截图验收（独立入口 share-demo.html，不进正式构建）。
 *
 * 数据是手写的示例（不依赖 LCU / 复盘模型），图片直接取 CommunityDragon 镜像，
 * 浏览器里 `npm run dev` 后打开 http://localhost:1420/share-demo.html；倒计时关掉（ttl 0）方便截图。
 * 验收清单见 spec 2026-11-19-postgame-toast-design.md §视觉 / 验收。
 */
import { nextTick, onMounted, ref } from 'vue'
import { domToPng } from 'modern-screenshot'
import PostGameToastCard from '@renderer/components/gaming/PostGameToastCard.vue'
import ShareCard from '@renderer/components/gaming/ShareCard.vue'
import {
  LABEL_COPY,
  type ShareCard as ShareCardData,
  type ShareFact
} from '@renderer/services/ai/review/shareFacts'
import type { VerdictLabel } from '@renderer/services/ai/matchDetail/types'

const CDN = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'
const icon = (id: number): string => `${CDN}/v1/champion-icons/${id}.png`
const splash = (key: string): string =>
  `${CDN}/assets/characters/${key}/skins/base/images/${key}_splash_centered_0.jpg`

/** 示例英雄：id、中文名、原画目录名 */
const CHAMPS = {
  yasuo: { id: 157, cn: '疾风剑豪', key: 'yasuo' },
  jinx: { id: 222, cn: '暴走萝莉', key: 'jinx' },
  leesin: { id: 64, cn: '盲僧', key: 'leesin' },
  thresh: { id: 412, cn: '魂锁典狱长', key: 'thresh' },
  ahri: { id: 103, cn: '九尾妖狐', key: 'ahri' }
} as const
type ChampKey = keyof typeof CHAMPS

const LINEUP_ALLIES = [157, 64, 103, 222, 412].map(icon)
const LINEUP_ENEMIES = [86, 121, 134, 51, 117].map(icon)

const fact = (headline: string, detail: string | null = null): ShareFact => ({
  kind: 'blame',
  headline,
  detail,
  score: 1,
  polarity: 'good'
})

const PARTS = [
  { cn: '对线', level: '大幅领先', bar: 2.2 },
  { cn: '团战', level: '领先', bar: 1 },
  { cn: '死亡质量', level: '落后', bar: -0.9 },
  { cn: '发育', level: '持平', bar: 0.1 },
  { cn: '资源', level: '大幅落后', bar: -2.1 },
  { cn: '视野', level: '领先', bar: 0.8 },
  { cn: '职责', level: '大幅领先', bar: 2.6 }
]

function card(
  label: VerdictLabel,
  champ: ChampKey,
  win: boolean,
  kda: string,
  facts: ShareFact[]
): ShareCardData {
  const c = CHAMPS[champ]
  return {
    label,
    copy: LABEL_COPY[label],
    name: '示例玩家#1234',
    champion: c.cn,
    championId: c.id,
    roleCn: '中单',
    win,
    kda,
    facts,
    parts: PARTS
  }
}

const SHARE_CARDS: Array<{
  title: string
  card: ShareCardData
  champ: ChampKey
  noSplash?: boolean
}> = [
  {
    title: 'Carry（炫耀金）',
    champ: 'yasuo',
    card: card('Carry', 'yasuo', true, '14/2/9', [
      fact('被 4 包 1 拖住 2 次，队友趁机拿下大龙与先锋', '以少打多 2 次'),
      fact('KDA 队内第 2，评分队内第 1'),
      fact('本局表现约在同位置玩家前 5%')
    ])
  },
  {
    title: '被连累（洗冤蓝）',
    champ: 'jinx',
    card: card('被连累', 'jinx', false, '9/9/6', [
      fact('9 次阵亡，本人责任只算 4 次', '队友先崩 3 次 · 以少打多 2 次'),
      fact('发育大幅领先同位置同英雄'),
      fact('KDA 队内第 3，评分队内第 1')
    ])
  },
  {
    title: '正常（平常灰）',
    champ: 'thresh',
    card: card('正常', 'thresh', true, '1/4/17', [fact('视野大幅领先同位置同英雄')])
  },
  {
    title: '犯罪（自嘲橙）',
    champ: 'leesin',
    card: card('犯罪', 'leesin', false, '2/11/4', [
      { ...fact('11 次阵亡，10 次算自己的'), polarity: 'bad' },
      { ...fact('对线大幅落后同位置同英雄'), polarity: 'bad' }
    ])
  },
  {
    title: '原画缺失兜底',
    champ: 'ahri',
    noSplash: true,
    card: card('尽力', 'ahri', true, '8/3/10', [fact('KDA 队内第 4，评分队内第 1')])
  }
]

const META = ['31:42', '+21 LP', '隐藏分 ≈ 钻石 II · 高于段位']

type ToastProps = InstanceType<typeof PostGameToastCard>['$props']
type ToastDemo = {
  title: string
  props: ToastProps
}
const t = (champ: ChampKey) => ({
  champion: CHAMPS[champ].cn,
  splashUrl: splash(CHAMPS[champ].key),
  iconUrl: icon(CHAMPS[champ].id),
  ttlMs: 0
})
const TOASTS: ToastDemo[] = [
  {
    title: '未标注（猜测钩子）',
    props: {
      ...t('yasuo'),
      state: 'guess',
      win: true,
      kda: '14/2/9',
      lpText: '+21 LP',
      allies: LINEUP_ALLIES,
      enemies: LINEUP_ENEMIES
    }
  },
  {
    title: '已揭晓 · Carry',
    props: {
      ...t('yasuo'),
      state: 'revealed',
      win: true,
      kda: '14/2/9',
      lpText: '+21 LP',
      label: 'Carry',
      tone: 'brag',
      tagline: '这把我带飞',
      headline: '被 4 包 1 拖住 2 次，队友趁机拿下大龙与先锋'
    }
  },
  {
    title: '已揭晓 · 被连累',
    props: {
      ...t('jinx'),
      state: 'revealed',
      win: false,
      kda: '9/9/6',
      lpText: '-18 LP',
      label: '被连累',
      tone: 'vindicate',
      tagline: '输了，但锅不在我',
      headline: '9 次阵亡，本人责任只算 4 次'
    }
  },
  {
    title: '已揭晓 · 正常',
    props: {
      ...t('thresh'),
      state: 'revealed',
      win: true,
      kda: '1/4/17',
      lpText: '+19 LP',
      label: '正常',
      tone: 'neutral',
      tagline: '不功不过的一局',
      headline: '视野大幅领先同位置同英雄'
    }
  },
  {
    title: '已揭晓 · 犯罪',
    props: {
      ...t('leesin'),
      state: 'revealed',
      win: false,
      kda: '2/11/4',
      lpText: '-20 LP',
      label: '犯罪',
      tone: 'roast',
      tagline: '这把……确实怪我',
      headline: '11 次阵亡，10 次算自己的',
      copyState: 'copied'
    }
  },
  {
    title: '模型未就绪',
    props: { ...t('ahri'), state: 'loading', win: true, kda: '8/3/10', lpText: null }
  },
  {
    title: '原画缺失兜底',
    props: {
      ...t('ahri'),
      splashUrl: null,
      state: 'revealed',
      win: true,
      kda: '8/3/10',
      lpText: '+17 LP',
      label: '尽力',
      tone: 'brag',
      tagline: '赢了，我出力不少',
      headline: 'KDA 队内第 4，评分队内第 1'
    }
  }
]

/**
 * 导出预览（地址带 ?export）：用与正式导出相同的 modern-screenshot ×3 渲染每张战报图，
 * 检查渐变字、原画、color-mix 等在导出 PNG 里是否保真。
 */
const cardsEl = ref<HTMLElement | null>(null)
const exported = ref<string[]>([])
onMounted(async () => {
  if (!location.search.includes('export')) return
  await nextTick()
  // 等原画加载完再截
  await new Promise(r => setTimeout(r, 3000))
  const nodes = cardsEl.value?.querySelectorAll<HTMLElement>('[data-test="share-card"]') ?? []
  for (const n of nodes) exported.value.push(await domToPng(n, { scale: 3 }))
})
</script>

<template>
  <div class="share-demo">
    <h2>赛后右下角弹卡</h2>
    <div class="demo-grid toasts" data-test="demo-toasts">
      <figure v-for="d in TOASTS" :key="d.title">
        <figcaption>{{ d.title }}</figcaption>
        <div class="toast-frame">
          <PostGameToastCard v-bind="d.props" />
        </div>
      </figure>
    </div>

    <h2>战报图（360×480，导出 ×3）</h2>
    <div ref="cardsEl" class="demo-grid cards" data-test="demo-cards">
      <figure v-for="d in SHARE_CARDS" :key="d.title">
        <figcaption>{{ d.title }}</figcaption>
        <ShareCard
          :card="d.card"
          :angle="0"
          :hide-name="false"
          :icon-url="icon(CHAMPS[d.champ].id)"
          :splash-url="d.noSplash ? null : splash(CHAMPS[d.champ].key)"
          :meta="META"
        />
      </figure>
    </div>

    <template v-if="exported.length">
      <h2>导出预览（modern-screenshot ×3，按 1/3 显示）</h2>
      <div class="demo-grid">
        <img v-for="(src, i) in exported" :key="i" :src="src" class="exported" alt="" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.share-demo {
  height: 100%;
  overflow: auto;
  padding: 24px;
  /* 模拟 Windows 桌面 / 聊天背景：卡片在明暗背景上都要站得住 */
  background: linear-gradient(135deg, #2b3a55 0%, #4a5d7e 50%, #c9d3e2 100%);
  color: #fff;
}
h2 {
  margin: 8px 0 12px;
  font-size: 16px;
}
.demo-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 28px;
}
figure {
  margin: 0;
}
figcaption {
  margin-bottom: 6px;
  font-size: 12px;
  opacity: 0.85;
}
.exported {
  width: 360px;
  height: 480px;
  outline: 1px dashed rgba(255, 255, 255, 0.4); /* theme-fixed：演示页 */
}
.toast-frame {
  padding: 20px;
}
</style>
