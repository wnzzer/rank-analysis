<template>
  <span
    class="objective-icon"
    :class="[`objective-icon--${kind}`, { [`objective-icon--${side}`]: side }]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :data-kind="kind"
  >
    <img class="objective-icon-img" :src="src" :alt="label" :aria-label="label" />
  </span>
</template>

<script setup lang="ts">
/**
 * 资源（野怪）图标：按 monsterType / monsterSubType 显示游戏内官方小地图图标，外圈按拿下方着色。
 * 图标素材为 Riot 官方资源（cdragon game/assets/ux/minimap/icons，64x64 PNG），
 * 打包进应用离线使用：国内直连 cdragon 极慢，故不做运行时网络请求。
 * 无 side 时不画外圈。
 * @property monster - monsterType（DRAGON / BARON_NASHOR / RIFTHERALD / HORDE / ATAKHAN，未知 → 通用小龙图）
 * @property subType - monsterSubType（FIRE_DRAGON 等；对龙、阿塔坎生效）
 * @property side - 拿下方；缺省不画外圈
 * @property size - 像素边长，默认 18
 */
import { computed } from 'vue'
import { monsterLabel } from '@renderer/services/ai/shared/timeline/labels'
import baron from '@renderer/assets/objectives/baron.png'
import dragon from '@renderer/assets/objectives/dragon.png'
import dragonInfernal from '@renderer/assets/objectives/dragon_infernal.png'
import dragonOcean from '@renderer/assets/objectives/dragon_ocean.png'
import dragonCloud from '@renderer/assets/objectives/dragon_cloud.png'
import dragonMountain from '@renderer/assets/objectives/dragon_mountain.png'
import dragonHextech from '@renderer/assets/objectives/dragon_hextech.png'
import dragonChemtech from '@renderer/assets/objectives/dragon_chemtech.png'
import dragonElder from '@renderer/assets/objectives/dragon_elder.png'
import riftherald from '@renderer/assets/objectives/riftherald.png'
import grub from '@renderer/assets/objectives/grub.png'
import atakhanR from '@renderer/assets/objectives/atakhan_r.png'
import atakhanV from '@renderer/assets/objectives/atakhan_v.png'

const props = withDefaults(
  defineProps<{ monster: string; subType?: string; side?: 'blue' | 'red'; size?: number }>(),
  { subType: '', side: undefined, size: 18 }
)

type Kind = 'dragon' | 'elder' | 'baron' | 'herald' | 'grub' | 'atakhan' | 'unknown'

/** 龙元素：中文名与图标（key 为 monsterSubType 去掉 _DRAGON 后缀） */
const ELEMENTS: Record<string, { src: string; name: string }> = {
  FIRE: { src: dragonInfernal, name: '火' },
  WATER: { src: dragonOcean, name: '海洋' },
  OCEAN: { src: dragonOcean, name: '海洋' },
  AIR: { src: dragonCloud, name: '云' },
  CLOUD: { src: dragonCloud, name: '云' },
  EARTH: { src: dragonMountain, name: '山' },
  MOUNTAIN: { src: dragonMountain, name: '山' },
  HEXTECH: { src: dragonHextech, name: '海克斯' },
  CHEMTECH: { src: dragonChemtech, name: '化学科技' }
}

const kind = computed<Kind>(() => {
  if (props.monster === 'DRAGON') return props.subType === 'ELDER_DRAGON' ? 'elder' : 'dragon'
  if (props.monster === 'BARON_NASHOR') return 'baron'
  if (props.monster === 'RIFTHERALD') return 'herald'
  if (props.monster === 'HORDE') return 'grub'
  if (props.monster === 'ATAKHAN') return 'atakhan'
  return 'unknown'
})

const element = computed(() => ELEMENTS[props.subType.replace(/_DRAGON$/, '')])

const src = computed(() => {
  switch (kind.value) {
    case 'elder':
      return dragonElder
    case 'dragon':
      return element.value?.src ?? dragon
    case 'baron':
      return baron
    case 'herald':
      return riftherald
    case 'grub':
      return grub
    case 'atakhan':
      return props.subType.includes('RUINOUS') ? atakhanR : atakhanV
    default:
      return dragon
  }
})

const label = computed(() => {
  if (kind.value === 'elder') return '远古龙'
  if (kind.value === 'dragon') return element.value ? `小龙（${element.value.name}）` : '小龙'
  if (kind.value === 'herald') return '峡谷先锋'
  return monsterLabel(props.monster)
})
</script>

<style scoped>
.objective-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
  box-sizing: border-box;
  border-radius: 50%;
  /* 半透明深底：浅色 / 深色背景下都能托出图标 */
  background: rgba(20, 24, 33, 0.55);
  overflow: hidden;
}

/* 外圈：按拿下方着色 */
.objective-icon--blue {
  border: 1.5px solid var(--side-blue);
}

.objective-icon--red {
  border: 1.5px solid var(--side-red);
}

.objective-icon-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
