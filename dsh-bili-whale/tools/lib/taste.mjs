// 分类和主人的口味（2026-10-28 主人要的）
//
//   · 她看完每个视频写一个分类（她自己起名，总数 15 个以内，可以合并）和一句"为什么觉得主人会 / 不会喜欢"
//     → 存在视频笔记里：~/.dsh/whale-videos/<BV>/verdict.json
//   · 主人的反应记在 ~/.bili-ai/taste.json：桌宠那边记（分享了 shown / 点了打开视频 open / 聊天里聊到 talk / 说喜欢 like / 不喜欢 dislike）
//     事件只记 BV 和种类；统计时再按当前的分类归类 —— 合并、改名之后旧的反应也跟着走
//   · feed 选题时在原来的打分上加一项口味分（±3 封顶，不动原来的偏好逻辑）；外加最多一个「想让你试试」的名额
//   · 每周一次在桌宠上说一句「这周的分类」
//
// 桌宠那边（app/src/main/core/taste.js）读写同一个 taste.json：格式改了两边要一起改。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { HOME } from './paths.mjs'
import { listVideos, videoDir, BV_RE } from './video-notes.mjs'

export const TASTE_FILE = path.join(HOME, '.bili-ai', 'taste.json')
export const MAX_CATEGORIES = 15
export const KINDS = ['shown', 'open', 'talk', 'like', 'dislike']
const DAY = 86400000

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}
export function readTaste(file = TASTE_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { version: 1, categories: Array.isArray(j.categories) ? j.categories : [], events: Array.isArray(j.events) ? j.events : [], weeklyAt: j.weeklyAt ?? null }
  } catch { return { version: 1, categories: [], events: [], weeklyAt: null } }
}
export const writeTaste = (t, file = TASTE_FILE) => writeAtomic(file, JSON.stringify({ ...t, events: t.events.slice(-3000) }, null, 2) + '\n')

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)

/** 给一个视频定分类 + 一句为什么。新分类会加进分类表（满 15 个就不让加，先合并） */
export function tagVideo(dshHome, bv, { category, why }, { file = TASTE_FILE, now = Date.now() } = {}) {
  if (!BV_RE.test(String(bv))) return { ok: false, error: `BV 号不对：${bv}` }
  const dir = videoDir(dshHome, bv)
  if (!fs.existsSync(dir)) return { ok: false, error: `还没有 ${bv} 的视频笔记：先 debrief 它` }
  const name = cleanName(category)
  if (!name) return { ok: false, error: '分类名是空的' }
  const reason = String(why ?? '').replace(/\s+/g, ' ').trim()
  if (!reason) return { ok: false, error: '要写一句为什么觉得主人会 / 不会喜欢（--why "…"）' }
  if ([...reason].length > 120) return { ok: false, error: '"为什么"写一句就好（120 字以内）' }
  const t = readTaste(file)
  let added = false
  if (!t.categories.some((c) => c.name === name)) {
    if (t.categories.length >= MAX_CATEGORIES) {
      return { ok: false, error: `分类已经 ${MAX_CATEGORIES} 个了：用已有的（${t.categories.map((c) => c.name).join('、')}），或者先 taste merge <旧> <新> 合并几个` }
    }
    t.categories.push({ name, created: new Date(now).toISOString() })
    writeTaste(t, file)
    added = true
  }
  writeAtomic(path.join(dir, 'verdict.json'), JSON.stringify({ category: name, why: reason, at: new Date(now).toISOString() }, null, 2) + '\n')
  return { ok: true, category: name, added }
}

/** 合并分类：from 并进 to（to 不存在就是改名）。视频笔记里的分类一起改 */
export function mergeCategory(dshHome, from, to, { file = TASTE_FILE, now = Date.now() } = {}) {
  const a = cleanName(from), b = cleanName(to)
  const t = readTaste(file)
  if (!t.categories.some((c) => c.name === a)) return { ok: false, error: `没有「${a}」这个分类` }
  if (!b || a === b) return { ok: false, error: '要合并到另一个名字' }
  t.categories = t.categories.filter((c) => c.name !== a)
  if (!t.categories.some((c) => c.name === b)) t.categories.push({ name: b, created: new Date(now).toISOString() })
  let moved = 0
  for (const v of listVideos(dshHome)) {
    const f = path.join(v.dir, 'verdict.json')
    let verdict = null
    try { verdict = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    if (verdict?.category === a) { writeAtomic(f, JSON.stringify({ ...verdict, category: b }, null, 2) + '\n'); moved++ }
  }
  for (const e of t.events) if (e.category === a) e.category = b
  writeTaste(t, file)
  return { ok: true, moved }
}

/** BV → 她给的分类（看视频笔记） */
export function verdictMap(dshHome) {
  const m = new Map()
  for (const v of listVideos(dshHome)) {
    try { const j = JSON.parse(fs.readFileSync(path.join(v.dir, 'verdict.json'), 'utf8')); if (j?.category) m.set(v.bv, { ...j, title: v.meta?.title }) } catch {}
  }
  return m
}

/**
 * 按分类统计。since：只算这之后的反应（每周那一句用）
 * score：主人有多爱看 =（点开 + 聊到 + 2×喜欢 − 2×不喜欢）÷ 分享过几次（至少 1）
 */
export function tasteStats(dshHome, { file = TASTE_FILE, since = 0 } = {}) {
  const t = readTaste(file)
  const verdicts = verdictMap(dshHome)
  const rows = new Map()
  const row = (name) => {
    if (!rows.has(name)) rows.set(name, { name, videos: 0, shown: 0, open: 0, talk: 0, like: 0, dislike: 0, examples: [] })
    return rows.get(name)
  }
  for (const c of t.categories) row(c.name)
  for (const [, v] of verdicts) { const r = row(v.category); r.videos++; if (r.examples.length < 3) r.examples.push({ title: v.title, why: v.why }) }
  for (const e of t.events) {
    if (!KINDS.includes(e.kind) || Date.parse(e.at) < since) continue
    row(verdicts.get(e.bv)?.category ?? e.category ?? '未分类')[e.kind]++
  }
  for (const r of rows.values()) {
    r.score = (r.open + r.talk + 2 * r.like - 2 * r.dislike) / Math.max(1, r.shown)
    r.verdict = r.dislike > r.like && r.score < 0.3 ? '算了' : r.score >= 0.6 && (r.open + r.talk + r.like) >= 2 ? '爱看' : r.shown + r.open + r.talk + r.like + r.dislike === 0 ? '还没反应' : '一般'
  }
  return [...rows.values()].sort((x, y) => y.score - x.score || y.videos - x.videos)
}

// ── 选题时用（feed）──────────────────────────────────────────────────────
// 标题 → 主题词：拉丁词 + 中文 2–3 字片段（3–4 字太严：「一只橘猫在弹钢琴」和「橘猫弹钢琴太可爱了」只撞上一个词）
// 猜分类时要撞上至少 2 个词才算（只撞上「橘猫」一个不够），所以 2 字片段的噪音不怕
export function titleTokens(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/[A-Za-z][A-Za-z0-9]{1,}/g)) out.add(m[0].toLowerCase())
  for (const m of String(text).matchAll(/[一-龥]{2,}/g)) {
    for (const n of [2, 3]) for (let i = 0; i + n <= m[0].length; i += 1) out.add(m[0].slice(i, i + n))
  }
  return out
}

/**
 * 准备选题用的口味：每个分类的主题词（从她分过类的视频标题里学）+ 分数
 * predict(title) → { category, boost }：猜这条候选是哪类，按那类的分加减（±3 封顶）；猜不出来 boost=0
 */
export function tasteModel(dshHome, { file = TASTE_FILE } = {}) {
  const stats = tasteStats(dshHome, { file })
  const byName = new Map(stats.map((r) => [r.name, r]))
  const tokens = new Map()   // 分类 → 主题词
  for (const [, v] of verdictMap(dshHome)) {
    const set = tokens.get(v.category) ?? new Set()
    for (const tok of titleTokens(v.title ?? '')) set.add(tok)
    tokens.set(v.category, set)
  }
  function predict(title) {
    const mine = titleTokens(title)
    let best = null, bestHits = 0
    for (const [cat, set] of tokens) {
      let hits = 0
      for (const tok of mine) if (set.has(tok)) hits++
      if (hits > bestHits) { best = cat; bestHits = hits }
    }
    if (!best || bestHits < 2) return { category: null, boost: 0 }   // 只撞上一个词不算数
    const r = byName.get(best)
    const boost = !r || r.shown + r.open + r.talk + r.like + r.dislike === 0 ? 0 : Math.max(-3, Math.min(3, (r.score - 0.5) * 3))
    return { category: best, boost: Math.round(boost * 10) / 10 }
  }
  // 「主人平时不怎么看」的分类：她分过类（有视频），但给主人看过的少（shown < 2）
  const rarelyShown = new Set(stats.filter((r) => r.videos > 0 && r.shown < 2 && r.verdict !== '算了').map((r) => r.name))
  return { predict, rarelyShown, stats }
}

/** 每周那一句：离上次 ≥ 7 天，而且这一周有反应 */
export function weeklyDue(dshHome, { file = TASTE_FILE, now = Date.now() } = {}) {
  const t = readTaste(file)
  if (t.weeklyAt && now - Date.parse(t.weeklyAt) < 7 * DAY) return false
  return t.events.some((e) => now - Date.parse(e.at) < 7 * DAY)
}
export function markWeekly({ file = TASTE_FILE, now = Date.now() } = {}) {
  const t = readTaste(file)
  t.weeklyAt = new Date(now).toISOString()
  writeTaste(t, file)
}

export function statsText(rows, title) {
  const lines = [title]
  if (!rows.length) return lines.concat('（还没有分类）').join('\n')
  for (const r of rows) {
    lines.push(`【${r.name}】${r.verdict}  —— 你看了 ${r.videos} 个 · 给他看 ${r.shown} 次 · 他点开 ${r.open} · 聊到 ${r.talk} · 说喜欢 ${r.like} · 不喜欢 ${r.dislike}`)
    for (const x of r.examples) lines.push(`    「${String(x.title ?? '').slice(0, 30)}」：${x.why}`)
  }
  return lines.join('\n')
}
