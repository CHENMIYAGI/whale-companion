// 右键菜单。菜单项文字可能来自插件，一律用 textContent。
// 主进程发来内容 → 画出来 → 告诉主进程有多高 → 主进程摆好位置再显示。
// 关闭：点了某项 / 按 Esc / 点到别处（窗口失去焦点，由主进程处理）。

const box = document.getElementById('box')
const list = document.getElementById('list')

let rows = []      // 能点的项（DOM 元素），上下键在这里面走
let active = -1    // 现在高亮的是第几个（-1 = 没有）

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function setActive(i) {
  rows[active]?.classList.remove('active')
  active = i
  rows[active]?.classList.add('active')
}

window.menu.onShow((data) => {
  document.getElementById('name').textContent = data.name ?? ''
  document.getElementById('status').textContent = data.status ?? ''
  list.replaceChildren()
  rows = []
  active = -1

  for (const item of data.items ?? []) {
    if (item.kind === 'sep') {
      list.append(el('div', 'sep'))
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
    if (!item.enabled) {
      // 灰掉的项：写明为什么不能点（插件没给原因就写个通用的）
      const why = item.hint || '暂时不能用'
      row.append(el('span', 'hint', why))
      row.setAttribute('aria-disabled', 'true')
      row.title = why
      list.append(row)
      continue
    }
    const i = rows.length
    rows.push(row)
    row.addEventListener('mouseenter', () => setActive(i))
    row.addEventListener('click', () => window.menu.pick(item.id))
    list.append(row)
  }

  // 直接量高度：getBoundingClientRect 会让浏览器当场排版，不用等下一帧。
  // 2026-10-27 修：以前用 requestAnimationFrame 等一帧 —— 可窗口隐藏过一次之后，浏览器就不再给它画帧，
  // 回调永远不来，主进程等不到高度，右键菜单就再也弹不出来了
  window.menu.ready(box.getBoundingClientRect().height)
})

// 鼠标离开菜单：取消高亮（键盘再按会从头开始）
box.addEventListener('mouseleave', () => setActive(-1))

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.menu.close()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!rows.length) return
    const step = e.key === 'ArrowDown' ? 1 : -1
    // 走到头就绕回来；一开始没高亮时，↓ 选第一个、↑ 选最后一个
    const next = active === -1 ? (step === 1 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length
    setActive(next)
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    rows[active]?.click()
  }
})
