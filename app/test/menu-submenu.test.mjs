// 右键菜单的二级菜单（2026-10-30）：插件的 group 字段、「看看…」怎么排、「我在忙…」的名字、子菜单放哪
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { groupMenuItems, busyMenu } from '../src/main/core/menu-build.js'
import { placeSubmenu } from '../src/main/core/menu-place.js'

test('插件 API：group 可写可不写；不写的（老插件）还在主菜单；写错的当没写', async () => {
  const host = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {} })
  await host.load({ id: 'old', setup(api) { api.registerMenu({ id: 'a', label: '老写法', onClick() {} }) } })
  await host.load({ id: 'new', setup(api) { api.registerMenu({ id: 'b', label: '看看新东西', group: 'look', order: 41.5, onClick() {} }) } })
  await host.load({ id: 'bad', setup(api) { api.registerMenu({ id: 'c', label: '乱写的组', group: '../x', onClick() {} }) } })
  const items = host.menuItems()
  assert.deepEqual(items.map((m) => [m.id, m.group]), [['new/b', 'look'], ['old/a', undefined], ['bad/c', undefined]])   // 按 order 排：41.5 在默认的 50 前面
})

test('分组：看看… 按 order 排（含不改代码的小本本插件、main.js 自己的「一起看的清单」）；不认识的组也成二级菜单', () => {
  const items = [
    { id: 'bili-whale/wake', label: '随便去刷一会儿', order: 10 },
    { id: 'owner-view/view', label: '看看她眼中的我', group: 'look', order: 47 },
    { id: 'diary/open-diary', label: '看看日记', group: 'look', order: 40 },
    { id: 'memories/view', label: '看看她的小本本', order: 50 },   // 用户自己的插件：没写 group
    { id: 'dreams/view', label: '看看她的梦', group: 'look', order: 45 },
    { id: 'x/y', label: '别的', group: 'tools', order: 1 },
  ]
  const { top, groups } = groupMenuItems(items, [{ id: 'watch-list', label: '看看一起看的清单', group: 'look', order: 44 }])
  assert.deepEqual(top.map((m) => m.label), ['随便去刷一会儿'])
  assert.deepEqual(groups.map((g) => [g.group, g.icon, g.label]), [['look', '👀', '看看…'], ['tools', '🧩', 'tools…']])
  assert.deepEqual(groups[0].items.map((m) => m.label), ['看看日记', '看看小本本', '看看一起看的清单', '看看她的梦', '看看她眼中的我'])
})

test('「我在忙…」：没在忙 / 还剩几分 / 直到你说；在忙时子菜单多「我忙完了」', () => {
  assert.equal(busyMenu(null).label, '我在忙…')
  assert.deepEqual(busyMenu(null).items.map((x) => x.label), ['忙 30 分钟', '忙 1 小时', '一直忙，直到我说'])
  assert.equal(busyMenu(23 * 60000 - 5000).label, '忙着呢 · 还剩 23 分')
  assert.equal(busyMenu(Infinity).label, '忙着呢 · 直到你说')
  assert.deepEqual(busyMenu(Infinity).items.map((x) => x.label ?? '—'), ['我忙完了', '—', '忙 30 分钟', '忙 1 小时', '一直忙，直到我说'])
})

test('子菜单放哪：右边放得下就放右边、和那一行对齐；放不下往左；下面放不下往上挪；窗口大小是算出来的', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const main = { x: 500, y: 300, w: 216, h: 400 }
  const r = placeSubmenu({ main, rowTop: 200, sub: { w: 216, h: 300 }, margin: 12, area })
  assert.equal(r.side, 'right')
  assert.deepEqual(r.sub, { x: 216 + 4, y: 194 })   // 第一项和那一行对齐（子菜单上边距 6）
  assert.deepEqual(r.main, { x: 0, y: 0 })
  assert.deepEqual(r.bounds, { x: 488, y: 288, width: 216 * 2 + 4 + 24, height: 494 + 24 })

  const nearRight = placeSubmenu({ main: { ...main, x: 1920 - 216 }, rowTop: 200, sub: { w: 216, h: 300 }, margin: 12, area })
  assert.equal(nearRight.side, 'left')
  assert.deepEqual([nearRight.sub.x, nearRight.main.x], [0, 216 + 4])
  assert.equal(nearRight.bounds.x + nearRight.bounds.width - 12, 1920, '不出右边')

  const nearBottom = placeSubmenu({ main: { ...main, y: 1040 - 400 }, rowTop: 380, sub: { w: 216, h: 300 }, margin: 12, area })
  assert.equal(nearBottom.bounds.y + nearBottom.bounds.height - 12, 1040, '往上挪到不出底边')
  assert.ok(nearBottom.sub.y < 380)
})
