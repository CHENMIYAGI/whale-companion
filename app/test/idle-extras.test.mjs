// 待机小动作：用假时钟模拟待机 10 分钟 —— 平时一直是普通待机的循环，小动作偶尔播一次、播完回来，同一个不会连着播
// （2026-10-29 的 bug：她一直在左顾右盼。原因是普通待机的 idle.webm 自己会转头，见 scripts/make-idle.sh）
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// idle-extras.js 是给网页用的普通脚本（不是模块）：在一个干净的沙箱里跑它，拿到 createIdleExtras
const code = fs.readFileSync(new URL('../src/renderer/idle-extras.js', import.meta.url), 'utf8')
const sandbox = {}
vm.runInNewContext(code, sandbox)
const { createIdleExtras } = sandbox

const EXTRAS = ['idle-look', 'idle-hum', 'idle-bubbles', 'idle-stretch']
const EXTRA_SEC = 10   // 小动作视频大约 10 秒

/** 模拟一只待机的桌宠：返回这段时间里播过的动画（按时间顺序，连着一样的合并） */
function simulate({ minutes, every = [3, 8], seed = 1, busyAt = () => false }) {
  let now = 0
  let timers = []
  let rnd = seed
  const random = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646 }   // 可重复的随机数
  let showing = 'idle'
  let endsAt = Infinity
  const played = ['idle']
  const show = (name) => { showing = name; if (played.at(-1) !== name) played.push(name) }
  createIdleExtras({
    list: EXTRAS, every, random,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t },
    clearTimer: (t) => { timers = timers.filter((x) => x !== t) },
    canPlay: () => showing === 'idle' && !busyAt(now),
    play: (extra) => { show(extra); endsAt = now + EXTRA_SEC * 1000 },
  })
  const end = minutes * 60_000
  while (true) {
    timers.sort((a, b) => a.at - b.at)
    const next = Math.min(timers[0]?.at ?? Infinity, endsAt)
    if (next > end) break
    now = next
    if (next === endsAt) { endsAt = Infinity; show('idle'); continue }   // 小动作播完 → 回到普通待机
    const t = timers.shift()
    t.fn()
  }
  return played
}

test('平时的循环是普通待机（idle），不是左顾右盼（idle-look）', () => {
  const pet = fs.readFileSync(new URL('../src/renderer/pet.js', import.meta.url), 'utf8')
  assert.match(pet, /const loops = \{[\s\S]*?\bidle: 'idle',/)
  assert.ok(!/idle: 'idle-look'/.test(pet))
  assert.match(pet, /play: \(extra\) => show\(extra, false\)/, '小动作只播一次（不循环）')
})

test('待机 10 分钟：小动作 1～3 次（3～8 分钟一次），每次播完都回到普通待机，同一个不会连着播', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const played = simulate({ minutes: 10, seed })
    const extras = played.filter((x) => x !== 'idle')
    assert.ok(extras.length >= 1 && extras.length <= 3, `seed ${seed}：10 分钟里播了 ${extras.length} 次：${played.join(' → ')}`)
    // 小动作和普通待机交替：两个小动作中间一定有普通待机
    for (let i = 1; i < played.length; i++) assert.notEqual(played[i] === 'idle', played[i - 1] === 'idle', `seed ${seed}：${played.join(' → ')}`)
    for (let i = 1; i < extras.length; i++) assert.notEqual(extras[i], extras[i - 1], `seed ${seed}：连着播了 ${extras[i]}`)
  }
})

test('间隔很短（设置成 1 分钟）也不会连着播同一个；主人忙的时候不播', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const extras = simulate({ minutes: 10, every: [1, 1], seed }).filter((x) => x !== 'idle')
    assert.ok(extras.length >= 8)
    for (let i = 1; i < extras.length; i++) assert.notEqual(extras[i], extras[i - 1])
  }
  const busy = simulate({ minutes: 10, every: [1, 1], busyAt: () => true })
  assert.deepEqual(busy, ['idle'])
})
