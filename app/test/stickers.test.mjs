// 表情包库：认图片、进库去重、挑表情包、sticker:// 地址
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathsFor } from '../src/main/core/paths.js'
import { sniffImage, checkImage, addToLibrary, readLibrary, getSticker, pickSticker, updateSticker, safeName, stickerText, STICKER_MAX_BYTES } from '../src/main/core/stickers.js'
import { resolveStickerUrl, stickerResponse, avatarList } from '../src/main/core/sticker-files.js'

// 最小的几种图片文件头（后面补点字节，内容不同 → hash 不同）
const PNG = (n = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stickers-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return pathsFor(root)
}

test('看文件头认格式，不看扩展名；太大、不是图片都不收', () => {
  assert.equal(sniffImage(PNG()), 'png')
  assert.equal(sniffImage(JPG), 'jpg')
  assert.equal(sniffImage(GIF), 'gif')
  assert.equal(sniffImage(WEBP), 'webp')
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)   // svg 能带脚本，不收
  assert.equal(checkImage(Buffer.from('MZ\x90\x00 这是个程序伪装成 png')).ok, false)
  const big = Buffer.concat([PNG(), Buffer.alloc(STICKER_MAX_BYTES)])
  assert.match(checkImage(big).error, /5MB/)
})

test('进库：复制文件、记索引；同一张图不重复；名字撞了自动改名', (t) => {
  const p = tmp(t)
  const a = addToLibrary(p.stickers, PNG(1), { name: '吃白饭的大肥鱼', caption: '我是吃白饭的', desc: '摊手', tags: ['得意', '乱写的标签'], source: 'dsh-pet' })
  assert.ok(a.ok && !a.duplicate)
  assert.deepEqual(a.sticker.tags, ['得意'])   // 不在词表里的标签丢掉
  assert.ok(fs.existsSync(path.join(p.stickers, '吃白饭的大肥鱼.png')))
  assert.equal(addToLibrary(p.stickers, PNG(1), { name: '换个名字' }).duplicate, true)
  const b = addToLibrary(p.stickers, PNG(2), { name: '吃白饭的大肥鱼' })
  assert.equal(b.sticker.file, '吃白饭的大肥鱼-2.png')
  assert.equal(readLibrary(p.stickers).stickers.length, 2)
  // 路径字符去掉：不能借名字写到库外面
  assert.equal(safeName('../../evil'), 'evil')
  assert.equal(safeName('a/b\\c:d'), 'abcd')
  const c = addToLibrary(p.stickers, GIF, { name: '..\\..\\x' })
  assert.equal(path.dirname(path.join(p.stickers, c.sticker.file)), p.stickers)
  assert.ok(updateSticker(p.stickers, a.sticker.id, { desc: '新描述', tags: ['开心'] }))
  assert.equal(getSticker(p.stickers, a.sticker.id).desc, '新描述')
})

test('挑表情包：情绪标签优先，关键词其次；尽量不连着发同一张', (t) => {
  const p = tmp(t)
  addToLibrary(p.stickers, PNG(1), { name: '吃白饭', caption: '吃白饭的大肥鱼', tags: ['得意', '吃饭'] })
  addToLibrary(p.stickers, PNG(2), { name: '就一碗', caption: '就一碗！', tags: ['吃饭', '撒娇'] })
  addToLibrary(p.stickers, PNG(3), { name: '电死你', caption: '电死你', desc: '举着电击器', tags: ['生气'] })
  const lib = readLibrary(p.stickers)
  assert.equal(pickSticker(lib, { emotion: '生气' }).name, '电死你')
  assert.equal(pickSticker(lib, { query: '电击器' }).name, '电死你')
  assert.equal(pickSticker(lib, { emotion: '吃饭', query: '一碗' }).name, '就一碗')
  assert.equal(pickSticker(lib, { emotion: '困' }), null)
  const eat = pickSticker(lib, { emotion: '吃饭' }, () => 0)
  const other = pickSticker(lib, { emotion: '吃饭', exclude: [eat.id] })
  assert.notEqual(other.id, eat.id)
  assert.equal(pickSticker(lib, { emotion: '生气', exclude: [pickSticker(lib, { emotion: '生气' }).id] }).name, '电死你')   // 只有这一张：照发
  assert.equal(stickerText('吃白饭的大肥鱼'), '[表情：吃白饭的大肥鱼]')
})

test('sticker:// 只按 id 取库里的图和状态头像，别的一律 404', (t) => {
  const p = tmp(t)
  const a = addToLibrary(p.stickers, PNG(1), { name: 'x' }).sticker
  assert.equal(resolveStickerUrl(`sticker://her/${a.id}`, p), path.join(p.stickers, 'x.png'))
  const r = stickerResponse(`sticker://her/${a.id}`, p)
  assert.equal(r.status, 200); assert.equal(r.type, 'image/png')
  assert.equal(resolveStickerUrl('sticker://her/../../config.json', p), null)
  assert.equal(resolveStickerUrl('sticker://her/0000000000000000', p), null)
  assert.equal(resolveStickerUrl('file:///C:/Windows/win.ini', p), null)
  assert.equal(resolveStickerUrl('sticker://avatar/..%2Fconfig', p), null)

  assert.deepEqual(avatarList(p.avatars), [])
  fs.mkdirSync(p.avatars, { recursive: true })
  fs.writeFileSync(path.join(p.avatars, 'sleep.webp'), WEBP)
  fs.writeFileSync(path.join(p.avatars, 'idle.png'), Buffer.from('不是图片'))
  assert.deepEqual(avatarList(p.avatars), ['idle', 'sleep'])
  assert.equal(stickerResponse('sticker://avatar/sleep', p).type, 'image/webp')
  assert.equal(stickerResponse('sticker://avatar/idle', p).status, 404)   // 扩展名是 png，内容不是图片：不给
})

test('她自己的表情：对得上时优先；「什么场合用」也能搜到；提示词里单独一组、写上场合', async (t) => {
  const p = tmp(t)
  addToLibrary(p.stickers, PNG(1), { name: '吃白饭', tags: ['吃饭'], source: 'dsh-pet' })
  addToLibrary(p.stickers, PNG(2), { name: '白米饭', tags: ['吃饭'], source: 'self', when: '聊到吃饭的时候' })
  addToLibrary(p.stickers, PNG(3), { name: '你忙完啦', tags: ['期待'], source: 'self', when: '主人忙完回来时' })
  addToLibrary(p.stickers, PNG(4), { name: '电死你', tags: ['生气'], source: 'dsh-pet' })
  const lib = readLibrary(p.stickers)
  for (let i = 0; i < 20; i++) assert.equal(pickSticker(lib, { emotion: '吃饭' }).name, '白米饭')
  assert.equal(pickSticker(lib, { emotion: '吃饭', exclude: [pickSticker(lib, { emotion: '吃饭' }).id] }).name, '吃白饭', '刚发过自己的：换一张别人的')
  assert.equal(pickSticker(lib, { query: '忙完' }).name, '你忙完啦')
  assert.equal(pickSticker(lib, { emotion: '生气' }).name, '电死你', '自己的没有合适的：用别人的')

  const { EventEmitter } = await import('node:events')
  const { createPluginHost } = await import('../src/main/core/plugin-host.js')
  const { default: stickersPlugin } = await import('../src/main/plugins/stickers/index.js')
  const host = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths: p } })
  await host.load(stickersPlugin)
  const prompt = await host.buildSystemPrompt({})
  assert.match(prompt, /你自己的表情（主人照你的样子画的，有合适的就优先用这些）：\n- 白米饭（吃饭）：聊到吃饭的时候\n- 你忙完啦（期待）：主人忙完回来时\n\n别人画的表情：\n- 吃白饭（吃饭）\n- 电死你（生气）/)
})
