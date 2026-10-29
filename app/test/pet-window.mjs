// 只打开桌宠窗口（真实的 preload 和 renderer），模拟主进程发状态/气泡、模拟鼠标，打印主进程收到的消息并截图
//
// 用法（在 app/ 目录下）：
//   npx electron test/pet-window.mjs              Windows / macOS
//   xvfb-run -a npx electron --no-sandbox test/pet-window.mjs     Linux 无屏幕环境
// 截图存在 app/test/out/，背景透明（PNG）。
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const OUT = path.join(HERE, 'out')
fs.mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const got = []
for (const ch of ['pet:click', 'pet:bubble-click', 'pet:menu', 'pet:drag-start', 'pet:drag-move', 'pet:drag-end', 'pet:interactive'])
  ipcMain.on(ch, (e, v) => got.push(ch.replace('pet:', '') + (v === undefined ? '' : `(${v})`)))
const fold = (arr) => { const out = []; for (const a of arr) { const l = out.at(-1); if (l?.name === a) l.n++; else out.push({ name: a, n: 1 }) } return out.map((o) => (o.n > 1 ? `${o.name}×${o.n}` : o.name)).join(' → ') || '（什么都没收到）' }

const WX = 300, WY = 200
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 300, height: 340, x: WX, y: WY, transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(SRC, 'preload/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message) })
  win.webContents.on('preload-error', (e, p, err) => errors.push('preload: ' + err.message))
  await win.loadFile(path.join(SRC, 'renderer/pet.html'))
  await wait(300)
  const shot = async (name) => { await wait(250); fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
  const js = (code) => win.webContents.executeJavaScript(code)

  // 等桌宠换到某段动画（换动画要等视频加载），返回实际在播的名字
  const anim = () => js('document.body.dataset.anim ?? null')
  const waitAnim = async (want, ms = 3000) => { for (let t = 0; t < ms; t += 50) { const a = await anim(); if (want(a)) return a; await wait(50) } return await anim() }
  const ok = (b) => (b ? '✓' : '✗')
  const noAnim = await js(`document.body.classList.contains('no-anim')`)
  console.log('动画文件：' + (noAnim ? '缺了，退回 emoji（见 src/renderer/anim/README.md）' : '找到了'))

  console.log('\n【状态】截图：test/out/state-*.png')
  for (const [state, mood, label, expect] of [['idle', 'normal', '醒着', 'idle'], ['watching', 'normal', '正在刷 B 站', 'watching'],
    ['thinking', 'normal', '醒着', 'thinking'], ['talking', 'normal', '醒着', 'talking'], ['idle', 'faint', '有点累', 'faint'], ['unknown', 'normal', '没见过的状态', 'idle']]) {
    win.webContents.send('pet:state', { state, mood, label, online: true, unread: 0 })
    const a = noAnim ? null : await waitAnim((x) => x === expect)
    await shot('state-' + state + (mood === 'normal' ? '' : '-' + mood))
    if (!noAnim) console.log(`  ${(state + '/' + mood).padEnd(16)} 在播 ${a}  ${ok(a === expect)}`)
  }
  // talking 只播一次；状态变回 idle 时不打断（基础动画没变），这里先切去刷 B 站再回来，把它切回 idle 给后面用
  win.webContents.send('pet:state', { state: 'watching', mood: 'normal', label: '', online: true, unread: 0 })
  win.webContents.send('pet:state', { state: 'idle', mood: 'normal', label: '醒着', online: true, unread: 0 })
  if (!noAnim) await waitAnim((x) => x === 'idle')
  win.webContents.send('pet:state', { state: 'idle', mood: 'normal', label: '<img src=x onerror="document.body.dataset.pwned=1">', online: true, unread: 0 })
  await wait(200)
  console.log('  文字里的网页代码被执行了吗？' + ((await js('document.body.dataset.pwned')) ? '被执行了 ✗' : '没有 ✓'))

  if (!noAnim) {
    // 待机小动作：主进程随状态发来间隔（分钟）。这里给极短的 0.005 分钟（0.3 秒）好看结果，正常是 3–8 分钟
    console.log('\n【待机小动作】间隔跟着设置走，不连着两次一样')
    win.webContents.send('pet:state', { state: 'idle', mood: 'normal', label: '醒着', online: true, unread: 0, idleEvery: [0.005, 0.006] })
    const extras = []
    for (let t = 0; t < 12000; t += 100) { const a = await anim(); if (a?.startsWith('idle-') && extras.at(-1) !== a) extras.push(a); if (a === 'idle' && extras.at(-1) !== '|') extras.push('|'); await wait(100) }
    const played = extras.filter((x) => x !== '|')
    console.log(`  12 秒里播了：${played.join(' → ') || '（没有）'}  ${ok(played.length >= 2)}`)
    console.log(`  没有连着两次一样：${ok(played.every((x, i) => i === 0 || x !== played[i - 1]))}`)
    win.webContents.send('pet:state', { state: 'idle', mood: 'normal', label: '醒着', online: true, unread: 0, idleEvery: [3, 8] })
    await waitAnim((x) => x === 'idle', 11000)
  }

  if (!noAnim) {
    console.log('\n【睡觉】入睡 → 一直熟睡 → 等这一轮播完再醒来。截图：test/out/sleep-*.png')
    const st = (state) => win.webContents.send('pet:state', { state, mood: 'normal', label: state === 'sleep' ? '在睡觉' : '醒着', online: true, unread: 0 })
    const time = () => js(`document.querySelector('.anim.front')?.currentTime ?? -1`)
    const waitTime = async (want, ms = 5000) => { for (let t = 0; t < ms; t += 20) { if (want(await time())) return true; await wait(20) } return false }
    // 记下接下来 ms 毫秒里依次播过哪些动画
    const trace = async (ms) => { const seen = []; for (let t = 0; t < ms; t += 50) { const a = await anim(); if (seen.at(-1) !== a) seen.push(a); await wait(50) } return seen }

    st('sleep')
    let a = await waitAnim((x) => x === 'sleep-in'); await wait(800); await shot('sleep-in')
    console.log(`  进入睡觉：${a}  ${ok(a === 'sleep-in')}`)
    a = await waitAnim((x) => x === 'sleep-loop', 6000)
    console.log(`  入睡播完：${a}  ${ok(a === 'sleep-loop')}`)
    // 循环接缝前后各截一张（循环段 1.92 秒）
    await waitTime((t) => t > 1.6 && t < 1.8); await shot('sleep-seam-before')
    const before = await time()
    await waitTime((t) => t > 0 && t < 0.25); await shot('sleep-seam-after')
    console.log(`  接缝：${before.toFixed(2)}s → ${(await time()).toFixed(2)}s，还在 ${await anim()}  ${ok((await anim()) === 'sleep-loop')}`)
    const seen = await trace(5000)
    console.log(`  再看 5 秒：${seen.join(' → ')}  ${ok(seen.length === 1 && seen[0] === 'sleep-loop')}（一直睡着，不会醒）`)

    st('idle')
    const left = 1.92 - (await time())
    const order = await trace(left * 1000 + 4500)
    console.log(`  不睡了（这一轮还剩 ${left.toFixed(1)}s）：${order.join(' → ')}  ${ok(order.join() === 'sleep-loop,sleep-out,idle')}`)

    st('sleep'); await waitAnim((x) => x === 'sleep-in'); await wait(1000)
    st('idle')
    const order2 = await trace(8500)
    console.log(`  入睡到一半就不睡了：${order2.join(' → ')}  ${ok(order2.join() === 'sleep-in,sleep-out,idle')}（入睡播完直接醒来）`)

    st('sleep'); await waitAnim((x) => x === 'sleep-loop', 7000)
    await waitTime((t) => t < 0.5); st('idle'); await wait(300); st('sleep')
    const order3 = await trace(3000)
    console.log(`  要醒又接着睡：${order3.join(' → ')}  ${ok(order3.join() === 'sleep-loop')}（不醒来，接着循环）`)
    await waitTime((t) => t > 1.0); await shot('sleep-loop')

    st('idle'); await waitAnim((x) => x === 'sleep-out', 3000); await wait(1500); await shot('sleep-out')
    await waitAnim((x) => x === 'idle', 4000)
  }

  console.log('\n【气泡】截图：test/out/bubble-*.png')
  win.webContents.send('pet:bubble', { text: '刷完啦！' }); await shot('bubble-short')
  win.webContents.send('pet:bubble', { text: '今天刷到一个讲咖啡豆的视频，UP 主说埃塞俄比亚日晒豆果香最明显，弹幕好多人吵起来了说太酸，我觉得两边都有道理哈哈哈，你喝咖啡吗？' }); await shot('bubble-long')

  console.log('\n【鼠标】（窗口不会真的跟着拖动）')
  const rect = async (id) => JSON.parse(await js(`JSON.stringify(document.getElementById('${id}')?.getBoundingClientRect() ?? null)`))
  const ev = (type, x, y, button = 'left') => win.webContents.sendInputEvent({ type, x, y, globalX: WX + x, globalY: WY + y, button, clickCount: 1 })
  const moveTo = async (to, from, steps = 4) => { for (let i = 1; i <= steps; i++) { ev('mouseMove', Math.round(from[0] + (to[0] - from[0]) * i / steps), Math.round(from[1] + (to[1] - from[1]) * i / steps)); await wait(15) } }
  const run = async (title, fn) => { got.length = 0; await fn(); await wait(150); console.log(`  ${title}\n     主进程收到：${fold(got)}`) }
  const w = await rect('whale')
  if (!w) { console.log('  找不到 #whale，跳过'); } else {
    const c = [Math.round(w.x + w.width / 2), Math.round(w.y + w.height / 2)]
    win.webContents.send('pet:bubble', { text: '' }); await js(`document.getElementById('bubble') && (document.getElementById('bubble').hidden = true)`)
    ev('mouseMove', 5, 5); await wait(50)
    const click = async () => { ev('mouseDown', ...c); await wait(30); ev('mouseUp', ...c) }
    const frontTime = () => js(`document.querySelector('.anim.front')?.currentTime ?? -1`)
    const setChat = (open) => win.webContents.send('pet:state', { state: 'idle', mood: 'normal', label: '醒着', online: true, unread: 0, chatOpen: open })
    await run('对话框关着，移到她身上点一下', async () => { await moveTo(c, [5, 5]); await click() })
    if (!noAnim) {
      const a = await waitAnim((x) => x === 'talking'); console.log(`     动画：${a}  ${ok(a === 'talking')}（要打开对话框，挥手）`)
      await wait(800); const t0 = await frontTime(); await click(); await wait(300)
      const a2 = await anim(), t1 = await frontTime()
      console.log(`     没播完又点：${a2}，进度 ${t0.toFixed(1)}s → ${t1.toFixed(1)}s  ${ok(a2 === 'talking' && t0 > 0 && t1 > t0)}（不从头开始）`)
      // 状态变了会打断挥手；切去刷 B 站再回来，模拟对话框开着、她在待机
      win.webContents.send('pet:state', { state: 'watching', mood: 'normal', label: '正在刷 B 站', online: true, unread: 0, chatOpen: true }); await waitAnim((x) => x === 'watching')
      setChat(true); await waitAnim((x) => x === 'idle')
    }
    await run('对话框开着，点一下', click)
    if (!noAnim) {
      const a = await waitAnim((x) => x?.startsWith('click-')); await shot('click'); console.log(`     动画：${a}  ${ok(a?.startsWith('click-'))}（截图 click.png）`)
      await wait(800); const t0 = await frontTime(); await click(); await wait(300)
      const a2 = await anim(), t1 = await frontTime()
      console.log(`     没播完又点：${a2}，进度 ${t0.toFixed(1)}s → ${t1.toFixed(1)}s  ${ok(a2 === a && t0 > 0 && t1 > t0)}（不从头开始）`)
      setChat(false); await wait(300)
      console.log(`     关上对话框：${await anim()}  ${ok((await anim()) === a)}（不另外播东西，让回应播完）`)
    }
    await run('拖 30 像素', async () => {
      ev('mouseDown', ...c); await moveTo([c[0] + 30, c[1]], c, 6)
      if (!noAnim) { const a = await waitAnim((x) => x === 'drag'); await shot('drag'); console.log(`     拖动中动画：${a}  ${ok(a === 'drag')}（截图 drag.png）`) }
      ev('mouseUp', c[0] + 30, c[1]); await moveTo(c, [c[0] + 30, c[1]], 2)
    })
    if (!noAnim) { const a = await waitAnim((x) => x === 'idle'); console.log(`     松手后动画：${a}  ${ok(a === 'idle')}`) }
    // 透明的地方：人物左右两边（视频里有画面但不是身体）不该让窗口接收鼠标
    await run('移到人物左边的空白处', async () => { await moveTo([30, c[1]], c) })
    await moveTo(c, [30, c[1]])
    await run('手抖 2 像素', async () => { ev('mouseDown', ...c); await moveTo([c[0] + 2, c[1]], c, 2); ev('mouseUp', c[0] + 2, c[1]); await moveTo(c, [c[0] + 2, c[1]], 1) })
    await run('右键', async () => { ev('mouseDown', ...c, 'right'); await wait(30); ev('mouseUp', ...c, 'right') })
    await run('拖出范围再松开', async () => { ev('mouseDown', ...c); await moveTo([c[0] - 110, c[1] - 90], c, 8); ev('mouseUp', c[0] - 110, c[1] - 90) })
    await run('移开', async () => { await moveTo(c, [c[0] - 110, c[1] - 90]); await moveTo([5, 5], c) })
  }
  console.log('\n【入场 / 退出】截图：test/out/enter-*.png、goodbye-*.png')
  const opacity = () => js('getComputedStyle(document.body).opacity').then(Number)
  const videoAt = () => js(`(v => v ? v.currentTime : -1)(document.querySelector('.anim.front'))`)
  // 不入场（设置里关了）：一打开就是不透明的，没有淡入
  await win.loadFile(path.join(SRC, 'renderer/pet.html'), { query: { enter: '0' } }); await wait(60)
  console.log(`  不入场：一打开就看得见（透明度 ${await opacity()}）  ${ok((await opacity()) === 1)}`)
  // 入场：一开始完全透明，收到 pet:hello 才淡入，淡入完挥手 + 冒气泡
  await win.loadFile(path.join(SRC, 'renderer/pet.html'), { query: { enter: '1' } }); await wait(60)
  console.log(`  入场：没收到 hello 前是透明的（${await opacity()}）  ${ok((await opacity()) === 0)}`)
  win.webContents.send('pet:state', { state: 'idle', mood: 'normal', label: '醒着', online: true, unread: 0 })
  win.webContents.send('pet:hello', { text: '我来啦～' })
  await wait(400)
  const mid = await opacity()
  console.log(`  淡入中（0.4 秒）：透明度 ${mid.toFixed(2)}  ${ok(mid > 0.1 && mid < 0.95)}`)
  await shot('enter-fading')
  if (!noAnim) {
    const a = await waitAnim((x) => x === 'talking', 2500)
    await wait(300)
    const t = await videoAt()
    console.log(`  淡入完：挥手 ${a}，从第 ${t.toFixed(1)} 秒播（抬手那里）  ${ok(a === 'talking' && t >= 2)}`)
  }
  console.log(`  气泡：${await js(`document.getElementById('bubble').hidden ? '（没冒）' : document.getElementById('bubble').textContent`)}，透明度 ${await opacity()}`)
  await shot('enter-wave')
  // 退出：挥手 + 气泡 → 1.6 秒后淡出（0.6 秒）
  if (!noAnim) await waitAnim((x) => x === 'idle', 9000)
  const t0 = Date.now()
  win.webContents.send('pet:goodbye', { text: '拜拜～' })
  win.webContents.send('pet:state', { state: 'thinking', mood: 'normal', label: '', online: true, unread: 0 })   // 说再见时状态变了：不打断挥手
  if (!noAnim) { const a = await waitAnim((x) => x === 'talking'); console.log(`  退出：挥手 ${a}，状态变了也不换  ${ok(a === 'talking')}`) }
  await wait(1000 - (Date.now() - t0))
  console.log(`  1 秒时：还看得见（${await opacity()}），气泡「${await js(`document.getElementById('bubble').textContent`)}」`)
  await shot('goodbye-wave')
  await wait(2300 - (Date.now() - t0))
  console.log(`  2.3 秒时：淡出完了（透明度 ${await opacity()}）  ${ok((await opacity()) === 0)}，动画 ${await anim()}  ${ok((await anim()) === 'talking')}`)

  console.log('\n网页报错：' + (errors.length ? errors.join('; ') : '没有'))
  app.quit()
})
