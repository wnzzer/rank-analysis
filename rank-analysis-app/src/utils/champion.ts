/**
 * 英雄选择相关：筛选、select 渲染（h 函数）
 */

import { h } from 'vue'
import { NAvatar, type SelectOption, type SelectRenderLabel, type SelectRenderTag } from 'naive-ui'
import { assetPrefix } from '@renderer/services/http'
import type { championOption } from '@renderer/types/domain/champion'

/** 后端已统一 camelCase，仅匹配 label / realName / nickname */
export function filterChampionFunc(input: string, option: SelectOption) {
  if (!input) return true
  const kw = input.toLowerCase()
  const opt = option as unknown as championOption
  return [opt.label, opt.realName, opt.nickname].some(t => t && t.toLowerCase().includes(kw))
}

export const renderSingleSelectTag: SelectRenderTag = ({ option }) => {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        maxWidth: '160px'
      }
    },
    [
      h(NAvatar, {
        src: `${assetPrefix}/champion/${option.value}`,
        round: true,
        size: 24,
        style: { marginRight: '6px', flex: '0 0 auto' }
      }),
      h(
        'span',
        {
          style: {
            flex: '1 1 auto',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }
        },
        option.label as string
      )
    ]
  )
}

export const renderLabel: SelectRenderLabel = option => {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center'
      }
    },
    [
      h(NAvatar, {
        src:
          option.value !== 0
            ? `${assetPrefix}/champion/${option.value}`
            : `${assetPrefix}/champion/-1`,
        round: true,
        size: 'small'
      }),
      h(
        'div',
        {
          style: {
            marginLeft: '12px',
            padding: '4px 0'
          }
        },
        [h('div', null, [option.label as string])]
      )
    ]
  )
}
