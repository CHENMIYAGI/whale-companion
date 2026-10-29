// 连发几条：拆分（分隔符被拆在两段里也认得）、最多 5 条、每条单独记、中间「正在输入」停顿、分隔符不外露
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createSplitter, splitParts, typingPause, SEP } from '../src/main/core/multi-message.js'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { createChat } from '../src/main/core/chat.js'
import { createChatLog } from '../src/main/core/chat-log.js'
import { pathsFor } from '../src/main/core/paths.js'

test('拆分：分隔符被拆在两段里也认得；像分隔符开头但不是的文字照常发', () => {
  const got = []
  const sp = createSplitter({ onText: (i, s) => { got[i] = (got[i] ?? '') + s }, onBreak: (i) => { got[i] = got[i] ?? '' } })
  for (const d of ['好呀', '\n[[下', '一条]]\n', '我去看看', '[[', '下一条]]', '回来啦 [[笑]]']) sp.push(d)
  sp.end()
  assert.deepEqual(got.map((s) => s.trim()), ['好呀', '我去看看', '回来啦 [[笑]]'])
  assert.ok(got.every((s) => !s.includes(SEP)))
})

test('最多 5 条：再多的分隔符并进最后一条；空的去掉', () => {
  assert.deepEqual(splitParts(['1', '2', '3', '4', '5', '6', '7'].join(SEP)), ['1', '2', '3', '4', '5\n6\n7'])
  assert.deepEqual(splitParts(`${SEP}嗯${SEP}${SEP}好`), ['嗯', '好'])
  assert.deepEqual(splitParts('就一句'), ['就一句'])
})

test('停顿：按字数，0.8～3 秒', () => {
  assert.equal(typingPause('嗯'), 870)
  assert.equal(typingPause(''), 800)
  assert.equal(typingPause('很'.repeat(100)), 3000)
})

async function setup(t, script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = pathsFor(root)
  const bus = new EventEmitter()
  const host = createPluginHost({ bus, log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths } })
  const chatLog = createChatLog({ file: paths.chatLog })
  const events = [], calls = [], waits = []
  let onWait = async () => {}
  const llm = { async *streamChat(args) { calls.push(args.messages); for (const d of script.shift() ?? ['嗯']) yield { type: 'text', delta: d } } }
  const ui = {
    start: (id) => events.push(['start', id]), delta: (id, s) => events.push(['delta', id, s]), end: (id, m) => events.push(['end', id, m?.text ?? null]),
    error: (id, e) => events.push(['error', id, e]), tool() {}, confirm: async () => true,
  }
  const chat = createChat({ host, chatLog, bus, ui, llm, getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'k', log: () => {},
    wait: async (ms, signal) => { waits.push(ms); await onWait(signal) } })
  return { chat, chatLog, events, calls, waits, setWait: (fn) => { onWait = fn } }
}

test('分三条：第一条边说边显示；后两条先「正在输入」再整条出来；聊天记录里三条；只调一次模型', async (t) => {
  const s = await setup(t, [['今天刷到', '一只猫\n[[下一', '条]]\n它会弹琴', `\n${SEP}\n`, '真的！']])
  await s.chat.send('今天看了啥')
  assert.equal(s.calls.length, 1)
  assert.deepEqual(s.chatLog.recent(10).map((r) => `${r.role}:${r.text}`), ['user:今天看了啥', 'assistant:今天刷到一只猫', 'assistant:它会弹琴', 'assistant:真的！'])
  const ids = [...new Set(s.events.filter((e) => e[0] === 'start').map((e) => e[1]))]
  assert.equal(ids.length, 3, '三个气泡')
  // 第二条：气泡先开（正在输入），等过停顿才有字
  const i2 = s.events.findIndex((e) => e[0] === 'start' && e[1] === ids[1])
  const d2 = s.events.findIndex((e) => e[0] === 'delta' && e[1] === ids[1])
  assert.ok(i2 < d2)
  assert.deepEqual(s.events[d2], ['delta', ids[1], '它会弹琴'])
  assert.equal(s.waits.length, 2)
  assert.ok(s.waits.every((ms) => ms <= 3000))
  assert.ok(s.events.every((e) => !String(e[2] ?? '').includes('[[')), '分隔符一点都不外露')

  // 下一轮：她以前连发的几条用分隔符接起来给模型看
  await s.chat.send('哈哈')
  const her = s.calls.at(-1).find((m) => m.role === 'assistant')
  assert.equal(her.content, `今天刷到一只猫\n${SEP}\n它会弹琴\n${SEP}\n真的！`)
})

test('等第二条时点了停止：第一条留着，后面的不发、不记', async (t) => {
  const s = await setup(t, [[`第一句${SEP}第二句${SEP}第三句`]])
  s.setWait(async () => { throw Object.assign(new Error('已停止'), { name: 'AbortError' }) })
  const r = await s.chat.send('说吧')
  assert.equal(r.ok, false)
  assert.deepEqual(s.chatLog.recent(10).map((x) => x.text), ['说吧', '第一句'])
  const ends = s.events.filter((e) => e[0] === 'end')
  assert.equal(ends.filter((e) => e[2] === null).length, 2, '没发出去的两个气泡拿掉')
})

test('只有一句：和以前一样，不停顿', async (t) => {
  const s = await setup(t, [['好的']])
  await s.chat.send('在吗')
  assert.equal(s.waits.length, 0)
  assert.deepEqual(s.chatLog.recent(5).map((x) => x.text), ['在吗', '好的'])
})
