const whale = document.getElementById('whale')
const label = document.getElementById('label')
const bubble = document.getElementById('bubble')

// state 与表情的对照表（动画文件缺了的时候用）
const faces = {
  sleep: '💤',
  idle: '🐋',
  watching: '📺',
  thinking: '💭',
  talking: '💬',
}

// ── 动画 ────────────────────────────────────────────────────────────────
// 文件在 anim/ 里（来源和对照见 anim/README.md）。每段首尾都是正面站姿，所以随时切换都接得上。

// state 与循环动画的对照表；查不到（比如 talking）就退回待机
const loops = {
  sleep: 'sleep-loop',
  idle: 'idle',
  watching: 'watching',
  thinking: 'thinking',
}

// 有"进场 / 退场"的循环动画：睡觉要先入睡（播一次）再一直熟睡；不睡了要等这一轮熟睡播完，再播醒来。
// 三段是从原来的 sleep.webm 切出来的（scripts/split-sleep.sh），接缝都做了淡化，前后接得上
const intros = { 'sleep-loop': 'sleep-in' }
const outros = { 'sleep-loop': 'sleep-out' }

// 这段动画属于哪个循环（入睡也算在睡觉里）
function loopOf(name) {
  return Object.keys(intros).find((k) => intros[k] === name) ?? name
}

// 进入这些状态时播一次，播完回到循环动画
const enterOnce = {
  talking: 'talking',
}

const idleExtras = ['idle-look', 'idle-hum', 'idle-bubbles', 'idle-stretch']
const clickReactions = ['click-happy', 'click-shy', 'click-pout', 'click-giggle']
const pick = (list) => list[Math.floor(Math.random() * list.length)]

const videos = [document.getElementById('animA'), document.getElementById('animB')]
let front = 0         // videos[front] 是正在显示的那个
let showing = null    // 正在显示（或正在准备）的动画名
let ticket = 0        // 每次换动画加 1；准备好时号码对不上，说明中途又换了别的，就作废
let baseAnim = 'idle' // 当前状态对应的循环动画
let lastState = null
let chatOpen = false  // 对话框开着吗（主进程随状态一起发来）
let loading = null    // 正在后台加载、还没换到前面的那个 video

// 换动画：在后台那个 video 里加载，能播了再换到前面
// from：从第几秒开始播（可以不写）。挥手那段前 2 秒是站着不动的，入场 / 退出时从抬手那里开始
function show(name, loop, from = 0) {
  if (loop && name === showing) {
    current().loop = true // 可能刚被设成"播完这轮就停"（要醒来），又不醒了：接着循环
    return
  }
  showing = name
  const my = ++ticket
  const back = videos[1 - front]
  back.loop = loop
  back.src = from ? `anim/${name}.webm#t=${from}` : `anim/${name}.webm` // #t=秒：浏览器自带的「从这里开始播」
  loading = back
  back.oncanplay = () => {
    back.oncanplay = null
    if (my !== ticket) return
    loading = null
    back.play()
    back.classList.add('front')
    videos[front].classList.remove('front')
    videos[front].pause()
    front = 1 - front
    document.body.dataset.anim = name // 方便测试和调试时看现在播的是哪段
    window.pet.anim({ name, loop, state: lastState }) // 记进日志：哪个状态在播哪段（查"一直在播某个动画"用）
  }
}

// 正在播 showing 的那个 video（还在加载的话就是后台那个）
function current() {
  return loading ?? videos[front]
}

// 回到当前状态的循环动画；有进场动画的先播进场（比如被点醒后再睡：先入睡）
function goBase() {
  const intro = intros[baseAnim]
  if (intro && loopOf(showing) !== baseAnim) show(intro, false)
  else show(baseAnim, true)
}

// 状态换了，要换循环动画
function changeBase() {
  const cur = loopOf(showing)
  if (cur === baseAnim) {
    // 又回到原来的状态（比如要醒了又接着睡）：熟睡就接着循环，入睡就让它播完
    if (showing === baseAnim) show(baseAnim, true)
    return
  }
  if (outros[cur]) {
    // 睡着或正在入睡：不打断。熟睡设成"这一轮播完就停"，播完触发 ended，在那里播醒来
    if (showing === cur) current().loop = false
    return
  }
  if (Object.values(outros).includes(showing)) return // 正在醒来：播完再换（ended 里会去新状态）
  goBase()
}

// 播一次的动画结束了（或熟睡被设成播完这轮就停）：接下一段
for (const v of videos) {
  v.addEventListener('ended', () => {
    if (v !== videos[front] || dragging) return
    const cur = loopOf(showing)
    if (cur === baseAnim) return show(baseAnim, true) // 入睡播完 → 熟睡
    if (outros[cur]) return show(outros[cur], false)  // 不睡了：这一轮熟睡（或入睡）播完 → 醒来
    goBase()
  })
  v.addEventListener('error', () => {
    document.body.classList.add('no-anim')
  })
}

// 正在播"播一次"的动画吗（循环动画、拖动动画都不算）
function playingOnce() {
  return showing !== baseAnim && showing !== 'drag'
}

// 点她时的反应：对话框没开 → 要打开了，挥挥手；已经开着 → 随机一段点击回应。
// 上一段反应还没播完就不理，免得连点时一直从头开始。（待机小动作不算反应，可以打断）
function react() {
  if (showing === 'talking' || clickReactions.includes(showing)) return
  show(chatOpen ? pick(clickReactions) : 'talking', false)
}

// 接收主进程发送的状态
window.pet.onState((s) => {
  whale.textContent = faces[s.state] ?? '🐋'
  label.textContent = s.label ?? ''
  chatOpen = s.chatOpen === true
  // 主人在忙（手动 / 全屏 / 不在电脑前）：桌宠变淡一点，待机小动作也停
  document.body.classList.toggle('busy', s.busy === true)
  // 设置里改了待机小动作的间隔：马上按新的重新计时
  idleExtraTimer.setEvery(s.idleEvery)

  const prevBase = baseAnim
  baseAnim = loops[s.state] ?? 'idle'
  if (baseAnim === 'idle' && s.mood === 'faint') baseAnim = 'faint'

  const entered = s.state !== lastState
  lastState = s.state
  if (dragging) return // 拖动中一直是悬空动画，松手时再回来
  if (leaving) return  // 正在说再见：挥手播完就关了，别被打断

  if (entered && enterOnce[s.state]) {
    show(enterOnce[s.state], false)
  } else if (baseAnim !== prevBase || !playingOnce()) {
    // 状态真的变了（比如开始刷 B 站）就打断正在播的；只是文字变了就让它播完。睡觉例外，见 changeBase
    changeBase()
  }
})

// 待机时每隔一会儿随机插一段小动作，播一次，播完回到普通待机
// 2026-10-28 改：以前 30~90 秒一次太频繁 → 默认 3~8 分钟（设置里能调，主进程随状态发来 idleEvery: [最少, 最多] 分钟）
// 2026-10-29 改：排班挪到 idle-extras.js（测试里能直接跑）。另外「她一直在左顾右盼」不是这里的毛病：
// 是普通待机的 idle.webm（原版「待机呼吸休闲」）自己会转头，现在换成只站着呼吸的那段（scripts/make-idle.sh）
const idleExtraTimer = createIdleExtras({
  list: idleExtras,
  canPlay: () => baseAnim === 'idle' && showing === 'idle' && !dragging && !document.body.classList.contains('busy') && !leaving,
  play: (extra) => show(extra, false),
})
show(baseAnim, true)

// 记录鼠标按下的位置，以及是否正在拖动
let press = null
let dragging = false

// 1. 按下左键：记录起点
whale.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return

  press = {
    x: e.screenX,
    y: e.screenY,
  }
  dragging = false
})

// 2. 移动鼠标：判断是否开始拖动
window.addEventListener('mousemove', (e) => {
  if (press === null) return

  const distance =
    Math.abs(e.screenX - press.x) +
    Math.abs(e.screenY - press.y)

  if (!dragging && distance >= 4) {
    dragging = true
    window.pet.dragStart()
    show('drag', true)
  }

  if (dragging) {
    window.pet.dragMove()
  }
})

// 3. 松开鼠标：结束拖动，或者视为点击
window.addEventListener('mouseup', (e) => {
  if (press === null) return
  if (e.button !== 0) return

  if (dragging) {
    window.pet.dragEnd()
    goBase() // 睡觉时被拖起来：放下后先入睡再熟睡
  } else {
    react() // 先看对话框原来开没开，再通知主进程去打开
    window.pet.click()
  }

  press = null
  dragging = false

  // 拖动结束后，检查鼠标是否还在鲸鱼上
  if (!whale.matches(':hover')) {
    window.pet.interactive(false)
  }
})

// 4. 右键：打开菜单
whale.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.pet.menu()
})

// 5. 鼠标进入鲸鱼
whale.addEventListener('mouseenter', () => {
  window.pet.interactive(true)
})

// 鼠标离开鲸鱼：拖动过程中不切换穿透状态
whale.addEventListener('mouseleave', () => {
  if (dragging) return

  window.pet.interactive(false)
})

let bubbleTimer = null

// 冒一个气泡（入场、退出也用它）
function showBubble(text) {
  // 更新气泡内容，避免将文本当作 HTML 解析
  bubble.textContent = text

  // 显示气泡
  bubble.hidden = false

  // 清除上一次的隐藏定时器
  if (bubbleTimer !== null) {
    clearTimeout(bubbleTimer)
  }

  // 显示时间：3 秒 + 每个字 0.15 秒，最多 10 秒
  const duration = Math.min(3000 + [...text].length * 150, 10000)

  bubbleTimer = setTimeout(() => {
    bubble.hidden = true
    bubbleTimer = null
  }, duration)
}

// 收到主进程发送的气泡消息
window.pet.onBubble(({ text }) => showBubble(text))

// 点击气泡：通知主进程，并立即隐藏
bubble.addEventListener('click', () => {
  window.pet.bubbleClick()

  bubble.hidden = true

  if (bubbleTimer !== null) {
    clearTimeout(bubbleTimer)
    bubbleTimer = null
  }
})

// 鼠标进入气泡：窗口接收鼠标交互
bubble.addEventListener('mouseenter', () => {
  window.pet.interactive(true)
})

// 鼠标离开气泡：窗口恢复鼠标穿透状态
bubble.addEventListener('mouseleave', () => {
  window.pet.interactive(false)
})

// ── 入场 / 退出 ─────────────────────────────────────────────────────────
// 时间和 main 里的 core/greetings.js 一样（网页这边读不到那个文件，只好写两遍）
const WAVE_FROM = 2        // 挥手动画从第 2 秒（抬手）开始播
const ENTER_FADE_MS = 800  // 淡入多久（pet.css 的 body 过渡）
const EXIT_WAVE_MS = 1600  // 退出时先挥手这么久，再淡出（淡出 0.6 秒，之后主进程就关窗口了）
let leaving = false

// 主进程打开窗口时带上 ?enter=1 就是要入场。pet.html 里 body 一开始就是透明的（class="away"），
// 不入场的话马上去掉（关掉过渡，不然会多一段淡入）
const entering = new URLSearchParams(location.search).get('enter') === '1'
if (entering) {
  // 万一等不到 pet:hello（主进程出岔子），3 秒后也别一直透明着
  setTimeout(() => document.body.classList.remove('away'), 3000)
} else {
  document.body.style.transition = 'none'
  document.body.classList.remove('away')
  document.body.offsetHeight // 读一下尺寸：让浏览器先按「没有过渡」画好，再把过渡还回去
  document.body.style.transition = ''
}

// 入场：淡入，淡入完再挥手、冒气泡
window.pet.onHello(({ text }) => {
  document.body.classList.remove('away')
  setTimeout(() => {
    if (dragging || leaving) return
    show('talking', false, WAVE_FROM)
    if (text) showBubble(text)
  }, ENTER_FADE_MS)
})

// 退出：挥手 + 气泡，过一会儿淡出
window.pet.onGoodbye(({ text }) => {
  leaving = true
  idleExtraTimer.stop()
  show('talking', false, WAVE_FROM)
  if (text) showBubble(text)
  setTimeout(() => document.body.classList.add('leaving'), EXIT_WAVE_MS)
})
