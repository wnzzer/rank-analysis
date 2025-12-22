import { assetPrefix } from '../services/http'
import { NAvatar, SelectRenderLabel, SelectRenderTag, useMessage } from 'naive-ui'
import { h } from 'vue'
import { championOption } from './type'
import { QueueInfo } from './record/type'

export const useCopy = () => {
  const message = useMessage()

  const copy = (nameId: string) => {
    navigator.clipboard
      .writeText(nameId)
      .then(() => {
        message.success('复制成功')
      })
      .catch(() => {
        message.error('复制失败')
      })
  }

  return { copy }
}

// 后端已统一 camelCase，仅匹配 label / realName / nickname
export function filterChampionFunc(input: string, option: championOption) {
  if (!input) return true
  const kw = input.toLowerCase()
  return [option.label, option.realName, option.nickname].some(
    t => t && t.toLowerCase().includes(kw)
  )
}

export const renderSingleSelectTag: SelectRenderTag = ({ option }) => {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        maxWidth: '160px' // 或放宽
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

export const divisionOrPoint = (queueInfo: QueueInfo) => {
  const highTire = ['MASTER', 'GRANDMASTER', 'CHALLENGER']
  if (highTire.includes(queueInfo.tier)) {
    return queueInfo.leaguePoints
  }
  return queueInfo.division
}
