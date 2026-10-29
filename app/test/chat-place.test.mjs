// 对话框跟着桌宠走：位置算对、宽高原样写回（不从窗口读回来，所以不会越拖越大）
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeChat } from '../src/main/core/chat-place.js'

const area = { x: 0, y: 0, width: 1536, height: 816 }   // 1920×1080 在 125% 下的工作区
const base = { size: { width: 380, height: 560 }, body: { left: 83, right: 216 }, petH: 340, area }

test('贴着身体左边、底边对齐', () => {
  assert.deepEqual(placeChat({ ...base, pet: { x: 1000, y: 400 } }), { x: 1000 + 83 - 380 - 4, y: 400 + 340 - 560, width: 380, height: 560 })
})

test('左边放不下就放右边；不超出屏幕', () => {
  const r = placeChat({ ...base, pet: { x: 50, y: 400 } })
  assert.equal(r.x, 50 + 216 + 4)
  const top = placeChat({ ...base, pet: { x: 800, y: -100 } })
  assert.equal(top.y, 0)
  const bottom = placeChat({ ...base, pet: { x: 800, y: 700 } })
  assert.equal(bottom.y + 560, 816)
})

test('拖一路（挪 500 次）宽高始终是给定的那个', () => {
  for (let i = 0; i < 500; i++) {
    const r = placeChat({ ...base, pet: { x: 300 + i, y: 200 + (i % 37) } })
    assert.equal(r.width, 380); assert.equal(r.height, 560)
  }
})
