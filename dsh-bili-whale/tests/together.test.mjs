// 一起看（2026-10-30）：「留着以后」清单、按 P 记预习笔记、标预习完、三种回答算进分类统计、醒来提示里的预习一步
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { saveDebrief, addNote, readVideo, notesOfPart } from '../tools/lib/video-notes.mjs'
import { tagVideo, markLater, markPreviewed, laterList, previewTodo, readTaste, writeTaste, tasteStats, statsText } from '../tools/lib/taste.mjs'

const bv = (n) => 'BV1' + String(n).padStart(9, 'a').slice(-9)
function home(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'together-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return { d, file: path.join(d, '.bili-ai', 'taste.json') }
}
const pages = [{ page: 1, part: '上', duration: 600 }, { page: 2, part: '下', duration: 540 }]

test('「留着以后」：要有视频笔记；记下几 P；不重复；主人说过不想看的不再加', (t) => {
  const h = home(t)
  assert.match(markLater(h.d, bv(1), { file: h.file }).error, /先 debrief/)
  saveDebrief(h.d, bv(1), { meta: { title: '两集的纪录片', duration: 600, part: 1, pages } })
  const r = markLater(h.d, bv(1), { file: h.file })
  assert.deepEqual([r.ok, r.entry.title, r.entry.nextPart, r.entry.parts, r.entry.previewed], [true, '两集的纪录片', 1, 2, []])
  assert.equal(markLater(h.d, bv(1), { file: h.file }).duplicate, true)
  assert.equal(laterList({ file: h.file }).length, 1)
  // 桌宠那边：主人说不想看
  const tt = readTaste(h.file); tt.later[0].removed = { at: new Date().toISOString() }; writeTaste(tt, h.file)
  assert.equal(laterList({ file: h.file }).length, 0)
  assert.match(markLater(h.d, bv(1), { file: h.file }).error, /不想看/)
})

test('taste.json 里的 later 不会被只认识旧字段的读写弄丢', (t) => {
  const h = home(t)
  saveDebrief(h.d, bv(2), { meta: { title: 'x', duration: 60 } })
  markLater(h.d, bv(2), { file: h.file })
  writeTaste(readTaste(h.file), h.file)   // 读出来原样写回
  assert.equal(readTaste(h.file).later.length, 1)
})

test('预习：按 P 记笔记（P2｜…）；预习清单先给下一 P 没预习的；标完就轮到下一个', (t) => {
  const h = home(t)
  saveDebrief(h.d, bv(3), { meta: { title: '分 P 视频', duration: 600, part: 1, pages } })
  saveDebrief(h.d, bv(4), { meta: { title: '单 P 视频', duration: 300 } })
  markLater(h.d, bv(3), { file: h.file })
  markLater(h.d, bv(4), { file: h.file })
  assert.equal(previewTodo({ file: h.file }).bv, bv(3))
  addNote(h.d, bv(3), '00:30', '开场：主持人在海边｜画面很好看｜弹幕都在刷"好美"')
  addNote(h.d, bv(3), '02:10', '第二段讲鲸鱼迁徙', { part: 2 })
  assert.match(addNote(h.d, bv(3), '01:00', 'x', { part: 0 }).error, /第几 P/)
  const v = readVideo(h.d, bv(3))
  assert.equal(notesOfPart(v.notes, 1).length, 1, '没写 P 的老笔记算第 1 P')
  assert.deepEqual(notesOfPart(v.notes, 2).map((n) => n.text), ['P2｜第二段讲鲸鱼迁徙'])
  assert.ok(markPreviewed(bv(3), 1, { file: h.file }).ok)
  assert.equal(previewTodo({ file: h.file }).bv, bv(4))
  markPreviewed(bv(4), 1, { file: h.file })
  assert.equal(previewTodo({ file: h.file }), null)
  // 桌宠那边一起看完第 1 P → 下一次是第 2 P，又需要预习
  const tt = readTaste(h.file); tt.later.find((e) => e.bv === bv(3)).nextPart = 2; writeTaste(tt, h.file)
  assert.equal(previewTodo({ file: h.file }).nextPart, 2)
})

test('一起看的三种回答算进分类统计：答应 +1、不想看 −1、晚点再说不算分', (t) => {
  const h = home(t)
  saveDebrief(h.d, bv(5), { meta: { title: '橘猫弹钢琴', duration: 100 } })
  tagVideo(h.d, bv(5), { category: '萌宠', why: '他爱看猫' }, { file: h.file })
  const tt = readTaste(h.file)
  for (const kind of ['shown', 'watch', 'postpone', 'skip']) tt.events.push({ at: new Date().toISOString(), bv: bv(5), kind })
  writeTaste(tt, h.file)
  const row = tasteStats(h.d, { file: h.file }).find((r) => r.name === '萌宠')
  assert.deepEqual([row.watch, row.postpone, row.skip, row.score], [1, 1, 1, 0])
  assert.match(statsText([row], 't'), /一起看：答应 1 \/ 晚点 1 \/ 不想看 1/)
})
