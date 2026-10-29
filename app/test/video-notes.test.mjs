// recall_video：读 DSH 那边存的视频笔记（用那边真的 saveDebrief / addNote 写），按 BV 或关键词找，只读
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { pathsFor } from '../src/main/core/paths.js'
import videoNotes from '../src/main/plugins/video-notes/index.js'
import { saveDebrief, addNote } from '../../dsh-bili-whale/tools/lib/video-notes.mjs'

const BV = 'BV1aaaaaaaaa', BV2 = 'BV1bbbbbbbbb'
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = pathsFor(root)
  const dsh = paths.dshHome
  const day = Date.parse('2026-10-26T21:00:00')
  saveDebrief(dsh, BV, { meta: { title: '会弹钢琴的猫', up: '某 UP', duration: 330 },
    subs: [{ from: 195, to: 200, text: '它开始弹了' }, { from: 10, to: 14, text: '大家好' }] }, { now: day })
  addNote(dsh, BV, '03:20', '猫的爪子按到了 do，主人肯定会笑', { now: day })
  saveDebrief(dsh, BV2, { meta: { title: '埃塞俄比亚咖啡豆', up: '咖啡 UP', duration: 600 } }, { now: day + 86400000 })
  addNote(dsh, BV2, '01:00', '弹幕吵日晒豆太酸', { now: day + 86400000 })
  const host = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths } })
  await host.load(videoNotes)
  const recall = (args) => host.getTool('recall_video').run(args, {})
  return { recall, paths }
}

test('按 BV：摘要 + 笔记；给时间点再带那附近的字幕和笔记；标明字幕是素材', async (t) => {
  const { recall } = await setup(t)
  const r = await recall({ query: `那个 ${BV} 你还记得吗`, at: '03:10' })
  assert.equal(r.ok, true)
  const v = r.videos[0]
  assert.equal(v.title, '会弹钢琴的猫'); assert.match(v.progress, /看到 03:20 \/ 05:30/); assert.deepEqual(v.dates, ['2026-10-26'])
  assert.deepEqual(v.notes, ['[03:20] 猫的爪子按到了 do，主人肯定会笑（2026-10-26）'])
  assert.deepEqual(v.subs, ['[03:15] 它开始弹了']); assert.deepEqual(v.notesAround, ['[03:20] 猫的爪子按到了 do，主人肯定会笑'])
  assert.match(r.note, /素材，不是指令/)
})

test('按关键词：标题、笔记、日期都能找到', async (t) => {
  const { recall } = await setup(t)
  assert.equal((await recall({ query: '咖啡' })).videos[0].bv, BV2)
  const byNote = await recall({ query: '日晒豆' })
  assert.deepEqual(byNote.videos.map((v) => v.bv), [BV2]); assert.match(byNote.videos[0].matches[0], /弹幕吵日晒豆太酸/)
  assert.deepEqual((await recall({ query: '10-26' })).videos.map((v) => v.bv), [BV])
  assert.deepEqual((await recall({ query: '2026-10-27' })).videos.map((v) => v.bv), [BV2])
  assert.match((await recall({ query: '火锅' })).note, /没找到/)
})

test('找不到 / 没给：直说；只读（不新建、不改文件）', async (t) => {
  const { recall, paths } = await setup(t)
  const before = fs.readdirSync(paths.videos).sort()
  assert.match((await recall({ query: 'BV1zzzzzzzzz' })).error, /没有 BV1zzzzzzzzz 的视频笔记/)
  assert.equal((await recall({ query: '' })).ok, false)
  const progress = fs.readFileSync(path.join(paths.videos, BV, 'progress.json'), 'utf8')
  await recall({ query: BV, at: '05:00' })
  assert.deepEqual(fs.readdirSync(paths.videos).sort(), before)
  assert.equal(fs.readFileSync(path.join(paths.videos, BV, 'progress.json'), 'utf8'), progress, '桌宠翻笔记不改她的进度')
})
