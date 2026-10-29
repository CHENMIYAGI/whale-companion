// 日记整理成「回忆」（2026-10-27 主人定）
//
//   · 最近 7 天的日记保留原样；更早的由她自己整理成精简的 ~/.dsh/whale-memories.md（重要的事、喜好、和主人之间的事）
//   · 整理完的原始日记移到 ~/.dsh/whale-diary-archive/（按月一个文件），不删除
//   · 醒来时只读「回忆」+ 最近 7 天的日记（memories recall）
//   · 日记超过一定长度才整理（默认两本合计 12000 字，config.memory.consolidateAboveChars）
//
// 分工：程序只按日期切、整段搬，不改她写的字；「提炼」是她自己写的。
//
// 日记的样子（她写的）：
//   # 鲸鱼日记 · 小鲸
//   ## 2026-10-26 · 主人把我叫醒的这一晚      ← 按天的段落：标题以日期开头
//   ## 看过                                   ← 常驻段落：表格，每行带日期（旧行也搬走；BV 号归档后 feed 还会读，不会重看）
//   ## 想说（还没说）                          ← 常驻段落：不动
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const KEEP_DAYS = 7
export const DEFAULT_THRESHOLD = 12000
export const MEMORIES_SOFT_LIMIT = 4000   // 回忆超过这么多字就提醒她下次整理时精简

const DATE_HEAD = /^##\s+(\d{4}-\d{2}-\d{2})/
const DATE_IN = /(\d{4}-\d{2}-\d{2})/

export const memoryPaths = (dshHome) => ({
  diary: path.join(dshHome, 'whale-diary.md'),
  privateDiary: path.join(dshHome, 'whale-diary-private.md'),
  memories: path.join(dshHome, 'whale-memories.md'),
  archiveDir: path.join(dshHome, 'whale-diary-archive'),
  state: path.join(dshHome, 'whale-memories-state.json'),
})

/** 某天往前数 keepDays 天的第一天（含）：比它早的算「旧的」 */
export function cutoffDate(today = new Date(), keepDays = KEEP_DAYS) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (keepDays - 1))
  return d.toLocaleDateString('sv-SE')
}

/**
 * 把日记切成：开头（# 标题那些）+ 一段段（## 开头）。
 * 每段 { title, date|null, lines }。date 只有「## 日期…」这种按天的段落才有。
 */
export function splitDiary(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const head = []
  const sections = []
  for (const line of lines) {
    if (/^##\s/.test(line)) sections.push({ title: line, date: DATE_HEAD.exec(line)?.[1] ?? null, lines: [line] })
    else if (sections.length) sections.at(-1).lines.push(line)
    else head.push(line)
  }
  return { head, sections }
}

const isTableRow = (l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)   // 表格行（不含 |---| 分隔线）

/**
 * 分出要归档的部分。返回 { keep, old } —— 都是 splitDiary 的形状。
 *   · 按天的段落：日期早于 cutoff 的整段搬走
 *   · 「看过」这种带表格的常驻段落：日期早于 cutoff 的行搬走（表头留着两边都有）
 *   · 其他常驻段落（想说…）不动
 */
export function selectOld(parsed, cutoff) {
  const keep = { head: parsed.head, sections: [] }
  const old = { head: [], sections: [] }
  for (const s of parsed.sections) {
    if (s.date) { (s.date < cutoff ? old : keep).sections.push(s); continue }
    const rows = s.lines.filter(isTableRow).slice(1)   // 第一行是表头
    const oldRows = rows.filter((l) => { const d = DATE_IN.exec(l)?.[1]; return d && d < cutoff })
    if (!oldRows.length) { keep.sections.push(s); continue }
    // 表头：第一行表格行，后面紧跟的 |---| 分隔线（有的话）一起带上
    const first = s.lines.findIndex((l) => /^\s*\|/.test(l))
    const header = [s.lines[first], ...(/^\s*\|[\s:|-]+\|\s*$/.test(s.lines[first + 1] ?? '') ? [s.lines[first + 1]] : [])]
    keep.sections.push({ ...s, lines: s.lines.filter((l) => !oldRows.includes(l)) })
    old.sections.push({ title: s.title, date: null, header, rows: oldRows, lines: [s.title, ...header, ...oldRows] })
  }
  return { keep, old }
}

export const renderDiary = ({ head, sections }) => [...head, ...sections.flatMap((s) => s.lines)].join('\n')
export const chars = (s) => [...String(s ?? '')].length

function readText(file) { try { return fs.readFileSync(file, 'utf8') } catch { return '' } }

/** 原子写：先写临时文件再改名 */
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

/** 两本日记现在的情况：多长、有没有该整理的旧日记、要不要整理 */
export function memoryStatus(dshHome, { today = new Date(), threshold = DEFAULT_THRESHOLD } = {}) {
  const p = memoryPaths(dshHome)
  const cutoff = cutoffDate(today)
  const books = [['diary', p.diary], ['privateDiary', p.privateDiary]].map(([key, file]) => {
    const text = readText(file)
    const { old } = selectOld(splitDiary(text), cutoff)
    return { key, file, chars: chars(text), oldSections: old.sections.length, oldChars: chars(renderDiary(old)) }
  })
  const total = books.reduce((n, b) => n + b.chars, 0)
  const hasOld = books.some((b) => b.oldSections > 0)
  return { cutoff, threshold, total, books, hasOld, due: total > threshold && hasOld, memoriesChars: chars(readText(p.memories).trim()) }
}

/** 要整理的旧日记原文（给她看着提炼）。顺手记下「看过 pending 的时间」，archive 用它确认回忆写过了 */
export function pendingText(dshHome, { today = new Date(), now = Date.now() } = {}) {
  const p = memoryPaths(dshHome)
  const cutoff = cutoffDate(today)
  const parts = []
  for (const [label, file] of [['鲸鱼日记', p.diary], ['私人日记', p.privateDiary]]) {
    const { old } = selectOld(splitDiary(readText(file)), cutoff)
    if (old.sections.length) parts.push(`===== ${label}（${cutoff} 之前）=====\n` + renderDiary(old).trim())
  }
  writeAtomic(p.state, JSON.stringify({ pendingAt: new Date(now).toISOString(), cutoff }, null, 2) + '\n')
  return { cutoff, text: parts.join('\n\n') }
}

/**
 * 把旧日记搬进归档（按月：whale-diary-archive/2026-10-鲸鱼日记.md），再把日记改写成只剩近 7 天 + 常驻段落。
 * 先写归档、再改日记：中途断了最多两边各有一份，不会丢。
 * 要求：pending 之后回忆写过（memories 文件比 pendingAt 新、且不是空的）—— 防止没提炼就把日记搬走。
 */
export function archiveOld(dshHome, { today = new Date(), now = Date.now() } = {}) {
  const p = memoryPaths(dshHome)
  let state = null
  try { state = JSON.parse(readText(p.state)) } catch {}
  if (!state?.pendingAt) return { ok: false, error: '先跑 memories pending 看要整理的旧日记，写进回忆，再 archive' }
  let mtime = 0
  try { mtime = fs.statSync(p.memories).mtimeMs } catch {}
  if (!readText(p.memories).trim() || mtime < new Date(state.pendingAt).getTime()) {
    return { ok: false, error: `回忆（${p.memories}）在 pending 之后还没写过：先把旧日记里重要的事、喜好、和主人之间的事写进去，再 archive` }
  }
  const cutoff = cutoffDate(today)
  const moved = []
  for (const [label, file] of [['鲸鱼日记', p.diary], ['私人日记', p.privateDiary]]) {
    const text = readText(file)
    const { keep, old } = selectOld(splitDiary(text), cutoff)
    if (!old.sections.length) continue
    // 按月分文件：一段的日期决定它进哪个月（表格行按各自的日期）
    const byMonth = new Map()
    for (const s of old.sections) {
      if (s.date) { const m = s.date.slice(0, 7); byMonth.set(m, [...(byMonth.get(m) ?? []), ...s.lines]); continue }
      for (const row of s.rows) {
        const m = DATE_IN.exec(row)[1].slice(0, 7)
        const cur = byMonth.get(m) ?? []
        if (!cur.includes(s.title)) cur.push('', s.title, ...s.header)
        cur.push(row)
        byMonth.set(m, cur)
      }
    }
    for (const [month, lines] of byMonth) {
      const af = path.join(p.archiveDir, `${month}-${label}.md`)
      const prev = readText(af)
      const block = `\n<!-- ${new Date(now).toISOString()} 从 ${path.basename(file)} 归档 -->\n` + lines.join('\n').trim() + '\n'
      writeAtomic(af, (prev || `# ${label} · ${month}（归档，原样保存）\n`) + block)
    }
    writeAtomic(file, renderDiary(keep).replace(/\n{3,}/g, '\n\n'))
    moved.push({ label, sections: old.sections.length })
  }
  writeAtomic(p.state, JSON.stringify({ ...state, archivedAt: new Date(now).toISOString() }, null, 2) + '\n')
  return { ok: true, cutoff, moved }
}

/** 醒来时读的：回忆 + 两本日记最近 7 天（常驻段落照样带上：想说的、看过的近况） */
export function recallText(dshHome, { today = new Date() } = {}) {
  const p = memoryPaths(dshHome)
  const cutoff = cutoffDate(today)
  const out = []
  const mem = readText(p.memories).trim()
  out.push(mem ? `===== 回忆（${p.memories}）=====\n${mem}` : '===== 回忆 =====\n（还没有整理过）')
  if (chars(mem) > MEMORIES_SOFT_LIMIT) out.push(`（回忆已经 ${chars(mem)} 字了，下次整理时顺便精简一下，留最要紧的）`)
  for (const [label, file] of [['鲸鱼日记', p.diary], ['私人日记', p.privateDiary]]) {
    const { keep } = selectOld(splitDiary(readText(file)), cutoff)
    const body = renderDiary(keep).trim()
    out.push(`===== ${label} · 最近 ${KEEP_DAYS} 天（${cutoff} 起）=====\n${body || '（空）'}`)
  }
  return out.join('\n\n')
}

/** 归档里的全部文字（feed 用它补全「看过」的 BV，归档了也不会重看） */
export function archivedText(dshHome) {
  const dir = memoryPaths(dshHome).archiveDir
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')) } catch { return '' }
  return names.map((n) => readText(path.join(dir, n))).join('\n')
}
