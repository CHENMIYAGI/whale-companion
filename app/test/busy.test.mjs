// 忙碌感知：手动 / 全屏 / 离开；忙时攒话、忙完合成一个气泡；聊天上下文；全屏检测助手
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createBusy, releaseBubble, IDLE_AWAY_SEC } from '../src/main/core/busy.js'
import { startFullscreenWatch, parseStates } from '../src/main/core/fullscreen-watch.js'
import { trayTemplate } from '../src/main/core/tray-menu.js'

function world(over = {}) {
  const w = { t: new Date(2026, 9, 28, 14, 0).getTime(), idle: 0, fs: false, settings: { manual: true, fullscreen: true }, ...over }
  const busy = createBusy({ now: () => w.t, idleSec: () => w.idle, fullscreen: () => w.fs, settings: () => w.settings, manual: over.manual })
  return { w, busy }
}

test('手动：30 分钟到点自己结束；直到我说要手动关；off 立刻不忙', () => {
  const { w, busy } = world()
  assert.equal(busy.evaluate().busy, false)
  assert.deepEqual(busy.setManual('30m'), { until: w.t + 30 * 60_000 })
  assert.deepEqual(busy.evaluate().reasons, ['manual'])
  w.t += 29 * 60_000; assert.equal(busy.evaluate().busy, true)
  w.t += 2 * 60_000; assert.equal(busy.evaluate().busy, false)
  assert.deepEqual(busy.setManual('until'), { until: null })
  w.t += 10 * 3600_000; assert.equal(busy.evaluate().busy, true)
  assert.equal(busy.setManual('off'), null); assert.equal(busy.evaluate().busy, false)
  assert.throws(() => busy.setManual('2h'))
})

test('重启后接着算：配置里存的「直到我说」还在', () => {
  const { busy } = world({ manual: { until: null } })
  assert.deepEqual(busy.evaluate().reasons, ['manual'])
  assert.deepEqual(busy.manual(), { until: null })
})

test('全屏、离开 10 分钟；设置里关掉的不算', () => {
  const { w, busy } = world()
  w.fs = true; assert.deepEqual(busy.evaluate().reasons, ['fullscreen'])
  w.settings = { manual: true, fullscreen: false }; assert.equal(busy.evaluate().busy, false)
  busy.setManual('1h'); w.settings = { manual: false, fullscreen: false }; assert.equal(busy.evaluate().busy, false, '手动关了，正在的也不算')
  w.idle = IDLE_AWAY_SEC - 1; assert.equal(busy.evaluate().busy, false)
  w.idle = IDLE_AWAY_SEC; assert.deepEqual(busy.evaluate().reasons, ['away'], '离开一直算，没有开关')
})

test('忙的时候攒话；不忙了一次交出来，合成一个气泡', () => {
  const { w, busy } = world()
  assert.equal(busy.hold('平时的话'), false, '不忙不攒')
  w.fs = true; busy.evaluate()
  assert.equal(busy.hold('刷到一只猫'), true); assert.equal(busy.hold('还有一个咖啡豆的视频，弹幕吵起来了，特别好笑'), true)
  w.fs = false
  const r = busy.evaluate()
  assert.deepEqual(r.released.held.map((h) => h.text), ['刷到一只猫', '还有一个咖啡豆的视频，弹幕吵起来了，特别好笑'])
  assert.equal(releaseBubble(r.released), '忙完啦？刚才攒了 2 句想说：刷到一只猫（点我看全部）')
  assert.equal(busy.evaluate().released, null, '只交一次')
  assert.deepEqual(busy.held(), [])
})

test('合成的气泡：一句直接说；离开回来说「回来啦」；没攒话不冒', () => {
  assert.equal(releaseBubble({ reasons: ['manual'], held: [{ text: '我刷完啦' }] }), '忙完啦？刚才我刷完啦')
  assert.equal(releaseBubble({ reasons: ['away'], held: [{ text: '我刷完啦' }] }), '回来啦？刚才我刷完啦')
  assert.equal(releaseBubble({ reasons: ['away'], held: [] }), null)
  assert.ok([...releaseBubble({ reasons: ['manual'], held: [{ text: '长'.repeat(300) }] })].length <= 120)
})

test('聊天上下文：现在在忙 / 刚才忙过（30 分钟内，说清楚攒了什么）/ 过了就不提', () => {
  const { w, busy } = world()
  assert.equal(busy.contextLine(), '')
  busy.setManual('until'); busy.evaluate()
  assert.match(busy.contextLine(), /^［主人现在在忙］主人说他在忙（从 14:00 起）。他要是来找你，回得简短些/)
  busy.hold('刷到一只猫')
  w.t += 20 * 60_000; busy.setManual('off'); busy.evaluate()
  assert.match(busy.contextLine(), /^［刚才］14:00–14:20 主人说他在忙，所以你没出声。那会儿你攒着没说的话[\s\S]*「刷到一只猫」/)
  w.t += 31 * 60_000
  assert.equal(busy.contextLine(), '')
})

function fakeSpawn() {
  const children = []
  const spawnImpl = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => { c.killed = true }; children.push(c); return c }
  return { children, spawnImpl }
}

test('全屏检测助手：读 STATE 行；2/3/4 算全屏；挂了会重起；别的系统不起', async () => {
  assert.equal(parseStates('STATE 5\r\nSTATE 2\r\n'), 2); assert.equal(parseStates('垃圾'), null)
  const { children, spawnImpl } = fakeSpawn()
  const changes = [], logs = []
  const w = startFullscreenWatch({ platform: 'win32', spawnImpl, onChange: (v) => changes.push(v), log: (...a) => logs.push(a.join(' ')) })
  assert.equal(w.isFullscreen(), false)
  children[0].stdout.emit('data', Buffer.from('STATE 5\n')); assert.equal(w.isFullscreen(), false)
  children[0].stdout.emit('data', Buffer.from('STATE 2\n')); assert.equal(w.isFullscreen(), true)
  children[0].stdout.emit('data', Buffer.from('STATE 3\n')); assert.equal(w.isFullscreen(), true)
  children[0].stdout.emit('data', Buffer.from('STATE 5\n'))
  assert.deepEqual(changes, [true, false], '只在变的时候通知')
  children[0].emit('exit', 1)
  assert.equal(w.isFullscreen(), false, '挂了当不全屏'); assert.match(logs[0], /退出了.*秒后重起/)
  w.stop()
  const other = startFullscreenWatch({ platform: 'linux', spawnImpl })
  assert.equal(other.isFullscreen(), false); assert.equal(children.length, 1, 'Linux 不起助手')
})

test('真的助手（Windows）：报出状态；盯着的进程没了就自己退出，不留孤儿', { skip: process.platform !== 'win32', timeout: 40000 }, async () => {
  const { spawn } = await import('node:child_process')
  const { helperCommand } = await import('../src/main/core/fullscreen-watch.js')
  // 一个 2 秒后自己结束的进程，当作"桌宠"
  const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'])
  const [exe, args] = helperCommand(parent.pid)
  const helper = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  helper.stdout.on('data', (b) => { out += b })
  const exited = new Promise((r) => helper.on('exit', () => r(Date.now())))
  const parentGone = await new Promise((r) => parent.on('exit', () => r(Date.now())))
  const t = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 15000))])
  if (t === null) helper.kill()
  assert.match(out, /STATE \d+/, '助手报了状态')
  assert.ok(t !== null, '「桌宠」没了 15 秒内助手要自己退')
  assert.ok(t - parentGone < 12000, `退得够快（${t - parentGone}ms）`)
})

test('托盘：不忙时「我在忙」子菜单；忙时「不忙了（还剩…）」；设置关了不显示', () => {
  const calls = []
  const act = { chat() {}, togglePet() {}, quit() {}, busy: (m) => calls.push(m) }
  const idle = trayTemplate({ name: '小鲸', petVisible: true, busy: { left: null }, act })
  const sub = idle.find((i) => i.label === '我在忙').submenu
  assert.deepEqual(sub.map((i) => i.label), ['30 分钟', '1 小时', '直到我说'])
  for (const i of sub) i.click()
  const on = trayTemplate({ name: '小鲸', petVisible: true, busy: { left: '还剩 20 分钟' }, act })
  on.find((i) => i.label === '不忙了（还剩 20 分钟）').click()
  assert.deepEqual(calls, ['30m', '1h', 'until', 'off'])
  assert.deepEqual(trayTemplate({ name: '小鲸', petVisible: true, busy: null, act }).map((i) => i.label ?? '—'), ['和她聊天', '隐藏小鲸', '—', '退出'])
})
