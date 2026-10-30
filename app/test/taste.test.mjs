// 主人的口味（桌宠这边）：记反应、和 DSH 那边算出一样的统计、rate_video、右键「她的分类」
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { pathsFor } from '../src/main/core/paths.js'
import { recordEvent, tasteStats, readTaste } from '../src/main/core/taste.js'
import tastePlugin from '../src/main/plugins/taste/index.js'
import { saveDebrief } from '../../dsh-bili-whale/tools/lib/video-notes.mjs'
import * as dsh from '../../dsh-bili-whale/tools/lib/taste.mjs'

const CAT = 'BV1aaaaaaaaa', NEWS = 'BV1bbbbbbbbb', CAT2 = 'BV1ccccccccc'
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taste-app-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = pathsFor(root)
  for (const [bv, title] of [[CAT, '橘猫弹钢琴'], [NEWS, '新闻联播政策解读'], [CAT2, '橘猫打架']]) saveDebrief(paths.dshHome, bv, { meta: { title, duration: 100 } })
  // 分类是 DSH 那边她自己给的
  dsh.tagVideo(paths.dshHome, CAT, { category: '萌宠', why: '他看猫会笑' }, { file: paths.taste })
  dsh.tagVideo(paths.dshHome, NEWS, { category: '新闻', why: '他最近关心这个' }, { file: paths.taste })
  dsh.tagVideo(paths.dshHome, CAT2, { category: '萌宠', why: '又是猫' }, { file: paths.taste })
  const bus = new EventEmitter(), opened = []
  const host = createPluginHost({ bus, log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths, openPath: (f) => opened.push(f) } })
  await host.load(tastePlugin)
  return { paths, bus, host, opened, rate: (a) => host.getTool('rate_video').run(a, {}) }
}
const kinds = (paths) => readTaste(paths.taste).events.map((e) => `${e.bv.slice(-1)}:${e.kind}`)
const tick = () => new Promise((r) => setImmediate(r))

test('同一个反应一天只记一次；喜欢 / 不喜欢只留最新的态度', async (t) => {
  const { paths } = await setup(t)
  const rec = (bv, kind, now) => recordEvent({ file: paths.taste, videosRoot: paths.videos, bv, kind, now })
  const d = Date.parse('2026-10-28T10:00:00')
  assert.equal(rec(CAT, 'open', d).category, '萌宠')
  assert.equal(rec(CAT, 'open', d + 3600_000).duplicate, true)
  rec(CAT, 'open', d + 86400_000)
  rec(CAT, 'like', d); rec(CAT, 'dislike', d + 1000)
  assert.deepEqual(kinds(paths), ['a:open', 'a:open', 'a:dislike'])
  assert.equal(rec('not-a-bv', 'open').ok, false)
})

test('和 DSH 那边同一份数据，算出一样的统计', async (t) => {
  const { paths } = await setup(t)
  for (const [bv, kind] of [[CAT, 'shown'], [CAT, 'open'], [CAT, 'like'], [CAT2, 'shown'], [CAT2, 'talk'], [NEWS, 'shown'], [NEWS, 'dislike']]) {
    recordEvent({ file: paths.taste, videosRoot: paths.videos, bv, kind })
  }
  const mine = tasteStats({ file: paths.taste, videosRoot: paths.videos })
  const theirs = dsh.tasteStats(paths.dshHome, { file: paths.taste })
  assert.deepEqual(mine.map(({ examples, ...r }) => r), theirs.map(({ examples, ...r }) => r))
  assert.deepEqual(mine.map((r) => [r.name, r.verdict]), [['萌宠', '爱看'], ['新闻', '算了']])
})

test('自动记：她分享（带 BV 的话）、点「打开视频」、聊天里提到 BV、翻笔记找到它', async (t) => {
  const { paths, bus } = await setup(t)
  bus.emit('chat:incoming', { source: 'dsh', bv: CAT, text: '看完啦' })
  bus.emit('chat:incoming', { source: 'dsh', text: '没有 BV 的话不算' })
  bus.emit('video:open', CAT)
  bus.emit('chat:user', { role: 'user', text: `${NEWS} 这个我看了` })
  bus.emit('video:recalled', CAT2)
  await tick()
  assert.deepEqual(kinds(paths), ['a:shown', 'a:open', 'b:talk', 'c:talk'])
})

test('rate_video：关键词找到唯一的就记；对得上好几个要问清楚；找不到直说', async (t) => {
  const { paths, rate } = await setup(t)
  const r = await rate({ video: '新闻联播', feeling: 'dislike' })
  assert.deepEqual([r.ok, r.bv, r.category], [true, NEWS, '新闻'])
  const many = (await rate({ video: '橘猫', feeling: 'like' })).error
  assert.match(many, /不止一个/); assert.match(many, /橘猫弹钢琴/); assert.match(many, /橘猫打架/)
  assert.equal((await rate({ video: CAT, feeling: 'like' })).ok, true, '给了 BV 就不问')
  assert.match((await rate({ video: '火锅', feeling: 'like' })).error, /找不到/)
  assert.equal((await rate({ video: CAT, feeling: 'love' })).ok, false)
  assert.deepEqual(kinds(paths), ['b:dislike', 'a:like'])
})

test('右键「她的分类」：没分过类时灰着；有了就生成一份打开', async (t) => {
  const empty = pathsFor(fs.mkdtempSync(path.join(os.tmpdir(), 'taste-empty-')))
  t.after(() => fs.rmSync(empty.home, { recursive: true, force: true }))
  const h0 = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths: empty, openPath: () => {} } })
  await h0.load(tastePlugin)
  const m0 = h0.menuItems().find((x) => x.id === 'taste/view')
  assert.deepEqual([m0.label, m0.enabled, m0.hint], ['看看她的分类', false, '她还没分过类'])

  const { paths, host, opened } = await setup(t)
  recordEvent({ file: paths.taste, videosRoot: paths.videos, bv: CAT, kind: 'shown' })
  await host.clickMenu('taste/view')
  assert.equal(opened.length, 1)
  const text = fs.readFileSync(opened[0], 'utf8')
  assert.match(text, /【萌宠】[\s\S]*她看了 2 个 · 给你看了 1 次[\s\S]*「橘猫弹钢琴」—— 他看猫会笑/)
  assert.match(text, /【新闻】还没反应/)
})
