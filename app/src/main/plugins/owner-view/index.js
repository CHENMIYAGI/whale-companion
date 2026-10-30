// 「我眼中的主人」：她对主人的印象和理解（~/.bili-ai/owner-view.md，和 DSH 里的她共用）
//   · 她在 DSH 里整理回忆、换会话写交接信时整篇重写（bili.mjs owner-view write）—— 桌宠这边只读，不写
//   · 上下文：放在人设、「我的成长」后面，只用来校准语气和态度
//   · 右键菜单「她眼中的我」：主人能看到她现在怎么看他
import fs from 'node:fs'

const MAX = 600   // 正常是 100–300 字；万一文件被改得很长，最多带这么多进提示

function readView(file) {
  try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' }
}

export default {
  id: 'owner-view',
  name: '她眼中的我',
  setup(api) {
    const file = api.services.paths.ownerView

    api.registerContext({
      id: 'owner-view',
      order: 2,   // 人设 0、「我的成长」1，接着就是它；聊天规矩是 5
      build: () => {
        const text = readView(file)
        if (!text) return ''
        return '［你眼中的主人］这是你自己对主人的理解，用来校准语气和态度 —— 不要念出来，也不要说「在我看来你是……」这种话。\n' +
          [...text].slice(0, MAX).join('')
      },
    })

    api.registerMenu({
      id: 'view', order: 47, icon: '👀', group: 'look',   // 右键「👀 看看…」里
      label: '看看她眼中的我',
      enabled: () => readView(file).length > 0,
      hint: () => (readView(file) ? '' : '她还没写'),
      onClick: () => api.services.openPath(file),
    })
  },
}
