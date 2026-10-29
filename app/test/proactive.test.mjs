// 主动开口：五个条件、每天次数、深夜跨午夜、提示词（不规定心情）
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSpeak, recordTry, proactiveNote, inQuietHours } from '../src/main/core/proactive.js'
import { SEP, SILENT } from '../src/main/core/multi-message.js'

const at = (h, m = 0) => new Date(2026, 9, 29, h, m).getTime()
const H = 3600_000
const base = (over = {}) => ({ now: at(15), settings: {}, idleSec: 30, holding: false, chatting: false, lastChatAt: at(13), state: null, ...over })

test('都满足才开口；哪条不满足说得出原因', () => {
  assert.deepEqual(canSpeak(base()), { ok: true })
  assert.equal(canSpeak(base({ idleSec: 6 * 60 })).why, '主人不在电脑前')
  assert.equal(canSpeak(base({ holding: true })).why, '主人在忙')
  assert.equal(canSpeak(base({ chatting: true })).why, '正在聊')
  assert.equal(canSpeak(base({ lastChatAt: at(14, 30) })).why, '刚聊过')
  assert.equal(canSpeak(base({ state: { lastTriedAt: at(14, 30) } })).why, '刚问过她')
  assert.equal(canSpeak(base({ now: at(23, 30), lastChatAt: at(20) })).why, '深夜')
  assert.equal(canSpeak(base({ now: at(7, 59), lastChatAt: 0 })).why, '深夜')
  assert.equal(canSpeak(base({ settings: { enabled: false } })).why, '设置里关了')
})

test('每天最多 4 次（只算真的说了的），第二天重新算', () => {
  let s = null
  for (let i = 0; i < 4; i++) s = recordTry(s, at(9 + i * 2), true)
  s = recordTry(s, at(17), false)   // 她不想说：不算次数，但算问过
  assert.equal(s.count, 4)
  assert.equal(s.lastTriedAt, at(17))
  assert.equal(s.lastSpokeAt, at(15))
  assert.equal(canSpeak(base({ now: at(19), lastChatAt: at(10), state: s })).why, '今天说够了')
  assert.deepEqual(canSpeak(base({ now: at(19) + 24 * H, lastChatAt: at(10), state: s })), { ok: true })
})

test('设置能改：间隔、上限、深夜时段（包括不跨午夜、关掉深夜）', () => {
  assert.equal(canSpeak(base({ settings: { minGapMinutes: 30 }, lastChatAt: at(14, 20) })).ok, true)
  assert.equal(canSpeak(base({ settings: { dailyMax: 1 }, state: recordTry(null, at(9), true) })).why, '今天说够了')
  assert.equal(inQuietHours(14, 13, 15), true)
  assert.equal(inQuietHours(16, 13, 15), false)
  assert.equal(inQuietHours(3, 0, 0), false)
})

test('提示词：上次主动开口后主人回没回、多久没聊；怎么回；不规定心情', () => {
  const n = proactiveNote({ now: at(15), lastChatAt: at(12), last: { at: at(11), replied: false }, notebook: '- 主人不吃香菜' })
  assert.match(n, /你们上次说话是 3 小时前。上次你主动找他是 4 小时前，那之后他没回你。/)
  assert.ok(n.includes(SEP) && n.includes(SILENT))
  assert.match(n, /［你的小本本］\n- 主人不吃香菜/)
  assert.match(proactiveNote({ now: at(15), lastChatAt: 0, last: null }), /还没在桌宠里聊过天。这是你第一次主动找他/)
  assert.doesNotMatch(n, /不要生气|要开心|温柔|别难过|不要抱怨/)
})
