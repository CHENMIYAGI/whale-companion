// 托盘（任务栏右下角）的右键菜单内容。
// 故意用系统自带的菜单，不用自己画的那个：自己画的出问题时，这里还能正常退出；开会、录屏时一键把她藏起来。
//
//   name        她的名字（显示在「显示/隐藏<名字>」里）
//   petVisible  桌宠现在显没显示
//   busy        「我在忙」：null = 设置里关了不显示；{ left: null } = 现在不忙；{ left: '还剩 20 分钟' } = 正在忙
//   act         要做的事：{ chat, togglePet, quit, busy(mode) }
// 返回 Menu.buildFromTemplate 用的模板
export function trayTemplate({ name, petVisible, busy = null, act }) {
  const busyItems = !busy ? [] : busy.left
    ? [{ label: `不忙了（${busy.left}）`, click: () => act.busy('off') }]
    : [{ label: '我在忙', submenu: [
        { label: '30 分钟', click: () => act.busy('30m') },
        { label: '1 小时', click: () => act.busy('1h') },
        { label: '直到我说', click: () => act.busy('until') },
      ] }]
  return [
    { label: '和她聊天', click: act.chat },
    { label: `${petVisible ? '隐藏' : '显示'}${name}`, click: act.togglePet },
    ...busyItems,
    { type: 'separator' },
    { label: '退出', click: act.quit },
  ]
}
