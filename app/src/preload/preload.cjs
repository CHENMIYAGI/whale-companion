const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  // 网页 → 主进程
  click: () => ipcRenderer.send('pet:click'),

  bubbleClick: () => ipcRenderer.send('pet:bubble-click'),

  menu: () => ipcRenderer.send('pet:menu'),

  dragStart: () => ipcRenderer.send('pet:drag-start'),

  dragMove: () => ipcRenderer.send('pet:drag-move'),

  dragEnd: () => ipcRenderer.send('pet:drag-end'),

  // 换了动画：告诉主进程记日志（只传名字、是不是循环、当时的状态）
  anim: (a) =>
    ipcRenderer.send('pet:anim', { name: String(a?.name ?? ''), loop: a?.loop === true, state: String(a?.state ?? '') }),

  // 只允许传递 true 或 false
  interactive: (v) =>
    ipcRenderer.send('pet:interactive', v === true),

  // 主进程 → 网页
  onState: (fn) =>
    ipcRenderer.on('pet:state', (event, data) => fn(data)),

  onBubble: (fn) =>
    ipcRenderer.on('pet:bubble', (event, data) => fn(data)),

  // 气泡上的按钮（一起看的邀请）：只传邀请的 id 和选了哪个
  bubbleAction: (id, choice) =>
    ipcRenderer.send('pet:bubble-action', { id: String(id ?? ''), choice: String(choice ?? '') }),

  // 主人在对话框里回答了邀请：收起气泡
  onBubbleClose: (fn) =>
    ipcRenderer.on('pet:bubble-close', (event, data) => fn(data)),

  // 入场：淡入、挥手、说一句（data.text，可能是空的）
  onHello: (fn) =>
    ipcRenderer.on('pet:hello', (event, data) => fn(data)),

  // 退出：挥手、说一句再见、淡出（主进程过一会儿就真的关）
  onGoodbye: (fn) =>
    ipcRenderer.on('pet:goodbye', (event, data) => fn(data)),
})

// ── 对话框 ──────────────────────────────────────────────────────────────
// 和 window.pet 分开：两扇窗用同一个 preload，但各用各的
// invoke 是"发过去并等回答"，返回 Promise，网页里用 await 拿结果
contextBridge.exposeInMainWorld('chat', {
  // 网页 → 主进程
  init: () => ipcRenderer.invoke('chat:init'),

  send: (text) => ipcRenderer.invoke('chat:send', String(text)),

  abort: () => ipcRenderer.invoke('chat:abort'),

  // 只传 id 和 true/false，不让网页塞别的东西过去
  confirm: (id, ok) =>
    ipcRenderer.invoke('chat:confirm', { id: String(id), ok: ok === true }),

  hide: () => ipcRenderer.invoke('chat:hide'),

  openVideo: (bv) => ipcRenderer.invoke('open:video', String(bv)),

  openDeepseek: () => ipcRenderer.invoke('open:deepseek'),

  // 出门开关：true = 休息，不出门
  setPaused: (paused) => ipcRenderer.invoke('dsh:pause', paused === true),

  // 待机小动作的间隔（分钟）：{ idleExtraMin, idleExtraMax }（只传数字）
  setPetSettings: (s) =>
    ipcRenderer.invoke('settings:pet', { idleExtraMin: Number(s?.idleExtraMin), idleExtraMax: Number(s?.idleExtraMax) }),

  // 她自己开口的设置：{ followUp: { enabled, maxRounds } } 或 { proactive: { enabled, minGapMinutes, dailyMax, quietStart, quietEnd } }
  // （只传 true/false 和数字）
  setTalkSettings: (s) => {
    const out = {}
    if (s?.followUp) out.followUp = { enabled: s.followUp.enabled === true, maxRounds: Number(s.followUp.maxRounds) }
    if (s?.proactive) {
      const p = s.proactive
      out.proactive = { enabled: p.enabled === true, minGapMinutes: Number(p.minGapMinutes), dailyMax: Number(p.dailyMax), quietStart: Number(p.quietStart), quietEnd: Number(p.quietEnd) }
    }
    return ipcRenderer.invoke('settings:talk', out)
  },

  // 入场 / 退出动画的开关：{ entrance, exit }（只传 true/false）
  setGreetSettings: (s) =>
    ipcRenderer.invoke('settings:greet', { entrance: s?.entrance === true, exit: s?.exit === true }),

  // 忙碌感知的开关：{ manual, fullscreen }（只传 true/false）
  setBusySettings: (s) =>
    ipcRenderer.invoke('settings:busy', { manual: s?.manual === true, fullscreen: s?.fullscreen === true }),

  // 表情包（主人这边）：图都由主进程检查、复制进桌宠自己的文件夹，网页只拿到 { box, id, name }
  // 发一张图（可以带一句话）
  sendSticker: (sticker, text) =>
    ipcRenderer.invoke('chat:send', { text: String(text ?? ''), sticker: { box: String(sticker?.box), id: String(sticker?.id) } }),

  // 粘贴 / 拖进来的图：把内容（Uint8Array）交给主进程
  importImage: (name, bytes) =>
    ipcRenderer.invoke('sticker:import', { name: String(name ?? ''), bytes: bytes instanceof Uint8Array ? bytes : null }),

  myStickers: () => ipcRenderer.invoke('sticker:mine'),

  favorite: (id) => ipcRenderer.invoke('sticker:favorite', { id: String(id) }),

  openStickerFolder: () => ipcRenderer.invoke('sticker:open-folder'),

  // 一起看：回答邀请（watch / postpone / skip）、暂停 / 继续 / 结束、清单、从清单里开始
  answerInvite: (id, choice) => ipcRenderer.invoke('watch:answer', { id: String(id), choice: String(choice) }),
  watchControl: (action) => ipcRenderer.invoke('watch:control', { action: String(action) }),
  watchList: () => ipcRenderer.invoke('watch:list'),
  watchStart: (bv) => ipcRenderer.invoke('watch:start', { bv: String(bv) }),
  setWatchSettings: (s) => ipcRenderer.invoke('settings:watch', { invite: s?.invite === true, overFullscreen: s?.overFullscreen === true }),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),

  listModels: (baseUrl, apiKey) =>
    ipcRenderer.invoke('settings:models', { baseUrl: String(baseUrl), apiKey: String(apiKey ?? '') }),

  saveSettings: (baseUrl, model, apiKey) =>
    ipcRenderer.invoke('settings:save', { baseUrl: String(baseUrl), model: String(model), apiKey: String(apiKey ?? '') }),

  // 主进程 → 网页
  onStatus: (fn) =>
    ipcRenderer.on('chat:status', (event, data) => fn(data)),

  onEvent: (fn) =>
    ipcRenderer.on('chat:event', (event, data) => fn(data)),
})

// ── 右键菜单（自己画的小窗口）─────────────────────────────────────────────
contextBridge.exposeInMainWorld('menu', {
  // 主进程 → 网页：要显示的内容 { name, status, items: [{ kind, id, icon, label, hint, enabled, toggle, danger }] }
  onShow: (fn) =>
    ipcRenderer.on('menu:show', (event, data) => fn(data)),

  // 网页 → 主进程
  // 画好了，告诉主进程菜单本身有多高（主进程据此算窗口大小和位置，再显示出来）
  ready: (height) => ipcRenderer.send('menu:ready', Number(height)),

  pick: (id) => ipcRenderer.send('menu:pick', String(id)),

  close: () => ipcRenderer.send('menu:close'),
})
