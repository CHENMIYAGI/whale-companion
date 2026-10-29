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
