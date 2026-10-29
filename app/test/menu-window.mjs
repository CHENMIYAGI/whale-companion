// 只开右键菜单窗口（真实的 preload 和 renderer），主进程是假的：发菜单内容、模拟键盘鼠标，打印网页发回来什么，并截图。
//
// 用法（在 app/ 目录下）：
//   npx electron test/menu-window.mjs
// 截图：test/out/menu.png（透明背景）、menu-on-bg.png（垫了背景，方便看阴影）
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const OUT = path.join(HERE, 'out')
fs.mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (b) => (b ? '✓' : '✗')
const MARGIN = 12

const got = []
for (const ch of ['menu:ready', 'menu:pick', 'menu:close']) ipcMain.on(ch, (e, v) => got.push([ch, v]))
const last = (ch) => got.filter((g) => g[0] === ch).at(-1)?.[1]

const XSS = '<img src=x onerror="document.body.dataset.pwned=1">'
const items = [
  { kind: 'item', id: 'chat', icon: '💬', label: '和她聊天', enabled: true },
  { kind: 'sep' },
  { kind: 'item', id: 'plugin:bili-whale/wake', icon: '📺', label: '随便去刷一会儿', enabled: false, hint: 'DSH 没开' },
  { kind: 'item', id: 'plugin:diary/open-diary', icon: '📖', label: '翻翻她的日记', enabled: true },
  { kind: 'item', id: 'plugin:memory/view', icon: '', label: '看看她的小本本', enabled: false, hint: '' },   // 旧写法插件：没图标、没原因
  { kind: 'item', id: 'plugin:x/evil', icon: '🧩', label: XSS, enabled: true },
  { kind: 'sep' },
  { kind: 'item', id: 'settings', icon: '⚙', label: '设置…', enabled: true },
  { kind: 'item', id: 'ontop', icon: '📌', label: '总在最前', enabled: true, toggle: true },
  { kind: 'sep' },
  { kind: 'item', id: 'quit', icon: '⏻', label: '退出', enabled: true, danger: true },
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 216 + 2 * MARGIN, height: 200, x: 400, y: 150, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(SRC, 'preload/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message) })
  win.webContents.on('preload-error', (e, p, err) => errors.push('preload: ' + err.message))
  await win.loadFile(path.join(SRC, 'renderer/menu.html'))
  await wait(300)
  const js = (code) => win.webContents.executeJavaScript(code)
  const key = async (keyCode) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await wait(60) }
  const activeLabel = () => js(`document.querySelector('.mi.active .label')?.textContent ?? '（没有）'`)
  const show = async () => {
    for (let i = got.length - 1; i >= 0; i--) if (got[i][0] === 'menu:ready') got.splice(i, 1)   // 清掉上一次的，等这一次画完
    win.webContents.send('menu:show', { name: '大肥鱼', status: 'DSH 没开（她现在出不了门）', items })
    for (let t = 0; t < 2000 && last('menu:ready') === undefined; t += 20) await wait(20)
    const h = last('menu:ready')
    win.setBounds({ x: 400, y: 150, width: 216 + 2 * MARGIN, height: Math.round(h) + 2 * MARGIN })
    await wait(150)
    return h
  }

  console.log('【显示】')
  const h = await show()
  console.log(`  画完报回来的高度：${Math.round(h)}px  ${ok(h > 200 && h < 600)}`)
  console.log(`  头部：${await js(`document.getElementById('name').textContent + ' / ' + document.getElementById('status').textContent`)}`)
  console.log(`  项数：${await js(`document.querySelectorAll('.mi').length`)}（应为 8），分隔线：${await js(`document.querySelectorAll('.sep').length`)}（应为 3）`)
  console.log(`  灰掉的项和原因：${await js(`[...document.querySelectorAll('.mi.dis')].map(r => r.querySelector('.label').textContent + '（' + r.querySelector('.hint').textContent + '）').join('、')`)}`)
  console.log(`  旧写法没图标的显示：${await js(`[...document.querySelectorAll('.mi')].find(r => r.textContent.includes('小本本')).querySelector('.ic').textContent`)}`)
  console.log(`  开关显示为开：${ok(await js(`!!document.querySelector('.tog.on')`))}`)
  console.log(`  文字里的网页代码被执行了吗？${(await js('document.body.dataset.pwned')) ? '被执行了 ✗' : '没有 ✓'}（原样显示：${ok((await js(`[...document.querySelectorAll('.label')].some(l => l.textContent.startsWith('<img'))`)))}）`)

  // 截图：透明的一张；再垫个背景截一张看阴影
  fs.writeFileSync(path.join(OUT, 'menu.png'), (await win.webContents.capturePage()).toPNG())
  await js(`document.body.style.background = 'linear-gradient(160deg,#7d9cc8,#d8e2ef)'`)
  await key('Down')   // 高亮第一项，截图里看得到高亮样式
  fs.writeFileSync(path.join(OUT, 'menu-on-bg.png'), (await win.webContents.capturePage()).toPNG())
  await js(`document.body.style.background = ''`)

  console.log('\n【键盘】')
  await show()
  const trail = []
  for (let i = 0; i < 7; i++) { await key('Down'); trail.push(await activeLabel()) }   // 能点的有 6 项，第 7 下应绕回第一个
  console.log(`  ↓×7：${trail.join(' → ')}`)
  console.log(`  跳过了灰掉的项：${ok(!trail.some((t) => t.includes('随便去刷') || t.includes('小本本')))}，走到头绕回第一个：${ok(trail[6] === '和她聊天')}`)
  await show()
  await key('Up')
  console.log(`  一开始按 ↑ 选到最后一个：${await activeLabel()}  ${ok((await activeLabel()) === '退出')}`)
  await key('Up'); await key('Return')
  console.log(`  ↑ 再 Enter 发过去：${last('menu:pick')}  ${ok(last('menu:pick') === 'ontop')}`)
  got.length = 0
  await key('Escape')
  console.log(`  Esc：${ok(got.some((g) => g[0] === 'menu:close'))}`)

  console.log('\n【鼠标】')
  await show()
  got.length = 0
  await js(`[...document.querySelectorAll('.mi')].find(r => r.textContent.includes('随便去刷')).click()`); await wait(50)
  console.log(`  点灰掉的项：${got.some((g) => g[0] === 'menu:pick') ? '发出去了 ✗' : '没反应 ✓'}`)
  const r = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.mi')].find(r => r.textContent.includes('日记')).getBoundingClientRect())`))
  const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy }); await wait(60)
  console.log(`  鼠标移上去高亮：${await activeLabel()}`)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 }); await wait(60)
  console.log(`  点"翻翻她的日记"发过去：${last('menu:pick')}  ${ok(last('menu:pick') === 'plugin:diary/open-diary')}`)

  // 2026-10-27 的 bug：菜单用过一次（窗口隐藏过）之后，右键就再也弹不出来。
  // 原因是网页等 requestAnimationFrame 才回话，而隐藏的窗口浏览器不给画帧。
  // 这里另开一个和 main.js 里菜单窗口一样设置的窗口（不关 backgroundThrottling），显示 → 隐藏 → 等 3 秒 → 再叫它画
  console.log('\n【隐藏过之后还能再弹】')
  const real = new BrowserWindow({ width: 216 + 2 * MARGIN, height: 200, x: 700, y: 150, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(SRC, 'preload/preload.cjs'), contextIsolation: true, sandbox: true } })
  await real.loadFile(path.join(SRC, 'renderer/menu.html'))
  const readyWithin = async (ms) => {
    got.length = 0
    real.webContents.send('menu:show', { name: '大肥鱼', status: '醒着', items })
    for (let t = 0; t < ms; t += 20) { if (got.some((g) => g[0] === 'menu:ready')) return true; await wait(20) }
    return false
  }
  console.log(`  第一次：${ok(await readyWithin(1000))}`)
  real.show(); await wait(300); real.hide(); await wait(3000)
  console.log(`  隐藏 3 秒后：${ok(await readyWithin(1000))}`)
  real.destroy()

  console.log('\n网页报错：' + (errors.length ? errors.join('; ') : '没有'))
  app.quit()
})
