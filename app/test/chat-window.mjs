// 只开对话框窗口（真实的 preload 和 renderer），主进程是假的：回答各个通道、模拟流式回复/工具/确认卡片/DSH 消息，
// 打印网页发来了什么，并截图。
//
// 用法（在 app/ 目录下）：
//   npx electron test/chat-window.mjs              Windows / macOS
//   xvfb-run -a npx electron --no-sandbox test/chat-window.mjs     Linux 无屏幕环境
// 截图存在 app/test/out/chat-*.png
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathsFor } from '../src/main/core/paths.js'
import { addToLibrary, readLibrary } from '../src/main/core/stickers.js'
import { stickerResponse } from '../src/main/core/sticker-files.js'
import { listMine, addToMine, saveReceived } from '../src/main/core/my-stickers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const OUT = path.join(HERE, 'out')
fs.mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (b) => (b ? '✓' : '✗')

// ── 假的表情包库：有真库（~/.whale-companion/stickers）就拿一张真图，没有就用一张 1×1 的 png ──
const stickerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-window-'))
const stickerPaths = pathsFor(stickerRoot)
const realLib = path.join(os.homedir(), '.whale-companion', 'stickers')
const real = readLibrary(realLib).stickers.find((x) => x.name === '吃白饭的大肥鱼') ?? readLibrary(realLib).stickers[0]
const TINY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const img = real ? fs.readFileSync(path.join(realLib, real.file)) : TINY
const SID = addToLibrary(stickerPaths.stickers, img, { name: '吃白饭的大肥鱼' }).sticker.id
fs.mkdirSync(stickerPaths.avatars, { recursive: true })
fs.writeFileSync(path.join(stickerPaths.avatars, 'thinking.png'), img)
// 主人的收藏里先放两张（真库里有就用真图）
const realAll = readLibrary(realLib).stickers.slice(1, 3)
for (const [i, x] of realAll.entries()) addToMine(stickerPaths.myStickers, fs.readFileSync(path.join(realLib, x.file)), x.name)
if (!realAll.length) addToMine(stickerPaths.myStickers, TINY, '小图')
protocol.registerSchemesAsPrivileged([{ scheme: 'sticker', privileges: { standard: true, secure: true } }])

// ── 假主进程 ──
const got = []   // 网页发来的 [通道, 参数]
const XSS = '<img src=x onerror="document.body.dataset.pwned=1">'
let settings = { baseUrl: 'https://api.deepseek.com', model: '', hasKey: false, encrypted: true,
  plugins: [{ id: 'persona', name: '人设', version: '1.0', state: 'ok' }, { id: 'memory', name: '小本本', state: 'failed', error: '语法错误' }],
  pluginDir: 'C:\\Users\\you\\.whale-companion\\plugins', sharedDir: '', busy: { manual: true, fullscreen: false }, idleEvery: [3, 8] }
let sendResult = { ok: true }
const answers = {
  'chat:init': () => ({
    name: '大肥鱼',
    history: [
      { id: 'h1', at: '2026-10-26T10:00:00Z', role: 'user', text: '早上好' },
      { id: 'h2', at: '2026-10-26T10:00:05Z', role: 'assistant', text: '早呀主人～今天想聊什么？' },
      { id: 'h3', at: '2026-10-26T11:20:00Z', role: 'assistant', source: 'dsh', kind: 'watch', bv: 'BV1xx411c7mD', text: '看完啦！这个视频讲咖啡豆，弹幕好热闹。' },
      { id: 'h4', at: '2026-10-26T11:30:00Z', role: 'assistant', text: XSS },
    ],
    status: { state: 'idle', mood: 'normal', label: 'DSH 没开', online: false, unread: 0 },
    needsSetup: true, busy: false, avatars: ['thinking'],
  }),
  'chat:send': () => sendResult,
  'chat:abort': () => true, 'chat:confirm': () => true, 'chat:hide': () => true, 'open:video': () => true, 'open:deepseek': () => true, 'dsh:pause': () => ({ ok: true }), 'settings:busy': () => ({ ok: true }), 'settings:pet': (a) => (a.idleExtraMin <= a.idleExtraMax ? { ok: true } : { ok: false, error: '最少不能比最多大' }),
  'settings:get': () => settings,
  'sticker:mine': () => listMine(stickerPaths.myStickers).map(({ box, id, name }) => ({ box, id, name })),
  'sticker:import': (a) => { const r = saveReceived(stickerPaths.received, Buffer.from(a.bytes), a.name); return r.ok ? { ok: true, sticker: { box: r.sticker.box, id: r.sticker.id, name: r.sticker.name }, inMine: false } : r },
  'sticker:favorite': () => ({ ok: true }),
  'sticker:open-folder': () => true,
  'settings:models': (a) => (a.apiKey || settings.hasKey ? { ok: true, models: ['deepseek-chat', 'deepseek-reasoner'] } : { ok: false, error: '先填 API key' }),
  'settings:save': (a) => { settings = { ...settings, baseUrl: a.baseUrl, model: a.model, hasKey: settings.hasKey || !!a.apiKey }; return { ok: true } },
}
for (const [ch, fn] of Object.entries(answers)) ipcMain.handle(ch, (e, a) => { got.push([ch, a]); return fn(a) })
const sentOn = (ch) => got.filter((g) => g[0] === ch)

app.whenReady().then(async () => {
  protocol.handle('sticker', (req) => { const r = stickerResponse(req.url, stickerPaths); return r.status === 200 ? new Response(r.body, { headers: { 'content-type': r.type } }) : new Response(null, { status: 404 }) })
  const win = new BrowserWindow({ width: 380, height: 560, x: 300, y: 100, frame: false, backgroundColor: '#fbfaf6',
    webPreferences: { preload: path.join(SRC, 'preload/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message) })
  win.webContents.on('preload-error', (e, p, err) => errors.push('preload: ' + err.message))
  await win.loadFile(path.join(SRC, 'renderer/chat.html'))
  await wait(400)
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => { await wait(200); fs.writeFileSync(path.join(OUT, 'chat-' + name + '.png'), (await win.webContents.capturePage()).toPNG()) }
  const event = (ev) => win.webContents.send('chat:event', ev)
  const status = (state, label = '醒着') => win.webContents.send('chat:status', { state, mood: 'normal', label, online: true, unread: 0 })
  // 看真正显示出来没有（只看 hidden 属性不够：CSS 的 display 会盖掉它）
  const visible = (id) => js(`getComputedStyle(document.getElementById('${id}')).display !== 'none'`)
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`)
  const type = async (text) => { await js(`document.getElementById('input').focus()`); win.webContents.insertText(text); await wait(50) }
  const enter = async (shift = false) => { for (const type of ['keyDown', 'char', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter', modifiers: shift ? ['shift'] : [] }); await wait(100) }

  console.log('【打开】需要设置时先显示设置面板')
  console.log(`  设置面板显示了吗：${ok(await visible('settings'))}`)
  console.log(`  key 输入框提示：${await js(`document.getElementById('setKey').placeholder`)}`)
  await shot('settings')

  console.log('\n【设置】')
  await click('#btnModels'); await wait(150)
  console.log(`  没填 key 就获取：${await js(`document.getElementById('setMsg').textContent`)}`)
  await js(`document.getElementById('setKey').value = 'sk-test-123'`)
  await click('#btnModels'); await wait(150)
  console.log(`  填了 key 再获取：${await js(`document.getElementById('setMsg').textContent`)}，下拉 ${await js(`[...document.getElementById('setModel').options].map(o => o.value).join(', ')`)}`)
  await js(`document.getElementById('setModel').value = 'deepseek-chat'`)
  await click('#btnSave'); await wait(900)
  const saved = sentOn('settings:save').at(-1)?.[1]
  console.log(`  保存发过去：${JSON.stringify(saved)}  ${ok(saved?.model === 'deepseek-chat' && saved?.apiKey === 'sk-test-123')}`)
  console.log(`  保存后设置面板关了吗：${ok(!(await visible('settings')))}`)
  await js(`document.getElementById('btnSettings').click()`); await wait(150)
  console.log(`  再打开设置，key 提示：${await js(`document.getElementById('setKey').placeholder`)}，模型 ${await js(`document.getElementById('setModel').value`)}`)
  await click('#btnBack'); await wait(100)

  console.log('\n【历史】')
  console.log(`  气泡数：${await js(`document.querySelectorAll('.msg').length`)}（应为 4）`)
  console.log(`  DSH 消息有标记和"打开视频"吗：${ok(await js(`!!document.querySelector('.msg.dsh .tag') && !!document.querySelector('.msg.dsh button')`))}`)
  await click('.msg.dsh button'); await wait(100)
  console.log(`  点"打开视频"发过去：${JSON.stringify(sentOn('open:video').at(-1)?.[1])}`)
  console.log(`  文字里的网页代码被执行了吗？${(await js('document.body.dataset.pwned')) ? '被执行了 ✗' : '没有 ✓'}`)

  console.log('\n【发消息 + 流式回复 + 工具提示】')
  await type('帮我记一下：我不吃香菜'); await enter(true); await type('谢谢')
  console.log(`  Shift+Enter 换行了没发：${ok(sentOn('chat:send').length === 0 && (await js(`document.getElementById('input').value`)).includes('\n'))}`)
  await enter()
  console.log(`  Enter 发出去：${JSON.stringify(sentOn('chat:send').at(-1)?.[1])}，输入框清空：${ok((await js(`document.getElementById('input').value`)) === '')}`)
  status('thinking')
  event({ type: 'start', id: 'r1' }); await wait(50)
  await shot('thinking')
  console.log(`  生成中显示"停止"：${ok((await visible('btnStop')) && !(await visible('btnSend')))}`)
  event({ type: 'tool', id: 'r1', name: 'remember', state: 'running', label: '记在小本本上' }); await wait(50)
  event({ type: 'tool', id: 'r1', name: 'remember', state: 'done', label: '记在小本本上' })
  for (const piece of ['好嘞', '，记下了！', '以后点菜', '都帮你避开香菜～', XSS]) { event({ type: 'delta', id: 'r1', text: piece }); await wait(60) }
  await shot('streaming')
  event({ type: 'end', id: 'r1', message: { id: 'm1', role: 'assistant', text: '好嘞，记下了！以后点菜都帮你避开香菜～' } })
  status('talking')
  await wait(100)
  console.log(`  最终文字：${await js(`[...document.querySelectorAll('.msg.her .text')].at(-1).textContent`)}`)
  console.log(`  工具提示：${await js(`[...document.querySelectorAll('.tools')].at(-1).textContent`)}`)
  console.log(`  结束后恢复"发送"：${ok((await visible('btnSend')) && !(await visible('btnStop')))}`)

  console.log('\n【确认卡片】')
  event({ type: 'confirm', card: { id: 'c1', title: '现在去看 BV1xx411c7mD？', text: '看完会回到这里告诉你她的想法（不会在 B 站发评论）。', okLabel: '去看', cancelLabel: '算了' } })
  event({ type: 'confirm', card: { id: 'c2', title: '随便去刷一会儿？', text: '', okLabel: '去吧', cancelLabel: '算了' } })
  await wait(100); await shot('confirm')
  await js(`document.querySelectorAll('.card')[0].querySelector('.primary').click()`); await wait(100)
  console.log(`  点"去看"发过去：${JSON.stringify(sentOn('chat:confirm').at(-1)?.[1])}`)
  event({ type: 'confirm-expired', id: 'c2' }); await wait(100)
  console.log(`  卡片结果：${await js(`[...document.querySelectorAll('.card .result')].map(e => e.textContent).join(' / ')`)}`)
  console.log(`  点过/过期后还有按钮吗：${(await js(`document.querySelectorAll('.card .row').length`)) ? '有 ✗' : '没有 ✓'}`)

  console.log('\n【她从 DSH 发回来的话】')
  event({ type: 'message', message: { id: 'd1', role: 'assistant', source: 'dsh', kind: 'wake-random', text: '刷到一只会弹钢琴的猫！' } })
  await wait(100)
  console.log(`  显示为 DSH 消息：${ok(await js(`[...document.querySelectorAll('.msg')].at(-1).classList.contains('dsh')`))}`)

  console.log('\n【停止 / 出错】')
  await type('讲个长故事'); await enter(); status('thinking')
  event({ type: 'start', id: 'r2' }); event({ type: 'delta', id: 'r2', text: '从前有一条鲸鱼' }); await wait(50)
  await click('#btnStop'); await wait(50)
  console.log(`  点"停止"发过去：${ok(sentOn('chat:abort').length === 1)}`)
  event({ type: 'end', id: 'r2', message: { text: '从前有一条鲸鱼' } }); event({ type: 'error', id: 'r2', error: '已停止' }); status('idle')
  await wait(100)
  console.log(`  说了一半的话留着：${await js(`[...document.querySelectorAll('.msg.her .text')].at(-1).textContent`)}，提示：${await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)}`)
  await type('在吗'); await enter(); status('thinking')
  event({ type: 'start', id: 'r3' }); event({ type: 'error', id: 'r3', error: 'API key 不对（或已失效），去设置里重新填一下' }); status('idle')
  await wait(100)
  console.log(`  一个字没说就出错：空气泡去掉了 ${ok(!(await js(`[...document.querySelectorAll('.msg.her')].some(b => b.querySelector('.text').textContent === '')`)))}，提示：${await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)}`)
  sendResult = { ok: false, error: '先填一下 API key 和模型' }
  const before = await js(`document.querySelectorAll('.msg.me').length`)
  await type('你好'); await enter(); await wait(100)
  console.log(`  没发出去：字还回输入框 ${ok((await js(`document.getElementById('input').value`)) === '你好')}，没多出主人的气泡 ${ok((await js(`document.querySelectorAll('.msg.me').length`)) === before)}`)
  event({ type: 'open-settings' }); await wait(150)
  console.log(`  主进程要求打开设置：${ok(await visible('settings'))}`)
  await shot('final-settings')
  await click('#btnBack'); await wait(100); await shot('final')

  console.log('\n【出门开关】')
  const pauseBtn = () => js(`(b => b.textContent + (b.classList.contains('offline') ? '（淡）' : '') + (b.disabled ? '（禁用）' : ''))(document.getElementById('btnPause'))`)
  win.webContents.send('chat:status', { state: 'idle', mood: 'normal', label: '醒着', online: true, paused: false, unread: 0 }); await wait(50)
  console.log(`  可以出门时：${await pauseBtn()}  ${ok((await pauseBtn()) === '🚪')}`)
  await click('#btnPause'); await wait(50)
  console.log(`  点一下发过去：${JSON.stringify(sentOn('dsh:pause').at(-1)?.[1])}  ${ok(sentOn('dsh:pause').at(-1)?.[1] === true)}（true = 让她休息）`)
  win.webContents.send('chat:status', { state: 'idle', mood: 'normal', label: '休息中，不出门', online: true, paused: true, unread: 0 }); await wait(50)
  console.log(`  休息中：${await pauseBtn()}，状态栏「${await js(`document.getElementById('status').textContent`)}」  ${ok((await pauseBtn()) === '🏠')}`)
  await shot('paused')
  await click('#btnPause'); await wait(50)
  console.log(`  再点发过去：${JSON.stringify(sentOn('dsh:pause').at(-1)?.[1])}  ${ok(sentOn('dsh:pause').at(-1)?.[1] === false)}`)
  win.webContents.send('chat:status', { state: 'idle', mood: 'normal', label: 'DSH 没开', online: false, paused: false, unread: 0 }); await wait(50)
  const n = sentOn('dsh:pause').length
  await click('#btnPause'); await wait(50)
  console.log(`  DSH 没开：${await pauseBtn()}，点了不发：${ok(sentOn('dsh:pause').length === n)}，说明原因：${ok((await js(`[...document.querySelectorAll('.note')].at(-1)?.textContent ?? ''`)).includes('DSH 没开'))}`)

  console.log('\n【忙完了：攒着的小提示补进对话框】')
  event({ type: 'held', reasons: ['fullscreen'], items: ['开关没拨成：DSH 没开', '「随便去刷一会儿」没去成'] }); await wait(100)
  console.log(`  提示：${await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)}  ${ok((await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)) === '你刚才在忙，她攒着的话：')}`)
  console.log(`  后面跟着她的两句：${ok((await js(`[...document.querySelectorAll('.msg.her .text')].slice(-2).map(e => e.textContent).join('|')`)) === '开关没拨成：DSH 没开|「随便去刷一会儿」没去成')}`)
  event({ type: 'held', reasons: ['away'], items: ['我刷完啦'] }); await wait(50)
  console.log(`  离开回来：${await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)}`)

  console.log('\n【设置：忙碌感知的开关】')
  await js(`document.getElementById('btnSettings').click()`); await wait(150)
  console.log(`  读出来的状态：手动 ${await js(`document.getElementById('setBusyManual').checked`)}，全屏 ${await js(`document.getElementById('setBusyFullscreen').checked`)}  ${ok((await js(`document.getElementById('setBusyManual').checked && !document.getElementById('setBusyFullscreen').checked`)))}`)
  await click('#setBusyFullscreen'); await wait(100)
  console.log(`  勾上全屏就发过去：${JSON.stringify(sentOn('settings:busy').at(-1)?.[1])}  ${ok(sentOn('settings:busy').at(-1)?.[1]?.fullscreen === true && sentOn('settings:busy').at(-1)?.[1]?.manual === true)}`)
  console.log(`  待机小动作间隔：${await js(`document.getElementById('setIdleMin').value + '–' + document.getElementById('setIdleMax').value`)} 分钟`)
  await js(`(() => { const b = document.getElementById('setIdleMax'); b.value = '10'; b.dispatchEvent(new Event('change')) })()`); await wait(100)
  console.log(`  改成 3–10 发过去：${JSON.stringify(sentOn('settings:pet').at(-1)?.[1])}  ${ok(sentOn('settings:pet').at(-1)?.[1]?.idleExtraMax === 10)}`)
  await js(`(() => { const b = document.getElementById('setIdleMin'); b.value = '20'; b.dispatchEvent(new Event('change')) })()`); await wait(100)
  console.log(`  最少比最多大：${await js(`document.getElementById('setMsg').textContent`)}  ${ok((await js(`document.getElementById('setMsg').className`)) === 'error')}`)
  await shot('busy-settings')
  await click('#btnBack'); await wait(100)

  console.log('\n【表情包】')
  const avatarSrc = () => js(`document.getElementById('avatar').getAttribute('src')`)
  status('thinking'); await wait(50)
  console.log(`  在想时标题栏换成「在想」的头像：${await avatarSrc()}  ${ok((await avatarSrc()) === 'sticker://avatar/thinking')}`)
  event({ type: 'start', id: 'r9' }); event({ type: 'delta', id: 'r9', text: '你骂我也没用～' })
  event({ type: 'sticker', id: 'r9', sticker: { box: 'her', id: SID, name: '吃白饭的大肥鱼' } })
  event({ type: 'end', id: 'r9', message: { text: '你骂我也没用～' } }); status('idle'); await wait(400)
  console.log(`  没有待机头像就用默认的：${await avatarSrc()}  ${ok((await avatarSrc()) === 'avatar.png')}`)
  const lastImg = () => js(`(i => i ? i.naturalWidth + 'px ' + i.alt : '没有图')([...document.querySelectorAll('img.sticker')].at(-1))`)
  console.log(`  她发的表情包显示出来了：${await lastImg()}  ${ok(/^[1-9]\d*px \[表情：吃白饭的大肥鱼\]$/.test(await lastImg()))}`)
  // 只发图不说话：空气泡拿掉
  const bubbles = await js(`document.querySelectorAll('.msg').length`)
  event({ type: 'start', id: 'r10' }); event({ type: 'sticker', id: 'r10', sticker: { box: 'her', id: SID, name: '吃白饭的大肥鱼' } }); event({ type: 'end', id: 'r10', message: null }); await wait(300)
  console.log(`  只发图不说话：只多了图那一个气泡 ${ok((await js(`document.querySelectorAll('.msg').length`)) === bubbles + 1)}`)
  // 取不到的图 / 不认识的地址：显示成一行字
  event({ type: 'message', message: { role: 'assistant', kind: 'sticker', text: '[表情：不见了]', meta: { sticker: { box: 'her', id: '0000000000000000', name: '不见了' } } } })
  event({ type: 'message', message: { role: 'assistant', kind: 'sticker', text: '[表情：外链]', meta: { sticker: { box: 'https://evil.example', id: 'x', name: '外链' } } } })
  await wait(400)
  console.log(`  取不到的图变成文字：${await js(`[...document.querySelectorAll('.msg .text')].slice(-2).map(e => e.textContent).join(' / ')`)}`)
  await shot('sticker')

  console.log('\n【主人发表情包】')
  sendResult = { ok: true }   // 前面「没发出去」那步改成了失败，这里改回来
  await js(`document.getElementById('input').value = ''`)
  status('idle'); await wait(50)
  await click('#btnStickers'); await wait(400)
  console.log(`  表情面板打开了：${ok(await visible('stickerPanel'))}，收藏里 ${await js(`document.querySelectorAll('#stickerGrid img').length`)} 张，图都加载出来了 ${ok(await js(`[...document.querySelectorAll('#stickerGrid img')].every(i => i.naturalWidth > 0)`))}`)
  await shot('sticker-panel')
  await type('看这个')
  await js(`document.querySelector('#stickerGrid button').click()`); await wait(200)
  const sent = sentOn('chat:send').at(-1)?.[1]
  console.log(`  点一张就发（输入框的字一起发）：${JSON.stringify(sent)}  ${ok(sent?.text === '看这个' && sent?.sticker?.box === 'mine' && /^[0-9a-f]{16}$/.test(sent?.sticker?.id))}`)
  console.log(`  发完面板收起来了：${ok(!(await visible('stickerPanel')))}`)
  status('idle'); await wait(50)
  // 模拟粘贴 / 拖进来的文件：直接调页面里的 sendFile
  await js(`sendFile(new File([Uint8Array.from(atob('${img.toString('base64')}'), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }), '')`)
  await wait(400)
  const sent2 = sentOn('chat:send').at(-1)?.[1]
  console.log(`  粘贴的图：先交给主进程检查（${ok(sentOn('sticker:import').length === 1)}），再发出去 ${ok(sent2?.sticker?.box === 'received')}，下面有「☆ 收藏」${ok(await js(`[...document.querySelectorAll('.msg.me button.small')].at(-1)?.textContent === '☆ 收藏'`))}`)
  await js(`[...document.querySelectorAll('.msg.me button.small')].at(-1).click()`); await wait(150)
  console.log(`  点了收藏：${await js(`[...document.querySelectorAll('.msg.me button.small')].at(-1).textContent`)}`)
  status('idle'); await wait(50)
  const imports = sentOn('sticker:import').length
  await js(`sendFile(new File(['<svg onload=alert(1)>'], 'x.svg', { type: 'image/svg+xml' }))`); await wait(150)
  console.log(`  svg 不收：${await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)}，没发给主进程 ${ok(sentOn('sticker:import').length === imports)}`)
  await js(`sendFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))`); await wait(150)
  console.log(`  太大的不收：${await js(`[...document.querySelectorAll('.note')].at(-1).textContent`)}`)
  await shot('sticker-sent')
  // 偷图：她问「这个能给我吗」，卡片里带着那张图
  event({ type: 'confirm', card: { id: 'c9', title: '这个能给我吗？', text: '她想要「image」这张表情包，给了以后她也会发。', okLabel: '给你', cancelLabel: '不给', image: { box: 'received', id: sent2.sticker.id, name: 'image' } } })
  await wait(400)
  console.log(`  「这个能给我吗」卡片带图：${ok(await js(`(i => !!i && i.naturalWidth > 0)(document.querySelector('.card:last-of-type img.sticker'))`))}`)
  await js(`[...document.querySelectorAll('.card')].at(-1).querySelector('.primary').click()`); await wait(100)
  console.log(`  点「给你」发过去：${JSON.stringify(sentOn('chat:confirm').at(-1)?.[1])}`)
  await shot('sticker-ask')

  console.log('\n【连发几条】')
  status('thinking')
  event({ type: 'start', id: 'm1' }); event({ type: 'delta', id: 'm1', text: '今天刷到一只猫' }); event({ type: 'end', id: 'm1', message: { text: '今天刷到一只猫' } })
  event({ type: 'start', id: 'm2' }); await wait(300)   // 第二条：气泡先开，空着 = 「正在输入」
  console.log(`  第二条在「正在输入」：${ok(await js(`(b => !!b && b.textContent === '' && getComputedStyle(b, '::after').content !== 'none')([...document.querySelectorAll('.msg.her .text')].at(-1))`))}`)
  await shot('multi-typing')
  event({ type: 'delta', id: 'm2', text: '它会弹钢琴！' }); event({ type: 'end', id: 'm2', message: { text: '它会弹钢琴！' } }); status('idle'); await wait(150)
  console.log(`  两条各一个气泡：${await js(`[...document.querySelectorAll('.msg.her .text')].slice(-2).map(e => e.textContent).join(' | ')`)}`)
  await shot('multi-done')

  console.log('\n【关闭】')
  await click('#btnClose'); await wait(50)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await wait(50)
  console.log(`  ✕ 和 Esc 各发一次 chat:hide：${ok(sentOn('chat:hide').length === 2)}`)
  console.log(`  文字里的网页代码被执行了吗？${(await js('document.body.dataset.pwned')) ? '被执行了 ✗' : '没有 ✓'}`)
  console.log(`  用了 innerHTML 吗：${fs.readFileSync(path.join(SRC, 'renderer/chat.js'), 'utf8').match(/\.innerHTML\s*=/) ? '用了 ✗' : '没有 ✓'}`)

  console.log('\n截图：test/out/chat-*.png')
  console.log('网页报错：' + (errors.length ? errors.join('; ') : '没有'))
  app.quit()
})
