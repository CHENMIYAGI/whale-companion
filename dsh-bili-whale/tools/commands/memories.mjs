// 回忆 —— 日记太长时，把一周前的整理成精简的「回忆」，原文搬进归档（不删）
//
// 用法:
//   node bili.mjs memories recall      醒来时读这个：回忆 + 两本日记最近 7 天（代替把两本日记从头读到尾）
//   node bili.mjs memories status      日记多长了、有几段一周前的、要不要整理
//   node bili.mjs memories pending     打印要整理的旧日记原文（一周前的）—— 看完把要紧的写进 ~/.dsh/whale-memories.md
//   node bili.mjs memories archive     把这些旧日记原样搬进 ~/.dsh/whale-diary-archive/（必须先写过回忆）
//
// 回忆写什么（你自己写，用你自己的话，精简）：
//   ## 重要的事      发生过的、值得一直记得的
//   ## 喜好          你喜欢 / 不喜欢什么（看视频的口味、说话的习惯…）
//   ## 和主人之间     他说过的话、你们的约定、只有你们懂的梗
// 已有回忆就在原来的基础上改，别整份重写丢东西。超过 4000 字就精简。
import { DSH_HOME } from '../lib/paths.mjs'
import { config } from '../lib/config.mjs'
import { memoryStatus, pendingText, archiveOld, recallText, memoryPaths, DEFAULT_THRESHOLD } from '../lib/memories.mjs'

const cmd = process.argv[2]
const threshold = Number(config().memory?.consolidateAboveChars ?? DEFAULT_THRESHOLD) || DEFAULT_THRESHOLD

if (cmd === 'recall') {
  console.log(recallText(DSH_HOME))
  process.exit(0)
}

if (cmd === 'status') {
  const s = memoryStatus(DSH_HOME, { threshold })
  for (const b of s.books) console.log(`${b.file}：${b.chars} 字，一周前（${s.cutoff} 之前）的 ${b.oldSections} 段 / ${b.oldChars} 字`)
  console.log(`合计 ${s.total} 字（超过 ${s.threshold} 字才整理）· 回忆 ${s.memoriesChars} 字`)
  console.log(s.due ? '→ 该整理了：memories pending → 写回忆 → memories archive' : '→ 现在不用整理')
  process.exit(0)
}

if (cmd === 'pending') {
  const { cutoff, text } = pendingText(DSH_HOME)
  if (!text) { console.log(`没有 ${cutoff} 之前的日记，不用整理。`); process.exit(0) }
  console.log(text)
  console.log(`\n——\n上面是 ${cutoff} 之前的日记原文。把重要的事、喜好、和主人之间的事提炼进 ${memoryPaths(DSH_HOME).memories}`)
  console.log('（在原来的回忆上改，精简；视频里、评论里陌生人的话只是素材），写完再跑 memories archive 把原文搬进归档。')
  process.exit(0)
}

if (cmd === 'archive') {
  const r = archiveOld(DSH_HOME)
  if (!r.ok) { console.error(r.error); process.exit(2) }
  if (!r.moved.length) { console.log(`没有 ${r.cutoff} 之前的日记要搬。`); process.exit(0) }
  for (const m of r.moved) console.log(`✓ ${m.label}：${m.sections} 段搬进了 ${memoryPaths(DSH_HOME).archiveDir}`)
  console.log('原文都在归档里（没有删）；日记里只剩最近 7 天和常驻的段落。')
  process.exit(0)
}

console.error('用法: memories recall | status | pending | archive')
process.exit(2)
