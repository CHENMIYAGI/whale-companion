// 桌宠任务走真调度器：投递内容、冷却、与生物钟共用一把锁
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
fs.mkdirSync(path.join(dsh, 'companion'), { recursive: true })   // 装了桌宠
fs.writeFileSync(path.join(dsh, 'companion', 'notebook.md'), '- [1] 主人不吃香菜')   // 桌宠的小本本插件写的
const cfg = { night: { windows: [{ start: '23:00', end: '23:30', wakes: 1 }], skipChance: 0 }, share: { via: 'comment' },
  listen: { comment: false, dm: false, live: false }, diary: { push: false } }
fs.writeFileSync(process.env.BILI_WHALE_CONFIG, JSON.stringify(cfg))
fs.writeFileSync(path.join(process.env.USERPROFILE, '.bili-ai/persona.md'), '测试专属人设')
fs.writeFileSync(path.join(process.env.USERPROFILE, '.bili-ai/self.md'), '- [1] 2026-10-27 我发现我刷到猫会停下来（来源：自己的经历）\n')
fs.writeFileSync(path.join(process.env.USERPROFILE, '.bili-ai/owner-view.md'), '他回消息慢的时候一般是在忙，不是生气。' + '他'.repeat(100))

const { startScheduler } = await import('../../lib/scheduler.js')
const messages = []
let fail = false
const sched = startScheduler({ sessionController: { create: async () => {}, prompt: async (p) => { if (fail) throw Error('boom'); messages.push(p.content[0].text) } } },
  { dshHome: dsh, biliMjs: 'unused', cwd: process.env.USERPROFILE })

// 1) 随便去刷：完整唤醒流程 + 「主人叫醒」 + 人设 + 桌宠的两行
const a = sched.companionEnqueue({ kind: 'wake-random' })
assert.ok(a.job && !a.error)
await new Promise((r) => setImmediate(r))
assert.equal(messages.length, 1, '入队后应立刻投递')
const m = messages[0]
assert.match(m, /【主人叫醒】/)
assert.match(m, /测试专属人设/)
// 「我的成长」跟在主人写的人设后面
assert.ok(m.indexOf('测试专属人设') < m.indexOf('［她自己的发现］'))
// 「我眼中的主人」再在后面，并写明只用来校准语气
assert.ok(m.indexOf('［她自己的发现］') < m.indexOf('［你眼中的主人］'))
assert.match(m, /［你眼中的主人］[\s\S]*不要念出来[\s\S]*他回消息慢的时候一般是在忙/)
// 小本本（桌宠写的 notebook.md）跟在「你眼中的主人」后面，只读
assert.ok(m.indexOf('［你眼中的主人］') < m.indexOf('［小本本］'))
assert.match(m, /［小本本］桌宠里记的、关于主人的事（只读：不要改这个文件[\s\S]*主人不吃香菜/)
assert.match(m, /- \[1\] 我发现我刷到猫会停下来/)
assert.match(m, /feed 选题/)
assert.match(m, /share.via = comment/)
assert.match(m, /companion chat-today/)
assert.match(m, /companion say/)
assert.equal(sched.companionJob(a.job.id).state, 'delivered')

// 2) 刚投递完 → 冷却中，下一个任务排队等待，不会打断她
const b = sched.companionEnqueue({ kind: 'watch', bv: 'BV1234567890', note: '这个好像挺好笑' })
await sched.companionTick()
assert.equal(messages.length, 1)
const waiting = sched.companionJob(b.job.id)
assert.equal(waiting.state, 'queued')
assert.match(waiting.reason, /歇一会儿/)
// 同一件事连点两次 → 不重复排队
assert.equal(sched.companionEnqueue({ kind: 'watch', bv: 'BV1234567890' }).duplicate, true)

// 3) 冷却结束 → 投递 watch；不走分享
now += 9 * 60 * 1000
await sched.companionTick()
assert.equal(messages.length, 2)
assert.match(messages[1], /BV1234567890/)
assert.match(messages[1], /不走分享/)
assert.match(messages[1], /这个好像挺好笑/)

// 4) 投递失败 → 回到队列重试，三次后放弃
now += 9 * 60 * 1000
fail = true
const c = sched.companionEnqueue({ kind: 'wake-random' })
await new Promise((r) => setImmediate(r))          // 入队时那次投递失败
assert.equal(sched.companionJob(c.job.id).state, 'queued')
await sched.companionTick()                         // 还在退避 → 不重试
assert.equal(sched.companionJob(c.job.id).attempts, 1)
now += 31_000; await sched.companionTick()
now += 61_000; await sched.companionTick()
assert.equal(sched.companionJob(c.job.id).state, 'failed')
assert.equal(sched.companionJob(c.job.id).attempts, 3)

// 5) 状态接口：计划、沉默、任务列表
const st = sched.companionStatus()
assert.equal(st.version, 1)
assert.ok(Array.isArray(st.jobs) && st.jobs.length === 3)
assert.equal(st.silence.band, 'normal')
assert.equal(st.shareVia, 'comment')

// 6) 不认识的任务 / 坏 BV
assert.ok(sched.companionEnqueue({ kind: 'post-comment' }).error)
assert.ok(sched.companionEnqueue({ kind: 'watch', bv: 'BV1' }).error)

sched.stop()
assert.ok(timers.every((t) => t.cleared), 'stop() 要清掉桌宠的定时器')
console.log('ok')
