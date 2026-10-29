/**
 * 桌宠主进程：两扇窗（桌宠 + 对话框）、插件、聊天引擎，以及它们之间的线。
 *
 * 安全约定：
 *   · 渲染进程全部 contextIsolation + sandbox，只能通过 preload 里白名单的通道说话
 *   · 每个 IPC 都检查是不是从我们自己的页面发来的，参数逐个校验
 *   · 只允许打开 bilibili.com 的视频页和 DeepSeek 官网；窗口里禁止跳转、禁止弹新窗
 */
import { app, BrowserWindow, ipcMain, screen, shell, safeStorage, Tray, Menu, powerMonitor, protocol } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { paths } from './core/paths.js'
import { readJson } from './core/files.js'
import { createConfig } from './core/config.js'
import { createChatLog } from './core/chat-log.js'
import { createBridgeClient } from './core/bridge-client.js'
import { createKv } from './core/kv.js'
import { createPluginHost } from './core/plugin-host.js'
import { createChat } from './core/chat.js'
import { listModels, explainError } from './core/llm.js'
import { placeMenu } from './core/menu-place.js'
import { placeChat } from './core/chat-place.js'
import { trayTemplate } from './core/tray-menu.js'
import { createBusy, releaseBubble } from './core/busy.js'
import { startFullscreenWatch } from './core/fullscreen-watch.js'
import { stickerResponse, avatarList } from './core/sticker-files.js'
import { listMine, addToMine, saveReceived, findMine } from './core/my-stickers.js'
import { sniffImage, STICKER_MAX_BYTES } from './core/stickers.js'
import { createVision, describeImage, DEFAULT_VISION_MODEL } from './core/vision.js'
import { HELLO_LINES, BYE_LINES, EXIT_TOTAL_MS, pickLine } from './core/greetings.js'
import { createHerSay } from './core/her-say.js'
import { createFollowUp, followUpNote } from './core/follow-up.js'
import { canSpeak, recordTry, proactiveNote, inQuietHours, PRESENT_SEC } from './core/proactive.js'
import { readDreams, appendDream, nightOf, memoryFragments, dreamPrompt, tidyDream, sleepTalk } from './core/dreams.js'
import { diaryTail } from './plugins/diary/index.js'
import { personaText } from './plugins/persona/index.js'

import persona from './plugins/persona/index.js'
import diary from './plugins/diary/index.js'
import biliWhale from './plugins/bili-whale/index.js'
import feedback from './plugins/feedback/index.js'
import selfPlugin from './plugins/self/index.js'
import ownerView from './plugins/owner-view/index.js'
import videoNotes from './plugins/video-notes/index.js'
import tastePlugin from './plugins/taste/index.js'
import stickersPlugin from './plugins/stickers/index.js'
import dreamsPlugin from './plugins/dreams/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDERER = path.join(HERE, '..', 'renderer')
const PRELOAD = path.join(HERE, '..', 'preload', 'preload.cjs')
const PET_W = 300  // 和 pet.css 里的视频大小、人物位置是一套，改一个要一起改
const PET_H = 340
// 她身体在桌宠窗口里的左右边缘（窗口两边是透明的），对话框贴着身体摆
const BODY_L = 83
const BODY_R = 216
// 右键菜单：菜单本身 216 宽；窗口透明，四周多留 12px 给阴影（和 menu.css 的 --margin 一样）
const MENU_W = 216
const MENU_MARGIN = 12
const BV_RE = /^BV[0-9A-Za-z]{10}$/

// 已经开着一个了（比如又双击了快捷方式）：那一个会收到 second-instance、自己打开对话框，这个立刻退出。
// 2026-10-27 修：以前用 app.quit() —— 它只是"开始退出"，下面的 whenReady 照样跑，插件全加载一遍、定时器也开了
const firstInstance = app.requestSingleInstanceLock()
if (!firstInstance) app.exit(0)

// 表情包和状态头像走 sticker://（见 core/sticker-files.js）：对话框只能按 id 取图，拿不到任意路径的文件。
// 必须在 ready 之前登记
protocol.registerSchemesAsPrivileged([{ scheme: 'sticker', privileges: { standard: true, secure: true } }])

// ── 日志：~/.whale-companion/companion.log（超过 1MB 就换新的）────────────────
fs.mkdirSync(paths.app, { recursive: true })
const LOG_FILE = path.join(paths.app, 'companion.log')
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  console.log(line)
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1')
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {}
}

let quitting = false
let petWin = null
let chatWin = null
let menuWin = null
let tray = null               // 任务栏右下角的托盘图标（留着引用，不然会被回收掉）
let host = null
let chat = null
let config = null
let chatLog = null
let herSay = null          // 她自己开口说的话怎么送（core/her-say.js）
let followUp = null        // 主人没回时她接着说（core/follow-up.js）
let vision = null          // 看图（core/vision.js）：主人发来的图看一次、按 hash 缓存

const bus = new EventEmitter()
bus.setMaxListeners(100)

// ── 桌宠状态：底色来自 bili-whale 插件，「在想」「在说」叠在上面 ─────────────────
const pet = { base: { state: 'idle', mood: 'normal', label: '连接中…', online: false }, thinking: false, talkingUntil: 0, unread: 0 }
function petView() {
  const state = pet.thinking ? 'thinking' : Date.now() < pet.talkingUntil ? 'talking' : pet.base.state
  // chatOpen：桌宠靠它决定点她时播挥手（要打开对话框）还是播点击回应（已经开着）
  const b = busy?.state() ?? { busy: false, reasons: [] }
  return { state, mood: pet.base.mood, label: pet.base.label, online: !!pet.base.online, paused: !!pet.base.paused, unread: pet.unread, chatOpen: !!chatWin?.isVisible(), busy: b.busy, busyReasons: b.reasons, idleEvery: idleEvery() }
}
// 待机小动作的间隔（分钟）：配置里读，坏值退回 3–8
function idleEvery() {
  const p = config?.get().pet ?? {}
  const min = Number(p.idleExtraMin), max = Number(p.idleExtraMax)
  return Number.isFinite(min) && Number.isFinite(max) && min >= 1 && max >= min && max <= 60 ? [min, max] : [3, 8]
}
function pushPet() {
  const v = petView()
  petWin?.webContents.send('pet:state', v)
  chatWin?.webContents.send('chat:status', v)
}
function talkFor(ms) { pet.talkingUntil = Date.now() + ms; pushPet(); setTimeout(pushPet, ms + 50) }

bus.on('pet:base', (d) => { pet.base = d; pushPet() })
bus.on('chat:busy', (busy) => { pet.thinking = busy; if (!busy) talkFor(2500); else pushPet() })
bus.on('pet:say', ({ text, unread = 0, kind }) => {
  const chatVisible = chatWin?.isVisible() && chatWin.isFocused()
  if (unread && !chatVisible) pet.unread += unread
  // 主人在忙：先攒着不冒（她从 DSH 发回来的话本来就进了聊天记录；别的插件的小提示另记，忙完补进对话框）
  if (busy?.hold(text)) {
    if (!kind) heldNotes.push(String(text))
    log('[忙碌] 攒着一句：', String(text).slice(0, 40))
    return
  }
  petWin?.webContents.send('pet:bubble', { text: String(text).slice(0, 120) })
  talkFor(4000)
})

// ── 忙碌感知（2026-10-28）：手动「我在忙」/ 前台全屏 / 离开 10 分钟 ─────────────────
let busy = null          // core/busy.js
let fsWatch = null       // 全屏检测助手（设置里关了就不起）
let heldNotes = []       // 忙的时候攒下的、不在聊天记录里的小提示（忙完补进对话框）

function syncFullscreenWatch() {
  const want = config.get().busy?.fullscreen !== false
  if (want && !fsWatch) fsWatch = startFullscreenWatch({ log, onChange: () => checkBusy() })
  if (!want && fsWatch) { fsWatch.stop(); fsWatch = null }
}

// ── 主动开口（core/proactive.js）：每分钟看一次条件，都满足才问她（问了才花钱）──────────
let proactiveStore = null   // state.json 里的 proactive 段：{ lastTriedAt, day, count, lastSpokeAt }
let proactiveRunning = false

async function checkProactive() {
  if (!chat || !herSay || leaving || proactiveRunning) return
  const now = Date.now()
  const rows = chatLog.recent(200)
  const lastChatAt = rows.length ? Date.parse(rows.at(-1).at) : 0
  const state = proactiveStore.get('state', null)
  const r = canSpeak({ now, settings: config.get().proactive, idleSec: powerMonitor.getSystemIdleTime(), holding: holdingTalk(), chatting: chat.busy(), lastChatAt, state })
  if (!r.ok) return
  proactiveRunning = true
  try {
    const last = state?.lastSpokeAt ? { at: state.lastSpokeAt, replied: rows.some((x) => x.role === 'user' && Date.parse(x.at) > state.lastSpokeAt) } : null
    // 小本本：装了小本本插件（id memories）的话系统提示里已经有了；没装就直接读她共用目录里那份
    const hasNotebook = host.list().some((p) => p.id === 'memories' && p.state === 'ok')
    let notebook = ''
    if (!hasNotebook) { try { notebook = fs.readFileSync(path.join(paths.shared, 'notebook.md'), 'utf8').trim().slice(0, 1500) } catch {} }
    log('[主动开口] 条件都满足，问问她要不要说话')
    const parts = await chat.ask({ note: proactiveNote({ now, lastChatAt, last, notebook }) })
    // 问过就记一笔（没问成也记：不然接口出错时每分钟都会再问一次）
    proactiveStore.set('state', recordTry(state, Date.now(), !!parts?.length))
    if (!parts?.length) { log('[主动开口]', parts ? '她不想说' : '没问成'); return }
    await herSay.deliver(parts, 'proactive')
  } finally {
    proactiveRunning = false
  }
}

// ── 做梦（core/dreams.js）：她在桌宠上睡着了 → 每晚最多一个梦，存进 ~/.dsh/whale-dreams.md ─────────────
// 梦只写进那个文件：不进聊天记录、小本本、回忆、我的成长、她眼中的主人（梦和现实分开）
let dreaming = false
let dreamTries = { night: null, n: 0 }     // 没做成（接口出错）一晚最多试 3 次
let sleepTalks = { night: null, n: 0 }     // 梦话一晚最多 2 句

async function maybeDream() {
  if (dreaming || pet.base.state !== 'sleep' || !chat || !config.hasApiKey() || !config.get().llm.model) return
  const now = Date.now()
  const night = nightOf(now)
  if (readDreams(paths.dreams).some((d) => nightOf(d.ms) === night)) return   // 今晚已经做过了
  if (dreamTries.night !== night) dreamTries = { night, n: 0 }
  if (dreamTries.n >= 3) return
  dreamTries.n++
  dreaming = true
  try {
    const diary = [diaryTail(paths.diary, 2400), diaryTail(paths.diaryPrivate, 1200)].join('\n')
    const fragments = memoryFragments({ diary, chat: chatLog.recent(60) })
    const system = personaText({ whaleConfig: readJson(paths.whaleConfig, {}) ?? {}, personaFile: paths.persona })
    const text = tidyDream(await chat.generate({ system, prompt: dreamPrompt(fragments), maxTokens: 700 }))
    if (!text) { log('[做梦] 没做成'); return }
    appendDream(paths.dreams, { at: new Date(now), text })
    log('[做梦] 做了一个梦：', text.slice(0, 30) + '…')
  } finally {
    dreaming = false
  }
}

// 梦话：深夜（和主动开口的深夜时段一样）、主人在电脑前、不忙、她在睡觉 → 偶尔（每次 20%）冒一句，一晚最多 2 句。只是气泡
function maybeSleepTalk() {
  if (pet.base.state !== 'sleep' || busy?.state().busy) return
  const p = config.get().proactive ?? {}
  if (!inQuietHours(new Date().getHours(), Number(p.quietStart ?? 23), Number(p.quietEnd ?? 8))) return
  if (powerMonitor.getSystemIdleTime() >= PRESENT_SEC) return
  const night = nightOf(Date.now())
  if (sleepTalks.night !== night) sleepTalks = { night, n: 0 }
  if (sleepTalks.n >= 2 || Math.random() > 0.2) return
  sleepTalks.n++
  const dream = readDreams(paths.dreams).filter((d) => nightOf(d.ms) === night).at(-1)
  const text = sleepTalk(dream)
  log('[梦话]', text)
  bus.emit('pet:say', { text, kind: 'sleeptalk', openChat: false })
}

// 主人「忙」到要先存着她自己开口的话：手动「我在忙」或前台全屏（只是离开电脑不算：回来就看得到）
function holdingTalk() {
  const s = busy?.state()
  return !!s?.busy && s.reasons.some((r) => r === 'manual' || r === 'fullscreen')
}

function checkBusy() {
  if (!busy) return
  herSay?.flush()   // 不忙了：她存着的话一起给（还在忙就什么都不做）
  const before = busy.state().busy
  const r = busy.evaluate()
  if (r.busy !== before) { log('[忙碌]', r.busy ? '开始：' + r.reasons.join('+') : '结束'); pushPet() }
  if (r.released) {
    const text = releaseBubble(r.released)
    if (text) { petWin?.webContents.send('pet:bubble', { text }); talkFor(4000) }
    if (heldNotes.length) sendChat({ type: 'held', reasons: r.released.reasons, items: heldNotes })
    heldNotes = []
  }
}

function setManualBusy(mode) {
  if (config.get().busy?.manual === false && mode !== 'off') return
  config.update({ busyManual: busy.setManual(mode) })
  log('[忙碌] 手动：', mode)
  checkBusy()
}

// 菜单里显示的「还剩多久」
function manualLeft() {
  const m = busy?.manual()
  if (!m) return null
  if (m.until === null) return '直到你说'
  return `还剩 ${Math.max(1, Math.round((m.until - Date.now()) / 60000))} 分钟`
}
bus.on('chat:incoming', (message) => chatWin?.webContents.send('chat:event', { type: 'message', message }))

// ── 窗口 ────────────────────────────────────────────────────────────────
const webPreferences = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }

function lockDown(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
}

function defaultPetPos() {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - PET_W - 24, y: wa.y + wa.height - PET_H - 8 }
}
function savedPetPos() {
  const { x, y } = config.get().pet ?? {}
  if (!Number.isFinite(x) || !Number.isFinite(y)) return defaultPetPos()
  // 显示器拔掉了 / 分辨率变了：位置不在任何屏幕里就回默认
  const visible = screen.getAllDisplays().some((d) => x + PET_W / 2 >= d.workArea.x && x + PET_W / 2 <= d.workArea.x + d.workArea.width && y + PET_H / 2 >= d.workArea.y && y + PET_H / 2 <= d.workArea.y + d.workArea.height)
  return visible ? { x, y } : defaultPetPos()
}

function createPetWindow() {
  const pos = savedPetPos()
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H, x: pos.x, y: pos.y,
    transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: config.get().pet?.alwaysOnTop !== false,
    backgroundColor: '#00000000', title: '桌宠', webPreferences,
  })
  // 125% 缩放下刚建好的无边框窗口会大 3px 左右（量过：378×428 物理像素，应为 375×425），以前要等第一次拖完才校正
  petWin.setBounds({ x: pos.x, y: pos.y, width: PET_W, height: PET_H })
  lockDown(petWin)
  watchRenderer(petWin, '桌宠')
  // 透明的地方让鼠标穿过去（Linux 不支持转发鼠标移动，那边就整窗可点）
  if (process.platform !== 'linux') petWin.setIgnoreMouseEvents(true, { forward: true })
  // 入场：网页一开始就要知道（?enter=1 时先完全透明，等 pet:hello 再淡入），不然会先闪一下再淡入
  const entrance = config.get().pet?.entrance !== false
  petWin.loadFile(path.join(RENDERER, 'pet.html'), { query: { enter: entrance ? '1' : '0' } })
  petWin.webContents.on('did-finish-load', pushPet)
  if (entrance) {
    petWin.webContents.once('did-finish-load', () => {
      // 主人在忙（比如开着全屏游戏）就只淡入挥手，不冒气泡
      const text = busy?.state().busy ? '' : pickLine(HELLO_LINES)
      petWin?.webContents.send('pet:hello', { text })   // 挥手由网页自己播（不走 talking 状态：那会从视频开头播）
      log('[入场]', text || '（在忙，不说话）')
    })
  }
  petWin.on('closed', () => { petWin = null })
}

// 对话框的大小我们自己记着（主人手动拖边框改大小时才更新）。
// 2026-10-27 修：以前每次挪都 getSize() 读回来再 setPosition —— 125% 缩放下读到的数会多 1、setPosition 也会多 1，
// 拖着桌宠走一圈对话框就越来越大
let chatSize = { width: 380, height: 560 }

function positionChat() {
  if (!chatWin || !petWin) return
  const [px, py] = petWin.getPosition()
  const area = screen.getDisplayNearestPoint({ x: px + PET_W / 2, y: py + PET_H / 2 }).workArea
  chatWin.setBounds(placeChat({ pet: { x: px, y: py }, size: chatSize, body: { left: BODY_L, right: BODY_R }, petH: PET_H, area }))
}

// ── 托盘图标（任务栏右下角）────────────────────────────────────────────────
// 右键：和她聊天 / 显示·隐藏 / 退出。用系统自带菜单：自己画的右键菜单出问题时这里还能退出；开会、录屏时一键藏起来
function createTray() {
  tray = new Tray(path.join(HERE, '..', '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'))
  tray.setToolTip(personaName())
  const quit = () => quitWithGoodbye('托盘')
  tray.on('right-click', () => {
    tray.setToolTip(personaName())   // 名字可能在设置里改过
    tray.popUpContextMenu(Menu.buildFromTemplate(trayTemplate({
      name: personaName(), petVisible: !!petWin?.isVisible(),
      busy: config.get().busy?.manual === false ? null : { left: manualLeft() },
      act: { chat: showChat, togglePet, quit, busy: setManualBusy },
    })))
  })
  tray.on('click', showChat)   // 左键点图标：打开对话框
}

// 藏起来：桌宠、对话框、菜单都收起来；再点一次只把桌宠放回来（对话框要用时再点她）
function togglePet() {
  if (!petWin) return
  if (petWin.isVisible()) {
    petWin.hide(); chatWin?.hide(); hideMenu('藏起来')
    log('[托盘] 藏起来')
  } else {
    petWin.showInactive()   // 不抢焦点：别打断主人正在做的事
    log('[托盘] 显示')
  }
}

// ── 退出 ──────────────────────────────────────────────────────────────────
// 从右键菜单 / 托盘点「退出」：先挥手说再见、淡出，再真的关（最多 3 秒，见 core/greetings.js）。
// 这些情况直接关、不等动画：设置里关掉了、桌宠藏起来了、正在说再见时又点了一次退出、关机 / 注销（见 whenReady 里）
let leaving = false

function quitNow(reason) {
  log('[退出]', reason)
  quitting = true
  app.quit()
}

function quitWithGoodbye(from) {
  if (leaving) return quitNow(from + '：又点了一次，不等了')
  if (config.get().pet?.exit === false || !petWin?.isVisible()) return quitNow(from)
  leaving = true
  chatWin?.hide()
  hideMenu('退出')
  const text = pickLine(BYE_LINES)
  petWin.webContents.send('pet:goodbye', { text })
  log('[退出]', from, '：先说再见', text)
  setTimeout(() => quitNow('再见说完了'), EXIT_TOTAL_MS)
}

// ── 右键菜单（自己画的小窗口，代替系统菜单）─────────────────────────────────
// 流程：右键 → 这里拼好菜单项发给 menu.html → 它画完告诉我们多高 → 按鼠标位置摆好再显示。
// 失去焦点（点到别处）、Esc、点了某项 → 隐藏（窗口一直留着，下次弹得快）
let menuActions = new Map()   // 这一次弹出的菜单里，能点的项 id → 要做的事
let menuAt = null             // 这一次右键时鼠标在哪

function createMenuWindow() {
  menuWin = new BrowserWindow({
    width: MENU_W + 2 * MENU_MARGIN, height: 200, show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    backgroundColor: '#00000000', title: '菜单', webPreferences,
  })
  menuWin.setAlwaysOnTop(true, 'pop-up-menu')   // 要在桌宠（也是总在最前）上面
  lockDown(menuWin)
  watchRenderer(menuWin, '菜单')
  menuWin.loadFile(path.join(RENDERER, 'menu.html'))
  menuWin.on('blur', () => hideMenu('失焦'))
  menuWin.on('close', (e) => { if (!quitting) { e.preventDefault(); hideMenu('关闭窗口') } })
}

let menuWaiting = null        // 等菜单网页回话（menu:ready）的看门狗：等不到就记一笔，"右键没反应"时有迹可查

function hideMenu(reason = '') {
  menuActions = new Map()
  if (menuWin?.isVisible()) { menuWin.hide(); log('[菜单] 关闭：' + reason) }
}

function openMenu() {
  if (!menuWin || menuWin.isDestroyed()) createMenuWindow()
  menuAt = screen.getCursorScreenPoint()
  log('[菜单] 打开：鼠标', menuAt, '窗口', menuWin.isVisible() ? '可见' : '隐藏', '网页', menuWin.webContents.isLoading() ? '还在加载' : '已加载')
  clearTimeout(menuWaiting)
  menuWaiting = setTimeout(() => log('[菜单] 1.5 秒没等到网页回话（menu:ready），菜单没显示出来'), 1500)
  const actions = new Map()
  const items = []
  const item = (id, icon, label, run, extra = {}) => {
    const enabled = extra.enabled !== false
    if (enabled) actions.set(id, run)
    items.push({ kind: 'item', id, icon, label, enabled, hint: extra.hint ?? '', toggle: extra.toggle, danger: !!extra.danger })
  }
  const sep = () => items.push({ kind: 'sep' })

  if (chatWin?.isVisible()) item('chat', '💬', '收起对话框', () => chatWin?.hide())
  else item('chat', '💬', '和她聊天', showChat)
  const plugin = host.menuItems()
  if (plugin.length) sep()
  for (const m of plugin) item('plugin:' + m.id, m.icon || '🧩', m.label, () => host.clickMenu(m.id), { enabled: m.enabled, hint: m.hint, toggle: m.toggle })
  // 我在忙（设置里关了就不显示）
  if (config.get().busy?.manual !== false) {
    sep()
    const left = manualLeft()
    if (left) item('busy-off', '🔔', '不忙了', () => setManualBusy('off'), { hint: left })
    else {
      item('busy-30m', '🔕', '我在忙 30 分钟', () => setManualBusy('30m'))
      item('busy-1h', '🔕', '我在忙 1 小时', () => setManualBusy('1h'))
      item('busy-until', '🔕', '我在忙（直到我说）', () => setManualBusy('until'))
    }
  }
  sep()
  item('settings', '⚙', '设置…', () => { showChat(); sendChat({ type: 'open-settings' }) })
  const onTop = config.get().pet?.alwaysOnTop !== false
  item('ontop', '📌', '总在最前', () => { config.update({ pet: { alwaysOnTop: !onTop } }); petWin?.setAlwaysOnTop(!onTop) }, { toggle: onTop })
  sep()
  item('quit', '⏻', '退出', () => quitWithGoodbye('右键菜单'), { danger: true })

  menuActions = actions
  menuWin.webContents.send('menu:show', { name: personaName(), status: petView().label, items })
}

// 菜单画好了：按它的高度和鼠标位置摆好，再显示、拿焦点（拿到焦点才收得到键盘和"点到别处"）
function showMenuAt(height) {
  clearTimeout(menuWaiting)
  if (!menuWin || !menuAt) return
  const box = { w: MENU_W, h: Math.max(40, Math.min(Math.round(height), 900)) }
  const area = screen.getDisplayNearestPoint(menuAt).workArea
  const bounds = placeMenu({ cursor: menuAt, box, margin: MENU_MARGIN, area })
  menuWin.setBounds(bounds)   // setBounds：缩放下 setPosition 会让窗口越变越大
  menuWin.show()
  menuWin.focus()
  log('[菜单] 显示', bounds, '拿到焦点', menuWin.isFocused())
}

// 网页出错 / 渲染进程崩了：以前这些都悄无声息，"点了没反应"时日志里什么都没有
function watchRenderer(win, name) {
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) log(`[${name}页面] 报错：`, String(e.message).slice(0, 300)) })
  win.webContents.on('render-process-gone', (_, d) => log(`[${name}页面] 渲染进程没了：`, d.reason))
  win.webContents.on('preload-error', (_, p, err) => log(`[${name}页面] preload 出错：`, String(err?.message ?? err)))
}

function createChatWindow() {
  chatWin = new BrowserWindow({
    width: 380, height: 560, minWidth: 320, minHeight: 420, show: false, frame: false,
    title: '和她聊天', backgroundColor: '#fbfaf6', icon: path.join(HERE, '..', '..', 'build', 'icon.png'), webPreferences,   // 任务栏里显示她的头像
  })
  lockDown(chatWin)
  watchRenderer(chatWin, '对话框')
  chatWin.loadFile(path.join(RENDERER, 'chat.html'))
  chatWin.on('close', (e) => { if (!quitting) { e.preventDefault(); chatWin.hide() } })
  // 只有主人拖边框改大小时才会触发（程序自己 setBounds 不触发）：记下新大小，之后挪动都用它
  chatWin.on('will-resize', (_, b) => { chatSize = { width: b.width, height: b.height } })
  // 开关对话框都告诉桌宠（chatOpen）
  chatWin.on('show', pushPet)
  chatWin.on('hide', pushPet)
  chatWin.on('focus', () => { if (pet.unread) { pet.unread = 0; pushPet() } })
  chatWin.webContents.on('did-finish-load', pushPet)
}

function showChat() {
  if (!chatWin) createChatWindow()
  if (!chatWin.isVisible()) positionChat()
  chatWin.show()
  chatWin.focus()
  pet.unread = 0
  pushPet()
  bus.emit('chat:open')
}
const sendChat = (payload) => chatWin?.webContents.send('chat:event', payload)

// ── IPC：只认自己的页面 ─────────────────────────────────────────────────
const ours = (e) => {
  try { return new URL(e.senderFrame?.url ?? '').protocol === 'file:' && [petWin, chatWin, menuWin].some((w) => w && !w.isDestroyed() && w.webContents.id === e.sender.id) } catch { return false }
}
// 被拒和出错都记日志：以前 on() 里抛的错没人接，处理一半就停了，日志里也看不到
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, arg) => {
    if (!ours(e)) { log('[IPC] 拒绝（不是自己的页面）：', ch); throw new Error('blocked') }
    try { return await fn(arg, e) } catch (err) { log('[IPC] 出错：', ch, String(err?.stack ?? err).slice(0, 500)); throw err }
  })
}
function on(ch, fn) {
  ipcMain.on(ch, (e, arg) => {
    if (!ours(e)) { log('[IPC] 拒绝（不是自己的页面）：', ch); return }
    try { const r = fn(arg, e); if (r?.catch) r.catch((err) => log('[IPC] 出错：', ch, String(err?.stack ?? err).slice(0, 500))) }
    catch (err) { log('[IPC] 出错：', ch, String(err?.stack ?? err).slice(0, 500)) }
  })
}

function okBaseUrl(u) {
  try {
    const url = new URL(String(u))
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  } catch { return false }
}

function safeOpenExternal(url) {
  try {
    const u = new URL(url)
    const allowed = u.protocol === 'https:' && (['www.bilibili.com', 'm.bilibili.com', 'platform.deepseek.com', 'api-docs.deepseek.com'].includes(u.hostname))
    if (allowed) shell.openExternal(u.href)
  } catch {}
}

function personaName() {
  const cfg = readJson(paths.whaleConfig, {}) ?? {}
  return String(cfg.persona?.name || '她').slice(0, 20)
}

function registerIpc() {
  // 桌宠
  let drag = null
  on('pet:interactive', (v) => { if (process.platform !== 'linux') petWin?.setIgnoreMouseEvents(!v, { forward: true }) })
  on('pet:drag-start', () => { if (!petWin) return; const c = screen.getCursorScreenPoint(); const [x, y] = petWin.getPosition(); drag = { cx: c.x, cy: c.y, x, y } })
  on('pet:drag-move', () => {
    if (!drag || !petWin) return
    const c = screen.getCursorScreenPoint()
    // 不用 setPosition：Windows 显示缩放（如 125%）下它每调一次窗口就宽高各多 1px，内容贴底，看起来就一直往下沉。
    // setBounds 每次都把宽高写死，尺寸就不会越积越大
    petWin.setBounds({ x: Math.round(drag.x + c.x - drag.cx), y: Math.round(drag.y + c.y - drag.cy), width: PET_W, height: PET_H })
    if (chatWin?.isVisible()) positionChat()
  })
  on('pet:drag-end', () => {
    if (!drag || !petWin) return
    drag = null
    const [x, y] = petWin.getPosition()
    // 缩放下换算会差 1px，松手时再按原尺寸校正一次
    petWin.setBounds({ x, y, width: PET_W, height: PET_H })
    // 记写进去的值：getBounds() 在 125% 缩放下会因为换算取整报 301×341，其实窗口还是 300×340（2026-10-27 用 GetWindowRect 量过：375×425 物理像素）
    log('[桌宠] 拖完', { x, y, width: PET_W, height: PET_H })
    config.update({ pet: { x, y } })
  })
  // 点她只打开（或拿到前面），不关；关对话框用它自己的 × 或右键菜单
  on('pet:click', showChat)
  on('pet:bubble-click', showChat)
  on('pet:menu', openMenu)
  // 桌宠换了动画：记一笔（"她一直在播某段动画"时，看日志就知道是哪个状态在播哪段）
  on('pet:anim', (a) => {
    const name = String(a?.name ?? '').slice(0, 40), state = String(a?.state ?? '').slice(0, 20)
    const kind = name.startsWith('idle-') ? '待机小动作，播一次' : a?.loop ? '循环' : '播一次'
    log(`[桌宠动画] 状态 ${state || '（还没收到）'} → ${name}（${kind}）`)
  })

  // 右键菜单（只认菜单窗口自己发来的）
  const fromMenu = (e) => menuWin && !menuWin.isDestroyed() && e.sender.id === menuWin.webContents.id
  on('menu:ready', (h, e) => { if (fromMenu(e) && Number.isFinite(h)) showMenuAt(h) })
  on('menu:close', (_, e) => { if (fromMenu(e)) hideMenu('Esc') })
  on('menu:pick', (id, e) => {
    if (!fromMenu(e)) return
    const run = menuActions.get(String(id))   // 不在这次菜单里、或是灰掉的项：不认
    log('[菜单] 选了：', String(id), run ? '' : '（这次菜单里没有 / 灰着，不执行）')
    hideMenu('选了一项')
    if (run) Promise.resolve().then(run).catch((err) => log('[菜单] 出错：', String(err?.message ?? err)))
  })

  // 对话框
  handle('chat:init', () => ({
    name: personaName(),
    history: chatLog ? chatLog.recent(80) : [],
    status: petView(),
    needsSetup: !config.hasApiKey() || !config.get().llm.model,
    busy: chat?.busy() ?? false,
    avatars: avatarList(paths.avatars),   // 有哪些状态头像（标题栏跟着状态换）
  }))
  // 参数：一句话（字符串），或 { text, sticker: { box, id } }（主人发图：图必须已经在桌宠自己的文件夹里）
  handle('chat:send', (a) => {
    const text = typeof a === 'string' ? a : a?.text ?? ''
    if (typeof text !== 'string') return { ok: false, error: '格式不对' }
    let sticker = null
    if (typeof a === 'object' && a?.sticker) {
      sticker = findMine({ box: a.sticker.box, id: a.sticker.id }, paths)
      if (!sticker) return { ok: false, error: '这张图找不到了' }
    }
    if (!config.hasApiKey() || !config.get().llm.model) { sendChat({ type: 'open-settings' }); return { ok: false, error: '先填一下 API key 和模型' } }
    chat.send(text, { sticker })
      .then((r) => { if (r?.ok) followUp?.herReplied() })   // 她回完了：开始等主人回，太久没回她可能接着说
      .catch((e) => log('[chat] send 失败', String(e?.message ?? e)))
    return { ok: true }
  })
  // 主人粘贴 / 拖进来的图：{ name, bytes }。检查（png/jpg/gif/webp、5MB 以内，看文件头）后复制进 received/
  handle('sticker:import', (a) => {
    const bytes = a?.bytes
    if (!(bytes instanceof Uint8Array)) return { ok: false, error: '不是图片' }
    if (bytes.length > STICKER_MAX_BYTES) return { ok: false, error: '图片太大了（要 5MB 以内）' }
    const r = saveReceived(paths.received, Buffer.from(bytes), typeof a?.name === 'string' ? a.name : '')
    if (!r.ok) return r
    const { box, id, name, hash } = r.sticker
    log('[表情] 收到一张图：', name, id)
    return { ok: true, sticker: { box, id, name }, inMine: listMine(paths.myStickers).some((m) => m.hash === hash) }
  })
  handle('sticker:mine', () => listMine(paths.myStickers).map(({ box, id, name }) => ({ box, id, name })))
  // 把发过的图收进收藏
  handle('sticker:favorite', (a) => {
    const s = findMine({ box: 'received', id: a?.id }, paths)
    if (!s) return { ok: false, error: '这张图找不到了' }
    const r = addToMine(paths.myStickers, fs.readFileSync(s.file), s.name)
    return r.ok ? { ok: true } : r
  })
  handle('sticker:open-folder', () => { fs.mkdirSync(paths.myStickers, { recursive: true }); shell.openPath(paths.myStickers); return true })
  handle('chat:abort', () => { chat.abort(); return true })
  handle('chat:confirm', (a) => {
    const fn = confirms.get(String(a?.id))
    if (fn) { confirms.delete(String(a.id)); fn(!!a.ok) }
    return true
  })
  handle('chat:hide', () => { chatWin?.hide(); return true })
  // 对话框标题栏的出门开关：交给 bili-whale 插件去拨（它管着和 DSH 的连接），结果从状态里看
  handle('dsh:pause', (paused) => {
    log('[出门开关] 对话框标题栏：', paused ? '关（休息）' : '开')
    if (typeof paused !== 'boolean') return { ok: false }
    bus.emit('pause:set', paused)
    return { ok: true }
  })
  handle('open:video', (bv) => {
    if (!BV_RE.test(String(bv))) return true
    safeOpenExternal(`https://www.bilibili.com/video/${bv}/`)
    bus.emit('video:open', String(bv))   // 主人点了「打开视频」：口味插件记一笔
    return true
  })
  handle('open:deepseek', () => { safeOpenExternal('https://platform.deepseek.com/'); return true })

  // 设置
  handle('settings:get', () => {
    const c = config.get()
    return { baseUrl: c.llm.baseUrl, model: c.llm.model, hasKey: config.hasApiKey(), encrypted: safeStorage.isEncryptionAvailable(), plugins: host.list(), pluginDir: paths.userPlugins, sharedDir: paths.shared,
      busy: { manual: c.busy?.manual !== false, fullscreen: c.busy?.fullscreen !== false }, idleEvery: idleEvery(),
      greet: { entrance: c.pet?.entrance !== false, exit: c.pet?.exit !== false },
      talk: { followUp: { enabled: c.chat?.followUp?.enabled !== false, maxRounds: c.chat?.followUp?.maxRounds ?? 2 }, proactive: c.proactive } }
  })
  // 忙碌感知的两个开关（设置面板里一勾就存，不用点保存）
  // 待机小动作的间隔（分钟）：1–60，最少不能比最多大（一改就存）
  handle('settings:pet', (a) => {
    const min = Math.round(Number(a?.idleExtraMin)), max = Math.round(Number(a?.idleExtraMax))
    if (!(min >= 1 && max <= 60 && min <= max)) return { ok: false, error: '间隔要在 1–60 分钟之间，最少不能比最多大' }
    config.update({ pet: { idleExtraMin: min, idleExtraMax: max } })
    log('[设置] 待机小动作每', min, '–', max, '分钟')
    pushPet()
    return { ok: true }
  })
  // 她自己开口的设置：{ followUp: { enabled, maxRounds } }（一改就存）
  // 她自己开口的设置（一改就存）：{ followUp: { enabled, maxRounds } } 和 / 或
  // { proactive: { enabled, minGapMinutes, dailyMax, quietStart, quietEnd } }
  handle('settings:talk', (a) => {
    const f = a?.followUp, p = a?.proactive
    if (f) {
      const rounds = Math.round(Number(f.maxRounds))
      if (typeof f.enabled !== 'boolean' || !(rounds >= 1 && rounds <= 5)) return { ok: false, error: '接着说的轮数要在 1～5 之间' }
      config.update({ chat: { followUp: { enabled: f.enabled, maxRounds: rounds } } })
      if (!f.enabled) followUp.stop()
      log('[设置] 接着说：', f.enabled ? `最多 ${rounds} 轮` : '关')
    }
    if (p) {
      const n = (k) => Math.round(Number(p[k]))
      const gap = n('minGapMinutes'), daily = n('dailyMax'), qs = n('quietStart'), qe = n('quietEnd')
      if (typeof p.enabled !== 'boolean') return { ok: false, error: '格式不对' }
      if (!(gap >= 10 && gap <= 1440)) return { ok: false, error: '最短间隔要在 10～1440 分钟之间' }
      if (!(daily >= 1 && daily <= 20)) return { ok: false, error: '每天最多 1～20 次' }
      if (!(qs >= 0 && qs <= 23 && qe >= 0 && qe <= 23)) return { ok: false, error: '深夜时段要填 0～23 点' }
      config.update({ proactive: { enabled: p.enabled, minGapMinutes: gap, dailyMax: daily, quietStart: qs, quietEnd: qe } })
      log('[设置] 主动开口：', p.enabled ? `至少隔 ${gap} 分钟，每天最多 ${daily} 次，${qs}–${qe} 点不打扰` : '关')
    }
    return f || p ? { ok: true } : { ok: false, error: '格式不对' }
  })
  // 入场 / 退出动画的两个开关（一勾就存；入场下次启动时生效）
  handle('settings:greet', (a) => {
    const patch = {}
    for (const k of ['entrance', 'exit']) if (typeof a?.[k] === 'boolean') patch[k] = a[k]
    if (!Object.keys(patch).length) return { ok: false }
    config.update({ pet: patch })
    log('[设置] 入场 / 退出动画：', patch)
    return { ok: true }
  })
  handle('settings:busy', (a) => {
    const patch = {}
    for (const k of ['manual', 'fullscreen']) if (typeof a?.[k] === 'boolean') patch[k] = a[k]
    if (!Object.keys(patch).length) return { ok: false }
    config.update({ busy: patch })
    if (patch.manual === false) config.update({ busyManual: busy.setManual('off') })   // 关掉手动：正在进行的也取消
    syncFullscreenWatch()
    checkBusy()
    log('[忙碌] 设置：', patch)
    return { ok: true }
  })
  handle('settings:models', async (a) => {
    const baseUrl = String(a?.baseUrl ?? config.get().llm.baseUrl)
    if (!okBaseUrl(baseUrl)) return { ok: false, error: '接口地址要是 https://（本机代理可以用 http://127.0.0.1）' }
    const key = typeof a?.apiKey === 'string' && a.apiKey.trim() ? a.apiKey.trim() : config.getApiKey()
    if (!key) return { ok: false, error: '先填 API key' }
    try { return { ok: true, models: await listModels({ baseUrl, apiKey: key }) } } catch (e) { return { ok: false, error: explainError(e) } }
  })
  handle('settings:save', (a) => {
    const baseUrl = String(a?.baseUrl ?? '').trim()
    const model = String(a?.model ?? '').trim()
    if (!okBaseUrl(baseUrl)) return { ok: false, error: '接口地址要是 https://（本机代理可以用 http://127.0.0.1）' }
    if (!/^[\w.:/-]{1,100}$/.test(model)) return { ok: false, error: '先选一个模型' }
    if (typeof a?.apiKey === 'string' && a.apiKey.trim()) config.setApiKey(a.apiKey.trim())
    if (!config.hasApiKey()) return { ok: false, error: '还没填 API key' }
    config.update({ llm: { baseUrl, model } })
    log('[设置] 已保存：', baseUrl, model)
    return { ok: true }
  })
}

// 主人发的图看一眼（{ box, id, name, hash, file }）：看过就用缓存，看不了返回 null
async function lookAt(s) {
  const buffer = fs.readFileSync(s.file)
  const ext = sniffImage(buffer)
  if (!ext) return null
  const r = await vision.look({ hash: s.hash, buffer, ext })
  log('[看图]', s.name, r ? '→ ' + (r.caption || r.desc).slice(0, 30) : '看不了，用文件名')
  return r
}

// 确认卡片：模型要用工具时，先让主人点头（2 分钟没点就当「算了」）
const confirms = new Map()
const ui = {
  start: (id) => sendChat({ type: 'start', id }),
  delta: (id, text) => sendChat({ type: 'delta', id, text }),
  end: (id, message) => sendChat({ type: 'end', id, message }),
  error: (id, error) => sendChat({ type: 'error', id, error }),
  tool: (id, t) => sendChat({ type: 'tool', id, ...t }),
  // 她发的表情包：界面只拿得到 sticker:// 的 id，拿不到路径
  attach: (id, it) => sendChat({ type: 'sticker', id, sticker: { box: it.box, id: it.id, name: it.name } }),
  confirm: (card) => new Promise((resolve) => {
    confirms.set(card.id, resolve)
    showChat()
    sendChat({ type: 'confirm', card })
    setTimeout(() => {
      if (!confirms.has(card.id)) return
      confirms.delete(card.id); resolve(false); sendChat({ type: 'confirm-expired', id: card.id })
    }, 120_000)
  }),
}

app.whenReady().then(async () => {
  if (!firstInstance) return   // 保险：万一 app.exit 之前就走到这里，也什么都不做
  fs.mkdirSync(paths.shared, { recursive: true })   // 有了这个目录，DSH 那边的她才知道桌宠在
  protocol.handle('sticker', (req) => {
    const r = stickerResponse(req.url, paths)
    return r.status === 200 ? new Response(r.body, { headers: { 'content-type': r.type } }) : new Response(null, { status: 404 })
  })
  const secretBox = safeStorage.isEncryptionAvailable()
    ? { encrypt: (s) => safeStorage.encryptString(s).toString('base64'), decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')) }
    : null
  config = createConfig({ file: paths.config, secretBox })
  chatLog = createChatLog({ file: paths.chatLog })
  const bridge = createBridgeClient({ file: paths.bridge })
  const kv = createKv(paths.appState)
  // 看图：模型名在配置 llm.visionModel；30 秒看不完就算了（退回用文件名）
  vision = createVision({
    file: paths.visionCache, log,
    describe: (buffer, ext) => describeImage({ baseUrl: config.get().llm.baseUrl, apiKey: config.getApiKey(), model: config.get().llm.visionModel || DEFAULT_VISION_MODEL, buffer, ext, signal: AbortSignal.timeout(30_000) }),
  })
  const services = {
    paths, chatLog, bridge, vision,
    whaleConfig: () => readJson(paths.whaleConfig, {}) ?? {},
    openPath: (f) => shell.openPath(f),
    openExternal: safeOpenExternal,
  }
  host = createPluginHost({ bus, log, getConfig: () => config.get(), updateConfig: (p) => config.update(p), services, kv })
  for (const p of [persona, selfPlugin, ownerView, stickersPlugin, diary, biliWhale, videoNotes, tastePlugin, dreamsPlugin, feedback]) await host.load(p)
  // 忙碌感知：手动的状态存在配置里（重启后「直到我说」还在）；每 5 秒看一次
  busy = createBusy({
    idleSec: () => powerMonitor.getSystemIdleTime(),
    fullscreen: () => fsWatch?.isFullscreen() ?? false,
    settings: () => config.get().busy ?? {},
    manual: config.get().busyManual,
  })
  syncFullscreenWatch()
  setInterval(checkBusy, 5000)
  proactiveStore = kv.scope('proactive')
  // 做梦：睡着 1 分钟后做（醒着不做），之后每 5 分钟看一次；梦话也每 5 分钟看一次
  const dreamTick = () => { maybeDream().catch((e) => log('[做梦] 出错：', String(e?.message ?? e))); maybeSleepTalk() }
  bus.on('pet:base', (d) => { if (d.state === 'sleep') setTimeout(dreamTick, 60_000) })
  setInterval(dreamTick, 5 * 60_000)
  setInterval(() => checkProactive().catch((e) => log('[主动开口] 出错：', String(e?.message ?? e))), 60_000)
  // 让她知道主人现在 / 刚才在忙（放在「DSH 那边的状态」之后、「现在几点」之前）
  await host.load({ id: 'busy', name: '忙碌感知', setup(api) { api.registerContext({ id: 'busy', order: 950, build: () => busy.contextLine() }) } })
  await host.loadUserPlugins(paths.userPlugins)
  chat = createChat({ host, chatLog, bus, ui, getConfig: () => config.get(), getApiKey: () => config.getApiKey(), log, describeSticker: lookAt })
  herSay = createHerSay({
    chatLog, bus, log,
    chat: { start: (id) => sendChat({ type: 'start', id }), delta: (id, text) => sendChat({ type: 'delta', id, text }), end: (id, message) => sendChat({ type: 'end', id, message }) },
    chatVisible: () => !!chatWin?.isVisible() && chatWin.isFocused(),
    holding: holdingTalk,
  })
  followUp = createFollowUp({
    settings: () => config.get().chat?.followUp,
    ask: ({ minutes, round }) => chat.ask({ note: followUpNote({ minutes, round }) }),
    deliver: (parts) => herSay.deliver(parts, 'followup'),
    log,
  })
  // 主人一发消息：她不再接着说，正在一条条送的也停下
  bus.on('chat:user', () => { followUp.ownerSpoke(); herSay.cancel() })

  registerIpc()
  createPetWindow()
  createChatWindow()
  createMenuWindow()
  createTray()
  if (process.env.WHALE_OPEN_CHAT === '1') petWin.webContents.once('did-finish-load', showChat)

  app.on('before-quit', () => { quitting = true; host.disposeAll(); kv.flush(); tray?.destroy(); fsWatch?.stop() })   // 托盘不销毁的话，Windows 上会留一个点了没反应的空图标
  app.on('second-instance', showChat)
  screen.on('display-removed', () => { const p = savedPetPos(); petWin?.setPosition(p.x, p.y) })
  // 关机 / 注销：直接关，不播再见动画。Windows 是窗口的 session-end，macOS / Linux 是 powerMonitor 的 shutdown。
  // 不先把 quitting 设好的话，对话框的 close 会被拦下（只是藏起来），可能挡住关机
  const endSession = (why) => () => quitNow(why)
  petWin.on('query-session-end', () => { quitting = true })
  petWin.on('session-end', endSession('关机 / 注销'))
  powerMonitor.on('shutdown', endSession('关机'))
})

app.on('window-all-closed', () => { if (quitting) app.quit() })

