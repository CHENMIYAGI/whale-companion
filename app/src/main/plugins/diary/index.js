// 日记：把她两本日记的末尾放进聊天上下文 —— 聊天里的她才知道自己最近看了什么、想了什么
import { readTail } from '../../core/files.js'
import fs from 'node:fs'

/** 取日记末尾，尽量从一个标题（# 开头的行）处开始，避免从半句话开始 */
export function diaryTail(file, maxChars) {
  const { text, truncated } = readTail(file, maxChars * 4)   // 汉字 3 字节，多读一点再按字数裁
  if (!text.trim()) return ''
  let s = text.length > maxChars ? text.slice(-maxChars) : text
  if (truncated || text.length > maxChars) {
    const h = s.search(/^#{1,4} /m)
    if (h > 0 && h < s.length * 0.6) s = s.slice(h)
    else s = '……' + s.slice(s.indexOf('\n') + 1)
  }
  return s.trim()
}

export default {
  id: 'diary',
  name: '日记',
  setup(api) {
    const { paths, openPath } = api.services
    const set = api.settings.get()
    const pubChars = Number(set.publicChars ?? 2400)
    const privChars = Number(set.privateChars ?? 1200)

    // order 10：日记一天才变几次，放前面能多命中缓存
    api.registerContext({
      id: 'diary', order: 10,
      build: () => {
        const pub = diaryTail(paths.diary, pubChars)
        const priv = diaryTail(paths.diaryPrivate, privChars)
        if (!pub && !priv) return '［你最近的日记］还没有写过日记。'
        return [
          pub && `［你最近的日记 · 给主人的那本（末尾）］\n${pub}`,
          priv && `［你的私人日记（末尾）］这是你自己的，可以影响你怎么说话，但别整段念给主人。\n${priv}`,
        ].filter(Boolean).join('\n\n')
      },
    })

    api.registerMenu({
      id: 'open-diary', label: '翻翻她的日记', order: 40, icon: '📖',
      enabled: () => fs.existsSync(paths.diary),
      hint: () => (fs.existsSync(paths.diary) ? '' : '她还没写过'),
      onClick: () => openPath(paths.diary),
    })
  },
}
