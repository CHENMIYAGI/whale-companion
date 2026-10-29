// 主人发表情包：收藏 / 收到的图、看图（每张只看一次、看不了退回文件名）、聊天记录里怎么记
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { pathsFor } from '../src/main/core/paths.js'
import { listMine, addToMine, saveReceived, findMine } from '../src/main/core/my-stickers.js'
import { resolveStickerUrl } from '../src/main/core/sticker-files.js'
import { createVision, parseVision, describeImage } from '../src/main/core/vision.js'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { createChat } from '../src/main/core/chat.js'
import { createChatLog } from '../src/main/core/chat-log.js'

const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)])

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-stickers-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return pathsFor(root)
}

test('收到的图复制进 received/，收藏去重；sticker:// 能取到这两处的图', (t) => {
  const p = tmp(t)
  const r = saveReceived(p.received, PNG(1), '吃白饭.png')
  assert.equal(r.sticker.name, '吃白饭')
  assert.equal(saveReceived(p.received, PNG(2), '').sticker.name, '图片')   // 截图粘贴没名字
  assert.equal(saveReceived(p.received, Buffer.from('<html>'), 'x.png').ok, false)
  const found = findMine({ box: 'received', id: r.sticker.id }, p)
  assert.equal(found.hash, r.sticker.hash)
  assert.equal(resolveStickerUrl(`sticker://received/${r.sticker.id}`, p), found.file)

  assert.ok(addToMine(p.myStickers, PNG(1), '吃白饭').ok)
  assert.equal(addToMine(p.myStickers, PNG(1), '别的名字').duplicate, true)
  fs.writeFileSync(path.join(p.myStickers, '假图片.png'), 'not an image')   // 主人往收藏里丢了个坏文件：跳过
  const mine = listMine(p.myStickers)
  assert.deepEqual(mine.map((m) => m.name), ['吃白饭'])
  assert.equal(resolveStickerUrl(`sticker://mine/${mine[0].id}`, p), path.join(p.myStickers, '吃白饭.png'))
  assert.equal(findMine({ box: 'her', id: mine[0].id }, p), null)   // 只认 mine / received
  assert.equal(findMine({ box: 'received', id: '../config' }, p), null)
})

test('看图：抠 JSON、标签只留词表里的；每张只看一次；看不了返回 null 且 10 分钟内不重试', async (t) => {
  const p = tmp(t)
  assert.deepEqual(parseVision('```json\n{"caption":"就一碗！","desc":"扒着碗边","tags":["吃饭","乱写"]}\n```'), { caption: '就一碗！', desc: '扒着碗边', tags: ['吃饭'] })
  assert.equal(parseVision('我看不清'), null)

  let calls = 0, fail = false, clock = 0
  const vision = createVision({ file: p.visionCache, now: () => clock, describe: async () => { calls++; if (fail) throw new Error('model not found'); return { caption: '就一碗！', desc: '扒着碗边', tags: ['吃饭'] } } })
  const a = await vision.look({ hash: 'h1', buffer: PNG(1), ext: 'png' })
  assert.equal(a.caption, '就一碗！')
  await vision.look({ hash: 'h1', buffer: PNG(1), ext: 'png' })
  assert.equal(calls, 1, '同一张图（同一个 hash）只看一次')
  assert.equal(JSON.parse(fs.readFileSync(p.visionCache, 'utf8')).h1.desc, '扒着碗边')

  fail = true
  assert.equal(await vision.look({ hash: 'h2', buffer: PNG(2), ext: 'png' }), null)
  await vision.look({ hash: 'h2', buffer: PNG(2), ext: 'png' })
  assert.equal(calls, 2, '刚失败过：不重试')
  clock += 11 * 60_000
  await vision.look({ hash: 'h2', buffer: PNG(2), ext: 'png' })
  assert.equal(calls, 3)
})

test('看图请求：图用 data: 地址发过去，带上要读配字的提示', async () => {
  let body
  const fetchImpl = async (url, opt) => { body = JSON.parse(opt.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"caption":"电死你","desc":"举着电击器","tags":["生气"]}' } }] }) } }
  const r = await describeImage({ baseUrl: 'https://api.deepseek.com/', apiKey: 'k', model: 'deepseek-v4-flash-vision-exp', buffer: PNG(1), ext: 'png', fetchImpl })
  assert.equal(r.caption, '电死你')
  assert.equal(body.model, 'deepseek-v4-flash-vision-exp')
  const [text, image] = body.messages[0].content
  assert.match(text.text, /图里写的字，原样抄下来/)
  assert.match(image.image_url.url, /^data:image\/png;base64,/)
  const bad = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'Model Not Exist' } }) })
  await assert.rejects(describeImage({ baseUrl: 'x', apiKey: 'k', model: 'm', buffer: PNG(1), ext: 'png', fetchImpl: bad }), /Model Not Exist/)
})

test('导入时没描述的图：后台看一遍补上配字、描述、标签；看不了的留着下次', async (t) => {
  const p = tmp(t)
  const { addToLibrary, readLibrary } = await import('../src/main/core/stickers.js')
  const { describeMissing } = await import('../src/main/plugins/stickers/index.js')
  addToLibrary(p.stickers, PNG(1), { name: '摸鱼中', caption: '摸鱼中' })            // 只有文件名
  addToLibrary(p.stickers, PNG(2), { name: '已有', desc: '写好了', tags: ['开心'] })  // 有描述的不动
  addToLibrary(p.stickers, PNG(3), { name: '看不了' })
  const seen = []
  const vision = { look: async ({ hash }) => { seen.push(hash); return hash === readLibrary(p.stickers).stickers[2].hash ? null : { caption: '摸鱼中…', desc: '趴在桌上偷懒', tags: ['累'] } } }
  assert.equal(await describeMissing({ dir: p.stickers, vision }), 1)
  assert.equal(seen.length, 2)
  const [a, b, c] = readLibrary(p.stickers).stickers
  assert.deepEqual([a.caption, a.desc, a.tags], ['摸鱼中…', '趴在桌上偷懒', ['累']])
  assert.equal(b.desc, '写好了')
  assert.equal(c.desc, '')
})

async function chatWith(t, describeSticker) {
  const p = tmp(t)
  const bus = new EventEmitter()
  const host = createPluginHost({ bus, log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths: p } })
  const chatLog = createChatLog({ file: p.chatLog })
  const calls = []
  const llm = { async *streamChat(args) { calls.push(args.messages); yield { type: 'text', delta: '哈哈' } } }
  const ui = { start() {}, delta() {}, end() {}, error() {}, tool() {}, confirm: async () => true }
  const users = []
  bus.on('chat:user', (r) => users.push(r))
  const chat = createChat({ host, chatLog, bus, ui, llm, describeSticker, getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'k', log: () => {} })
  return { chat, chatLog, calls, users }
}

test('主人发图：聊天记录记「[表情：名字]」，给她看的是配字和画面；粘贴的图用配字当名字', async (t) => {
  const { chat, chatLog, calls, users } = await chatWith(t, async () => ({ caption: '吃白饭的大肥鱼', desc: '摊手', tags: ['得意'] }))
  await chat.send('你看', { sticker: { box: 'received', id: 'a'.repeat(16), name: '图片', hash: 'h' } })
  const rows = chatLog.recent(5)
  assert.deepEqual(rows.map((r) => r.text), ['你看', '[表情：吃白饭的大肥鱼]', '哈哈'])
  assert.equal(rows[1].kind, 'sticker')
  assert.deepEqual(rows[1].meta.sticker, { box: 'received', id: 'a'.repeat(16), name: '吃白饭的大肥鱼', hash: 'h', desc: '配字：吃白饭的大肥鱼；画面：摊手' })
  assert.equal(users.length, 2)
  assert.equal(calls[0].at(-1).content, '你看\n[表情：吃白饭的大肥鱼]（配字：吃白饭的大肥鱼；画面：摊手）')
})

test('看图模型不可用：退回用文件名，并告诉她看不到画面', async (t) => {
  const { chat, chatLog, calls } = await chatWith(t, async () => null)
  await chat.send('', { sticker: { box: 'mine', id: 'b'.repeat(16), name: '就一碗', hash: 'h2' } })
  assert.deepEqual(chatLog.recent(5).map((r) => r.text), ['[表情：就一碗]', '哈哈'])
  assert.match(calls[0].at(-1).content, /^\[表情：就一碗\]（主人发了一张图，你看不到画面，只知道它叫「就一碗」）$/)
  // 看图那步抛错也一样
  const broken = await chatWith(t, async () => { throw new Error('boom') })
  assert.equal((await broken.chat.send('', { sticker: { box: 'mine', id: 'c'.repeat(16), name: 'x', hash: 'h3' } })).ok, true)
})
