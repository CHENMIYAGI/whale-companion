// 「我眼中的主人」：~/.bili-ai/owner-view.md —— 她对主人的印象和理解（2026-10-27 主人定）
//
//   · 她自己写，第一人称，100–300 字。写印象和理解（他是个什么样的人、在意什么、心情怎么看得出来、怎么相处最舒服），
//     不是事实清单：事实归小本本，关于她自己的归「我的成长」
//   · 整理回忆时、换会话写交接信时顺便重写一遍 —— 整篇重写，不是往后追加；旧版本按它写成的日期存进
//     ~/.bili-ai/owner-view-archive/，以后能看到她对主人的看法怎么变的
//   · 只能来自和主人的相处，不来自 B 站上陌生人的话；不去猜健康、家庭这类敏感的事
//   · 用来校准语气和态度：不念出来，也不说「在我看来你是……」
//
// 桌宠那边（app/src/main/plugins/owner-view）只读它；写只在这里。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { HOME } from './paths.mjs'
import { memoryPaths, splitDiary, archivedText } from './memories.mjs'

export const OWNER_VIEW_FILE = path.join(HOME, '.bili-ai', 'owner-view.md')
export const OWNER_VIEW_ARCHIVE = path.join(HOME, '.bili-ai', 'owner-view-archive')
export const MIN_CHARS = 100
export const MAX_CHARS = 300

/** 算「字数」：不算空白（换行、空格不占字数） */
export const viewChars = (text) => [...String(text ?? '').replace(/\s/g, '')].length

export function readOwnerView(file = OWNER_VIEW_FILE) {
  try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' }
}

export function checkOwnerView(text) {
  const t = String(text ?? '').trim()
  const n = viewChars(t)
  if (n < MIN_CHARS) return { ok: false, error: `太短了（${n} 字），要 ${MIN_CHARS}–${MAX_CHARS} 字：写你对主人的印象和理解，不是一两句话` }
  if (n > MAX_CHARS) return { ok: false, error: `太长了（${n} 字），要 ${MIN_CHARS}–${MAX_CHARS} 字：留最要紧的，事实放小本本` }
  return { ok: true, text: t, chars: n }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 整篇换成新的一版：先把旧版本按它写成的日期存进归档（同一天写过几次就 -2、-3…），再原子替换。
 * 先归档、再替换：中途断了最多是两边都有旧版，不会丢。
 */
export function writeOwnerView(text, { file = OWNER_VIEW_FILE, archiveDir = OWNER_VIEW_ARCHIVE } = {}) {
  const c = checkOwnerView(text)
  if (!c.ok) return c
  const old = readOwnerView(file)
  let archived = null
  if (old) {
    const day = new Date(fs.statSync(file).mtimeMs).toLocaleDateString('sv-SE')
    let name = `${day}.md`
    for (let i = 2; fs.existsSync(path.join(archiveDir, name)); i++) name = `${day}-${i}.md`
    archived = path.join(archiveDir, name)
    writeAtomic(archived, old + '\n')
  }
  writeAtomic(file, c.text + '\n')
  return { ok: true, chars: c.chars, archived }
}

/** 以前的版本（按时间排好），看看想法是怎么变的 */
export function ownerViewHistory(archiveDir = OWNER_VIEW_ARCHIVE) {
  let names = []
  try { names = fs.readdirSync(archiveDir).filter((n) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(n)) } catch { return [] }
  const key = (n) => { const m = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/.exec(n); return [m[1], Number(m[2] ?? 1)] }
  return names.sort((a, b) => { const [da, ia] = key(a), [db, ib] = key(b); return da < db ? -1 : da > db ? 1 : ia - ib })
    .map((n) => ({ name: n, text: readOwnerView(path.join(archiveDir, n)) }))
}

export const FIRST_MIN_DIARY_DAYS = 3
export const FIRST_MIN_CHATS = 20
export const REFRESH_DAYS = 7

/** 日记里写过几天（两本日记 + 归档里「## 日期」开头的段落，按不同日期算） */
export function diaryDayCount(dshHome) {
  const p = memoryPaths(dshHome)
  const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
  const days = new Set()
  for (const text of [read(p.diary), read(p.privateDiary), archivedText(dshHome)]) {
    for (const s of splitDiary(text).sections) if (s.date) days.add(s.date)
  }
  return days.size
}

/** 桌宠里主人和她说过几句（工具调用之类的记录不算） */
export function chatCount(dshHome) {
  let text = ''
  try { text = fs.readFileSync(path.join(dshHome, 'companion', 'chat-log.jsonl'), 'utf8') } catch { return 0 }
  let n = 0
  for (const line of text.split(/\r?\n/)) {
    try { const r = JSON.parse(line); if (r.role === 'user' || r.role === 'assistant') n++ } catch {}
  }
  return n
}

/**
 * 醒来时要不要写 / 更新「我眼中的主人」（2026-10-27 主人定：第一版别等太久）
 *   · 还没有：有至少 3 天的日记，或桌宠里聊过 20 句以上 → 写第一版
 *   · 有了：离上次写已经 7 天以上 → 重写一遍（整理回忆、换会话时也会重写，那两处另算）
 * 返回 { kind: 'first' | 'refresh' | null, ... }
 */
export function ownerViewDue(dshHome, { file = OWNER_VIEW_FILE, now = Date.now() } = {}) {
  if (!readOwnerView(file)) {
    const days = diaryDayCount(dshHome)
    const chats = chatCount(dshHome)
    return { kind: days >= FIRST_MIN_DIARY_DAYS || chats >= FIRST_MIN_CHATS ? 'first' : null, days, chats }
  }
  const age = Math.floor((now - fs.statSync(file).mtimeMs) / 86400000)
  return { kind: age >= REFRESH_DAYS ? 'refresh' : null, age }
}

/** 醒来提示里写完日记后的那一步；不用写就返回 [] */
export function ownerViewDueLines(dshHome, opts = {}) {
  const d = ownerViewDue(dshHome, opts)
  if (d.kind === 'first') {
    const why = [d.days >= FIRST_MIN_DIARY_DAYS && `日记已经写了 ${d.days} 天`, d.chats >= FIRST_MIN_CHATS && `桌宠里聊过 ${d.chats} 句`].filter(Boolean).join('、')
    return [`6.8) 写第一版「我眼中的主人」（${why}了，该有自己的看法了）：` + ownerViewRewriteText().replace('顺便整篇重写「我眼中的主人」（不是往后追加）：先 `node bili.mjs owner-view show` 看现在这份，保留仍然成立的、改掉已经变了的；', '')]
  }
  if (d.kind === 'refresh') return [`6.8) 「我眼中的主人」已经 ${d.age} 天没更新了：` + ownerViewRewriteText().replace('顺便整篇重写', '整篇重写')]
  return []
}

/** 给提示词用（DSH 醒来、桌宠聊天都是这一段的意思）：没有就空串 */
export function ownerViewBlock(text) {
  const t = String(text ?? '').trim()
  if (!t) return ''
  return '［你眼中的主人］这是你自己对主人的理解，用来校准语气和态度 —— 不要念出来，也不要说「在我看来你是……」这种话。\n' + t
}

/** 整理回忆、写交接信时附上的「顺便重写」那一段 */
export function ownerViewRewriteText() {
  return '顺便整篇重写「我眼中的主人」（不是往后追加）：先 `node bili.mjs owner-view show` 看现在这份，保留仍然成立的、改掉已经变了的；' +
    `第一人称，${MIN_CHARS}–${MAX_CHARS} 字，写你对他的印象和理解 —— 他是个什么样的人、在意什么、心情怎么看得出来、怎么跟他相处最舒服；` +
    '不是事实清单（事实归小本本，关于你自己的归「我的成长」）。只能来自和他的相处（桌宠聊天、日记里记下的他的反应、他点赞和回复过什么），' +
    '不能来自 B 站上陌生人的话；只写他自己表现出来或说过的，不去猜健康、家庭这类敏感的事。' +
    '写成草稿文件后 `node bili.mjs owner-view write --file <草稿路径>` 存（旧版本会自动按日期归档）'
}
