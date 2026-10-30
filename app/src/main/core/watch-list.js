// 一起看（2026-10-30）：「留着以后」清单 —— 桌宠这一边
//
// 清单在 ~/.bili-ai/taste.json 的 later 里，两边都写（DSH 那边 tools/lib/taste.mjs 管「加进来」「预习好了」）：
//   { bv, title, at, nextPart（下一次一起看第几 P）, parts（一共几 P）, previewed: [预习好的 P],
//     askAfter（晚点再说 → 这之前不再邀请）, removed（不想看）, done（都看完了）, together: [{ part, at, watchedTo }] }
// 主人对邀请的回答记成反应（watch / postpone / skip），算进分类的统计（core/taste.js）。
// 一起看完一 P：在视频笔记 notes.md 里记一行「和主人一起看到第 N P」，下次从下一 P 开始。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readTaste, writeTaste, recordEvent } from './taste.js'

export const POSTPONE_DAYS = 2
const DAY = 86400000
const BV_RE = /^BV[0-9A-Za-z]{10}$/

/** 还在清单里的（没被拒、没看完） */
export const laterEntries = (file) => readTaste(file).later.filter((e) => e && BV_RE.test(e.bv) && !e.removed && !e.done)

/** 能邀请的：下一 P 预习好了、不在「晚点再说」的冷却里。先加进来的先 */
export function inviteCandidate({ file, now = Date.now() }) {
  return laterEntries(file).find((e) => (e.previewed ?? []).includes(e.nextPart ?? 1) && !(e.askAfter && Date.parse(e.askAfter) > now)) ?? null
}

function update(file, bv, fn) {
  const t = readTaste(file)
  const e = t.later.find((x) => x.bv === bv)
  if (!e) return null
  fn(e)
  writeTaste(t, file)
  return e
}

/**
 * 主人回答邀请：watch 现在看 / postpone 晚点再说（至少隔 2 天再问）/ skip 不想看（移出清单，不再提）。
 * 三种都记成反应（分类统计里看得到）
 */
export function answerInvite({ file, videosRoot, bv, choice, now = Date.now() }) {
  if (!['watch', 'postpone', 'skip'].includes(choice)) return { ok: false, error: '不认识的回答' }
  const e = update(file, bv, (x) => {
    if (choice === 'postpone') x.askAfter = new Date(now + POSTPONE_DAYS * DAY).toISOString()
    if (choice === 'skip') x.removed = { at: new Date(now).toISOString() }
  })
  if (!e) return { ok: false, error: `${bv} 不在「留着以后」里` }
  recordEvent({ file, videosRoot, bv, kind: choice, now })
  return { ok: true, entry: e }
}

const p2 = (n) => String(n).padStart(2, '0')
export const fmtTime = (sec) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${p2(m)}:${p2(s % 60)}` }
const parseTime = (s) => { const parts = String(s).split(':').map(Number); return parts.some((n) => !Number.isFinite(n)) ? null : parts.reduce((a, n) => a * 60 + n, 0) }

/** 视频笔记里这一 P 的东西：标题、这一 P 的名字和时长、预习笔记（「P2｜」开头的；第 1 P 也算没写 P 的） */
export function partInfo({ videosRoot, bv, part }) {
  const dir = path.join(videosRoot, bv)
  let meta = {}
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) } catch {}
  const pages = Array.isArray(meta.pages) ? meta.pages : []
  const page = pages[part - 1]
  // 时长：pages 里有就用；只有一 P 时用 meta.duration；都没有就当 10 分钟
  const duration = Number(page?.duration) || (pages.length <= 1 && Number(meta.duration)) || 600
  const notes = []
  let text = ''
  try { text = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8') } catch {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^- \[(\d+(?::\d+){1,2})\] (.+?)（\d{4}-\d{2}-\d{2}）$/.exec(line.trim())
    if (!m) continue
    const pm = /^P(\d+)｜(.*)$/.exec(m[2])
    if (pm ? Number(pm[1]) !== part : part !== 1) continue
    const body = pm ? pm[2] : m[2]
    if (/^和主人一起看/.test(body)) continue   // 我们自己记的「一起看到第几 P」不算预习笔记
    notes.push({ at: parseTime(m[1]), text: body })
  }
  return { bv, part, title: String(meta.title ?? bv), partTitle: String(page?.part ?? ''), parts: Math.max(1, pages.length), duration, notes }
}

/**
 * 一起看完（或看到一半结束）一 P：清单里记上、下次从下一 P 开始（最后一 P 看完就从清单里拿掉），
 * 视频笔记里记一行「和主人一起看到第 N P」
 */
export function finishPart({ file, videosRoot, bv, part, watchedTo, now = Date.now() }) {
  const e = update(file, bv, (x) => {
    x.together = [...(x.together ?? []), { part, at: new Date(now).toISOString(), watchedTo: Math.round(watchedTo) }]
    x.nextPart = Math.max(x.nextPart ?? 1, part + 1)
    if (x.nextPart > (x.parts ?? 1)) x.done = { at: new Date(now).toISOString() }
    delete x.askAfter
  })
  const notes = path.join(videosRoot, bv, 'notes.md')
  if (fs.existsSync(path.dirname(notes))) {
    let prev = ''
    try { prev = fs.readFileSync(notes, 'utf8') } catch {}
    const line = `- [${fmtTime(watchedTo)}] P${part}｜和主人一起看到第 ${part} P 的 ${fmtTime(watchedTo)}（${new Date(now).toLocaleDateString('sv-SE')}）\n`
    const tmp = `${notes}.${process.pid}.${crypto.randomUUID()}.tmp`
    fs.writeFileSync(tmp, prev.replace(/\n*$/, prev ? '\n' : '') + line)
    fs.renameSync(tmp, notes)
  }
  return e
}

/** 右键「一起看的清单」用：每一项的状态 */
export function listView({ file, now = Date.now() }) {
  return laterEntries(file).map((e) => ({
    bv: e.bv, title: e.title || e.bv, nextPart: e.nextPart ?? 1, parts: e.parts ?? 1,
    previewed: (e.previewed ?? []).includes(e.nextPart ?? 1),
    watchedParts: [...new Set((e.together ?? []).map((x) => x.part))].sort((a, b) => a - b),
    postponedUntil: e.askAfter && Date.parse(e.askAfter) > now ? e.askAfter : null,
  }))
}
