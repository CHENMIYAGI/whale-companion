// 入场 / 退出：台词是固定列表、退出整个过程不超过 3 秒、网页和主进程的时间对得上
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HELLO_LINES, BYE_LINES, WAVE_FROM, EXIT_WAVE_MS, EXIT_FADE_MS, EXIT_TOTAL_MS, pickLine } from '../src/main/core/greetings.js'

test('台词：入场从三句里挑，退出说再见；随机挑得到每一句', () => {
  assert.deepEqual(HELLO_LINES, ['我来啦～', '主人好！', '嘿嘿，又见面了'])
  assert.ok(BYE_LINES.includes('拜拜～') && BYE_LINES.includes('下次见！'))
  assert.deepEqual([0, 0.4, 0.99].map((r) => pickLine(HELLO_LINES, () => r)), HELLO_LINES)
})

test('退出最多 3 秒：先挥手再淡出，淡出完才关', () => {
  assert.ok(EXIT_TOTAL_MS <= 3000, `一共 ${EXIT_TOTAL_MS} 毫秒`)
  assert.ok(EXIT_TOTAL_MS >= EXIT_WAVE_MS + EXIT_FADE_MS, '淡出还没完就关了')
})

test('网页（pet.js / pet.css）里抄的时间和主进程一样', () => {
  const js = fs.readFileSync(new URL('../src/renderer/pet.js', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/renderer/pet.css', import.meta.url), 'utf8')
  assert.match(js, new RegExp(`const WAVE_FROM = ${WAVE_FROM}\\b`))
  assert.match(js, new RegExp(`const EXIT_WAVE_MS = ${EXIT_WAVE_MS}\\b`))
  assert.match(css, new RegExp(`body\\.leaving \\{ opacity: 0; transition: opacity ${EXIT_FADE_MS / 1000}s`))
  assert.doesNotMatch(js, /chat\(|streamChat|llm/, '台词不调模型')
})
