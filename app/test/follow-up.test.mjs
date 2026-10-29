// 主人没回时她接着说：2～5 分钟后问一次、最多连着补 2 轮、她不想说就停、主人一说话就停、忙的时候先存着
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createFollowUp, followUpNote } from '../src/main/core/follow-up.js'
import { createHerSay } from '../src/main/core/her-say.js'
import { createChatLog } from '../src/main/core/chat-log.js'
import { createChat } from '../src/main/core/chat.js'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { pathsFor } from '../src/main/core/paths.js'
import { SEP, SILENT } from '../src/main/core/multi-message.js'

const tick = () => new Promise((r) => setImmediate(r))

// 假的定时器：记下要等多久，手动触发
function fakeTimers() {
  const timers = []
  return {
    timers,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t },
    clearTimer: (t) => { t.cleared = true },
    fireLast: async () => { const t = timers.filter((x) => !x.cleared).at(-1); t.cleared = true; await t.fn(); await tick() },
    live: () => timers.filter((x) => !x.cleared).length,
  }
}

test('问她的话：说清楚主人多久没回、怎么分条、不想说怎么回；不规定她的心情', () => {
  const n = followUpNote({ minutes: 3, round: 2 })
  assert.match(n, /大约 3 分钟了，主人还没回（这已经是你第 2 次接着说了）/)
  assert.ok(n.includes(SEP) && n.includes(SILENT))
  assert.doesNotMatch(n, /不要生气|要开心|温柔|别难过/)
})

test('2～5 分钟后问；说了就再等一轮；最多 2 轮', async () => {
  const ft = fakeTimers()
  const asked = [], delivered = []
  const fu = createFollowUp({ settings: () => ({}), random: () => 0.5, ...ft,
    ask: async (a) => { asked.push(a); return ['还在吗'] }, deliver: async (p) => { delivered.push(p); return 'shown' } })
  fu.herReplied()
  assert.equal(ft.timers[0].ms, 3.5 * 60_000)
  await ft.fireLast()
  await ft.fireLast()
  assert.equal(asked.length, 2)
  assert.deepEqual(asked.map((a) => a.round), [1, 2])
  assert.equal(ft.live(), 0, '补满 2 轮就不再等了')
  assert.equal(delivered.length, 2)
})

test('她不想说 → 停；主人一说话 → 停，问到一半的结果也作废', async () => {
  const ft = fakeTimers()
  let answer = []
  const delivered = []
  const fu = createFollowUp({ settings: () => ({}), ...ft, ask: async () => answer, deliver: async (p) => { delivered.push(p); return 'shown' } })
  fu.herReplied(); await ft.fireLast()
  assert.equal(ft.live(), 0)
  assert.equal(delivered.length, 0)

  let release
  answer = new Promise((r) => { release = r })
  fu.herReplied()
  const firing = ft.fireLast()
  fu.ownerSpoke()          // 正在问她的时候主人发消息了
  release(['在吗？'])
  await firing
  assert.equal(delivered.length, 0)
  assert.equal(ft.live(), 0)
})

test('设置里关了 / 只补 1 轮', async () => {
  const ft = fakeTimers()
  let s = { enabled: false }
  const fu = createFollowUp({ settings: () => s, ...ft, ask: async () => ['嗯'], deliver: async () => 'shown' })
  fu.herReplied()
  assert.equal(ft.live(), 0)
  s = { maxRounds: 1 }
  fu.herReplied(); await ft.fireLast()
  assert.equal(ft.live(), 0)
})

test('送出去：一条条「正在输入」后出来、写进聊天记录、没看对话框时冒气泡；忙的时候存着，空了一起给；主人说话就停', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'her-say-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const chatLog = createChatLog({ file: pathsFor(root).chatLog })
  const bus = new EventEmitter()
  const ui = [], bubbles = [], waits = []
  bus.on('pet:say', (x) => bubbles.push(x.text))
  let busy = false, onWait = async () => {}
  const say = createHerSay({ chatLog, bus, holding: () => busy, wait: async (ms) => { waits.push(ms); await onWait() },
    chat: { start: (id) => ui.push(['start', id]), delta: (id, s) => ui.push(['delta', s]), end: (id, rec) => ui.push(['end', rec?.text ?? null]) } })

  assert.equal(await say.deliver(['你还在忙吗', '那我等你'], 'followup'), 'shown')
  assert.deepEqual(chatLog.recent(5).map((r) => `${r.kind}:${r.text}`), ['followup:你还在忙吗', 'followup:那我等你'])
  assert.deepEqual(bubbles, ['你还在忙吗', '那我等你'])
  assert.equal(waits.length, 2)
  assert.deepEqual(ui.slice(0, 3).map((x) => x[0]), ['start', 'delta', 'end'])

  busy = true
  assert.equal(await say.deliver(['我先自己玩会儿'], 'followup'), 'held')
  assert.equal(say.pending(), 1)
  assert.equal(await say.flush(), 'empty', '还在忙：不给')
  busy = false
  await say.flush()
  assert.equal(chatLog.recent(1)[0].text, '我先自己玩会儿')

  onWait = async () => say.cancel()   // 等的时候主人说话了
  assert.equal(await say.deliver(['一', '二'], 'followup'), 'cancelled')
  assert.equal(chatLog.recent(1)[0].text, '我先自己玩会儿', '一条都没记')
  assert.deepEqual(ui.at(-1), ['end', null], '「正在输入」的气泡拿掉')
})

test('问她（ask）：带上聊天记录和提示；回「不说」就是 []；主人发消息时作废', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const p = pathsFor(root)
  const bus = new EventEmitter()
  const host = createPluginHost({ bus, log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths: p } })
  const chatLog = createChatLog({ file: p.chatLog })
  chatLog.append({ role: 'user', text: '我去洗澡' })
  chatLog.append({ role: 'assistant', text: '好～' })
  const replies = [[`去这么久？${SEP}水别太烫`], [SILENT]], calls = []
  const llm = { async *streamChat(a) { calls.push(a); for (const d of replies.shift() ?? ['嗯']) yield { type: 'text', delta: d } } }
  const ui = { start() {}, delta() {}, end() {}, error() {}, tool() {}, confirm: async () => true }
  const chat = createChat({ host, chatLog, bus, ui, llm, getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'k', log: () => {} })
  assert.deepEqual(await chat.ask({ note: followUpNote({ minutes: 3, round: 1 }) }), ['去这么久？', '水别太烫'])
  assert.equal(calls[0].tools, undefined, '不给工具')
  assert.equal(calls[0].messages.at(-1).content.startsWith('［系统提示，不是主人说的］'), true)
  assert.equal(calls[0].messages.at(-2).content, '好～')
  assert.deepEqual(await chat.ask({ note: 'x' }), [])
  assert.equal(chatLog.recent(10).length, 2, 'ask 不写聊天记录')
})
