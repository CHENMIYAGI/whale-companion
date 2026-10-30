// 她的梦（梦是 main.js 在她睡着时做的，存在 ~/.dsh/whale-dreams.md，见 core/dreams.js）
//   · 第二天第一次聊天：上下文里带上「昨晚的梦（这是梦，不是真的发生过）」，只带这一次，提不提由她
//   · 右键「她的梦」：打开梦的文件
// 梦和现实分开：这个插件只读梦，不往别处写；提示里也叮嘱她别把梦记进小本本、我的成长、她眼中的主人
import fs from 'node:fs'
import { readDreams, dreamContext, DREAM_FRESH_MS } from '../../core/dreams.js'

export default {
  id: 'dreams',
  name: '她的梦',
  setup(api) {
    const file = api.services.paths.dreams

    api.registerContext({
      id: 'last-night', order: 930,   // 一天只出现一次，放后面（前面的提示能命中缓存）
      build: ({ now } = {}) => {
        const t = (now ?? new Date()).getTime()
        const dream = readDreams(file).at(-1)
        if (!dream || t - dream.ms > DREAM_FRESH_MS || api.store.get('told') === dream.at) return ''
        api.store.set('told', dream.at)   // 带过一次就不再带（第一次聊天之后就不是「刚醒来」了）
        return dreamContext(dream)
      },
    })

    api.registerMenu({
      id: 'view', order: 45, icon: '💭', group: 'look',   // 右键「👀 看看…」里
      label: '看看她的梦',
      enabled: () => fs.existsSync(file),
      hint: () => (fs.existsSync(file) ? '' : '她还没做过梦'),
      onClick: () => api.services.openPath(file),
    })
  },
}
