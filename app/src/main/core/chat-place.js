// 对话框放哪：贴着桌宠身体的左边（放不下就右边），底边和桌宠窗口底边对齐，不超出屏幕。
//
//   pet    桌宠窗口左上角 {x, y}
//   size   对话框的大小 {width, height} —— 用我们自己记着的，不要用 chatWin.getSize() 读回来的：
//          125% 缩放下读回来的数会因为换算取整偶尔多 1（窗口实际没变），读了再写回去就会越积越大
//   body   桌宠身体在窗口里的左右边 {left, right}
//   petH   桌宠窗口高度
//   area   屏幕工作区 {x, y, width, height}
// 返回对话框的 {x, y, width, height}（交给 setBounds，宽高原样写回去）
export function placeChat({ pet, size, body, petH, area }) {
  const { width: w, height: h } = size
  let x = pet.x + body.left - w - 4
  if (x < area.x) x = pet.x + body.right + 4
  if (x + w > area.x + area.width) x = area.x + area.width - w
  let y = pet.y + petH - h
  y = Math.max(area.y, Math.min(y, area.y + area.height - h))
  return { x: Math.round(x), y: Math.round(y), width: w, height: h }
}
