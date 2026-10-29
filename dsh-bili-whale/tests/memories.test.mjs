// 日记整理成「回忆」：按日期切、整段搬进归档（不删、不改字）、醒来只读回忆 + 最近 7 天
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { splitDiary, selectOld, renderDiary, cutoffDate, memoryStatus, pendingText, archiveOld, recallText, archivedText, memoryPaths } from '../tools/lib/memories.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const today = new Date(2026, 9, 27)   // 2026-10-27 → 保留 10-21 起的 7 天
const day = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE') }

// 和她真实日记一样的结构：标题、按天的段落、「看过」表格、「想说」列表
const diary = (d = day) => [
  '# 鲸鱼日记 · 小鲸', '',
  `## ${d(20)} · 第一次刷到猫`, '今天刷到一只会弹钢琴的猫。', '',
  `## ${d(9)} · 主人说不吃香菜`, '他说不吃香菜，我记下了。', '',
  `## ${d(1)} · 主人把我叫醒的这一晚`, '主人叫我去刷，我刷到了咖啡豆。', '',
  '## 看过', '| 时间 | BV | 标题 | 想法 |', '| --- | --- | --- | --- |',
  `| ${d(20)} | BV1aaaaaaaaa | 弹钢琴的猫 | 可爱 |`, `| ${d(1)} | BV1bbbbbbbbb | 咖啡豆 | 吵 |`, '',
  '## 想说（还没说）', '- 想跟主人说猫的事', '',
].join('\n')
const privateDiary = (d = day) => ['# 私人日记 · 小鲸', '', `## ${d(12)}`, '偏好校准：猫 +1', '', `## ${d(0)}`, '今天有点累', ''].join('\n')

test('按日期切：一周前的整段、「看过」里一周前的行搬走；近 7 天、表头、想说都留着', () => {
  const cutoff = cutoffDate(today)
  assert.equal(cutoff, '2026-10-21')
  const { keep, old } = selectOld(splitDiary(diary()), cutoff)
  const kept = renderDiary(keep), gone = renderDiary(old)
  assert.match(gone, /第一次刷到猫[\s\S]*主人说不吃香菜/)
  assert.match(gone, /\| 时间 \| BV \|[\s\S]*\| --- \|[\s\S]*BV1aaaaaaaaa/)
  assert.doesNotMatch(gone, /BV1bbbbbbbbb|想说/)
  assert.match(kept, /^# 鲸鱼日记/)
  assert.match(kept, /主人把我叫醒的这一晚/)
  assert.match(kept, /## 看过\n\| 时间 \| BV[\s\S]*BV1bbbbbbbbb/)
  assert.doesNotMatch(kept, /BV1aaaaaaaaa|第一次刷到猫/)
  assert.match(kept, /## 想说（还没说）\n- 想跟主人说猫的事/)
})

test('表格没有 |---| 分隔线也不会把第一行数据当表头弄重复', () => {
  const text = `## 看过\n| 时间 | BV |\n| ${day(20)} | BV1aaaaaaaaa |\n| ${day(1)} | BV1bbbbbbbbb |\n`
  const { keep, old } = selectOld(splitDiary(text), cutoffDate(today))
  assert.deepEqual(old.sections[0].header, ['| 时间 | BV |'])
  assert.deepEqual(old.sections[0].rows, [`| ${day(20)} | BV1aaaaaaaaa |`])
  assert.match(renderDiary(keep), /\| 时间 \| BV \|\n\| 2026-10-26 \| BV1bbbbbbbbb \|/)
})

function home(t) {
  const dsh = fs.mkdtempSync(path.join(os.tmpdir(), 'memories-'))
  t.after(() => fs.rmSync(dsh, { recursive: true, force: true }))
  const p = memoryPaths(dsh)
  fs.writeFileSync(p.diary, diary()); fs.writeFileSync(p.privateDiary, privateDiary())
  return { dsh, p }
}

test('只有超过长度、而且有一周前的才该整理', (t) => {
  const { dsh } = home(t)
  assert.equal(memoryStatus(dsh, { today, threshold: 12000 }).due, false, '短：不整理')
  const s = memoryStatus(dsh, { today, threshold: 100 })
  assert.equal(s.due, true); assert.equal(s.books[0].oldSections, 3); assert.equal(s.books[1].oldSections, 1)
  const fresh = memoryPaths(dsh)
  fs.writeFileSync(fresh.diary, `# 鲸鱼日记\n\n## ${day(0)}\n${'很长'.repeat(200)}\n`); fs.writeFileSync(fresh.privateDiary, '')
  assert.equal(memoryStatus(dsh, { today, threshold: 100 }).due, false, '长但全是近 7 天的：不整理')
})

test('archive 之前必须先 pending、再写回忆；搬完一个字都不丢，原文在归档里', (t) => {
  const { dsh, p } = home(t)
  const before = (fs.readFileSync(p.diary, 'utf8') + '\n' + fs.readFileSync(p.privateDiary, 'utf8')).split('\n').filter((l) => l.trim())
  assert.match(archiveOld(dsh, { today }).error, /先跑 memories pending/)
  const pend = pendingText(dsh, { today, now: Date.now() - 1000 })
  assert.match(pend.text, /鲸鱼日记（2026-10-21 之前）[\s\S]*第一次刷到猫[\s\S]*私人日记[\s\S]*偏好校准/)
  assert.match(archiveOld(dsh, { today }).error, /还没写过/, '没写回忆不许搬')
  fs.writeFileSync(p.memories, '## 喜好\n- 猫\n## 和主人之间\n- 他不吃香菜\n')
  const r = archiveOld(dsh, { today })
  assert.equal(r.ok, true); assert.deepEqual(r.moved.map((m) => [m.label, m.sections]), [['鲸鱼日记', 3], ['私人日记', 1]])
  const after = fs.readFileSync(p.diary, 'utf8') + '\n' + fs.readFileSync(p.privateDiary, 'utf8')
  const archived = archivedText(dsh)
  for (const line of before) assert.ok(after.includes(line) || archived.includes(line), '丢了：' + line)
  assert.doesNotMatch(after, /第一次刷到猫|主人说不吃香菜|偏好校准/)
  assert.match(after, /主人把我叫醒的这一晚[\s\S]*BV1bbbbbbbbb[\s\S]*想跟主人说猫的事/)
  assert.ok(fs.readdirSync(p.archiveDir).includes('2026-10-鲸鱼日记.md'))
  assert.match(archived, /BV1aaaaaaaaa/, 'feed 从归档里还能读到看过的 BV')
  assert.deepEqual(fs.readdirSync(dsh).filter((f) => f.endsWith('.tmp')), [])
  // 再来一次：没有旧的了，什么都不动
  pendingText(dsh, { today }); fs.appendFileSync(p.memories, '\n')
  assert.deepEqual(archiveOld(dsh, { today }).moved, [])
})

test('recall：回忆 + 两本日记最近 7 天，没有一周前的', (t) => {
  const { dsh, p } = home(t)
  assert.match(recallText(dsh, { today }), /回忆 =====\n（还没有整理过）/)
  fs.writeFileSync(p.memories, '## 和主人之间\n- 他不吃香菜\n')
  const r = recallText(dsh, { today })
  assert.match(r, /他不吃香菜[\s\S]*鲸鱼日记 · 最近 7 天（2026-10-21 起）[\s\S]*主人把我叫醒的这一晚[\s\S]*私人日记 · 最近 7 天[\s\S]*今天有点累/)
  assert.doesNotMatch(r, /第一次刷到猫|偏好校准/)
  fs.writeFileSync(p.memories, '回忆'.repeat(2100))
  assert.match(recallText(dsh, { today }), /精简/)
})

test('命令行：status / pending / archive / recall', (t) => {
  const dsh = fs.mkdtempSync(path.join(os.tmpdir(), 'memories-cli-'))
  t.after(() => fs.rmSync(dsh, { recursive: true, force: true }))
  const realDay = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE') }
  const p = memoryPaths(dsh)
  fs.writeFileSync(p.diary, diary(realDay)); fs.writeFileSync(p.privateDiary, privateDiary(realDay))
  const cfg = path.join(dsh, 'cfg.json'); fs.writeFileSync(cfg, JSON.stringify({ memory: { consolidateAboveChars: 50 } }))
  const env = { ...process.env, DSH_HOME: dsh, USERPROFILE: dsh, HOME: dsh, BILI_WHALE_CONFIG: cfg }
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools/commands/memories.mjs'), ...a], { env, encoding: 'utf8' })
  assert.match(run('status').stdout, /该整理了/)
  assert.match(run('pending').stdout, /第一次刷到猫/)
  assert.equal(run('archive').status, 2)
  fs.writeFileSync(p.memories, '## 喜好\n- 猫\n')
  const a = run('archive'); assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /鲸鱼日记：3 段/)
  assert.match(run('status').stdout, /现在不用整理/)
  assert.match(run('recall').stdout, /喜好[\s\S]*主人把我叫醒的这一晚/)
})

test('醒来提示：第 2 步读回忆；日记长了才加「整理回忆」', async (t) => {
  const { wakePrompt } = await import('../lib/scheduler.js')
  const { dsh } = home(t)
  const small = wakePrompt({ date: '2026-10-27' }, '', 5, 'comment', true, dsh)
  assert.match(small, /2\) `node bili\.mjs memories recall`/)
  assert.doesNotMatch(small, /6\.7\)/)
  fs.appendFileSync(memoryPaths(dsh).diary, `\n## ${new Date(Date.now() - 20 * 86400000).toLocaleDateString('sv-SE')} · 很久以前\n${'很长的一天'.repeat(3000)}\n`)
  const big = wakePrompt({ date: '2026-10-27' }, '', 5, 'comment', true, dsh)
  assert.match(big, /6\.7\) 日记有点长了[\s\S]*memories pending[\s\S]*memories archive/)
  assert.ok(big.indexOf('6.5)') < big.indexOf('6.7)'))
})
