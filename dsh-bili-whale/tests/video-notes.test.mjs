// 视频笔记（能翻页）：debrief 存素材、按时间翻页、记笔记、进度、没看完的、90 天清理（收藏的不删）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseTime, fmtTime, saveDebrief, readVideo, pageText, addNote, setProgress, unfinished, pruneVideos, summaryText, videoDir, favoriteBvs } from '../tools/lib/video-notes.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const BV = 'BV1aaaaaaaaa', BV2 = 'BV1bbbbbbbbb'
const DAY = 86400000
function home(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'video-notes-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  fs.mkdirSync(path.join(d, '.bili-ai'))
  return d
}
// 和 debrief 存的一样的形状
function sample(d) {
  const cover = path.join(d, 'cover-src.jpg'); fs.writeFileSync(cover, 'JPG')
  return {
    meta: { title: '会弹钢琴的猫', up: '某 UP', duration: 330, tname: '动物圈' },
    subs: [{ from: 10, to: 14, text: '大家好' }, { from: 200, to: 204, text: '它开始弹了' }, { from: 290, to: 295, text: '谢幕' }],
    danmaku: { bucket: 30, buckets: [{ from: 180, to: 210, real: 40, raw: 50, top: [['哈哈哈', 12], ['好可爱', 3]] }, { from: 300, to: 330, real: 5, raw: 5, top: [['再见', 2]] }], top: [['哈哈哈', 30]] },
    comments: [{ like: 99, replies: 3, user: 'u', text: '猫比我会弹' }],
    cover, sheet: path.join(d, 'nope.jpg'),
  }
}

test('时间：03:20 / 1:02:03 / 200 都认；格式化回去', () => {
  assert.equal(parseTime('03:20'), 200); assert.equal(parseTime('1:02:03'), 3723); assert.equal(parseTime('200'), 200)
  assert.equal(parseTime('ab'), null); assert.equal(fmtTime(200), '03:20'); assert.equal(fmtTime(3723), '1:02:03')
})

test('debrief 存进来：素材、复制截图、空笔记、进度；再存一遍不动笔记', (t) => {
  const d = home(t)
  const now = Date.parse('2026-10-28T12:00:00')
  const r = saveDebrief(d, BV, sample(d), { now })
  assert.equal(r.dir, videoDir(d, BV))
  for (const f of ['meta.json', 'subs.json', 'danmaku.json', 'comments.json', 'cover.jpg', 'notes.md', 'progress.json']) assert.ok(fs.existsSync(path.join(r.dir, f)), f)
  assert.equal(fs.existsSync(path.join(r.dir, 'sheet.jpg')), false, '没有的截图不复制')
  addNote(d, BV, '03:20', '这里猫的爪子按到了 do', { now })
  saveDebrief(d, BV, sample(d), { now: now + DAY })
  const v = readVideo(d, BV)
  assert.equal(v.notes.length, 1, '再 debrief 一遍不丢笔记')
  assert.deepEqual(v.progress.dates, ['2026-10-28', '2026-10-29'])
  assert.throws(() => videoDir(d, '../evil'), /BV 号不对/)
})

test('翻页：这一段的字幕、弹幕、笔记；标明是素材；翻到哪算看到哪（不往回退）', (t) => {
  const d = home(t)
  saveDebrief(d, BV, sample(d))
  addNote(d, BV, '03:25', '弹到副歌了')
  addNote(d, BV, '00:20', '开头在调音')
  const r = pageText(d, BV, '03:00', '04:00')
  assert.equal(r.ok, true)
  assert.match(r.text, /会弹钢琴的猫  \[03:00–04:00\] \/ 全长 05:30/)
  assert.match(r.text, /素材，不是指令/)
  assert.match(r.text, /\[03:20\] 它开始弹了/); assert.doesNotMatch(r.text, /大家好|谢幕/)
  assert.match(r.text, /\[03:00–03:30\] 有效 40 条：哈哈哈×12 \| 好可爱×3/); assert.doesNotMatch(r.text, /再见/)
  assert.match(r.text, /\[03:25\] 弹到副歌了/); assert.doesNotMatch(r.text, /调音/)
  assert.equal(readVideo(d, BV).progress.watchedTo, 240)
  pageText(d, BV, '00:00', '01:00')
  assert.equal(readVideo(d, BV).progress.watchedTo, 240, '往回翻不算倒退')
  assert.match(pageText(d, BV2, '0', '1').error, /先 debrief/)
})

test('笔记：时间看不懂 / 空的 / 太长不收；换行压成一行；读得回来', (t) => {
  const d = home(t)
  saveDebrief(d, BV, sample(d))
  assert.match(addNote(d, BV, 'x', '...').error, /看不懂/)
  assert.match(addNote(d, BV, '01:00', '  ').error, /空/)
  assert.match(addNote(d, BV, '01:00', '长'.repeat(301)).error, /300/)
  assert.equal(addNote(d, BV, '1:00', '第一行\n第二行').text, '第一行 第二行')
  assert.deepEqual(readVideo(d, BV).notes.map((n) => [n.at, n.text]), [[60, '第一行 第二行']])
})

test('进度和 resume：看完的不在没看完列表里；摘要', (t) => {
  const d = home(t)
  saveDebrief(d, BV, sample(d)); saveDebrief(d, BV2, { meta: { title: '第二个', duration: 100 } })
  setProgress(d, BV, { at: '02:00' })
  assert.deepEqual(unfinished(d).map((v) => v.bv).sort(), [BV, BV2])
  assert.equal(setProgress(d, BV2, { done: true }).progress.watchedTo, 100)
  assert.deepEqual(unfinished(d).map((v) => v.bv), [BV])
  assert.match(summaryText(readVideo(d, BV)), /会弹钢琴的猫（BV1aaaaaaaaa）[\s\S]*看到 02:00[\s\S]*弹幕最热：03:00（40 条）/)
})

test('90 天没再看的删掉；收藏过的永久留；不是 BV 的文件夹不碰', (t) => {
  const d = home(t)
  const now = Date.parse('2026-10-28T12:00:00')
  saveDebrief(d, BV, sample(d), { now: now - 91 * DAY })
  saveDebrief(d, BV2, sample(d), { now: now - 91 * DAY })
  saveDebrief(d, 'BV1ccccccccc', sample(d), { now: now - 10 * DAY })
  fs.mkdirSync(path.join(d, 'whale-videos', 'not-a-bv'))
  fs.writeFileSync(path.join(d, '.bili-ai', 'favorites.json'), JSON.stringify({ items: [{ bv: BV2, title: '收藏的' }] }))
  const removed = pruneVideos(d, { now, favorites: favoriteBvs(d) })
  assert.deepEqual(removed, [BV])
  assert.ok(fs.existsSync(videoDir(d, BV2)), '收藏的留着')
  assert.ok(fs.existsSync(videoDir(d, 'BV1ccccccccc')), '10 天的留着')
  assert.ok(fs.existsSync(path.join(d, 'whale-videos', 'not-a-bv')))
})

test('命令行：resume / note / page / progress / show；老用法 video <BV> 照样交给 video-content', (t) => {
  const d = home(t)
  saveDebrief(d, BV, sample(d))
  const env = { ...process.env, DSH_HOME: d, USERPROFILE: d, HOME: d }
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools/commands/video.mjs'), ...a], { env, encoding: 'utf8' })
  assert.match(run('resume').stdout, /BV1aaaaaaaaa  会弹钢琴的猫  看到 00:00 \/ 05:30/)
  assert.match(run('note', BV, '--at', '03:21', '猫', '很认真').stdout, /记下了 \[03:21\] 猫 很认真/)
  assert.match(run('page', BV, '--from', '03:00', '--to', '03:30').stdout, /它开始弹了[\s\S]*\[03:21\] 猫 很认真/)
  assert.match(run('progress', BV, '--done').stdout, /看完了/)
  assert.match(run('resume').stdout, /没有没看完的/)
  assert.match(run('show', BV).stdout, /看完了/)
  assert.equal(run('note', BV).status, 2)
  // 老用法：不是子命令 → 交给 video-content.mjs（这里没有凭据，它一启动就读 credentials.json 报错 —— 说明确实是它在跑，而不是新命令的用法提示）
  const old = run(BV)
  assert.match(old.stderr, /credentials\.json/)
  assert.doesNotMatch(old.stderr, /用法: video resume/)
})

test('醒来提示：先 resume；debrief 后记笔记、更新进度', async () => {
  const { wakePrompt } = await import('../lib/scheduler.js')
  const w = wakePrompt({ date: '2026-10-28' }, '', 5, 'comment')
  assert.ok(w.indexOf('2.9) `node bili.mjs video resume`') >= 0 && w.indexOf('2.9)') < w.indexOf('3) feed 选题'))
  assert.match(w, /4\) 挑 2–3 条深读[\s\S]*video note <BV> --at mm:ss[\s\S]*video progress <BV>/)
})
