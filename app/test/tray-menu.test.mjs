// 托盘菜单：三项、「显示/隐藏」跟着状态变、点了做对应的事
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trayTemplate } from '../src/main/core/tray-menu.js'

test('显示着时是「隐藏小鲸」，藏起来时是「显示小鲸」', () => {
  const act = { chat: () => {}, togglePet: () => {}, quit: () => {} }
  assert.deepEqual(trayTemplate({ name: '小鲸', petVisible: true, act }).map((i) => i.label ?? '—'), ['和她聊天', '隐藏小鲸', '—', '退出'])
  assert.equal(trayTemplate({ name: '小鲸', petVisible: false, act })[1].label, '显示小鲸')
})

test('每一项点了都调用对应的事', () => {
  const done = []
  const act = { chat: () => done.push('chat'), togglePet: () => done.push('toggle'), quit: () => done.push('quit') }
  for (const item of trayTemplate({ name: '小鲸', petVisible: true, act })) item.click?.()
  assert.deepEqual(done, ['chat', 'toggle', 'quit'])
})
