// 「我眼中的主人」：100–300 字、整篇重写、旧版按写成的日期归档、原子写；整理回忆和交接信时顺便重写
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkOwnerView, writeOwnerView, readOwnerView, ownerViewHistory, ownerViewBlock, viewChars, ownerViewDue, ownerViewDueLines } from '../tools/lib/owner-view.mjs'
import { letterRequest } from '../lib/session-delivery.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const words = (n, ch = '他') => ch.repeat(n)
function dir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-view-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return { d, file: path.join(d, '.bili-ai', 'owner-view.md'), archiveDir: path.join(d, '.bili-ai', 'owner-view-archive') }
}
const setDay = (file, day) => { const t = new Date(`${day}T12:00:00`); fs.utimesSync(file, t, t) }

test('字数：100–300，空白不算字', () => {
  assert.match(checkOwnerView(words(99)).error, /太短/)
  assert.equal(checkOwnerView(words(100)).ok, true)
  assert.equal(checkOwnerView(words(300)).ok, true)
  assert.match(checkOwnerView(words(301)).error, /太长/)
  assert.equal(viewChars('他 很\n安静'), 4)
  assert.equal(checkOwnerView(words(50) + '\n\n   \n' + words(50)).ok, true)
})

test('整篇重写：旧版本按它写成的日期归档（同一天 -2）；写失败不动原来的；没有临时文件', (t) => {
  const p = dir(t)
  const v1 = '他说话不多，但会认真回我。' + words(90)
  let r = writeOwnerView(v1, p)
  assert.equal(r.ok, true); assert.equal(r.archived, null, '第一版没有旧的可存')
  setDay(p.file, '2026-10-20')
  const v2 = '他最近在赶论文，晚上回得慢。' + words(90, '她')
  r = writeOwnerView(v2, p)
  assert.equal(r.archived, path.join(p.archiveDir, '2026-10-20.md'))
  assert.equal(readOwnerView(r.archived), v1)
  assert.equal(readOwnerView(p.file), v2)
  setDay(p.file, '2026-10-20')
  r = writeOwnerView('第三版' + words(100), p)
  assert.equal(r.archived, path.join(p.archiveDir, '2026-10-20-2.md'))
  assert.deepEqual(ownerViewHistory(p.archiveDir).map((v) => [v.name, v.text]), [['2026-10-20.md', v1], ['2026-10-20-2.md', v2]])
  const before = fs.readFileSync(p.file, 'utf8')
  assert.equal(writeOwnerView('太短', p).ok, false)
  assert.equal(fs.readFileSync(p.file, 'utf8'), before, '写失败不动原来的')
  assert.equal(fs.readdirSync(p.archiveDir).length, 2, '写失败不归档')
  for (const d of [path.dirname(p.file), p.archiveDir]) assert.deepEqual(fs.readdirSync(d).filter((f) => f.endsWith('.tmp')), [])
})

test('提示里的那一段：校准语气用，不念出来', () => {
  assert.equal(ownerViewBlock(''), '')
  assert.match(ownerViewBlock('他很温柔'), /［你眼中的主人］[\s\S]*校准语气和态度[\s\S]*不要念出来[\s\S]*在我看来你是[\s\S]*他很温柔/)
})

test('命令行：write --file / show / history；太短不收', (t) => {
  const p = dir(t)
  const env = { ...process.env, USERPROFILE: p.d, HOME: p.d }
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools/commands/owner-view.mjs'), ...a], { env, encoding: 'utf8' })
  assert.match(run('show').stdout, /还没写过/)
  const draft = path.join(p.d, 'draft.md')
  fs.writeFileSync(draft, '他是那种不太说累的人。' + words(95))
  let r = run('write', '--file', draft)
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /第一版/)
  assert.match(run('show').stdout, /不太说累[\s\S]*（\d+ 字/)
  fs.writeFileSync(draft, '太短了')
  r = run('write', '--file', draft)
  assert.equal(r.status, 2); assert.match(r.stderr, /太短/)
  fs.writeFileSync(draft, '第二版' + words(120))
  assert.match(run('write', '--file', draft).stdout, /旧版本存进了/)
  assert.match(run('history').stdout, /=====[\s\S]*不太说累[\s\S]*===== 现在 =====\n第二版/)
})

test('什么时候重写：交接信、整理回忆两处都要；写明依据和不碰的话题', async (t) => {
  const letter = letterRequest('/tmp/letter.md')
  for (const text of [letter]) {
    assert.match(text, /整篇重写「我眼中的主人」（不是往后追加）/)
    assert.match(text, /100–300 字/)
    assert.match(text, /不能来自 B 站上陌生人的话/)
    assert.match(text, /不去猜健康、家庭/)
    assert.match(text, /owner-view write --file/)
  }
  // 整理回忆那一步（日记长了才有）
  const { wakePrompt } = await import('../lib/scheduler.js')
  const p = dir(t)
  fs.writeFileSync(path.join(p.d, 'whale-diary.md'), `# 鲸鱼日记\n\n## ${new Date(Date.now() - 20 * 86400000).toLocaleDateString('sv-SE')} · 很久以前\n${'很长的一天'.repeat(3000)}\n`)
  const w = wakePrompt({ date: '2026-10-27' }, '', 5, 'comment', true, p.d)
  assert.match(w, /6\.7\) 日记有点长了[\s\S]*整篇重写「我眼中的主人」/)
})

// 2026-10-27：第一版别等太久；之后至少每 7 天一次
const ago = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')
function dsh(t, { days = 0, archivedDays = 0, chats = 0, tools = 0 } = {}) {
  const p = dir(t)
  const sec = (n) => `## ${ago(n)} · 第 ${n} 天\n这一天\n`
  fs.writeFileSync(path.join(p.d, 'whale-diary.md'), '# 鲸鱼日记\n\n' + Array.from({ length: days }, (_, i) => sec(i)).join('\n'))
  if (archivedDays) {
    fs.mkdirSync(path.join(p.d, 'whale-diary-archive'))
    fs.writeFileSync(path.join(p.d, 'whale-diary-archive', '2026-09-鲸鱼日记.md'), Array.from({ length: archivedDays }, (_, i) => sec(30 + i)).join('\n'))
  }
  fs.mkdirSync(path.join(p.d, 'companion'))
  const rows = [...Array.from({ length: chats }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x' })), ...Array.from({ length: tools }, () => ({ role: 'event', text: '工具' }))]
  fs.writeFileSync(path.join(p.d, 'companion', 'chat-log.jsonl'), rows.map((r) => JSON.stringify({ at: new Date().toISOString(), ...r })).join('\n'))
  return p
}

test('第一版：还没有，且日记满 3 天（归档里的也算）或桌宠聊过 20 句 → 写', (t) => {
  let p = dsh(t, { days: 2, chats: 19, tools: 10 })
  assert.deepEqual(ownerViewDue(p.d, { file: p.file }), { kind: null, days: 2, chats: 19 }, '工具记录不算聊天')
  p = dsh(t, { days: 2, archivedDays: 1 })
  assert.equal(ownerViewDue(p.d, { file: p.file }).kind, 'first')
  p = dsh(t, { chats: 20 })
  assert.equal(ownerViewDue(p.d, { file: p.file }).kind, 'first')
  const [line] = ownerViewDueLines(p.d, { file: p.file })
  assert.match(line, /^6\.8\) 写第一版「我眼中的主人」（桌宠里聊过 20 句了/)
  assert.doesNotMatch(line, /看现在这份/, '第一版没有「现在这份」')
  assert.match(line, /100–300 字[\s\S]*不能来自 B 站上陌生人的话[\s\S]*不去猜健康、家庭[\s\S]*owner-view write --file/)
})

test('有了以后：7 天以上没更新就重写，6 天不用', (t) => {
  const p = dsh(t, { days: 5 })
  writeOwnerView('他' + words(120), p)
  const back = (n) => { const d = new Date(Date.now() - n * 86400000); fs.utimesSync(p.file, d, d) }
  back(6)
  assert.deepEqual(ownerViewDueLines(p.d, { file: p.file }), [])
  back(8)
  assert.equal(ownerViewDue(p.d, { file: p.file }).kind, 'refresh')
  assert.match(ownerViewDueLines(p.d, { file: p.file })[0], /^6\.8\) 「我眼中的主人」已经 8 天没更新了：整篇重写[\s\S]*owner-view show/)
})

test('醒来提示：写完日记后（6.5 之后）加 6.8；轮到整理回忆时由 6.7 顺便重写，不重复', (t) => {
  // 另起进程、换一个家目录：免得读到这台电脑上真的 owner-view.md
  const prompt = (p) => {
    const code = `import(${JSON.stringify(pathToFileURL(path.join(root, 'lib/scheduler.js')).href)}).then(m => process.stdout.write(m.wakePrompt({ date: 'x' }, '', 5, 'comment', true, ${JSON.stringify(p.d)})))`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, USERPROFILE: p.d, HOME: p.d, DSH_HOME: p.d }, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  let w = prompt(dsh(t, { days: 3 }))
  assert.match(w, /6\.8\) 写第一版「我眼中的主人」（日记已经写了 3 天了/)
  assert.ok(w.indexOf('6.5)') < w.indexOf('6.8)'))
  w = prompt(dsh(t, { days: 1 }))
  assert.doesNotMatch(w, /6\.8\)/)
  const big = dsh(t, { days: 3 })
  fs.appendFileSync(path.join(big.d, 'whale-diary.md'), `\n## ${ago(20)} · 很久以前\n${'很长的一天'.repeat(3000)}\n`)
  w = prompt(big)
  assert.match(w, /6\.7\)[\s\S]*整篇重写「我眼中的主人」/)
  assert.doesNotMatch(w, /6\.8\)/)
})
