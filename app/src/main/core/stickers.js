// 表情包：她的库（~/.whale-companion/stickers/ + index.json）和图片检查
//
// index.json：{ version: 1, stickers: [{ file, name, caption, desc, when, tags, source, hash, added }] }
//   file     库里的文件名（复制进来时起的，不一定和原名一样）
//   name     短名字，聊天记录里写成「[表情：name]」（导入时用原文件名去掉扩展名）
//   caption  图里的配字（没有就空）
//   desc     画面描述（谁、什么表情、在干什么）
//   when     什么场合用（可选，比如「主人忙完回来时」）：她挑表情包时看这个最准
//   source   从哪来的：self = 她自己的（主人照她的形象画的），dsh-pet、owner（找主人要的）……
//   tags     情绪标签，从 EMOTIONS 里挑；她发表情包时按这个选
//   hash     图片内容的 sha256：同一张图不会进库两次，看图描述也按它缓存
//
// 安全：只认本地的 png / jpg / gif / webp，看文件头而不是扩展名（改个名骗不过去），5MB 以内；
// 一律复制进桌宠自己的文件夹再显示，界面只通过 sticker:// 按 id 取图，碰不到别的路径。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readJson, writeJsonAtomic } from './files.js'

/** 她自己的表情（主人照她的形象画的）的 source */
export const SELF = 'self'

export const STICKER_MAX_BYTES = 5 * 1024 * 1024
export const STICKER_EXTS = ['png', 'jpg', 'gif', 'webp']
export const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

// 情绪标签的固定词表：模型选表情包时只能填这些，选得才准（自由发挥的话"高兴""开心""快乐"会对不上）
export const EMOTIONS = ['打招呼', '开心', '得意', '夸奖', '卖萌', '撒娇', '害羞', '期待', '认真', '疑惑', '惊讶',
  '无语', '吐槽', '委屈', '难过', '崩溃', '生气', '累', '困', '吃饭']

/** 看文件头认图片格式；不是这四种就 null */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

export const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
export const stickerId = (s) => String(s?.hash ?? '').slice(0, 16)

/** 检查一段图片数据：{ ok, ext } 或 { ok:false, error }（error 是给主人看的话） */
export function checkImage(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, error: '不是图片' }
  if (buf.length > STICKER_MAX_BYTES) return { ok: false, error: '图片太大了（要 5MB 以内）' }
  const ext = sniffImage(buf)
  if (!ext) return { ok: false, error: '只认 png / jpg / gif / webp 图片' }
  return { ok: true, ext }
}

/** 读一个本地图片文件（先看大小再读，免得把大文件整个读进内存） */
export function readImageFile(file) {
  let st
  try { st = fs.statSync(file) } catch { return { ok: false, error: '找不到这个文件' } }
  if (!st.isFile()) return { ok: false, error: '不是文件' }
  if (st.size > STICKER_MAX_BYTES) return { ok: false, error: '图片太大了（要 5MB 以内）' }
  const buf = fs.readFileSync(file)
  const c = checkImage(buf)
  return c.ok ? { ok: true, ext: c.ext, buffer: buf } : c
}

/** 文件名里不能有的字符去掉、限长；全被去光了就用 hash 开头 */
export function safeName(name, fallback = 'sticker') {
  const s = String(name ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').trim().slice(0, 40)
  return s || fallback
}

export const indexFile = (dir) => path.join(dir, 'index.json')

export function readLibrary(dir) {
  const j = readJson(indexFile(dir), null)
  const stickers = Array.isArray(j?.stickers) ? j.stickers.filter((s) => s && typeof s.file === 'string' && typeof s.hash === 'string') : []
  return { version: 1, stickers }
}

/** 按 id（hash 前 16 位）找；返回条目和它的完整路径（文件不在了就 null） */
export function getSticker(dir, id) {
  const s = readLibrary(dir).stickers.find((x) => stickerId(x) === String(id))
  if (!s) return null
  const file = path.join(dir, path.basename(s.file))
  return fs.existsSync(file) ? { ...s, id: stickerId(s), path: file } : null
}

const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : []).map(String).filter((t) => EMOTIONS.includes(t)))]

/**
 * 加一张进库：同一张图（hash 一样）不重复加，返回已有的那条。
 * meta：{ name, caption, desc, when, tags, source }
 */
export function addToLibrary(dir, buffer, meta = {}, { now = () => new Date() } = {}) {
  const c = checkImage(buffer)
  if (!c.ok) return c
  const hash = hashOf(buffer)
  const lib = readLibrary(dir)
  const had = lib.stickers.find((s) => s.hash === hash)
  if (had) return { ok: true, duplicate: true, sticker: { ...had, id: stickerId(had) } }
  fs.mkdirSync(dir, { recursive: true })
  const name = safeName(meta.name, hash.slice(0, 8))
  // 文件名撞了（不同的图同一个名字）就加 -2、-3
  let file = `${name}.${c.ext}`
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${name}-${i}.${c.ext}`
  fs.writeFileSync(path.join(dir, file), buffer)
  const sticker = {
    file, name,
    caption: String(meta.caption ?? '').slice(0, 200),
    desc: String(meta.desc ?? '').slice(0, 300),
    when: String(meta.when ?? '').slice(0, 200),
    tags: cleanTags(meta.tags),
    source: String(meta.source ?? ''),
    hash, added: now().toISOString().slice(0, 10),
  }
  lib.stickers.push(sticker)
  writeJsonAtomic(indexFile(dir), lib)
  return { ok: true, sticker: { ...sticker, id: stickerId(sticker) } }
}

/** 改一条的描述 / 标签 / 场合 / 来源（看图补描述、重新导入时用） */
export function updateSticker(dir, id, patch) {
  const lib = readLibrary(dir)
  const s = lib.stickers.find((x) => stickerId(x) === String(id))
  if (!s) return false
  if (patch.caption !== undefined) s.caption = String(patch.caption).slice(0, 200)
  if (patch.desc !== undefined) s.desc = String(patch.desc).slice(0, 300)
  if (patch.tags !== undefined) s.tags = cleanTags(patch.tags)
  if (patch.when !== undefined) s.when = String(patch.when).slice(0, 200)
  if (patch.source !== undefined) s.source = String(patch.source)
  writeJsonAtomic(indexFile(dir), lib)
  return true
}

/**
 * 按情绪 / 关键词挑一张：标签对上 3 分，名字/配字/场合里有关键词 2 分，描述里有 1 分；
 * 她自己的表情（source: self）对得上的话再加 0.5 分 —— 有合适的就优先用自己的，同分里不靠运气。同分随机。
 * exclude：最近发过的 id，尽量不连着发同一张（实在没别的才发）
 */
export function pickSticker(lib, { emotion, query, exclude = [] } = {}, random = Math.random) {
  const words = String(query ?? '').split(/[\s,，、]+/).filter(Boolean)
  const scored = lib.stickers.map((s) => {
    let score = 0
    if (emotion && s.tags?.includes(emotion)) score += 3
    for (const w of words) {
      if (s.name?.includes(w) || s.caption?.includes(w) || s.when?.includes(w)) score += 2
      else if (s.desc?.includes(w)) score += 1
    }
    if (score > 0 && s.source === SELF) score += 0.5
    return { s, score }
  }).filter((x) => x.score > 0)
  if (!scored.length) return null
  const fresh = scored.filter((x) => !exclude.includes(stickerId(x.s)))
  const pool = fresh.length ? fresh : scored
  const best = Math.max(...pool.map((x) => x.score))
  const top = pool.filter((x) => x.score === best)
  const s = top[Math.floor(random() * top.length)].s
  return { ...s, id: stickerId(s) }
}

/** 聊天记录里表情包写成这样，DSH 那边读记录也看得懂 */
export const stickerText = (name) => `[表情：${String(name ?? '').slice(0, 40) || '图片'}]`
