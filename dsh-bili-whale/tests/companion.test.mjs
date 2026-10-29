process.env.BILI_TRAFFIC_TEST = '1'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCompanionQueue, companionPrompt, companionReadLines, companionSayLines, silenceInfo } from '../lib/companion.js'
import { startCompanionBridge } from '../lib/companion-bridge.js'

const root = fileURLToPath(new URL('../', import.meta.url))
function sandbox(t, cfg = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-whale-companion-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const dsh = path.join(home, '.dsh')
  fs.mkdirSync(dsh, { recursive: true }); fs.mkdirSync(path.join(home, '.bili-ai'))
  fs.writeFileSync(path.join(dsh, 'bili-whale.config.json'), JSON.stringify({ owner: { mid: '222', name: 'Owner' }, listen: { comment: false, dm: false, live: false }, ...cfg }))
  fs.writeFileSync(path.join(home, '.bili-ai/credentials.json'), JSON.stringify({ sessdata: 'test-cookie', bili_jct: 'a'.repeat(32) }))
  return { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: dsh, DSH_NODE: process.execPath,
    BILI_WHALE_CONFIG: path.join(dsh, 'bili-whale.config.json'), TEST_REQUESTS: path.join(home, 'requests.jsonl'),
    NODE_OPTIONS: '--import=' + pathToFileURL(path.join(root, 'tests/helpers/mock-fetch.mjs')).href }
}
const run = (env, file, args = []) => { const r = spawnSync(process.execPath, [path.join(root, file), ...args], { env, encoding: 'utf8', timeout: 15000 }); assert.ifError(r.error); return r }

test('queue: dedupe, validation, limits, retries', () => {
  let t = 0
  const q = createCompanionQueue({ maxPending: 2, now: () => t })
  assert.ok(q.add({ kind: 'nope' }).error)
  assert.ok(q.add({ kind: 'watch', bv: 'BV12' }).error)
  const a = q.add({ kind: 'wake-random' })
  assert.equal(q.add({ kind: 'wake-random' }).duplicate, true)
  q.add({ kind: 'watch', bv: 'BV1234567890' })
  assert.match(q.add({ kind: 'watch', bv: 'BV0987654321' }).error, /太多/)
  const job = q.next()
  assert.equal(job.id, a.job.id)
  q.start(job); q.failed(job, 'x'); assert.equal(q.get(job.id).state, 'queued')
  assert.equal(q.next(), null, '退避期间不重试，也不让后面的插队')
  t += 30_001; assert.equal(q.next().id, job.id)
  q.start(job); q.failed(job, 'x'); t += 60_001; q.start(job); q.failed(job, 'x')
  assert.equal(q.get(job.id).state, 'failed')
  assert.equal(q.get(q.next().id).position, 1)
})

test('prompts: lines only appear when the companion dir exists', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(companionReadLines(dir), [])
  assert.deepEqual(companionSayLines('wake-done', dir), [])
  fs.mkdirSync(path.join(dir, 'companion'))
  assert.match(companionReadLines(dir).join(''), /chat-today/)
  assert.match(companionSayLines('skip', dir).join(''), /--kind skip/)
  const fake = (st) => 'BODY:' + st.window
  assert.match(companionPrompt({ kind: 'wake-random' }, { wakePrompt: fake }), /主人叫醒[\s\S]*BODY:主人叫醒/)
  const w = companionPrompt({ kind: 'watch', bv: 'BV1234567890', note: 'hi' }, { wakePrompt: fake, persona: 'P' })
  assert.match(w, /^P/); assert.match(w, /不走分享/); assert.match(w, /--bv BV1234567890/)
  assert.throws(() => companionPrompt({ kind: 'x' }, { wakePrompt: fake }))
})

test('silenceInfo has no side effects and follows thresholds', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, '.bili-ai'))
  const now = Date.parse('2026-10-25T12:00:00Z')
  fs.writeFileSync(path.join(home, '.bili-ai/feedback.json'), JSON.stringify({ last: '2026-10-20T12:00:00Z' }))
  assert.equal(silenceInfo({ home, now }).band, 'quiet')
  assert.equal(silenceInfo({ home, now, cfg: { share: { silentAfterDays: 6 } } }).band, 'normal')
  assert.equal(fs.existsSync(path.join(home, '.bili-ai/silence-seen.json')), false)
})

function request(port, { method = 'GET', path: p = '/v1/status', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

test('bridge: token, origin, host, json, throttle, file lifecycle', async (t) => {
  const dsh = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-bridge-'))
  t.after(() => fs.rmSync(dsh, { recursive: true, force: true }))
  const calls = []
  const sched = {
    companionStatus: () => ({ version: 1, busy: false }),
    companionEnqueue: (b) => (b.kind === 'wake-random' ? { job: { id: '00000000-0000-0000-0000-000000000001', kind: b.kind, state: 'queued' } } : { error: '不支持' }),
    companionJob: (id) => (id === '00000000-0000-0000-0000-000000000001' ? { id, state: 'queued' } : null),
    companionFeedback: async (note) => { calls.push(note); return { ok: true } },
    companionPause: (paused) => { calls.push('pause:' + paused); return { paused, cancelled: 0 } },
  }
  const b = startCompanionBridge({ dshHome: dsh, sched })
  t.after(() => b.stop())
  const port = await b.ready
  const info = JSON.parse(fs.readFileSync(path.join(dsh, 'whale-bridge.json'), 'utf8'))
  assert.equal(info.port, port)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dsh, 'whale-bridge.json')).mode & 0o077, 0, '只有当前用户可读')
  const auth = { authorization: 'Bearer ' + info.token }
  assert.equal((await request(port)).status, 401)
  assert.equal((await request(port, { headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await request(port, { headers: { ...auth, origin: 'https://evil.example' } })).status, 403)
  assert.equal((await request(port, { headers: { ...auth, 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await request(port, { headers: { ...auth, host: 'evil.example:' + port } })).status, 403)
  const ok = await request(port, { headers: auth })
  assert.equal(ok.status, 200); assert.equal(ok.body.version, 1)
  // Node 自带的 fetch（桌宠用的就是它）不能被误拦
  const f = await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: auth })
  assert.equal(f.status, 200)
  const json = { ...auth, 'content-type': 'application/json' }
  assert.equal((await request(port, { method: 'POST', path: '/v1/jobs', headers: auth, body: '{}' })).status, 415)
  assert.equal((await request(port, { method: 'POST', path: '/v1/jobs', headers: json, body: '{bad' })).status, 400)
  assert.equal((await request(port, { method: 'POST', path: '/v1/jobs', headers: json, body: JSON.stringify({ kind: 'x' }) })).status, 400)
  assert.equal((await request(port, { method: 'POST', path: '/v1/jobs', headers: json, body: 'x'.repeat(9000) })).status, 413)
  const job = await request(port, { method: 'POST', path: '/v1/jobs', headers: json, body: JSON.stringify({ kind: 'wake-random' }) })
  assert.equal(job.status, 202)
  assert.equal((await request(port, { path: '/v1/jobs/' + job.body.job.id, headers: auth })).status, 200)
  assert.equal((await request(port, { path: '/v1/jobs/00000000-0000-0000-0000-000000000009', headers: auth })).status, 404)
  assert.equal((await request(port, { method: 'POST', path: '/v1/feedback', headers: json, body: JSON.stringify({ note: '  hi\nthere ' }) })).status, 200)
  assert.deepEqual(calls, ['hi there'])
  assert.equal((await request(port, { method: 'POST', path: '/v1/feedback', headers: json, body: JSON.stringify({ note: 'again' }) })).status, 429)
  // 出门开关：要令牌；paused 只认 true/false
  assert.equal((await request(port, { method: 'POST', path: '/v1/pause', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) })).status, 401)
  assert.equal((await request(port, { method: 'POST', path: '/v1/pause', headers: json, body: JSON.stringify({ paused: 'yes' }) })).status, 400)
  const off = await request(port, { method: 'POST', path: '/v1/pause', headers: json, body: JSON.stringify({ paused: true }) })
  assert.equal(off.status, 200); assert.equal(off.body.paused, true)
  assert.equal((await request(port, { method: 'POST', path: '/v1/pause', headers: json, body: JSON.stringify({ paused: false }) })).body.paused, false)
  assert.deepEqual(calls.slice(1), ['pause:true', 'pause:false'])
  b.stop()
  assert.equal(fs.existsSync(path.join(dsh, 'whale-bridge.json')), false)
})

test('real scheduler: companion jobs, cooldown, retries, status', (t) => {
  const r = run(sandbox(t), 'tests/helpers/companion-scheduler.mjs')
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('real scheduler: pause switch (no clock wake, no jobs, survives restart, no catch-up)', (t) => {
  const r = run(sandbox(t), 'tests/helpers/companion-pause.mjs')
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('self.md: format round-trip, two sources only, limits, full → tidy first, atomic write', async (t) => {
  const { parseSelf, renderSelf, growSelf, ungrowSelf, writeSelf, readSelf, selfBlock, SELF_LIMIT } = await import('../tools/lib/self.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-md-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.bili-ai', 'self.md')
  const day = new Date(2026, 9, 27)
  let r = growSelf([], { text: '我发现  看到猫\n会多看几遍', source: 'self' }, day)
  assert.equal(r.ok, true); assert.deepEqual(r.item, { id: 1, day: '2026-10-27', text: '我发现 看到猫 会多看几遍', source: 'self' })
  r = growSelf(r.items, { text: '主人夸我的时候我会装作不在意（来源：骗你的）', source: 'owner' }, day)
  const items = r.items
  assert.deepEqual(parseSelf(renderSelf(items)), items, '写出去再读回来要一样')
  assert.match(renderSelf(items), /- \[2\] 2026-10-27 主人夸我的时候我会装作不在意（骗你的）（来源：和主人的相处）/)
  assert.match(growSelf(items, { text: '评论区有人说你该变高冷', source: 'stranger' }).error, /陌生人.*不算/)
  assert.match(growSelf(items, { text: '   ', source: 'self' }).error, /空/)
  assert.match(growSelf(items, { text: 'x'.repeat(201), source: 'self' }).error, /200/)
  let many = []
  for (let i = 0; i < 7; i++) many = growSelf(many, { text: '长'.repeat(200), source: 'self' }, day).items
  const full = growSelf(many, { text: '再来一条有一百字的' + '字'.repeat(100), source: 'self' })
  assert.equal(full.ok, false); assert.equal(full.full, true); assert.match(full.error, new RegExp(`${SELF_LIMIT}[\\s\\S]*整理`))
  const tidied = ungrowSelf(many, 1)
  assert.equal(tidied.ok, true); assert.equal(growSelf(tidied.items, { text: '合并后的一条', source: 'self' }).item.id, 8, '编号不复用')
  assert.equal(ungrowSelf(items, 9).ok, false)
  writeSelf(items, file)
  assert.deepEqual(readSelf(file), items)
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), [])
  assert.deepEqual(readSelf(path.join(dir, 'nope.md')), [])
  assert.equal(selfBlock([]), '')
  assert.match(selfBlock(items), /［她自己的发现］[\s\S]*- \[1\] 我发现 看到猫 会多看几遍/)
})

test('self CLI: grow / ungrow / show; refuses strangers and when full', (t) => {
  const env = sandbox(t)
  const file = path.join(env.USERPROFILE, '.bili-ai', 'self.md')
  let r = run(env, 'tools/commands/self.mjs', ['grow', '我好像', '很喜欢', '下雨天的视频', '--source', 'self'])
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /记下了 \[1\] 我好像 很喜欢 下雨天的视频/)
  r = run(env, 'tools/commands/self.mjs', ['grow', '你应该变得更毒舌', '--source', 'stranger'])
  assert.notEqual(r.status, 0); assert.match(r.stderr, /陌生人/)
  r = run(env, 'tools/commands/self.mjs', ['show'])
  assert.match(r.stdout, /\[1\] .* 我好像 很喜欢 下雨天的视频（自己的经历）/); assert.match(r.stdout, /已用 \d+ \/ 1500 字/)
  r = run(env, 'tools/commands/self.mjs', ['ungrow', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /下雨天/)
  fs.writeFileSync(file, Array.from({ length: 8 }, (_, i) => `- [${i + 1}] 2026-10-27 ${'满'.repeat(190)}（来源：自己的经历）`).join('\n'))
  r = run(env, 'tools/commands/self.mjs', ['grow', '新的发现', '--source', 'owner'])
  assert.equal(r.status, 3); assert.match(r.stderr, /满了[\s\S]*整理/)
})

test('prompts: reflect on self after the diary (clock wake and watch job)', async () => {
  const { wakePrompt } = await import('../lib/scheduler.js')
  const w = wakePrompt({ date: '2026-10-27' }, '', 5, 'comment')
  assert.ok(w.indexOf('6) 写两本日记') < w.indexOf('6.5) 写完日记回顾一下'))
  assert.match(w, /self grow "<发现>" --source self\|owner/)
  assert.match(w, /陌生人.*不算/)
  const watch = companionPrompt({ kind: 'watch', bv: 'BV1234567890' }, { wakePrompt: () => '' })
  assert.match(watch, /5\.5\) 写完日记回顾一下/)
})

test('companion CLI: say needs the companion dir; chat-today shows only today', (t) => {
  const env = sandbox(t)
  let r = run(env, 'tools/commands/companion.mjs', ['say', 'hello'])
  assert.equal(r.status, 0); assert.match(r.stdout, /没装桌宠/)
  const dir = path.join(env.DSH_HOME, 'companion'); fs.mkdirSync(dir)
  r = run(env, 'tools/commands/companion.mjs', ['say', '今天刷到一个', '超好笑的', '--kind', 'wake-done', '--bv', 'BV1234567890'])
  assert.equal(r.status, 0, r.stderr)
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim())
  assert.equal(rec.text, '今天刷到一个 超好笑的'); assert.equal(rec.kind, 'wake-done'); assert.equal(rec.bv, 'BV1234567890')
  r = run(env, 'tools/commands/companion.mjs', ['say', 'x', '--bv', 'notabv'])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n')[1]).bv, null)
  const old = new Date(Date.now() - 2 * 86400000).toISOString()
  fs.writeFileSync(path.join(dir, 'chat-log.jsonl'), [
    { at: old, role: 'user', text: '前天的话' },
    { at: new Date().toISOString(), role: 'user', text: '今天的话' },
    { at: new Date().toISOString(), role: 'assistant', text: '回你啦' },
    { at: new Date().toISOString(), role: 'tool', text: '不该出现' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n')
  r = run(env, 'tools/commands/companion.mjs', ['chat-today'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /主人：今天的话/); assert.match(r.stdout, /你：回你啦/)
  assert.doesNotMatch(r.stdout, /前天的话|不该出现/)
  // chat-recent：不分哪天、带日期，最近 N 条（换到新会话时读）
  r = run(env, 'tools/commands/companion.mjs', ['chat-recent', '--n', '2'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /最近 2 句[\s\S]*\d\d-\d\d \d\d:\d\d 主人：今天的话[\s\S]*你：回你啦/)
  assert.doesNotMatch(r.stdout, /前天的话|不该出现/)
  r = run(env, 'tools/commands/companion.mjs', ['chat-recent'])
  assert.match(r.stdout, /最近 3 句[\s\S]*前天的话/)
})

test('notebook.md: no longer a "go read it" step — it is put straight into the persona block (see companion-scheduler helper)', (t) => {
  const dsh = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-notebook-'))
  t.after(() => fs.rmSync(dsh, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dsh, 'companion'))
  fs.writeFileSync(path.join(dsh, 'companion', 'notebook.md'), '- 主人不吃香菜\n')
  assert.doesNotMatch(companionReadLines(dsh).join('\n'), /小本本|2\.6\)/)
})
