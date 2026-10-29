// 偷图：主人发了她库里没有的表情包 → 她可以问「这个能给我吗」（确认卡片带图）→ 给了就进她的库
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
import { addToLibrary, readLibrary } from '../src/main/core/stickers.js'
import { saveReceived } from '../src/main/core/my-stickers.js'
import stickersPlugin from '../src/main/plugins/stickers/index.js'

const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)])

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-sticker-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = pathsFor(root)
  addToLibrary(paths.stickers, PNG(1), { name: '她自己的', tags: ['开心'] })
  const looked = { caption: '摸鱼中', desc: '趴在桌上', tags: ['累'] }
  const vision = { cached: () => looked }
  const bus = new EventEmitter()
  const host = createPluginHost({ bus, log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths, vision } })
  await host.load(stickersPlugin)
  t.after(() => host.disposeAll())   // 插件有后台补描述的定时器，不清掉测试不会结束
  const chatLog = createChatLog({ file: paths.chatLog })
  const script = [], calls = [], cards = []
  let answer = true
  const llm = { async *streamChat(args) { calls.push(structuredClone(args.messages)); for (const ev of script.shift() ?? [{ type: 'text', delta: '嗯' }]) yield ev } }
  const ui = { start() {}, delta() {}, end() {}, error() {}, tool() {}, attach() {}, confirm: async (c) => { cards.push(c); return answer } }
  const chat = createChat({ host, chatLog, bus, ui, llm, describeSticker: async () => looked, getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'k', log: () => {} })
  const sendImage = (n, name) => { const s = saveReceived(paths.received, PNG(n), name).sticker; return chat.send('', { sticker: s }) }
  const ask = [{ type: 'tool_calls', calls: [{ id: 'k', name: 'keep_sticker', arguments: '{}' }] }]
  const toolResult = () => calls.at(-1).find((m) => m.role === 'tool')?.content ?? ''
  return { paths, script, calls, cards, sendImage, ask, toolResult, setAnswer: (v) => { answer = v } }
}

test('库里没有的图：提示她可以要；问了、主人给了 → 进她的库，带上看图得到的描述和标签', async (t) => {
  const { paths, script, calls, cards, sendImage, ask, toolResult } = await setup(t)
  script.push(ask, [{ type: 'text', delta: '谢谢主人！' }])
  await sendImage(2, '摸鱼')
  assert.match(calls[0][0].content, /［主人刚发的表情包］「摸鱼」你的库里没有/)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].title, '这个能给我吗？')
  assert.equal(cards[0].image.box, 'received')
  assert.match(toolResult(), /"ok":true/)
  const got = readLibrary(paths.stickers).stickers.find((s) => s.name === '摸鱼')
  assert.deepEqual([got.caption, got.desc, got.tags, got.source], ['摸鱼中', '趴在桌上', ['累'], 'owner'])

  // 再发同一张：已经在库里了，不再提示
  await sendImage(2, '摸鱼')
  assert.doesNotMatch(calls.at(-1)[0].content, /主人刚发的表情包/)
})

test('主人说不给：不进库，这张图以后也不再问；没有可要的图时不弹卡片', async (t) => {
  const { paths, script, calls, cards, sendImage, ask, toolResult, setAnswer } = await setup(t)
  setAnswer(false)
  script.push(ask, [{ type: 'text', delta: '好吧' }])
  await sendImage(3, '不给的')
  assert.equal(cards.length, 1)
  assert.equal(readLibrary(paths.stickers).stickers.length, 1)
  await sendImage(3, '不给的')
  assert.doesNotMatch(calls.at(-1)[0].content, /主人刚发的表情包/, '问过一次就不再提示')
  script.push(ask, [{ type: 'text', delta: '嗯' }])
  await sendImage(3, '不给的')
  assert.equal(cards.length, 1, '不再弹卡片')
  assert.match(toolResult(), /别再要了/)

  // 她自己库里就有的图：不提示
  const own = await setup(t)
  await own.sendImage(1, '她自己的')
  assert.doesNotMatch(own.calls.at(-1)[0].content, /主人刚发的表情包/)
})
