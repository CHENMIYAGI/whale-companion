// 分类和主人的口味：给视频分类（15 个以内、可合并）、按分类统计反应、选题加权、「想让你试试」、每周一句
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { saveDebrief } from '../tools/lib/video-notes.mjs'
import { tagVideo, mergeCategory, tasteStats, tasteModel, weeklyDue, markWeekly, readTaste, writeTaste, MAX_CATEGORIES } from '../tools/lib/taste.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const DAY = 86400000
const bv = (n) => 'BV1' + String(n).padStart(9, 'a').slice(-9)
function home(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'taste-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return { d, file: path.join(d, '.bili-ai', 'taste.json') }
}
const video = (h, id, title) => saveDebrief(h.d, id, { meta: { title, duration: 100 } })
const events = (h, list) => { const t = readTaste(h.file); t.events.push(...list.map(([id, kind, ago = 0]) => ({ at: new Date(Date.now() - ago * DAY).toISOString(), bv: id, kind }))); writeTaste(t, h.file) }

test('分类：要先有视频笔记、要写为什么；新分类进分类表；满 15 个不让加新的', (t) => {
  const h = home(t)
  assert.match(tagVideo(h.d, bv(1), { category: '猫', why: 'x' }, { file: h.file }).error, /先 debrief/)
  video(h, bv(1), '会弹钢琴的猫')
  assert.match(tagVideo(h.d, bv(1), { category: '猫', why: '' }, { file: h.file }).error, /为什么/)
  assert.deepEqual(tagVideo(h.d, bv(1), { category: '  萌宠  ', why: '他上次看猫视频笑了' }, { file: h.file }), { ok: true, category: '萌宠', added: true })
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.d, 'whale-videos', bv(1), 'verdict.json'), 'utf8')).why, '他上次看猫视频笑了')
  assert.equal(tagVideo(h.d, bv(1), { category: '萌宠', why: '再来' }, { file: h.file }).added, false)
  for (let i = 2; i <= MAX_CATEGORIES; i++) { video(h, bv(i), 't' + i); assert.equal(tagVideo(h.d, bv(i), { category: '类' + i, why: 'w' }, { file: h.file }).ok, true) }
  video(h, bv(99), '第十六个')
  assert.match(tagVideo(h.d, bv(99), { category: '新的', why: 'w' }, { file: h.file }).error, /已经 15 个了[\s\S]*taste merge/)
  assert.equal(tagVideo(h.d, bv(99), { category: '萌宠', why: 'w' }, { file: h.file }).ok, true, '用已有的可以')
})

test('合并：分类表和视频笔记里的分类一起改；合并后旧的反应跟着走', (t) => {
  const h = home(t)
  video(h, bv(1), '猫弹钢琴'); video(h, bv(2), '狗狗冲浪')
  tagVideo(h.d, bv(1), { category: '猫', why: 'w' }, { file: h.file }); tagVideo(h.d, bv(2), { category: '狗', why: 'w' }, { file: h.file })
  events(h, [[bv(1), 'shown'], [bv(1), 'open']])
  assert.deepEqual(mergeCategory(h.d, '猫', '萌宠', { file: h.file }), { ok: true, moved: 1 })
  mergeCategory(h.d, '狗', '萌宠', { file: h.file })
  assert.deepEqual(readTaste(h.file).categories.map((c) => c.name), ['萌宠'])
  const [r] = tasteStats(h.d, { file: h.file })
  assert.deepEqual([r.name, r.videos, r.shown, r.open], ['萌宠', 2, 1, 1])
  assert.match(mergeCategory(h.d, '没有的', 'x', { file: h.file }).error, /没有/)
})

test('统计：爱看 / 算了 / 一般 / 还没反应；只算这周的', (t) => {
  const h = home(t)
  for (const [i, title, cat] of [[1, '猫一', '萌宠'], [2, '猫二', '萌宠'], [3, '政策解读', '新闻'], [4, '游戏', '游戏'], [5, '摄影', '摄影']]) { video(h, bv(i), title); tagVideo(h.d, bv(i), { category: cat, why: 'w' }, { file: h.file }) }
  events(h, [[bv(1), 'shown'], [bv(1), 'open'], [bv(1), 'like'], [bv(2), 'shown', 10], [bv(2), 'talk', 10],
    [bv(3), 'shown'], [bv(3), 'dislike'], [bv(4), 'shown'], [bv(4), 'open']])
  const rows = Object.fromEntries(tasteStats(h.d, { file: h.file }).map((r) => [r.name, r]))
  assert.equal(rows['萌宠'].verdict, '爱看'); assert.equal(rows['萌宠'].score, (1 + 1 + 2) / 2)
  assert.equal(rows['新闻'].verdict, '算了')
  assert.equal(rows['游戏'].verdict, '一般')
  assert.equal(rows['摄影'].verdict, '还没反应')
  const week = Object.fromEntries(tasteStats(h.d, { file: h.file, since: Date.now() - 7 * DAY }).map((r) => [r.name, r]))
  assert.deepEqual([week['萌宠'].shown, week['萌宠'].talk], [1, 0], '10 天前的不算这周')
})

test('选题：按标题猜分类（至少撞上 2 个词），按主人反应 ±3 封顶；「主人平时不怎么看」的分类', (t) => {
  const h = home(t)
  for (const [i, title, cat] of [[1, '橘猫弹钢琴太可爱了', '萌宠'], [2, '橘猫和柴犬打架', '萌宠'], [3, '新闻联播政策解读', '新闻'], [4, '城市夜景延时摄影', '摄影']]) { video(h, bv(i), title); tagVideo(h.d, bv(i), { category: cat, why: 'w' }, { file: h.file }) }
  events(h, [[bv(1), 'shown'], [bv(1), 'open'], [bv(1), 'like'], [bv(2), 'shown'], [bv(2), 'talk'], [bv(3), 'shown'], [bv(3), 'dislike'], [bv(3), 'shown', 1]])
  const m = tasteModel(h.d, { file: h.file })
  const cat = m.predict('一只橘猫在弹钢琴')
  assert.equal(cat.category, '萌宠'); assert.ok(cat.boost > 0 && cat.boost <= 3)
  const news = m.predict('今日新闻联播政策解读')
  assert.equal(news.category, '新闻'); assert.ok(news.boost < 0 && news.boost >= -3)
  assert.deepEqual(m.predict('只有一个橘猫字样'), { category: null, boost: 0 }, '只撞上一个词不算')
  assert.deepEqual(m.predict('完全无关的标题'), { category: null, boost: 0 })
  assert.equal(m.predict('城市夜景延时摄影第二集').boost, 0, '主人还没反应过的分类不加不减')
  assert.deepEqual([...m.rarelyShown], ['摄影'], '分过类、主人很少看到、又不是「算了」的')
})

test('每周一句：这周有反应、离上次 ≥7 天才该说；说过就记下', (t) => {
  const h = home(t)
  assert.equal(weeklyDue(h.d, { file: h.file }), false, '没有反应不说')
  events(h, [[bv(1), 'open']])
  assert.equal(weeklyDue(h.d, { file: h.file }), true)
  markWeekly({ file: h.file })
  assert.equal(weeklyDue(h.d, { file: h.file }), false)
  assert.equal(weeklyDue(h.d, { file: h.file, now: Date.now() + 8 * DAY }), false, '8 天后：这周没新反应也不说')
  events(h, [[bv(1), 'talk', -8]])
  assert.equal(weeklyDue(h.d, { file: h.file, now: Date.now() + 8 * DAY }), true)
})

test('命令行：video tag / taste show / week / merge', (t) => {
  const h = home(t)
  video(h, bv(1), '橘猫弹钢琴')
  const env = { ...process.env, DSH_HOME: h.d, USERPROFILE: h.d, HOME: h.d }
  const run = (script, ...a) => spawnSync(process.execPath, [path.join(root, 'tools/commands', script), ...a], { env, encoding: 'utf8' })
  let r = run('video.mjs', 'tag', bv(1), '--category', '猫', '--why', '他喜欢猫')
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /归到「猫」（新分类）/)
  assert.match(run('video.mjs', 'show', bv(1)).stdout, /分类：猫  —— 他喜欢猫/)
  events(h, [[bv(1), 'shown'], [bv(1), 'open']])
  assert.match(run('taste.mjs', 'show').stdout, /分类（1 \/ 15 个）[\s\S]*【猫】[\s\S]*给他看 1 次 · 他点开 1/)
  assert.match(run('taste.mjs', 'week').stdout, /这一周[\s\S]*【猫】/)
  assert.ok(readTaste(h.file).weeklyAt, 'week 会记下说过了')
  assert.match(run('taste.mjs', 'merge', '猫', '萌宠').stdout, /并进了「萌宠」（1 个视频/)
})

test('醒来提示：看完分类；试试那条要说明；装了桌宠、该说时才有每周一句', (t) => {
  const h = home(t)
  const prompt = () => {
    const code = `import(${JSON.stringify(pathToFileURL(path.join(root, 'lib/scheduler.js')).href)}).then(m => process.stdout.write(m.wakePrompt({ date: 'x' }, '', 5, 'comment', true, ${JSON.stringify(h.d)})))`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, USERPROFILE: h.d, HOME: h.d, DSH_HOME: h.d }, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  let w = prompt()
  assert.match(w, /video tag <BV> --category 名字 --why "为什么觉得主人会 \/ 不会喜欢"/)
  assert.match(w, /标【想让你试试】的那条，跟他说这是你想让他试试的/)
  assert.doesNotMatch(w, /8\.6\)/)
  fs.mkdirSync(path.join(h.d, 'companion'))
  events(h, [[bv(1), 'open']])
  w = prompt()
  assert.match(w, /8\.6\) 这周的分类：先 `node bili\.mjs taste week`[\s\S]*companion say/)
})
