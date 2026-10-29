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
import { addToLibrary } from '../src/main/core/stickers.js'
import stickersPlugin from '../src/main/plugins/stickers/index.js'

const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)])

async function setup(t) {
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
  const chat = createChat({ host, chatLog, bus, ui, llm, getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'k', log: () => {} })
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
  assert.match(her[0].content, /^嘿嘿\n\[表情：吃白饭的大肥鱼\]（配字：我是吃白饭的；摊手）$/)
})

test('冷却：发过一张后主人要再说 3 句才能发；只发图不说话时不硬塞「……」', async (t) => {
  const { chat, chatLog, script, seen, sticker, say } = await setup(t)
  script.push(sticker({ emotion: '开心' }), say('哈哈'))
  await chat.send('1')
  for (const n of ['2', '3']) {
    script.push(sticker({ emotion: '开心' }), say('嗯'))
    await chat.send(n)
    const toolMsg = seen.calls.at(-1).find((m) => m.role === 'tool')
    assert.match(toolMsg.content, /刚发过表情包/)
  }
  assert.equal(seen.attach.length, 1)

  // 第 4 句（隔了 3 句）：可以了；这次只发图不说话
  script.push(sticker({ query: '可爱' }), [])
  await chat.send('4')
  assert.equal(seen.attach.length, 2)
  assert.equal(seen.end.at(-1), null)
  const last = chatLog.recent(2)
  assert.deepEqual(last.map((r) => r.text), ['4', '[表情：可爱]'])
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
