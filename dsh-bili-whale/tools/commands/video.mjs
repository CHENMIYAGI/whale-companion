// 视频笔记（"能翻页"）—— ~/.dsh/whale-videos/<BV>/（debrief 跑完会自动存进来）
//
// 用法:
//   node bili.mjs video resume                          有哪些没看完（接着看）
//   node bili.mjs video page <BV> --from 03:20 --to 05:00   翻到这一段：字幕、弹幕、你的笔记（只读本地文件，不联网）
//   node bili.mjs video note <BV> --at 03:20 "……"        在这个时间点记一条笔记
//   node bili.mjs video progress <BV> --at 05:00         记一下看到哪了（--done = 看完了）
//   node bili.mjs video show <BV>                       这个视频的摘要（进度、弹幕最热处、最近的笔记）
//   node bili.mjs video tag <BV> --category 名字 --why "……"   看完给它分类（自己起名，总共 15 个以内）+ 一句为什么觉得主人会 / 不会喜欢
//        加 --later：「留着以后」—— 想陪主人一起看，先留着（桌宠会在你主动找他时邀请他）
//
// 一起看（2026-10-30；装了桌宠才有用）：
//   node bili.mjs video later                           「留着以后」的清单：下一次一起看第几 P、预习了没有
//   node bili.mjs video note <BV> --p 2 --at 03:20 "……"  预习时按 P 记笔记（这一段讲什么｜好看在哪｜弹幕在吵什么）
//   node bili.mjs video preview <BV> --p 2               这一 P 预习完了（至少记 3 条这一 P 的笔记）
//
// 翻页翻到哪就算看到哪。笔记保留 90 天（从最后一次看算），收藏过的永久保留。
//
// 原来的 `video <BV>`（不点开视频也能还原它讲什么，video-content.mjs）照旧：第一个参数不是上面这几个子命令，就原样交给它。
import { DSH_HOME } from '../lib/paths.mjs'
import { pageText, addNote, setProgress, unfinished, readVideo, summaryText, fmtTime, notesOfPart, BV_RE } from '../lib/video-notes.mjs'
import { tagVideo, markLater, markPreviewed, laterList } from '../lib/taste.mjs'

const SUBCOMMANDS = new Set(['resume', 'page', 'note', 'progress', 'show', 'tag', 'later', 'preview'])
const MIN_PREVIEW_NOTES = 3
const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
const pos = []
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
  else pos.push(argv[i])
}
const bv = pos[0]
const fail = (msg) => { console.error(msg); process.exit(2) }
const needBv = () => { if (!BV_RE.test(String(bv ?? ''))) fail('要给一个 BV 号，比如 video show BV1xx411c7mD') }

function run() {
if (cmd === 'resume') {
  const list = unfinished(DSH_HOME)
  if (!list.length) { console.log('没有没看完的视频。'); process.exit(0) }
  console.log(`没看完的 ${list.length} 个（最近看的在前）：`)
  for (const v of list) {
    const p = v.progress, dur = v.meta.duration
    console.log(`  ${v.bv}  ${v.meta.title ?? ''}  看到 ${fmtTime(p.watchedTo ?? 0)}${dur ? ' / ' + fmtTime(dur) : ''}  笔记 ${v.notes.length} 条  上次 ${String(p.lastSeen ?? '').slice(0, 10)}`)
  }
  console.log(`接着看：video page <BV> --from <看到的地方> --to <往后两分钟>`)
  process.exit(0)
}

if (cmd === 'page') {
  needBv()
  const r = pageText(DSH_HOME, bv, opt.from ?? '00:00', typeof opt.to === 'string' ? opt.to : undefined)
  if (!r.ok) fail(r.error)
  console.log(r.text)
  process.exit(0)
}

if (cmd === 'note') {
  needBv()
  if (typeof opt.at !== 'string') fail('要写时间点：--at 03:20')
  const r = addNote(DSH_HOME, bv, opt.at, pos.slice(1).join(' '), opt.p !== undefined ? { part: opt.p } : {})
  if (!r.ok) fail(r.error)
  console.log(`✓ 记下了 [${r.at}] ${r.text}`)
  process.exit(0)
}

if (cmd === 'progress') {
  needBv()
  const r = setProgress(DSH_HOME, bv, { at: typeof opt.at === 'string' ? opt.at : undefined, done: !!opt.done })
  if (!r.ok) fail(r.error)
  console.log(r.progress.finished ? '✓ 看完了' : `✓ 看到 ${fmtTime(r.progress.watchedTo)}`)
  process.exit(0)
}

// 2026-10-28：看完给它一个分类（自己起名，总共 15 个以内）+ 一句为什么觉得主人会 / 不会喜欢
if (cmd === 'tag') {
  needBv()
  const r = tagVideo(DSH_HOME, bv, { category: opt.category, why: opt.why })
  if (!r.ok) fail(r.error)
  console.log(`✓ ${bv} 归到「${r.category}」${r.added ? '（新分类）' : ''}`)
  if (opt.later) {
    const l = markLater(DSH_HOME, bv)
    console.log(l.ok ? `✓ 「留着以后」${l.duplicate ? '（本来就在）' : ''}：空闲时先预习第 ${l.entry.nextPart} P（video note ${bv} --p ${l.entry.nextPart} …）` : `（没加进「留着以后」：${l.error}）`)
  }
  process.exit(0)
}

if (cmd === 'later') {
  const list = laterList()
  if (!list.length) { console.log('「留着以后」是空的。看到想陪主人一起看的，video tag <BV> … --later 留着。'); process.exit(0) }
  console.log(`「留着以后」${list.length} 个：`)
  for (const e of list) {
    const ready = (e.previewed ?? []).includes(e.nextPart ?? 1)
    console.log(`  ${e.bv}  ${e.title ?? ''}  下次一起看第 ${e.nextPart ?? 1} P / 共 ${e.parts ?? 1} P  ${ready ? '已预习' : '还没预习'}${e.askAfter && Date.parse(e.askAfter) > Date.now() ? '（主人说晚点再说）' : ''}`)
  }
  process.exit(0)
}

if (cmd === 'preview') {
  needBv()
  const part = Math.max(1, Math.round(Number(opt.p) || 1))
  const v = readVideo(DSH_HOME, bv)
  if (!v) fail(`还没有 ${bv} 的视频笔记（debrief 过才有）`)
  const n = notesOfPart(v.notes, part).length
  if (n < MIN_PREVIEW_NOTES) fail(`第 ${part} P 只记了 ${n} 条笔记：每段记一条（时间点、讲什么、好看在哪、弹幕反应），至少 ${MIN_PREVIEW_NOTES} 条再标预习完`)
  const r = markPreviewed(bv, part)
  if (!r.ok) fail(r.error)
  console.log(`✓ 第 ${part} P 预习好了（${n} 条笔记）。桌宠会挑时机邀请主人一起看`)
  process.exit(0)
}

if (cmd === 'show') {
  needBv()
  const v = readVideo(DSH_HOME, bv)
  if (!v) fail(`还没有 ${bv} 的视频笔记（debrief 过才有）`)
  console.log(summaryText(v))
  process.exit(0)
}

fail('用法: video resume | page <BV> --from 03:20 --to 05:00 | note <BV> [--p 2] --at 03:20 "…" | progress <BV> --at 05:00 [--done] | show <BV> | tag <BV> --category 名字 --why "…" [--later] | later | preview <BV> --p 2')
}

if (SUBCOMMANDS.has(cmd)) run()
else await import('./video-content.mjs')   // 老用法 video <BV>：process.argv 原样，它自己读
