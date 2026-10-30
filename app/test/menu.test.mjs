// 右键菜单：放的位置不超出屏幕；插件 registerMenu 新旧两种写法都能用、出错不拖垮别的项
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { placeMenu } from '../src/main/core/menu-place.js'
import { createPluginHost } from '../src/main/core/plugin-host.js'

const area = { x: 0, y: 0, width: 1920, height: 1040 }   // 1080 高的屏幕，减掉任务栏
const box = { w: 216, h: 300 }
const inside = (r, m) => r.x + m >= area.x && r.y + m >= area.y && r.x + r.width - m <= area.x + area.width && r.y + r.height - m <= area.y + area.height

test('菜单左上角对着鼠标，窗口四周多出阴影留白', () => {
  const r = placeMenu({ cursor: { x: 500, y: 400 }, box, margin: 12, area })
  assert.deepEqual(r, { x: 488, y: 388, width: 240, height: 324 })
})

test('右边、下边放不下就往左、往上开，都不超出屏幕', () => {
  const corner = placeMenu({ cursor: { x: 1910, y: 1030 }, box, margin: 12, area })
  assert.equal(corner.x + 12, 1910 - 216)   // 往左开：右边缘对着鼠标
  assert.equal(corner.y + 12, 1030 - 300)   // 往上开
  for (const cursor of [{ x: 0, y: 0 }, { x: 1919, y: 0 }, { x: 0, y: 1039 }, { x: 1919, y: 1039 }, { x: 960, y: 1000 }, { x: 100, y: 900 }]) {
    assert.ok(inside(placeMenu({ cursor, box, margin: 12, area }), 12), JSON.stringify(cursor))
  }
})

test('副屏在主屏左边（坐标是负的）也不超出', () => {
  const left = { x: -1280, y: 0, width: 1280, height: 984 }
  const r = placeMenu({ cursor: { x: -10, y: 970 }, box, margin: 12, area: left })
  assert.ok(r.x + 12 >= left.x && r.x + 12 + 216 <= 0 && r.y + 12 >= 0 && r.y + 12 + 300 <= 984)
})

function host() {
  const logs = []
  const h = createPluginHost({ bus: new EventEmitter(), log: (...a) => logs.push(a.join(' ')), getConfig: () => ({ plugins: {} }), updateConfig: () => {} })
  return { h, logs }
}

test('旧写法（只有 label / enabled，像小本本插件）照样能用', async () => {
  const { h } = host()
  let clicked = 0
  await h.load({ id: 'memory', name: '小本本', setup(api) {
    api.registerMenu({ id: 'view', label: '看看她的小本本', enabled: () => false, onClick: () => clicked++ })
    api.registerMenu({ id: 'always', label: () => '一直能点', onClick: () => clicked++ })
  } })
  const items = h.menuItems()
  assert.deepEqual(items.map((m) => [m.id, m.label, m.enabled, m.icon, m.hint]), [
    ['memory/view', '看看她的小本本', false, '', ''],
    ['memory/always', '一直能点', true, '', ''],
  ])
  await h.clickMenu('memory/always')
  assert.equal(clicked, 1)
})

test('新写法：icon、hint 可以是字符串或函数；enabled 也可以直接写 true/false', async () => {
  const { h } = host()
  let online = false
  await h.load({ id: 'whale', name: '鲸鱼', setup(api) {
    api.registerMenu({ id: 'wake', label: '随便去刷一会儿', icon: '📺', enabled: () => online, hint: () => (online ? '' : 'DSH 没开') })
    api.registerMenu({ id: 'off', label: '关着的', icon: '🔒', enabled: false, hint: '还没做' })
  } })
  assert.deepEqual(h.menuItems().map((m) => [m.label, m.icon, m.enabled, m.hint]), [['随便去刷一会儿', '📺', false, 'DSH 没开'], ['关着的', '🔒', false, '还没做']])
  online = true
  assert.deepEqual(h.menuItems()[0], { id: 'whale/wake', label: '随便去刷一会儿', icon: '📺', enabled: true, hint: '', toggle: undefined, group: undefined, order: 50 })
})

test('toggle：没写就是普通项；写了显示成开关（函数出错当成关）', async () => {
  const { h } = host()
  let out = true
  await h.load({ id: 'whale', name: '鲸鱼', setup(api) {
    api.registerMenu({ id: 'plain', order: 1, label: '普通项' })
    api.registerMenu({ id: 'go-out', order: 2, label: '可以出门', toggle: () => out })
    api.registerMenu({ id: 'bad', order: 3, label: '坏开关', toggle: () => { throw new Error('x') } })
  } })
  assert.deepEqual(h.menuItems().map((m) => m.toggle), [undefined, true, false])
  out = false
  assert.equal(h.menuItems()[1].toggle, false)
})

test('某一项的函数抛错：只影响这一项，别的照常', async () => {
  const { h, logs } = host()
  await h.load({ id: 'bad', name: '坏插件', setup(api) {
    api.registerMenu({ id: 'a', order: 1, label: () => { throw new Error('label 坏了') } })
    api.registerMenu({ id: 'b', order: 2, label: '好的', icon: () => { throw new Error('icon 坏了') }, hint: () => { throw new Error('hint 坏了') } })
  } })
  const [a, b] = h.menuItems()
  assert.deepEqual([a.label, a.enabled], ['bad/a', false])
  assert.deepEqual([b.label, b.enabled, b.icon, b.hint], ['好的', true, '', ''])
  assert.ok(logs.some((l) => l.includes('label 出错')))
})
