<script setup lang="ts">
/**
 * 常规设置里的「帮助改进 Rank Analysis」：一个总开关，下面两个可单独勾的子项。
 *
 * 设计见 docs/superpowers/specs/2026-11-21-unified-share-switch-design.md。
 * 原来是两个并列的开关（匿名错误上报、分享对局判断），性质相同——都是匿名传给开发者、
 * 用来改进产品——所以收到一个开关底下。
 *
 * **不新增配置键**：总开关只是两个现有键的派生状态，子项直接读写原来的键。
 * 这样老用户不需要迁移，也不可能出现「更新后被多传了数据」——只开过错误上报的人，
 * 更新后看到的是总开关开、只勾着「错误报告」。
 */
import { computed, onMounted, ref } from 'vue'
import { NCheckbox, NSwitch, NText, useMessage } from 'naive-ui'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { MATCH_LABEL_SHARE_KEY, retryMatchLabelUploads } from '@renderer/services/matchLabel'

/** 子项：errors = 错误报告，labels = 对局判断与反馈 */
type Item = 'errors' | 'labels'

const KEYS: Record<Item, string> = {
  errors: CONFIG_KEYS.errorReportingEnabled,
  labels: MATCH_LABEL_SHARE_KEY
}

const message = useMessage()

/** 两个子项当前的值（与配置一致） */
const state = ref<Record<Item, boolean>>({ errors: false, labels: false })
/**
 * 关掉总开关之前的勾选，用来在重新打开时恢复。只记在内存里：
 * 重启后再开总开关，没有可恢复的，两个都勾上。
 */
const remembered = ref<Record<Item, boolean> | null>(null)

/** 总开关：任意一个子项开着就是开 */
const master = computed(() => state.value.errors || state.value.labels)
/** 总开关关着时，子项显示关之前的勾选（置灰），让用户知道再打开会恢复成什么 */
const shown = computed<Record<Item, boolean>>(() =>
  master.value ? state.value : (remembered.value ?? state.value)
)

onMounted(async () => {
  for (const item of ['errors', 'labels'] as const) {
    try {
      state.value[item] = (await getConfigByIpc<boolean>(KEYS[item])) === true
    } catch (e) {
      console.error(e)
    }
  }
})

/**
 * 写一个子项并处理它的附带动作
 * @returns 是否写成功
 */
async function write(item: Item, value: boolean): Promise<boolean> {
  if (state.value[item] === value) return true
  try {
    await putConfigByIpc(KEYS[item], value)
  } catch (e) {
    console.error(e)
    return false
  }
  state.value[item] = value
  // 打开「对局判断与反馈」时把本地没传上去的标注补传
  if (item === 'labels' && value) {
    const done = await retryMatchLabelUploads()
    if (done > 0) message.success(`已补传 ${done} 条本地标注`)
  }
  return true
}

/** 保存后的提示：错误报告要重启才生效，单独说明 */
function saved(ok: boolean, restart: boolean): void {
  if (!ok) message.error('保存失败')
  else message.success(restart ? '设置已保存，错误报告重启后生效' : '设置已保存')
}

async function setMaster(on: boolean): Promise<void> {
  if (on) {
    const target = remembered.value ?? { errors: true, labels: true }
    // 记下的勾选是「两个都没勾」时（理论上不会发生）也按两个都勾处理，否则总开关打不开
    const next = target.errors || target.labels ? target : { errors: true, labels: true }
    const before = state.value.errors
    const ok = (await write('errors', next.errors)) && (await write('labels', next.labels))
    remembered.value = null
    saved(ok, before !== state.value.errors)
    return
  }
  remembered.value = { ...state.value }
  const before = state.value.errors
  const ok = (await write('errors', false)) && (await write('labels', false))
  saved(ok, before !== state.value.errors)
}

async function setItem(item: Item, value: boolean): Promise<void> {
  saved(await write(item, value), item === 'errors')
}
</script>

<template>
  <div class="share-switch">
    <n-switch :value="master" data-test="share-master" @update:value="setMaster" />
    <n-text :depth="3" class="share-hint">
      匿名分享以下内容，用来修问题、改进评分。不含召唤师名或账号。
    </n-text>
    <div class="share-items">
      <n-checkbox
        :checked="shown.errors"
        :disabled="!master"
        data-test="share-errors"
        @update:checked="(v: boolean) => setItem('errors', v)"
      >
        <span class="share-item-title">错误报告</span>
        <span class="share-item-desc">崩溃与报错（已脱敏）。重启后生效。</span>
      </n-checkbox>
      <n-checkbox
        :checked="shown.labels"
        :disabled="!master"
        data-test="share-labels"
        @update:checked="(v: boolean) => setItem('labels', v)"
      >
        <span class="share-item-title">对局判断与反馈</span>
        <span class="share-item-desc"
          >你标注的「最关键 / 最犯罪」、理由，以及对 AI 回应的态度。</span
        >
      </n-checkbox>
    </div>
  </div>
</template>

<style scoped>
.share-switch {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}
.share-hint {
  font-size: var(--font-size-sm);
}
.share-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-2);
}
.share-item-title {
  margin-right: var(--space-8);
}
.share-item-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>
