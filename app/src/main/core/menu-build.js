// 右键菜单的二级菜单（2026-10-30）：插件菜单项写了 group 的进对应的二级菜单，没写的还在主菜单
//
//   「👀 看看…」（group: 'look'）：日记、小本本、视频笔记、她的分类、一起看的清单、她的梦、她的成长、她眼中的我
//   「🔕 我在忙…」：main.js 自己拼（busyMenu）
// 这里只有纯逻辑，main.js 拿去拼菜单，测试直接调。

/** 认识的二级菜单：图标和名字。不认识的 group 也会变成二级菜单（名字就用 group） */
export const GROUPS = { look: { icon: '👀', label: '看看…' } }

/**
 * 别人写的插件（不改它的代码）也放进二级菜单：插件菜单 id → { group, label, order }
 * 小本本是用户自己的插件（~/.whale-companion/plugins/memory），它的菜单没写 group
 */
export const MENU_OVERRIDES = {
  'memories/view': { group: 'look', label: '看看小本本', order: 41 },
}

/**
 * 把插件菜单项分成主菜单的和各个二级菜单的（各自按 order 排）。
 * extra：main.js 自己的、也要进二级菜单的项（比如「看看一起看的清单」），格式一样
 * 返回 { top: [...], groups: [{ group, icon, label, items: [...] }] }（groups 按第一次出现的顺序）
 */
export function groupMenuItems(items, extra = [], overrides = MENU_OVERRIDES) {
  const all = [...items, ...extra].map((m) => (overrides[m.id] ? { ...m, ...overrides[m.id] } : m))
  const top = []
  const groups = new Map()
  for (const m of all) {
    if (!m.group) { top.push(m); continue }
    if (!groups.has(m.group)) groups.set(m.group, [])
    groups.get(m.group).push(m)
  }
  const byOrder = (a, b) => (a.order ?? 50) - (b.order ?? 50)
  return {
    top: top.sort(byOrder),
    groups: [...groups].map(([group, list]) => ({ group, icon: GROUPS[group]?.icon ?? '🧩', label: GROUPS[group]?.label ?? `${group}…`, items: list.sort(byOrder) })),
  }
}

/**
 * 「我在忙…」：主菜单那一项的名字 + 子菜单。
 * left：手动「我在忙」还剩多久 —— null（没在忙）/ Infinity（直到我说）/ 毫秒
 */
export function busyMenu(left) {
  const busy = left !== null && left !== undefined
  const label = !busy ? '我在忙…' : left === Infinity ? '忙着呢 · 直到你说' : `忙着呢 · 还剩 ${Math.max(1, Math.round(left / 60000))} 分`
  const items = [
    ...(busy ? [{ id: 'busy-off', icon: '🔔', label: '我忙完了' }, { kind: 'sep' }] : []),
    { id: 'busy-30m', icon: '🔕', label: '忙 30 分钟' },
    { id: 'busy-1h', icon: '🔕', label: '忙 1 小时' },
    { id: 'busy-until', icon: '🔕', label: '一直忙，直到我说' },
  ]
  return { icon: '🔕', label, items }
}
