// 主人这边的图：
//   my-stickers/   主人自己的收藏（表情面板里显示；直接往文件夹里丢图也行）
//   received/      主人粘贴 / 拖进对话框的图：先复制一份到这里再显示、再发（原文件动了删了都不影响）
//                  文件名是 <id>.<扩展名>，原名记在 received/index.json
// id 都是图片内容 sha256 的前 16 位：同一张图不管从哪来 id 都一样，看图描述也按它缓存。
import fs from 'node:fs'
import path from 'node:path'
import { checkImage, hashOf, safeName, STICKER_EXTS, STICKER_MAX_BYTES, sniffImage } from './stickers.js'
import { readJson, writeJsonAtomic } from './files.js'

const ID_RE = /^[0-9a-f]{16}$/

// 收藏文件夹里每张图的 hash 算一次就记住（按 文件名+大小+修改时间，图换了会重算）
const hashMemo = new Map()

/** 收藏里的图：[{ box:'mine', id, name, hash, file }]，按文件名排；不合格的（太大、不是图片）跳过 */
export function listMine(dir) {
  let names = []
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort() } catch { return [] }
  const out = []
  const seen = new Set()
  for (const name of names) {
    if (!STICKER_EXTS.includes(path.extname(name).slice(1).toLowerCase().replace('jpeg', 'jpg'))) continue
    const file = path.join(dir, name)
    let st
    try { st = fs.statSync(file) } catch { continue }
    if (st.size > STICKER_MAX_BYTES) continue
    const key = `${file}|${st.size}|${st.mtimeMs}`
    let hash = hashMemo.get(key)
    if (hash === undefined) {
      const buf = fs.readFileSync(file)
      hash = sniffImage(buf) ? hashOf(buf) : null
      hashMemo.set(key, hash)
    }
    if (!hash || seen.has(hash)) continue
    seen.add(hash)
    out.push({ box: 'mine', id: hash.slice(0, 16), name: safeName(name), hash, file })
  }
  return out
}

/** 放进收藏（同一张图已经在了就不再放） */
export function addToMine(dir, buffer, name) {
  const c = checkImage(buffer)
  if (!c.ok) return c
  const hash = hashOf(buffer)
  const had = listMine(dir).find((s) => s.hash === hash)
  if (had) return { ok: true, duplicate: true, sticker: had }
  fs.mkdirSync(dir, { recursive: true })
  const base = safeName(name, hash.slice(0, 8))
  let file = `${base}.${c.ext}`
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${base}-${i}.${c.ext}`
  fs.writeFileSync(path.join(dir, file), buffer)
  return { ok: true, sticker: { box: 'mine', id: hash.slice(0, 16), name: base, hash, file: path.join(dir, file) } }
}

/** 主人粘贴 / 拖进来的图：检查、复制进 received/，返回 { box:'received', id, name, hash } */
export function saveReceived(dir, buffer, name) {
  const c = checkImage(buffer)
  if (!c.ok) return c
  const hash = hashOf(buffer)
  const id = hash.slice(0, 16)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.${c.ext}`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer)
  const index = readJson(path.join(dir, 'index.json'), {}) ?? {}
  const clean = safeName(name, '图片')
  if (index[id]?.name !== clean) { index[id] = { name: clean }; writeJsonAtomic(path.join(dir, 'index.json'), index) }
  return { ok: true, sticker: { box: 'received', id, name: clean, hash, file } }
}

/** box + id → 文件（找不到 null）。box 只认 mine / received（她的库在 stickers.js 的 getSticker） */
export function findMine({ box, id }, paths) {
  if (!ID_RE.test(String(id ?? ''))) return null
  if (box === 'mine') return listMine(paths.myStickers).find((s) => s.id === id) ?? null
  if (box === 'received') {
    for (const ext of STICKER_EXTS) {
      const file = path.join(paths.received, `${id}.${ext}`)
      if (fs.existsSync(file)) {
        const name = (readJson(path.join(paths.received, 'index.json'), {}) ?? {})[id]?.name ?? '图片'
        return { box, id, name, file, hash: hashOf(fs.readFileSync(file)) }
      }
    }
  }
  return null
}
