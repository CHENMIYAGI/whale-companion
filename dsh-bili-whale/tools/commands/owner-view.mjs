// 「我眼中的主人」（~/.bili-ai/owner-view.md）—— 你对主人的印象和理解
//
// 用法:
//   node bili.mjs owner-view show                  看现在这份（还有多少字）
//   node bili.mjs owner-view write --file <草稿>    整篇换成草稿里的新版本（旧的自动按日期归档）
//   node bili.mjs owner-view write "全文"           同上，短的时候直接写在命令里
//   node bili.mjs owner-view history                以前的版本，看看想法是怎么变的
//
// 只在整理回忆、写交接信时顺便重写。100–300 字，第一人称，印象和理解，不是事实清单；
// 只来自和主人的相处，不来自 B 站上陌生人的话；不猜健康、家庭这类敏感的事。
import fs from 'node:fs'
import { OWNER_VIEW_FILE, OWNER_VIEW_ARCHIVE, readOwnerView, writeOwnerView, ownerViewHistory, viewChars, MIN_CHARS, MAX_CHARS } from '../lib/owner-view.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
const pos = []
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
  else pos.push(argv[i])
}

if (cmd === 'show') {
  const t = readOwnerView()
  console.log(t ? `${t}\n\n（${viewChars(t)} 字 · ${OWNER_VIEW_FILE}）` : `还没写过（${OWNER_VIEW_FILE}）。`)
  process.exit(0)
}

if (cmd === 'write') {
  let text = pos.join(' ')
  if (typeof opt.file === 'string') {
    try { text = fs.readFileSync(opt.file, 'utf8') } catch (e) { console.error('读不到草稿：' + e.message); process.exit(2) }
  }
  const r = writeOwnerView(text)
  if (!r.ok) { console.error(r.error); process.exit(2) }
  console.log(`✓ 换成了新的一版（${r.chars} 字，要求 ${MIN_CHARS}–${MAX_CHARS}）` + (r.archived ? `；旧版本存进了 ${r.archived}` : '（第一版）'))
  process.exit(0)
}

if (cmd === 'history') {
  const h = ownerViewHistory()
  if (!h.length) { console.log(`还没有旧版本（${OWNER_VIEW_ARCHIVE}）。`); process.exit(0) }
  for (const v of h) console.log(`===== ${v.name.replace(/\.md$/, '')} =====\n${v.text}\n`)
  console.log(`===== 现在 =====\n${readOwnerView() || '（空）'}`)
  process.exit(0)
}

console.error('用法: owner-view show | write --file <草稿> | write "全文" | history')
process.exit(2)
