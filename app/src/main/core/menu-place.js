// 右键菜单放哪：左上角对着鼠标；右边放不下就往左开，下边放不下就往上开，最后再整体推回屏幕里。
// 菜单窗口是透明的，四周留 margin 给阴影 —— 所以窗口比菜单本身大一圈，算位置时按"菜单本身"算。
//
//   cursor   鼠标位置 {x, y}（屏幕坐标）
//   box      菜单本身的大小 {w, h}
//   margin   阴影留白（窗口每边比菜单多出的宽度）
//   area     能放的范围（鼠标所在屏幕的工作区，不含任务栏）{x, y, width, height}
// 返回窗口的 {x, y, width, height}
export function placeMenu({ cursor, box, margin, area }) {
  const right = area.x + area.width
  const bottom = area.y + area.height
  let x = cursor.x
  let y = cursor.y
  if (x + box.w > right) x = cursor.x - box.w
  if (y + box.h > bottom) y = cursor.y - box.h
  // 往左/往上开了还放不下（菜单比屏幕还大、或鼠标贴边）：贴着边放
  x = Math.max(area.x, Math.min(x, right - box.w))
  y = Math.max(area.y, Math.min(y, bottom - box.h))
  return { x: Math.round(x - margin), y: Math.round(y - margin), width: Math.round(box.w + 2 * margin), height: Math.round(box.h + 2 * margin) }
}

/**
 * 二级菜单放哪（2026-10-30）：贴着主菜单右边、和点开的那一行对齐；右边放不下就放左边；
 * 下边放不下就往上挪，不超出屏幕。窗口要把两块都装下 —— 返回新的窗口大小位置，和两块在窗口里的位置。
 * 所有尺寸都是算出来的（主菜单大小是我们自己定的、子菜单高度是网页量好告诉我们的），
 * 不读回窗口大小：125% 缩放下读回来的数会多 1，越加越大。
 *
 *   main    主菜单本身在屏幕上的位置大小 {x, y, w, h}（不含阴影留白）
 *   rowTop  点开的那一行，离主菜单顶端多少
 *   sub     子菜单本身的大小 {w, h}
 *   gap     两块之间的缝
 * 返回 { bounds: 窗口 {x,y,width,height}, main: {x,y}, sub: {x,y}, side: 'right'|'left' }（main / sub 是在窗口里、留白之内的位置）
 */
export function placeSubmenu({ main, rowTop, sub, margin, area, gap = 4 }) {
  const right = area.x + area.width
  const bottom = area.y + area.height
  let side = 'right'
  let sx = main.x + main.w + gap
  if (sx + sub.w > right) { side = 'left'; sx = main.x - gap - sub.w }
  sx = Math.max(area.x, Math.min(sx, right - sub.w))
  // 子菜单第一项和点开的那一行对齐（子菜单上面有 6px 内边距）
  let sy = main.y + rowTop - 6
  sy = Math.max(area.y, Math.min(sy, bottom - sub.h))
  const x0 = Math.min(main.x, sx), y0 = Math.min(main.y, sy)
  const x1 = Math.max(main.x + main.w, sx + sub.w), y1 = Math.max(main.y + main.h, sy + sub.h)
  return {
    side,
    bounds: { x: Math.round(x0 - margin), y: Math.round(y0 - margin), width: Math.round(x1 - x0 + 2 * margin), height: Math.round(y1 - y0 + 2 * margin) },
    main: { x: Math.round(main.x - x0), y: Math.round(main.y - y0) },
    sub: { x: Math.round(sx - x0), y: Math.round(sy - y0) },
  }
}
