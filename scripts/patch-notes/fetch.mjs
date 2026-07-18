/**
 * CMC 公告频道（target=24 = LOL 端游公告）列表拉取与版本更新公告候选筛选。
 * 站内文章（无 sRedirectURL）不支持：无稳定正文接口，且实测正式版本公告均带跳转链。
 */
export const LIST_URL =
  'https://apps.game.qq.com/cmc/zmMcnTargetContentList?r0=jsonp&page=1&num=16&target=24&source=web_pc'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 剥掉 JSONP 的 callback(...) 包装 */
export function stripJsonp(text) {
  const t = text.trim()
  return t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))
}

/**
 * 从列表项中挑最新一篇端游版本更新公告；无命中返回 null。
 * 标题筛选故意从宽（只要求含「更新公告」），最终由 AI 的 isPatchNotes 判定确认。
 */
export function pickCandidate(items) {
  return (
    items.find(it => {
      const url = it.sRedirectURL || ''
      return (
        it.sTitle.includes('更新公告') &&
        !it.sTitle.includes('云顶') &&
        !it.sTitle.includes('手游') &&
        !it.sTitle.includes('周免') &&
        url.includes('lol.qq.com') &&
        url.includes('/news/')
      )
    }) ?? null
  )
}

/** 「7月16日凌晨1点停机版本更新公告」→「7月16日更新」 */
export function deriveLabel(title) {
  let label = title
  for (const sep of ['凌晨', '停机', '版本更新']) {
    const i = label.indexOf(sep)
    if (i >= 0) label = label.slice(0, i)
  }
  return `${label.trim()}更新`
}

export async function fetchList(fetchFn = fetch) {
  const res = await fetchFn(LIST_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`CMC list HTTP ${res.status}`)
  const json = JSON.parse(stripJsonp(await res.text()))
  const items = json?.data?.result
  if (!Array.isArray(items)) throw new Error('CMC list: data.result 缺失')
  return items
}

/** 文章页为 GBK 编码的服务端渲染 HTML */
export async function fetchArticleHtml(url, fetchFn = fetch) {
  const res = await fetchFn(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`article HTTP ${res.status}`)
  return new TextDecoder('gbk').decode(await res.arrayBuffer())
}
