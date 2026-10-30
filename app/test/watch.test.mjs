// 一起看：清单（和 DSH 那边一起读写 taste.json）、邀请谁、三种回答、按笔记写台词、计时（暂停）、看完记下第几 P
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathsFor } from '../src/main/core/paths.js'
import { inviteCandidate, answerInvite, partInfo, finishPart, listView, laterEntries } from '../src/main/core/watch-list.js'
import { linesPrompt, parseLines, linesFromNotes, createWatchSession, LINES_MAX } from '../src/main/core/watch-session.js'
import { readTaste, tasteStats } from '../src/main/core/taste.js'
import { saveDebrief, addNote, readVideo } from '../../dsh-bili-whale/tools/lib/video-notes.mjs'
import * as dsh from '../../dsh-bili-whale/tools/lib/taste.mjs'

const A = 'BV1aaaaaaaaa', B = 'BV1bbbbbbbbb'
const DAY = 86400000
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const p = pathsFor(root)
  saveDebrief(p.dshHome, A, { meta: { title: '鲸鱼纪录片', duration: 600, part: 1, pages: [{ page: 1, part: '上', duration: 600 }, { page: 2, part: '下', duration: 540 }] } })
  saveDebrief(p.dshHome, B, { meta: { title: '橘猫弹琴', duration: 120 } })
  dsh.tagVideo(p.dshHome, A, { category: '自然', why: '他喜欢海' }, { file: p.taste })
  dsh.tagVideo(p.dshHome, B, { category: '萌宠', why: '他看猫会笑' }, { file: p.taste })
  dsh.markLater(p.dshHome, A, { file: p.taste })
  dsh.markLater(p.dshHome, B, { file: p.taste })
  return p
}

test('邀请：只邀请下一 P 预习好了的；晚点再说至少隔 2 天；不想看就移出清单、不再提；三种都记进分类统计', (t) => {
  const p = setup(t)
  const now = Date.now()
  assert.equal(inviteCandidate({ file: p.taste, now }), null, '都还没预习')
  dsh.markPreviewed(B, 1, { file: p.taste })
  assert.equal(inviteCandidate({ file: p.taste, now }).bv, B)

  assert.ok(answerInvite({ file: p.taste, videosRoot: p.videos, bv: B, choice: 'postpone', now }).ok)
  assert.equal(inviteCandidate({ file: p.taste, now: now + DAY }), null, '1 天后还不问')
  assert.equal(inviteCandidate({ file: p.taste, now: now + 2 * DAY + 1000 }).bv, B, '2 天后再问')

  answerInvite({ file: p.taste, videosRoot: p.videos, bv: B, choice: 'skip', now })
  assert.deepEqual(laterEntries(p.taste).map((e) => e.bv), [A])
  assert.equal(dsh.laterList({ file: p.taste }).length, 1, 'DSH 那边看到的也一样')
  assert.match(dsh.markLater(p.dshHome, B, { file: p.taste }).error, /不想看/, 'DSH 那边也不会再加回来')

  const cat = tasteStats({ file: p.taste, videosRoot: p.videos }).find((r) => r.name === '萌宠')
  assert.deepEqual([cat.postpone, cat.skip], [1, 1])
  // DSH 那边算出来一样
  assert.deepEqual(dsh.tasteStats(p.dshHome, { file: p.taste }).find((r) => r.name === '萌宠').skip, 1)
})

test('这一 P 的预习笔记；看完第 1 P：笔记里记下、下次从第 2 P 开始（又要预习）；最后一 P 看完就离开清单', (t) => {
  const p = setup(t)
  addNote(p.dshHome, A, '00:40', '海面上出现鲸鱼背｜画面超美｜弹幕在刷"好大"')
  addNote(p.dshHome, A, '01:30', '下集的笔记', { part: 2 })
  const info = partInfo({ videosRoot: p.videos, bv: A, part: 1 })
  assert.deepEqual([info.title, info.partTitle, info.parts, info.duration], ['鲸鱼纪录片', '上', 2, 600])
  assert.deepEqual(info.notes.map((n) => n.text), ['海面上出现鲸鱼背｜画面超美｜弹幕在刷"好大"'])
  assert.equal(partInfo({ videosRoot: p.videos, bv: A, part: 2 }).duration, 540)

  dsh.markPreviewed(A, 1, { file: p.taste })
  finishPart({ file: p.taste, videosRoot: p.videos, bv: A, part: 1, watchedTo: 600 })
  const e = readTaste(p.taste).later.find((x) => x.bv === A)
  assert.deepEqual([e.nextPart, e.done, e.together.length], [2, undefined, 1])
  assert.match(readVideo(p.dshHome, A).notes.at(-1).text, /^P1｜和主人一起看到第 1 P 的 10:00$/)
  assert.equal(partInfo({ videosRoot: p.videos, bv: A, part: 1 }).notes.length, 1, '这一行不算预习笔记')
  assert.equal(dsh.previewTodo({ file: p.taste }).nextPart, 2, 'DSH 那边：该预习第 2 P 了')
  assert.equal(inviteCandidate({ file: p.taste }), null)

  finishPart({ file: p.taste, videosRoot: p.videos, bv: A, part: 2, watchedTo: 300 })
  assert.ok(!laterEntries(p.taste).some((x) => x.bv === A), '两 P 都看了：离开清单')
  const view = listView({ file: p.taste })
  assert.deepEqual(view.map((v) => [v.bv, v.nextPart, v.previewed]), [[B, 1, false]])
})

test('台词：提示里有预习笔记和时长；解析「分钟｜话」，超出时长的、重复的不要；太少算没写成；退路用笔记', () => {
  const prompt = linesPrompt({ title: '鲸鱼纪录片', part: 1, parts: 2, partTitle: '上', duration: 600, notes: [{ at: 40, text: '鲸鱼背' }] })
  assert.match(prompt, /第 1 P「上」（共 2 P）/)
  assert.match(prompt, /\[00:40\] 鲸鱼背/)
  assert.match(prompt, /8～15 句/)
  const lines = parseLines('0.5｜开始了开始了\n2|鲸鱼要出来了\n3.5：好大！\n3.5：好大！\n12｜超出时长\n乱七八糟的一行\n9.9｜最后一句', 600)
  assert.deepEqual(lines, [{ at: 30, text: '开始了开始了' }, { at: 120, text: '鲸鱼要出来了' }, { at: 210, text: '好大！' }, { at: 594, text: '最后一句' }])
  assert.equal(parseLines('1｜一句\n2｜两句', 600), null)
  assert.equal(parseLines(Array.from({ length: 30 }, (_, i) => `${i * 0.3}｜第${i}句`).join('\n'), 600).length, LINES_MAX)
  assert.deepEqual(linesFromNotes([{ at: 40, text: '鲸鱼背｜好看' }]), [{ at: 40, text: '鲸鱼背' }])
})

test('一起看的计时：按时间冒出来；暂停时不走；时长到了自动结束；点结束记下看到哪', () => {
  let clock = 0
  const said = [], ends = []
  const s = createWatchSession({ bv: A, part: 1, title: 't', duration: 300, now: () => clock,
    lines: [{ at: 10, text: '一' }, { at: 100, text: '二' }, { at: 200, text: '三' }],
    onLine: (l) => said.push(l.text), onEnd: (e) => ends.push(e) })
  clock = 50_000; s.tick()
  assert.deepEqual(said, ['一'])
  s.pause()
  clock = 500_000; s.tick()
  assert.deepEqual(said, ['一'], '暂停时计时也停')
  assert.equal(s.status().elapsed, 50)
  s.resume()
  clock = 560_000; s.tick()
  assert.deepEqual(said, ['一', '二'])
  clock = 760_000; s.tick()
  assert.deepEqual(ends, [{ reason: 'time', watchedTo: 300 }])
  assert.deepEqual(said, ['一', '二', '三'])

  const ends2 = []
  clock = 0
  const s2 = createWatchSession({ bv: A, part: 1, title: 't', duration: 300, now: () => clock, lines: [], onLine() {}, onEnd: (e) => ends2.push(e) })
  clock = 75_000; s2.end(); s2.end()
  assert.deepEqual(ends2, [{ reason: 'owner', watchedTo: 75 }])
})
