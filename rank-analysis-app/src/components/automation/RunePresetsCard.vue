<script setup lang="ts">
/**
 * 设置页「自动应用符文」卡片
 *
 * 与「自动选择英雄」卡片同构：头部总开关（settings.auto.applyRunesSwitch）；卡内先是
 * 「我的符文方案」（规则，按英雄 + 分路先匹配），再是「没记住的英雄用什么兜底」。
 * 方案只能在选人期推荐栏「☆ 记住」添加，这里负责查看与删除。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ColorWandOutline } from '@vicons/ionicons5'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { assetPrefix } from '@renderer/services/http'
import { useRunePresets } from '@renderer/composables/useRunePresets'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import type { championOption } from '@renderer/types/domain/champion'
import type { RuneFallback, RunePreset } from '@renderer/types/championBuild'

const props = defineProps<{
  /** 英雄选项（设置页已加载的那份），用来把 id 翻成中文名 */
  championOptions: championOption[]
}>()

const enabled = ref(false)
const presetsApi = useRunePresets()
const assets = useRecordAssets()

onMounted(async () => {
  enabled.value = (await getConfigByIpc<boolean>(CONFIG_KEYS.applyRunesSwitch)) ?? false
  await presetsApi.reload()
})

async function onToggle(next: boolean): Promise<void> {
  enabled.value = next
  await putConfigByIpc(CONFIG_KEYS.applyRunesSwitch, next)
}

/** 新记住的在前 */
const sorted = computed(() => [...presetsApi.presets.value].sort((a, b) => b.saved_at - a.saved_at))

// 符文 / 符文系名字按需加载
watch(
  sorted,
  list => {
    const ids = new Set<number>()
    for (const p of list) {
      ids.add(p.primary_style_id)
      ids.add(p.sub_style_id)
      ids.add(p.primary_perk_ids[0])
    }
    if (ids.size) assets.preload([{ kind: 'perk', ids: [...ids] }])
  },
  { immediate: true }
)

const POSITION_LABELS: Record<string, string> = {
  top: '上单',
  jungle: '打野',
  middle: '中单',
  bottom: '下路',
  utility: '辅助',
  none: '大乱斗'
}

function championName(id: number): string {
  const c = props.championOptions.find(o => o.value === id)
  return c?.realName || c?.label || `英雄 ${id}`
}

const perkName = (id: number) => assets.detailOf('perk', id)?.name ?? ''

function titleOf(p: RunePreset): string {
  return `${championName(p.champion_id)} · ${POSITION_LABELS[p.position] ?? p.position}`
}

function runeOf(p: RunePreset): string {
  const main = [perkName(p.primary_style_id), perkName(p.primary_perk_ids[0])]
    .filter(Boolean)
    .join(' · ')
  const sub = perkName(p.sub_style_id)
  return sub ? `${main} / ${sub}` : main
}

function onFallback(next: RuneFallback): void {
  void presetsApi.setFallback(next)
}
</script>

<template>
  <n-card>
    <template #header>
      <span class="setting-label">
        <n-icon size="20" class="runes-icon">
          <ColorWandOutline />
        </n-icon>
        自动应用符文
      </span>
    </template>
    <template #header-extra>
      <n-switch :value="enabled" @update:value="onToggle" />
    </template>

    <!-- 开关关闭时整体降透明度：方案仍可管理，但一眼能看出当前不生效 -->
    <div :class="{ 'runes-inactive': !enabled }">
      <div class="section-title">我的符文方案（先匹配这里）</div>
      <div v-if="sorted.length === 0" class="presets-empty">
        还没有记住的方案。选人期在推荐栏选中一套符文后点「☆ 记住」即可添加
      </div>
      <div v-for="p in sorted" :key="`${p.champion_id}-${p.position}`" class="preset-row">
        <n-avatar
          :src="`${assetPrefix}/champion/${p.champion_id}`"
          :fallback-src="`${assetPrefix}/champion/-1`"
          :size="24"
          style="flex-shrink: 0"
        />
        <span class="preset-title">{{ titleOf(p) }}</span>
        <img class="preset-keystone" :src="assets.srcOf('perk', p.primary_perk_ids[0])" alt="" />
        <span class="preset-rune">{{ runeOf(p) }}</span>
        <n-button
          quaternary
          type="error"
          size="small"
          class="preset-delete"
          @click="presetsApi.forget(p.champion_id, p.position)"
        >
          删除
        </n-button>
      </div>

      <div class="fallback-row">
        <span class="section-title fallback-title">没记住的英雄：</span>
        <n-radio-group
          :value="presetsApi.fallback.value"
          name="rune-fallback"
          @update:value="onFallback"
        >
          <n-radio value="opgg" class="fallback-radio">用 OP.GG 推荐</n-radio>
          <n-radio value="none" class="fallback-radio">不自动写</n-radio>
        </n-radio-group>
      </div>
    </div>
  </n-card>
</template>

<style scoped>
.setting-label {
  font-size: var(--font-size-md);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--text-primary);
}

.runes-icon {
  color: var(--accent-gold);
}

.runes-inactive {
  opacity: 0.45;
  transition: opacity var(--dur-normal, 0.2s) ease;
}

.section-title {
  font-weight: 600;
  margin-bottom: var(--space-8);
  color: var(--text-primary);
}

.presets-empty {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  padding: var(--space-4) 0 var(--space-12);
}

.preset-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.preset-title {
  min-width: 120px;
  white-space: nowrap;
}

.preset-keystone {
  width: 22px;
  height: 22px;
}

.preset-rune {
  flex: 1;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fallback-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-top: var(--space-12);
}

.fallback-title {
  margin-bottom: 0;
}
</style>
