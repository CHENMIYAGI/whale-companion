// 右键菜单。菜单项文字可能来自插件，一律用 textContent。
// 主进程发来内容 → 画出来 → 告诉主进程有多高 → 主进程摆好位置再显示。
// 关闭：点了某项 / 按 Esc / 点到别处（窗口失去焦点，由主进程处理）。
//
// 二级菜单（2026-10-30）：kind 为 'submenu' 的项右边有个 ›
//   · 鼠标停 0.2 秒展开，点一下立刻展开；展开时主进程把窗口放大（固定尺寸），告诉我们两块各放哪（onLayout）
//   · 鼠标斜着往子菜单走、路过别的行时不马上收起：等 0.3 秒，这期间进了子菜单就不收
//   · 键盘：↑↓ 在这一层里走；→ / 回车 展开并进到子菜单；← / Esc 回到主菜单；主菜单里 Esc 关掉菜单

const box = document.getElementById('box')
const list = document.getElementById('list')
const subBox = document.getElementById('sub')
const subList = document.getElementById('subList')

const MARGIN = 12      // 和 menu.css 的 --margin、main.js 的 MENU_MARGIN 一样：窗口四周给阴影留的地方
const HOVER_MS = 200   // 鼠标停多久展开子菜单
const LEAVE_MS = 300   // 子菜单开着时，鼠标路过别的行多久才算真的离开（给斜着走的鼠标留时间）

// 两层各自的「能点的行」和高亮：{ rows: [{ el, item }], active }
const main = { rows: [], active: -1 }
const sub = { rows: [], active: -1 }
let level = main         // 键盘现在在哪一层
let openRow = null       // 子菜单是从主菜单哪一行展开的（{ el, item }）
let openTimer = null
let leaveTimer = null
let focusSubWhenShown = false   // 用键盘展开的：子菜单出来后把高亮放到第一项

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function setActive(scope, i) {
  scope.rows[scope.active]?.el.classList.remove('active')
  scope.active = i
  scope.rows[scope.active]?.el.classList.add('active')
}

// 画一层（主菜单或子菜单）
function render(container, items, scope) {
  container.replaceChildren()
  scope.rows = []
  scope.active = -1
  for (const item of items ?? []) {
    if (item.kind === 'sep') {
      container.append(el('div', 'sep'))
      continue
    }
    const row = el('div', 'mi' + (item.enabled ? '' : ' dis') + (item.danger ? ' danger' : ''))
    row.setAttribute('role', 'menuitem')
    row.append(el('span', 'ic', item.icon || '•'))
    row.append(el('span', 'label', item.label ?? ''))
    if (typeof item.toggle === 'boolean') {
      row.append(el('span', 'tog' + (item.toggle ? ' on' : '')))
      row.setAttribute('aria-checked', String(item.toggle))
    } else if (item.enabled && item.hint) {
      row.append(el('span', 'hint', item.hint))   // 能点的项也可以带一句小字，比如「还剩 20 分钟」
    }
    if (item.kind === 'submenu') {
      row.append(el('span', 'arrow', '›'))
      row.setAttribute('aria-haspopup', 'menu')
    }
    if (!item.enabled) {
      // 灰掉的项：写明为什么不能点（插件没给原因就写个通用的）
      const why = item.hint || '暂时不能用'
      row.append(el('span', 'hint', why))
      row.setAttribute('aria-disabled', 'true')
      row.title = why
      container.append(row)
      continue
    }
    const i = scope.rows.length
    const r = { el: row, item }
    scope.rows.push(r)
    row.addEventListener('mouseenter', () => {
      setActive(scope, i)
      level = scope
      if (scope === main) hoverMain(r)
      else clearTimeout(leaveTimer)
    })
    row.addEventListener('click', () => {
      if (item.kind === 'submenu') openSub(r, false)
      else window.menu.pick(item.id)
    })
    container.append(row)
  }
}

// 鼠标到了主菜单的某一行
function hoverMain(r) {
  clearTimeout(openTimer)
  if (r.item.kind === 'submenu') {
    if (openRow?.el === r.el) { clearTimeout(leaveTimer); return }
    // 另一个子菜单开着：多等一会儿（可能只是斜着路过）
    openTimer = setTimeout(() => openSub(r, false), openRow ? LEAVE_MS : HOVER_MS)
  } else if (openRow) {
    clearTimeout(leaveTimer)
    leaveTimer = setTimeout(closeSub, LEAVE_MS)
  }
}

function openSub(r, focusFirst) {
  clearTimeout(openTimer)
  clearTimeout(leaveTimer)
  if (openRow?.el === r.el) { if (focusFirst) { level = sub; setActive(sub, 0) } return }
  openRow?.el.classList.remove('open')
  openRow = r
  r.el.classList.add('open')
  render(subList, r.item.items, sub)
  // 先藏着量高度，等主进程把窗口放大、告诉我们位置后再露出来（不然会先在错的地方闪一下）
  subBox.style.visibility = 'hidden'
  subBox.hidden = false
  const height = subBox.getBoundingClientRect().height
  const rowTop = r.el.getBoundingClientRect().top - box.getBoundingClientRect().top
  focusSubWhenShown = focusFirst
  window.menu.sub(true, rowTop, height)
}

function closeSub() {
  clearTimeout(openTimer)
  clearTimeout(leaveTimer)
  if (!openRow) return
  openRow.el.classList.remove('open')
  openRow = null
  subBox.hidden = true
  sub.rows = []
  sub.active = -1
  level = main
  window.menu.sub(false)
}

// 主进程摆好了：两块各放哪（窗口里、留白之内的位置）
window.menu.onLayout((l) => {
  box.style.left = MARGIN + (l.main?.x ?? 0) + 'px'
  box.style.top = MARGIN + (l.main?.y ?? 0) + 'px'
  if (!l.sub || !openRow) { subBox.hidden = true; return }
  subBox.style.left = MARGIN + l.sub.x + 'px'
  subBox.style.top = MARGIN + l.sub.y + 'px'
  subBox.style.visibility = ''
  if (focusSubWhenShown) { level = sub; setActive(sub, 0); focusSubWhenShown = false }
})

window.menu.onShow((data) => {
  document.getElementById('name').textContent = data.name ?? ''
  document.getElementById('status').textContent = data.status ?? ''
  // 新的一次：子菜单收起（窗口大小主进程自己会重新摆，这里不用再告诉它）
  clearTimeout(openTimer)
  clearTimeout(leaveTimer)
  openRow = null
  subBox.hidden = true
  level = main
  render(list, data.items, main)

  // 直接量高度：getBoundingClientRect 会让浏览器当场排版，不用等下一帧。
  // 2026-10-27 修：以前用 requestAnimationFrame 等一帧 —— 可窗口隐藏过一次之后，浏览器就不再给它画帧，
  // 回调永远不来，主进程等不到高度，右键菜单就再也弹不出来了
  window.menu.ready(box.getBoundingClientRect().height)
})

// 鼠标进了子菜单：别收；离开主菜单（又没进子菜单）：取消高亮（子菜单开着时，点开它的那一行保持亮着）
subBox.addEventListener('mouseenter', () => { clearTimeout(leaveTimer); clearTimeout(openTimer) })
box.addEventListener('mouseleave', () => { clearTimeout(openTimer); if (!openRow) setActive(main, -1) })
subBox.addEventListener('mouseleave', () => setActive(sub, -1))

document.addEventListener('keydown', (e) => {
  const cur = level.rows[level.active]
  if (e.key === 'Escape') {
    if (level === sub) { closeSub(); return }   // 先回主菜单
    window.menu.close()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const rows = level.rows
    if (!rows.length) return
    const step = e.key === 'ArrowDown' ? 1 : -1
    // 走到头就绕回来；一开始没高亮时，↓ 选第一个、↑ 选最后一个
    const next = level.active === -1 ? (step === 1 ? 0 : rows.length - 1) : (level.active + step + rows.length) % rows.length
    setActive(level, next)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    if (level === main && cur?.item.kind === 'submenu') openSub(cur, true)
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    if (level === sub) closeSub()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (!cur) return
    if (cur.item.kind === 'submenu') openSub(cur, true)
    else cur.el.click()
  }
})
