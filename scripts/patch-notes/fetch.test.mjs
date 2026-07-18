import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickCandidate, stripJsonp, deriveLabel } from './fetch.mjs'

const item = (title, url) => ({
  sTitle: title,
  sRedirectURL: url,
  iDocID: 'd1',
  sIdxTime: '2026-07-15 18:00:00'
})

test('选中列表中第一篇端游版本更新公告', () => {
  const items = [
    item('海斗大赛宝典已上线', ''),
    item('7月16日凌晨1点停机版本更新公告', 'https://lol.qq.com/gicp/news/410/37091415.html'),
    item('6月25日凌晨1点停机版本更新公告', 'https://lol.qq.com/gicp/news/410/37000000.html')
  ]
  assert.equal(pickCandidate(items).sTitle, '7月16日凌晨1点停机版本更新公告')
})

test('排除云顶/手游/周免/站内文章/非 news 链接', () => {
  const items = [
    item('17.7云顶之弈版本更新公告', 'https://lol.qq.com/gicp/news/662/1.html'),
    item('英雄联盟手游版本更新公告', 'https://lol.qq.com/gicp/news/410/2.html'),
    item('7月17日周免英雄更新公告', 'https://lol.qq.com/act/a20200421weekfree/index.html'),
    item('2026年6月26日 不停机更新公告', '')
  ]
  assert.equal(pickCandidate(items), null)
})

test('标题变体也能命中（26.6版本更新公告-希瓦娜…）', () => {
  const items = [
    item('26.6版本更新公告-希瓦娜大型更新，银焰骑士系列皮肤上线', 'https://lol.qq.com/gicp/news/410/3.html')
  ]
  assert.equal(pickCandidate(items)?.iDocID, 'd1')
})

test('stripJsonp 剥掉 callback 包装（含尾分号）', () => {
  assert.deepEqual(JSON.parse(stripJsonp('callback({"a":1});')), { a: 1 })
})

test('deriveLabel 从标题萃取展示标签', () => {
  assert.equal(deriveLabel('7月16日凌晨1点停机版本更新公告'), '7月16日更新')
  assert.equal(deriveLabel('26.6版本更新公告-希瓦娜大型更新'), '26.6更新')
})
