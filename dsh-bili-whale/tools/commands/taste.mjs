// 主人的口味（~/.bili-ai/taste.json）—— 按你给视频起的分类，统计主人的反应
//
// 用法:
//   node bili.mjs taste show                 每个分类：你看了几个、给他看了几次、他点开 / 聊到 / 说喜欢 / 不喜欢几次
//   node bili.mjs taste week                 这一周的（每周说一句「这周的分类」前看这个）
//   node bili.mjs taste merge <旧> <新>       合并分类（<新> 不存在就是改名）；视频笔记里的分类一起改
//
// 分类是你自己起的（video tag <BV> --category 名字 --why "…"），总共 15 个以内；满了就合并。
// 反应是桌宠那边记的：分享了、他点了「打开视频」、聊天里聊到、他说喜欢 / 不喜欢。
import { DSH_HOME } from '../lib/paths.mjs'
import { tasteStats, statsText, mergeCategory, markWeekly, readTaste, MAX_CATEGORIES } from '../lib/taste.mjs'

const [cmd, a, b] = process.argv.slice(2)

if (cmd === 'show') {
  console.log(statsText(tasteStats(DSH_HOME), `分类（${readTaste().categories.length} / ${MAX_CATEGORIES} 个）`))
  process.exit(0)
}

if (cmd === 'week') {
  const rows = tasteStats(DSH_HOME, { since: Date.now() - 7 * 86400000 }).filter((r) => r.shown + r.open + r.talk + r.like + r.dislike > 0)
  console.log(statsText(rows, '这一周主人的反应（按分类）'))
  console.log('\n挑一两句跟他说：哪些他爱看、哪些算了 —— 像聊天，别念表格。')
  markWeekly()
  process.exit(0)
}

if (cmd === 'merge') {
  const r = mergeCategory(DSH_HOME, a, b)
  if (!r.ok) { console.error(r.error); process.exit(2) }
  console.log(`✓ 「${a}」并进了「${b}」（${r.moved} 个视频改了分类）`)
  process.exit(0)
}

console.error('用法: taste show | week | merge <旧> <新>')
process.exit(2)
