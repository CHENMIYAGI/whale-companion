// 她发表情包：send_sticker 工具 + 聊天引擎（附图、记聊天记录、冷却）
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { createChat } from '../src/main/core/chat.js'
import { createChatLog } from '../src/main/core/chat-log.js'
import { pathsFor } from '../src/main/core/paths.js'
import { addToLibrary, readLibrary, stickerId } from '../src/main/core/stickers.js'
import stickersPlugin, { COOLDOWN_TURNS } from '../src/main/plugins/stickers/index.js'

const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)])

async function setup(t, { findSticker = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stickers-chat-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = pathsFor(root)
  addToLibrary(paths.stickers, PNG(1), { name: '吃白饭的大肥鱼', caption: '我是吃白饭的', desc: '摊手', tags: ['得意'] })
  addToLibrary(paths.stickers, PNG(2), { name: '可爱', desc: '握拳笑', tags: ['开心'] })
  const bus = new EventEmitter()
  const host = createPluginHost({ bus, log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths } })
  await host.load(stickersPlugin)
  const chatLog = createChatLog({ file: paths.chatLog })
  const seen = { attach: [], end: [], tool: [], calls: [] }
  // 假模型：每一轮按剧本吐事件；把它收到的 messages 存下来
  const script = []
  const llm = {
    async *streamChat(args) {
      seen.calls.push(structuredClone(args.messages))
      for (const ev of script.shift() ?? [{ type: 'text', delta: '嗯' }]) yield ev
    },
  }
  const ui = {
    start() {}, delta() {}, error() {}, confirm: async () => true,
    end: (id, m) => seen.end.push(m), tool: (id, x) => seen.tool.push(x), attach: (id, it) => seen.attach.push(it),
  }
  // 和 main.js 一样：按名字在库里找（兜底「她把表情打成了字」用）
  const find = (name) => { const x = readLibrary(paths.stickers).stickers.find((y) => y.name === name); return x ? { id: stickerId(x), name: x.name, desc: x.desc } : null }
  const chat = createChat({ host, chatLog, bus, ui, llm, findSticker: findSticker ? find : null, getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'k', log: () => {} })
  const sticker = (args) => [{ type: 'tool_calls', calls: [{ id: 'c1', name: 'send_sticker', arguments: JSON.stringify(args) }] }]
  const say = (text) => [{ type: 'text', delta: text }]
  return { paths, host, chat, chatLog, script, seen, sticker, say }
}

test('发一张：当场显示，说完话后记成「[表情：名字]」；下一轮模型看得到配字和描述', async (t) => {
  const { host, chat, chatLog, script, seen, sticker, say } = await setup(t)
  const prompt = await host.buildSystemPrompt({})
  assert.match(prompt, /偶尔用，不要每句都发/)
  assert.match(prompt, /- 吃白饭的大肥鱼（得意）/)

  script.push(sticker({ emotion: '得意' }), say('嘿嘿'))
  await chat.send('你又在偷懒')
  assert.deepEqual(seen.attach.map((x) => x.name), ['吃白饭的大肥鱼'])
  assert.equal(seen.tool.length, 0, 'silent 工具不显示「…✓」')
  const rows = chatLog.recent(10)
  assert.deepEqual(rows.map((r) => r.text), ['你又在偷懒', '嘿嘿', '[表情：吃白饭的大肥鱼]'])
  assert.equal(rows[2].kind, 'sticker')
  assert.equal(rows[2].meta.sticker.box, 'her')

  script.push(say('好'))
  await chat.send('那你去干活')
  const history = seen.calls.at(-1)
  // 她的那句和表情包并成一条 assistant（不连着两条），带上配字和描述
  const her = history.filter((m) => m.role === 'assistant')
  assert.equal(her.length, 1)
  // 给模型看的是旁白，不是她能照着打的「[表情：…]」（2026-10-30：她照着打过字）
  assert.equal(her[0].content, '嘿嘿\n（她发了一张表情：吃白饭的大肥鱼）')
})

test('冷却（COOLDOWN_TURNS = 1）：每一轮都能发一张；同一轮再要就告诉她被冷却了、没发出去；只发图不说话时不硬塞「……」', async (t) => {
  assert.equal(COOLDOWN_TURNS, 1)
  const { chat, chatLog, script, seen, sticker, say } = await setup(t)
  // 连着三轮，每轮都发得出去
  for (const n of ['1', '2', '3']) {
    script.push(sticker({ emotion: '开心' }), say('嗯'))
    await chat.send(n)
  }
  assert.equal(seen.attach.length, 3)

  // 同一轮里要第二张：工具回「被冷却了」（不是「发出去了」）
  script.push([{ type: 'tool_calls', calls: [{ id: 'a', name: 'send_sticker', arguments: '{"emotion":"开心"}' }] }],
    [{ type: 'tool_calls', calls: [{ id: 'b', name: 'send_sticker', arguments: '{"emotion":"得意"}' }] }], say('好'))
  await chat.send('4')
  const toolMsgs = seen.calls.at(-1).filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))
  assert.equal(toolMsgs[0].ok, true)
  assert.equal(toolMsgs[1].ok, false)
  assert.equal(toolMsgs[1].sent, false)
  assert.match(toolMsgs[1].error, /刚发过表情，这轮先不发/)
  assert.equal(seen.attach.length, 4)

  // 下一轮又可以了；这次只发图不说话
  script.push(sticker({ query: '可爱' }), [])
  await chat.send('5')
  assert.equal(seen.attach.length, 5)
  assert.equal(seen.end.at(-1), null)
  assert.deepEqual(chatLog.recent(2).map((r) => r.text), ['5', '[表情：可爱]'])
})

test('兜底：她把表情打成了字 —— 库里有的换成真的图，找不到的那行去掉；以前打成字的在历史里也换成旁白', async (t) => {
  const { chat, chatLog, script, seen, say } = await setup(t, { findSticker: true })
  script.push(say('好呀\n[表情：可爱]（配字：……）'))
  await chat.send('一起玩吗')
  assert.deepEqual(seen.attach.map((x) => x.name), ['可爱'], '换成了图')
  assert.deepEqual(chatLog.recent(3).map((r) => r.text), ['一起玩吗', '好呀', '[表情：可爱]'])
  assert.equal(seen.end.at(-1).text, '好呀', '显示的文字里没有那一行')

  script.push(say('（她发了一张表情：不存在的表情）'))
  await chat.send('嗯？')
  assert.equal(seen.attach.length, 1, '找不到的不换')
  assert.deepEqual(chatLog.recent(1).map((r) => r.text), ['嗯？'], '只剩那一行：整条去掉，不硬塞「……」')

  // 以前的聊天记录里她打成字的：给模型看时换成旁白
  chatLog.append({ role: 'assistant', text: '好的\n[表情：好的主人]（配字：好的主人！）' })
  script.push(say('嗯'))
  await chat.send('在吗')
  const lastHer = seen.calls.at(-1).filter((m) => m.role === 'assistant').at(-1)
  assert.match(lastHer.content, /好的\n（她发了一张表情：好的主人）$/)
  assert.doesNotMatch(lastHer.content, /\[表情：/)
})

test('一次回复最多一张', async (t) => {
  const { chat, script, seen, say } = await setup(t)
  script.push([{ type: 'tool_calls', calls: [
    { id: 'a', name: 'send_sticker', arguments: '{"emotion":"开心"}' },
    { id: 'b', name: 'send_sticker', arguments: '{"emotion":"得意"}' },
  ] }], say('好'))
  await chat.send('来两张')
  assert.equal(seen.attach.length, 1)
})

test('对不上的情绪不乱发', async (t) => {
  const { chat, script, seen, sticker, say } = await setup(t)
  script.push(sticker({ emotion: '困' }), say('好'))
  await chat.send('困了')
  assert.match(seen.calls.at(-1).find((m) => m.role === 'tool').content, /没有对得上的表情包/)
  assert.equal(seen.attach.length, 0)
})
