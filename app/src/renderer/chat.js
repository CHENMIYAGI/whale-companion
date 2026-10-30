// 对话框。所有来自模型、网络、DSH 的文字一律用 textContent 显示，不用 innerHTML（防止被当成网页代码执行）

const nameEl = document.getElementById('name')
const statusEl = document.getElementById('status')
const dot = document.getElementById('dot')
const messages = document.getElementById('messages')
const composer = document.getElementById('composer')
const input = document.getElementById('input')
const btnSend = document.getElementById('btnSend')
const btnStop = document.getElementById('btnStop')

// 小工具：建一个元素，顺手设 class 和文字
function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

// ── 滚动 ────────────────────────────────────────────────────────────────
// 主人往上翻旧消息时，新消息来了不要硬把他拉到底；本来就在底部才跟着滚
function nearBottom(extra = 0) {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60 + extra
}
function append(node, forceScroll = false) {
  const stick = forceScroll || nearBottom()
  messages.append(node)
  if (stick) messages.scrollTop = messages.scrollHeight
}

// ── 消息气泡 ────────────────────────────────────────────────────────────
// 表情包：图只从 sticker:// 按 id 取（主进程只给自己文件夹里的图）；取不到就显示「[表情：名字]」这行字
const STICKER_BOXES = ['her', 'mine', 'received']
function stickerImg(st) {
  const label = '[表情：' + (st?.name ?? '') + ']'
  if (!STICKER_BOXES.includes(st?.box) || !/^[0-9a-f]{16}$/.test(st?.id ?? '')) return el('div', 'text', label)
  const img = el('img', 'sticker')
  img.alt = label
  img.title = st.name ?? ''
  img.addEventListener('error', () => img.replaceWith(el('div', 'text', label)))
  img.addEventListener('load', () => { if (nearBottom(img.height)) messages.scrollTop = messages.scrollHeight })
  img.src = 'sticker://' + st.box + '/' + st.id
  return img
}

// rec 是聊天记录里的一条：{ role, text, source?, kind?, bv?, at?, meta? }
function bubble(rec) {
  const mine = rec.role === 'user'
  const fromDsh = rec.source === 'dsh'
  const box = el('div', 'msg ' + (mine ? 'me' : 'her') + (fromDsh ? ' dsh' : ''))
  if (rec.at) box.title = new Date(rec.at).toLocaleString()
  if (rec.kind === 'sticker' && rec.meta?.sticker) {
    box.append(stickerImg(rec.meta.sticker))
    // 主人粘贴 / 拖进来的图：可以收进自己的收藏（已经在收藏里的就不显示）
    if (mine && rec.meta.sticker.box === 'received' && !rec.meta.sticker.inMine) box.append(favButton(rec.meta.sticker.id))
    return box
  }

  // 她在 DSH 里刷完回来说的话：加个小标记
  if (fromDsh) box.append(el('span', 'tag', rec.bv ? '看完回来了' : '刚刷完'))

  box.append(el('div', 'text', rec.text ?? ''))
  box.append(el('div', 'tools'))

  // 带 BV 号就给个按钮；链接只交给主进程打开（主进程只放行 BV 格式）
  if (fromDsh && rec.bv) {
    const open = el('button', 'small', '打开视频')
    open.type = 'button'
    open.addEventListener('click', () => window.chat.openVideo(rec.bv))
    box.append(open)
  }
  return box
}

function note(text, isError = false) {
  append(el('div', 'note' + (isError ? ' error' : ''), text))
}

// ── 流式回复 ────────────────────────────────────────────────────────────
// 一次回复有一个 id；start 时建气泡，delta 往里加字，end 换成最终文字
const replies = new Map()

function replyBox(id) {
  let box = replies.get(id)
  if (!box) {
    box = bubble({ role: 'assistant', text: '' })
    replies.set(id, box)
    append(box)
  }
  return box
}

// 工具小提示："记在小本本上…" → "✓ 记在小本本上"
const toolMarks = { running: '…', done: '✓', cancelled: '✗ 取消了：', error: '⚠ 出错了：' }
function showTool({ id, name, state, label }) {
  const tools = replyBox(id).querySelector('.tools')
  let line = tools.querySelector(`[data-tool="${CSS.escape(name)}"]`)
  if (!line) {
    line = el('div')
    line.dataset.tool = name
    tools.append(line)
  }
  const mark = toolMarks[state] ?? ''
  line.textContent = state === 'running' ? label + mark : mark + ' ' + label
  line.className = state === 'error' ? 'error' : ''
}

// ── 确认卡片 ────────────────────────────────────────────────────────────
const cards = new Map()

function showCard(card) {
  const box = el('div', 'card')
  box.append(el('div', 'title', card.title ?? '要做这件事吗？'))
  if (card.image) box.append(stickerImg(card.image))   // 她问「这个能给我吗」时带上那张图
  if (card.text) box.append(el('div', 'body', card.text))
  const row = el('div', 'row')
  const no = el('button', '', card.cancelLabel ?? '算了')
  const yes = el('button', 'primary', card.okLabel ?? '好')
  no.type = yes.type = 'button'
  row.append(no, yes)
  box.append(row)

  const answer = (ok) => {
    window.chat.confirm(card.id, ok)
    closeCard(card.id, ok ? '好的，去办了' : '算了')
  }
  yes.addEventListener('click', () => answer(true))
  no.addEventListener('click', () => answer(false))

  cards.set(card.id, box)
  append(box, true)
}

// 点过了或过期了：按钮换成一行说明，不能再点
function closeCard(id, text) {
  const box = cards.get(id)
  if (!box) return
  cards.delete(id)
  box.querySelector('.row').replaceWith(el('div', 'result', text))
}

// ── 状态：标题栏 + 发送/停止按钮 ────────────────────────────────────────────
let busy = false

function setBusy(v) {
  busy = v
  btnSend.hidden = v
  btnStop.hidden = !v
}

// 出门开关按钮：🚪 = 可以出门，🏠 = 在家休息
// DSH 没开时拨不了：按钮变淡，但还能点 —— 点了说明原因（以前直接禁用，点了毫无反应，像坏了一样）
const btnPause = document.getElementById('btnPause')
let paused = false
let online = false

function applyPause(s) {
  paused = s.paused === true
  online = s.online === true
  btnPause.textContent = paused ? '🏠' : '🚪'
  btnPause.classList.toggle('off', paused)
  btnPause.classList.toggle('offline', !online)
  btnPause.title = !online ? '出门开关（DSH 没开，拨不了）'
    : paused ? '休息中，不出门（点一下：让她可以出门）' : '可以出门（点一下：让她在家休息）'
}

// 状态头像：~/.whale-companion/avatars/ 里有哪个状态的就用哪个，没有就用待机的，再没有就用默认的 avatar.png
const avatar = document.getElementById('avatar')
let avatars = []   // 打开时主进程告诉我们有哪些（init 里的 avatars）
function applyAvatar(s) {
  const want = s.state === 'idle' && s.mood === 'faint' ? 'faint' : s.state
  const pick = avatars.includes(want) ? want : avatars.includes('idle') ? 'idle' : null
  const src = pick ? 'sticker://avatar/' + pick : 'avatar.png'
  if (avatar.getAttribute('src') !== src) avatar.src = src
}
// 图坏了 / 被删了：退回默认头像（只退一次，不会来回循环）
avatar.addEventListener('error', () => { if (avatar.getAttribute('src') !== 'avatar.png') avatar.src = 'avatar.png' })

// status：{ state, mood, label, online, paused, unread }。state 是 thinking 就是她正在回复
function applyStatus(s) {
  statusEl.textContent = s.label ?? ''
  applyAvatar(s)
  dot.classList.toggle('online', s.online === true)
  setBusy(s.state === 'thinking')
  applyPause(s)
}

btnPause.addEventListener('click', () => {
  if (!online) return note('DSH 没开，出门开关现在拨不了（开着 DSH 再试）')
  window.chat.setPaused(!paused)
})

// ── 主进程发来的事件 ─────────────────────────────────────────────────────
window.chat.onStatus(applyStatus)

window.chat.onEvent((ev) => {
  if (ev.type === 'start') {
    replyBox(ev.id)
  } else if (ev.type === 'delta') {
    const text = replyBox(ev.id).querySelector('.text')
    const stick = nearBottom()
    text.textContent += ev.text
    if (stick) messages.scrollTop = messages.scrollHeight
  } else if (ev.type === 'end') {
    // message 是 null：她只发了表情包没说话，空气泡拿掉
    // （上面还有别的工具小提示就留着，只把空文字藏起来——空的 .text 会一直显示「正在输入」的点点）
    const b = replies.get(ev.id)
    if (!ev.message) { if (b && !b.querySelector('.tools').textContent) b.remove(); else if (b) b.querySelector('.text').hidden = true }
    else replyBox(ev.id).querySelector('.text').textContent = ev.message.text ?? ''
  } else if (ev.type === 'sticker') {
    append(bubble({ role: 'assistant', kind: 'sticker', meta: { sticker: ev.sticker } }))
  } else if (ev.type === 'error') {
    // 一个字都没说出来就出错：把空气泡拿掉（工具提示还在的话留着）
    const box = replies.get(ev.id)
    if (box && !box.querySelector('.text').textContent && !box.querySelector('.tools').textContent) box.remove()
    note(ev.error ?? '出错了', ev.error !== '已停止')
  } else if (ev.type === 'tool') {
    showTool(ev)
  } else if (ev.type === 'confirm') {
    showCard(ev.card)
  } else if (ev.type === 'confirm-expired') {
    closeCard(ev.id, '太久没回答，作废了')
  } else if (ev.type === 'message') {
    append(bubble(ev.message))
  } else if (ev.type === 'open-settings') {
    openSettings()
  } else if (ev.type === 'held') {
    // 主人刚才在忙，她攒着没冒的话（从 DSH 发回来的本来就在上面，这里是别的小提示）
    note(ev.reasons?.includes('away') && ev.reasons.length === 1 ? '你刚才不在，她攒着的话：' : '你刚才在忙，她攒着的话：')
    for (const text of ev.items ?? []) append(bubble({ role: 'assistant', text }))
  }
})

// ── 发送 ────────────────────────────────────────────────────────────────
async function send() {
  const text = input.value.trim()
  if (!text || busy) return
  setBusy(true)   // 先挡住连点；真正的状态等主进程的 chat:status
  input.value = ''
  // 先把主人的话放上去：她的回复可能比 send 的返回值先到，晚放的话顺序会颠倒
  const mine = bubble({ role: 'user', text })
  append(mine, true)
  const res = await window.chat.send(text)
  if (!res.ok) {
    mine.remove()
    setBusy(false)
    input.value = text   // 没发出去：把字还给主人，不用重打
    note(res.error ?? '没发出去', true)
  }
}

composer.addEventListener('submit', (e) => {
  e.preventDefault()   // 表单默认会刷新页面，拦住
  send()
})

// Enter 发送、Shift+Enter 换行。isComposing：输入法还在选字时按的 Enter 是确认候选词，不算发送
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
})

btnStop.addEventListener('click', () => window.chat.abort())
document.getElementById('btnClose').addEventListener('click', () => window.chat.hide())
document.getElementById('btnSettings').addEventListener('click', () => openSettings())

// ── 设置面板 ────────────────────────────────────────────────────────────
const settings = document.getElementById('settings')
const setBaseUrl = document.getElementById('setBaseUrl')
const setKey = document.getElementById('setKey')
const setModel = document.getElementById('setModel')
const setMsg = document.getElementById('setMsg')
const btnModels = document.getElementById('btnModels')
const btnSave = document.getElementById('btnSave')

function settingsMessage(text, kind = '') {
  setMsg.textContent = text
  setMsg.className = kind
}

// 下拉框换成这些模型，尽量保持原来选中的
function fillModels(list, selected) {
  setModel.replaceChildren()
  if (!list.length) setModel.append(el('option', '', '（先获取模型列表）'))
  for (const m of list) {
    const opt = el('option', '', m)
    opt.value = m
    setModel.append(opt)
  }
  if (list.includes(selected)) setModel.value = selected
}

let needsSetup = false

async function openSettings() {
  const s = await window.chat.getSettings()
  setBaseUrl.value = s.baseUrl || 'https://api.deepseek.com'
  setKey.value = ''
  setKey.placeholder = s.hasKey ? '已保存，留空不改' : 'sk-…'
  document.getElementById('plainWarn').hidden = s.encrypted
  document.getElementById('setupHint').hidden = !needsSetup
  fillModels(s.model ? [s.model] : [], s.model)
  settingsMessage('')

  const list = document.getElementById('pluginList')
  list.replaceChildren()
  for (const p of s.plugins ?? []) {
    const li = el('li', p.state === 'failed' ? 'failed' : '', `${p.name}${p.version ? ' ' + p.version : ''}`)
    if (p.state !== 'ok') li.textContent += `（${p.state === 'failed' ? '加载失败：' + (p.error ?? '') : '已停用'}）`
    if (p.description) li.title = p.description
    list.append(li)
  }
  document.getElementById('pluginDir').textContent = s.pluginDir ?? ''
  idleMin.value = s.idleEvery?.[0] ?? 3
  idleMax.value = s.idleEvery?.[1] ?? 8
  followUpBox.checked = s.talk?.followUp?.enabled !== false
  followUpRounds.value = s.talk?.followUp?.maxRounds ?? 2
  const p = s.talk?.proactive ?? {}
  proactiveBox.checked = p.enabled !== false
  gapBox.value = p.minGapMinutes ?? 60
  dailyBox.value = p.dailyMax ?? 4
  quietStartBox.value = p.quietStart ?? 23
  quietEndBox.value = p.quietEnd ?? 8
  watchInviteBox.checked = s.watch?.invite !== false
  watchOverFsBox.checked = s.watch?.overFullscreen !== false
  entranceBox.checked = s.greet?.entrance !== false
  exitBox.checked = s.greet?.exit !== false
  busyManual.checked = s.busy?.manual !== false
  busyFullscreen.checked = s.busy?.fullscreen !== false

  settings.hidden = false
  ;(s.hasKey ? setModel : setKey).focus()
}

function closeSettings() {
  settings.hidden = true
  input.focus()
}

btnModels.addEventListener('click', async () => {
  btnModels.disabled = true
  settingsMessage('正在获取…')
  const res = await window.chat.listModels(setBaseUrl.value.trim(), setKey.value.trim())
  btnModels.disabled = false
  if (!res.ok) return settingsMessage(res.error ?? '获取失败', 'error')
  fillModels(res.models ?? [], setModel.value)
  settingsMessage(`找到 ${res.models.length} 个模型，选一个再保存`, 'ok')
})

btnSave.addEventListener('click', async () => {
  btnSave.disabled = true
  const res = await window.chat.saveSettings(setBaseUrl.value.trim(), setModel.value, setKey.value.trim())
  btnSave.disabled = false
  if (!res.ok) return settingsMessage(res.error ?? '保存失败', 'error')
  needsSetup = false
  settingsMessage('保存好了', 'ok')
  setTimeout(closeSettings, 600)
})

document.getElementById('btnBack').addEventListener('click', closeSettings)

// 待机小动作的间隔：改了就存（不对的话提示原因，不存）
const idleMin = document.getElementById('setIdleMin')
const idleMax = document.getElementById('setIdleMax')
for (const box of [idleMin, idleMax]) {
  box.addEventListener('change', async () => {
    const r = await window.chat.setPetSettings({ idleExtraMin: idleMin.value, idleExtraMax: idleMax.value })
    settingsMessage(r?.ok ? `好，每 ${idleMin.value}–${idleMax.value} 分钟一次` : (r?.error ?? '没改成'), r?.ok ? 'ok' : 'error')
  })
}

// 她自己开口：一改就存
const followUpBox = document.getElementById('setFollowUp')
const followUpRounds = document.getElementById('setFollowUpRounds')
for (const box of [followUpBox, followUpRounds]) {
  box.addEventListener('change', async () => {
    const r = await window.chat.setTalkSettings({ followUp: { enabled: followUpBox.checked, maxRounds: followUpRounds.value } })
    settingsMessage(r?.ok ? '已经改好了' : (r?.error ?? '没改成'), r?.ok ? 'ok' : 'error')
  })
}

const proactiveBox = document.getElementById('setProactive')
const gapBox = document.getElementById('setGap')
const dailyBox = document.getElementById('setDaily')
const quietStartBox = document.getElementById('setQuietStart')
const quietEndBox = document.getElementById('setQuietEnd')
for (const box of [proactiveBox, gapBox, dailyBox, quietStartBox, quietEndBox]) {
  box.addEventListener('change', async () => {
    const r = await window.chat.setTalkSettings({ proactive: { enabled: proactiveBox.checked, minGapMinutes: gapBox.value, dailyMax: dailyBox.value, quietStart: quietStartBox.value, quietEnd: quietEndBox.value } })
    settingsMessage(r?.ok ? '已经改好了' : (r?.error ?? '没改成'), r?.ok ? 'ok' : 'error')
  })
}

// 入场 / 退出动画的两个开关：一勾就存
const entranceBox = document.getElementById('setEntrance')
const exitBox = document.getElementById('setExit')
for (const box of [entranceBox, exitBox]) {
  box.addEventListener('change', async () => {
    const r = await window.chat.setGreetSettings({ entrance: entranceBox.checked, exit: exitBox.checked })
    settingsMessage(r?.ok ? '已经改好了' : '没改成', r?.ok ? 'ok' : 'error')
  })
}

// 忙碌感知的两个开关：一勾就存
const busyManual = document.getElementById('setBusyManual')
const busyFullscreen = document.getElementById('setBusyFullscreen')
for (const box of [busyManual, busyFullscreen]) {
  box.addEventListener('change', async () => {
    const r = await window.chat.setBusySettings({ manual: busyManual.checked, fullscreen: busyFullscreen.checked })
    settingsMessage(r?.ok ? '已经改好了' : '没改成', r?.ok ? 'ok' : 'error')
  })
}
document.getElementById('btnGetKey').addEventListener('click', () => window.chat.openDeepseek())

// Esc：设置开着就关设置，否则收起对话框
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!settings.hidden) closeSettings()
  else if (!stickerPanel.hidden) closeStickers()
  else if (!watchListEl.hidden) closeWatchList()
  else window.chat.hide()
})

// ── 表情包（主人这边）：表情面板、粘贴、拖图进来 ──────────────────────────────
// 图片只认本地文件：先交给主进程检查（格式看文件头、5MB 以内）、复制进桌宠自己的文件夹，
// 拿回 { box, id, name } 再显示、再发。网上的图（从浏览器拖过来的链接）不收。
const MAX_IMAGE = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const stickerPanel = document.getElementById('stickerPanel')
const stickerGrid = document.getElementById('stickerGrid')
const btnStickers = document.getElementById('btnStickers')
const filePick = document.getElementById('filePick')

function favButton(id) {
  const b = el('button', 'small', '☆ 收藏')
  b.type = 'button'
  b.addEventListener('click', async () => {
    b.disabled = true
    const r = await window.chat.favorite(id)
    b.textContent = r?.ok ? '★ 已收藏' : (r?.error ?? '没收成')
  })
  return b
}

// 发一张图；输入框里有字就一起发（先字后图）
async function sendSticker(st) {
  if (busy) return note('她还在说上一句，等一下再发', true)
  setBusy(true)
  closeStickers()
  const text = input.value.trim()
  input.value = ''
  const shown = []
  if (text) shown.push(bubble({ role: 'user', text }))
  shown.push(bubble({ role: 'user', kind: 'sticker', meta: { sticker: st } }))
  for (const b of shown) append(b, true)
  const res = await window.chat.sendSticker(st, text)
  if (!res?.ok) {
    for (const b of shown) b.remove()
    setBusy(false)
    input.value = text
    note(res?.error ?? '没发出去', true)
  }
}

// 粘贴 / 拖进来 / 选的一个文件 → 交给主进程 → 发
async function sendFile(file, name = file.name) {
  if (!IMAGE_TYPES.includes(file.type)) return note('只能发 png / jpg / gif / webp 图片', true)
  if (file.size > MAX_IMAGE) return note('图片太大了（要 5MB 以内）', true)
  const r = await window.chat.importImage(name, new Uint8Array(await file.arrayBuffer()))
  if (!r?.ok) return note(r?.error ?? '这张图发不了', true)
  sendSticker({ ...r.sticker, inMine: r.inMine })
}

async function openStickers() {
  const list = await window.chat.myStickers()
  stickerGrid.replaceChildren()
  if (!list.length) {
    stickerGrid.append(el('div', 'empty', '收藏还是空的：把图片放进收藏文件夹，或者发过的图点「☆ 收藏」。也可以直接粘贴、拖图进来发。'))
  }
  for (const st of list) {
    const b = el('button')
    b.type = 'button'
    b.title = st.name
    b.append(stickerImg(st))
    b.addEventListener('click', () => sendSticker({ ...st, inMine: true }))
    stickerGrid.append(b)
  }
  stickerPanel.hidden = false
  btnStickers.classList.add('on')
}
function closeStickers() {
  stickerPanel.hidden = true
  btnStickers.classList.remove('on')
}

btnStickers.addEventListener('click', () => (stickerPanel.hidden ? openStickers() : closeStickers()))
document.getElementById('btnStickerFolder').addEventListener('click', () => window.chat.openStickerFolder())
document.getElementById('btnPickFile').addEventListener('click', () => filePick.click())
filePick.addEventListener('change', () => {
  const f = filePick.files[0]
  filePick.value = ''   // 清掉：同一张图下次还能再选
  if (f) sendFile(f)
})

// 粘贴：剪贴板里有图就发图（截图粘贴没有文件名，名字留空，主进程会叫它「图片」）；只有字就照常粘贴
input.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
  if (!f) return
  e.preventDefault()
  sendFile(f, '')
})

// 拖图进来：只认本地文件；从网页拖来的图只有链接没有文件，不收
let dragDepth = 0
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging') })
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging') } })
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('dragging')
  const f = e.dataTransfer?.files?.[0]
  if (!f) return note('只能拖电脑里的图片文件进来（网上的图先存到电脑里）', true)
  sendFile(f)
})

// ── 一起看 ──────────────────────────────────────────────────────────────
// 邀请卡片（现在看 / 晚点再说 / 不想看）、一起看时顶上那一条（看到哪、暂停 / 结束）、「一起看的清单」
const watchBar = document.getElementById('watchBar')
const watchInfo = document.getElementById('watchInfo')
const btnWatchToggle = document.getElementById('btnWatchToggle')
const watchListEl = document.getElementById('watchList')
const watchItems = document.getElementById('watchItems')
const CHOICE_LABELS = { watch: '现在看', postpone: '晚点再说', skip: '不想看' }
const mmss = (s) => `${String(Math.floor((s ?? 0) / 60)).padStart(2, '0')}:${String(Math.floor(s ?? 0) % 60).padStart(2, '0')}`
let watching = null   // 主进程发来的一起看状态（没在看就是 null）

function applyWatch(st) {
  watching = st?.active ? st : null
  watchBar.hidden = !watching
  if (!watching) return
  const label = `「${st.title}」${st.parts > 1 ? ` P${st.part}` : ''}`
  watchInfo.textContent = st.preparing ? `🎬 一起看${label}：她在准备…` : `🎬 一起看${label} · ${mmss(st.elapsed)} / ${mmss(st.duration)}${st.paused ? '（暂停）' : ''}`
  btnWatchToggle.hidden = !!st.preparing
  btnWatchToggle.textContent = st.paused ? '继续' : '暂停'
}
btnWatchToggle.addEventListener('click', () => window.chat.watchControl(watching?.paused ? 'resume' : 'pause'))
document.getElementById('btnWatchEnd').addEventListener('click', () => window.chat.watchControl('end'))

// 邀请卡片：和确认卡片一个样子，三个按钮
function showInvite(inv) {
  const box = el('div', 'card invite')
  box.append(el('div', 'title', inv.text ?? '一起看吗？'))
  const row = el('div', 'row')
  for (const [i, a] of (inv.actions ?? []).entries()) {
    const b = el('button', i === 0 ? 'primary' : '', a.label)
    b.type = 'button'
    b.addEventListener('click', async () => {
      const r = await window.chat.answerInvite(inv.id, a.id)
      closeCard(inv.id, r?.ok ? '你选了：' + a.label : (r?.error ?? '没成功'))
    })
    row.append(b)
  }
  box.append(row)
  cards.set(inv.id, box)
  append(box, true)
}

// 「一起看的清单」
async function openWatchList() {
  const { items, active } = await window.chat.watchList()
  watchItems.replaceChildren()
  if (!items.length) watchItems.append(el('li', 'empty', '还是空的：她在 DSH 里看到想陪你一起看的视频，会先留着（「留着以后」）。'))
  for (const it of items) {
    const li = el('li')
    li.append(el('div', 't', it.title))
    const bits = [`下次一起看第 ${it.nextPart} P / 共 ${it.parts} P`, it.previewed ? '已预习' : '还没预习']
    if (it.watchedParts.length) bits.push('一起看过：' + it.watchedParts.map((p) => 'P' + p).join('、'))
    if (it.postponedUntil) bits.push(`晚点再说（${new Date(it.postponedUntil).toLocaleDateString()} 以后再问）`)
    li.append(el('div', 's', bits.join(' · ')))
    const b = el('button', 'primary', '现在一起看')
    b.type = 'button'
    b.disabled = !!active
    if (active) b.title = '正在一起看别的'
    b.addEventListener('click', async () => {
      b.disabled = true
      const r = await window.chat.watchStart(it.bv)
      if (r?.ok) closeWatchList()
      else { b.disabled = false; note(r?.error ?? '开始不了', true) }
    })
    li.append(b)
    watchItems.append(li)
  }
  watchListEl.hidden = false
}
function closeWatchList() {
  watchListEl.hidden = true
}
document.getElementById('btnWatchListClose').addEventListener('click', closeWatchList)

window.chat.onEvent((ev) => {
  if (ev.type === 'invite') showInvite(ev.invite)
  else if (ev.type === 'invite-closed') closeCard(ev.id, '你选了：' + (CHOICE_LABELS[ev.choice] ?? ''))
  else if (ev.type === 'watch') applyWatch(ev.state)
  else if (ev.type === 'open-watch-list') openWatchList()
})

// 设置里一起看的两个开关：一勾就存
const watchInviteBox = document.getElementById('setWatchInvite')
const watchOverFsBox = document.getElementById('setWatchOverFs')
for (const box of [watchInviteBox, watchOverFsBox]) {
  box.addEventListener('change', async () => {
    const r = await window.chat.setWatchSettings({ invite: watchInviteBox.checked, overFullscreen: watchOverFsBox.checked })
    settingsMessage(r?.ok ? '已经改好了' : '没改成', r?.ok ? 'ok' : 'error')
  })
}

// ── 打开时：拿名字、历史、状态 ───────────────────────────────────────────
async function start() {
  const data = await window.chat.init()
  nameEl.textContent = data.name
  avatars = data.avatars ?? []
  document.title = '和' + data.name + '聊天'
  for (const rec of data.history ?? []) messages.append(bubble(rec))
  messages.scrollTop = messages.scrollHeight
  applyStatus(data.status ?? {})
  setBusy(data.busy === true)
  needsSetup = data.needsSetup === true
  if (needsSetup) openSettings()
  else input.focus()
}
start()
