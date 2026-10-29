// bili-whale 插件：DSH 状态 → 桌宠显示什么、聊天模型知道什么（出门开关部分）
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeStatus, statusContext } from '../src/main/plugins/bili-whale/index.js'

const status = (extra) => ({ ok: true, data: { jobs: [], silence: { band: 'normal' }, inWindow: true, ...extra } })

test('出门开关关着：显示「休息中，不出门」；动画照作息（醒着的时段 idle、不在就睡觉）', () => {
  assert.deepEqual(describeStatus(status({ paused: true })), { online: true, state: 'idle', mood: 'normal', label: '休息中，不出门', paused: true })
  assert.equal(describeStatus(status({ paused: true, inWindow: false })).state, 'sleep')
})

test('关开关时她正在刷：照样显示在刷，并说刷完就休息', () => {
  const d = describeStatus(status({ paused: true, busy: 'still-working' }))
  assert.equal(d.state, 'watching')
  assert.equal(d.label, '正在刷 B 站（刷完就休息）')
  assert.equal(d.paused, true)
})

test('开着 / 老版本 DSH（状态里没有 paused）：和以前一样', () => {
  assert.equal(describeStatus(status({})).label, '醒着')
  assert.equal(describeStatus(status({ paused: false })).label, '醒着')
  assert.equal(describeStatus({ ok: false }).online, false)
})

test('聊天模型被告知开关关了，不要假装去了', () => {
  const d = describeStatus(status({ paused: true }))
  assert.match(statusContext(d, status({ paused: true })), /出门开关.*关了[\s\S]*不要假装去了/)
  assert.doesNotMatch(statusContext(describeStatus(status({})), status({})), /出门开关/)
})
