// 主人的口味（~/.bili-ai/taste.json）—— 桌宠这边记主人的反应、算每个分类的统计
//
// 格式和算法跟 dsh-bili-whale/tools/lib/taste.mjs 一样（那边管分类表、给视频分类、选题加权）：改了两边要一起改，
// test/taste.test.mjs 会拿同一份数据让两边各算一遍对比。
//   events：{ at, bv, kind, category? } —— kind：shown 分享了 / open 点了打开视频 / talk 聊天里聊到 / like / dislike
//   统计时按视频笔记里当前的分类（verdict.json）归类：合并、改名后旧反应跟着走
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const KINDS = ['shown', 'open', 'talk', 'like', 'dislike']
const BV_RE = /^BV[0-9A-Za-z]{10}$/

export function readTaste(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { version: 1, categories: Array.isArray(j.categories) ? j.categories : [], events: Array.isArray(j.events) ? j.events : [], weeklyAt: j.weeklyAt ?? null }
  } catch { return { version: 1, categories: [], events: [], weeklyAt: null } }
}
function writeTaste(t, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...t, events: t.events.slice(-3000) }, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function verdictOf(videosRoot, bv) {
  try { return JSON.parse(fs.readFileSync(path.join(videosRoot, bv, 'verdict.json'), 'utf8')) } catch { return null }
}

/**
 * 记一次反应。同一个视频同一种反应一天只记一次（点了三次「打开视频」算一次）；
 * 喜欢 / 不喜欢只留最新的态度（先说喜欢后来说不喜欢，以后面的为准）
 */
export function recordEvent({ file, videosRoot, bv, kind, now = Date.now() }) {
  if (!BV_RE.test(String(bv)) || !KINDS.includes(kind)) return { ok: false, error: '记不了：BV 或种类不对' }
  const t = readTaste(file)
  const day = new Date(now).toLocaleDateString('sv-SE')
  const sameDay = (e) => e.bv === bv && e.kind === kind && new Date(e.at).toLocaleDateString('sv-SE') === day
  if (kind !== 'like' && kind !== 'dislike' && t.events.some(sameDay)) return { ok: true, duplicate: true }
  if (kind === 'like' || kind === 'dislike') t.events = t.events.filter((e) => !(e.bv === bv && (e.kind === 'like' || e.kind === 'dislike')))
  const category = verdictOf(videosRoot, bv)?.category
  t.events.push({ at: new Date(now).toISOString(), bv, kind, ...(category ? { category } : {}) })
  writeTaste(t, file)
  return { ok: true, category: category ?? null }
}

/** 按分类统计（和 DSH 那边 tasteStats 同一个算法） */
export function tasteStats({ file, videosRoot }) {
  const t = readTaste(file)
  const verdicts = new Map()
  let names = []
  try { names = fs.readdirSync(videosRoot).filter((n) => BV_RE.test(n)) } catch {}
  for (const bv of names) {
    const v = verdictOf(videosRoot, bv)
    if (!v?.category) continue
    let title = ''
    try { title = JSON.parse(fs.readFileSync(path.join(videosRoot, bv, 'meta.json'), 'utf8')).title ?? '' } catch {}
    verdicts.set(bv, { ...v, title })
  }
  const rows = new Map()
  const row = (name) => {
    if (!rows.has(name)) rows.set(name, { name, videos: 0, shown: 0, open: 0, talk: 0, like: 0, dislike: 0, examples: [] })
    return rows.get(name)
  }
  for (const c of t.categories) row(c.name)
  for (const [, v] of verdicts) { const r = row(v.category); r.videos++; if (r.examples.length < 3) r.examples.push({ title: v.title, why: v.why }) }
  for (const e of t.events) if (KINDS.includes(e.kind)) row(verdicts.get(e.bv)?.category ?? e.category ?? '未分类')[e.kind]++
  for (const r of rows.values()) {
    r.score = (r.open + r.talk + 2 * r.like - 2 * r.dislike) / Math.max(1, r.shown)
    r.verdict = r.dislike > r.like && r.score < 0.3 ? '算了' : r.score >= 0.6 && (r.open + r.talk + r.like) >= 2 ? '爱看' : r.shown + r.open + r.talk + r.like + r.dislike === 0 ? '还没反应' : '一般'
  }
  return [...rows.values()].sort((x, y) => y.score - x.score || y.videos - x.videos)
}

/** 右键「她的分类」打开的那份 */
export function reportText(rows) {
  const lines = ['她的分类（她看视频时自己起的名字，总共 15 个以内）', '', '「爱看」「算了」是按你的反应算的：分享给你的、你点开的、聊到的、说喜欢 / 不喜欢的。', '']
  if (!rows.length) return lines.concat('（她还没给视频分过类）').join('\n')
  for (const r of rows) {
    lines.push(`【${r.name}】${r.verdict}`)
    lines.push(`  她看了 ${r.videos} 个 · 给你看了 ${r.shown} 次 · 你点开 ${r.open} 次 · 聊到 ${r.talk} 次 · 说喜欢 ${r.like} · 不喜欢 ${r.dislike}`)
    for (const x of r.examples) lines.push(`  「${String(x.title ?? '').slice(0, 30)}」—— ${x.why}`)
    lines.push('')
  }
  return lines.join('\n')
}
