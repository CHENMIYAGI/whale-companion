// 出门开关走真调度器：关着时生物钟到点不叫醒、桌宠任务不投递；存成文件，重启后还在；打开后不补过期的那次
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const RealDate = Date
let now = new RealDate('2026-10-25T15:00:00').getTime()
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
const timers = []
globalThis.setInterval = globalThis.setTimeout = (fn) => { const t = { fn }; timers.push(t); return t }
globalThis.clearInterval = globalThis.clearTimeout = (t) => { t.cleared = true }

const dsh = process.env.DSH_HOME
fs.mkdirSync(path.join(dsh, 'companion'), { recursive: true })
const cfg = { night: { windows: [{ start: '23:00', end: '23:30', wakes: 1 }], skipChance: 0 }, share: { via: 'comment' },
  listen: { comment: false, dm: false, live: false }, diary: { push: false } }
fs.writeFileSync(process.env.BILI_WHALE_CONFIG, JSON.stringify(cfg))

const { startScheduler } = await import('../../lib/scheduler.js')
const messages = []
const ctx = { sessionController: { create: async () => {}, prompt: async (p) => { messages.push(p.content[0].text) } } }
const opts = { dshHome: dsh, biliMjs: 'unused', cwd: process.env.USERPROFILE }
const stateFile = path.join(dsh, 'whale-night.json')
const pauseFile = path.join(dsh, 'whale-pause.json')

let sched = startScheduler(ctx, opts)

// 1) 默认没暂停；文件不存在
assert.equal(sched.companionStatus().paused, false)
assert.equal(fs.existsSync(pauseFile), false)

// 2) 关掉开关：写文件（原子写，不留临时文件）；状态里能看到
assert.deepEqual(sched.companionPause(true), { paused: true, cancelled: 0 })
assert.equal(JSON.parse(fs.readFileSync(pauseFile, 'utf8')).paused, true)
assert.deepEqual(fs.readdirSync(dsh).filter((f) => f.endsWith('.tmp')), [])
assert.equal(sched.companionStatus().paused, true)

// 3) 关着时桌宠排任务 → 直接拒，说明原因
assert.match(sched.companionEnqueue({ kind: 'wake-random' }).error, /休息/)
assert.match(sched.companionEnqueue({ kind: 'watch', bv: 'BV1234567890' }).error, /休息/)
assert.equal(messages.length, 0)

// 4) 重启 DSH（新的调度器实例）：还是关着
sched.stop()
sched = startScheduler(ctx, opts)
assert.equal(sched.companionStatus().paused, true)

// 5) 生物钟：先排好今晚的计划，到点时关着 → 不叫醒；这一次记成用掉了、没醒
await sched.tick()
const plan = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
assert.equal(plan.action, 'wake')
now = plan.atMs + 1000
await sched.tick()
assert.equal(messages.length, 0, '关着时到点不能叫醒她')
const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
assert.equal(after.fired, true)
assert.equal(after.woke, false)
assert.equal(after.pausedSkip, true)

// 6) 打开开关 → 不补那次过期的唤醒；桌宠任务又能排了、会投递
assert.deepEqual(sched.companionPause(false), { paused: false, cancelled: 0 })
await sched.tick()
assert.equal(messages.length, 0, '打开后不该补一次过期的唤醒')
const ok = sched.companionEnqueue({ kind: 'wake-random' })
assert.ok(ok.job && !ok.error)
await new Promise((r) => setImmediate(r))
assert.equal(messages.length, 1)
assert.match(messages[0], /【主人叫醒】/)

// 7) 她在冷却时排上的任务，关开关时一起取消（不会等打开后突然出门）
const queued = sched.companionEnqueue({ kind: 'watch', bv: 'BV1234567890' })
await sched.companionTick()
assert.equal(sched.companionJob(queued.job.id).state, 'queued')
assert.deepEqual(sched.companionPause(true), { paused: true, cancelled: 1 })
const cancelled = sched.companionJob(queued.job.id)
assert.equal(cancelled.state, 'failed')
assert.match(cancelled.reason, /休息/)
now += 9 * 60 * 1000
await sched.companionTick()
assert.equal(messages.length, 1, '取消了的任务不再投递')

sched.stop()
console.log('ok')
