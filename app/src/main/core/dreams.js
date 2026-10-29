// 做梦：她在桌宠上睡着时，每晚最多做一个梦，存进 ~/.dsh/whale-dreams.md（和日记分开）
//
// 梦和现实要分开 ——
//   · 梦只写进 whale-dreams.md：不进聊天记录、小本本、回忆、我的成长、她眼中的主人
//   · 第二天第一次聊天，上下文里带上「昨晚的梦（这是梦，不是真的发生过）」，提不提由她
//   · 深夜主人在电脑前、她在睡觉时，偶尔冒一句模糊的梦话（只是气泡，也不进聊天记录）
//
// 文件长这样（人也能直接看）：
//   # 她的梦
//   > 说明……
//   ## 2026-10-29 03:12
//   梦的内容
import fs from 'node:fs'
import path from 'node:path'

export const DREAM_MIN = 100
export const DREAM_MAX = 300
export const DREAM_FRESH_MS = 20 * 3600_000   // 做完梦 20 小时内还算「昨晚的梦」

const HEADER = `# 她的梦

> 这是她在桌宠上睡着时做的梦。**梦不是真的发生过**：梦和现实要分开，
> 梦里的事不写进小本本、回忆、我的成长、她眼中的主人。右键菜单「她的梦」打开这个文件。
`

const p2 = (n) => String(n).padStart(2, '0')
export const stamp = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`

/** 这个梦算哪一晚的：中午 12 点到第二天中午 12 点算同一晚（凌晨 3 点做的梦算前一天晚上） */
export function nightOf(ms) {
  const d = new Date(ms - 12 * 3600_000)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** 读所有的梦：[{ at: 'YYYY-MM-DD HH:MM', ms, text }]，旧的在前 */
export function readDreams(file) {
  let s = ''
  try { s = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const block of s.split(/^## /m).slice(1)) {
    const nl = block.indexOf('\n')
    const at = block.slice(0, nl).trim()
    const m = at.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
    if (!m) continue
    const text = block.slice(nl + 1).trim()
    if (text) out.push({ at, ms: new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime(), text })
  }
  return out
}

/** 记一个梦（整个文件重写一遍再换上去：写到一半断电也不会坏） */
export function appendDream(file, { at, text }) {
  let s = ''
  try { s = fs.readFileSync(file, 'utf8') } catch {}
  if (!s.trim()) s = HEADER
  s = s.replace(/\s*$/, '\n') + `\n## ${stamp(at)}\n${String(text).trim()}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, s)
  fs.renameSync(tmp, file)
}

/** 记忆碎片：从日记末尾、最近的聊天里随手抓几句（短句，打乱顺序）——梦就是这么拼起来的 */
export function memoryFragments({ diary = '', chat = [], count = 8, random = Math.random }) {
  const pieces = []
  // 日记的标题行（# 10-28 这种日期）不算碎片
  const body = String(diary).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  for (const line of body.split(/[。！？!?\n]/)) pieces.push(line)
  for (const r of chat) if (r.kind !== 'sticker' && (r.role === 'user' || r.role === 'assistant')) pieces.push(...String(r.text).split(/[。！？!?\n]/))
  const words = /[\p{Script=Han}\p{L}]/u   // 至少得有字（光是数字、符号不算）
  const ok = [...new Set(pieces.map((x) => x.replace(/^[>\-*\s]+/, '').trim()).filter((x) => words.test(x) && [...x].length >= 4 && [...x].length <= 40))]
  for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]] }
  return ok.slice(0, count)
}

/** 让她做梦的那句话 */
export function dreamPrompt(fragments) {
  const list = fragments.length ? fragments.map((f) => `- ${f}`).join('\n') : '- （最近没什么特别的事）'
  return `你现在在桌宠里睡着了，正在做梦。下面是你最近的一些记忆碎片（零零散散，顺序是乱的）：
${list}

用你自己的口吻（第一人称）写下这个梦：有点荒诞、跳跃，像真的梦那样不讲道理，碎片可以变形、拼在一起。
${DREAM_MIN} 到 ${DREAM_MAX} 字。只写梦本身，不要标题、不要解释、不要说"这是梦"。`
}

/** 整理模型写的梦：去掉多余的引号 / 标题；太长就在 300 字附近的句号处截断；太短（没写好）返回 null */
export function tidyDream(text) {
  let s = String(text ?? '').replace(/^#+.*\n/, '').replace(/^["“「]|["”」]$/g, '').trim()
  const chars = [...s]
  if (chars.length < DREAM_MIN * 0.6) return null
  if (chars.length > DREAM_MAX) {
    const cut = chars.slice(0, DREAM_MAX + 20).join('')
    const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('…'))
    s = end > DREAM_MIN ? cut.slice(0, end + 1) : chars.slice(0, DREAM_MAX).join('') + '……'
  }
  return s
}

/** 第二天聊天时给她看的那段（提不提由她） */
export function dreamContext(dream) {
  return `［昨晚的梦（这是梦，不是真的发生过）］你昨晚在桌宠里睡着时做了这个梦：
${dream.text}
想跟主人提就提，不想提就不提。梦和现实要分开：梦里的事没有真的发生过，不要当成真事，不要记进小本本、我的成长、她眼中的主人。`
}

const MUMBLES = ['唔……再吃一口……', '嗯……泡泡……好多泡泡……', '主人……别走……zzz', '……不是我吃的……', '嘿嘿……抓到了……']

/** 梦话：今晚做过梦就从梦里抠几个字嘟囔，没做过就随便一句 */
export function sleepTalk(dream, random = Math.random) {
  const bits = dream ? dream.text.split(/[，。！？、,.!?\s…]+/).map((x) => x.trim()).filter((x) => [...x].length >= 3 && [...x].length <= 10) : []
  if (!bits.length) return MUMBLES[Math.floor(random() * MUMBLES.length)]
  return `唔……${bits[Math.floor(random() * bits.length)]}……`
}
