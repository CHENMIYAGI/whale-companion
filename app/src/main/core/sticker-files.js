// sticker:// 地址 → 本地文件。对话框里的图只能这样取：按 id 找，碰不到 ~/.whale-companion 以外、也碰不到别的文件
//   sticker://her/<id>        她的表情包库
//   sticker://mine/<id>       主人的收藏（my-stickers/）
//   sticker://received/<id>   主人粘贴 / 拖进来的图（received/）
//   sticker://avatar/<状态>   标题栏的状态头像（avatars/<状态>.png 之类）
import fs from 'node:fs'
import path from 'node:path'
import { getSticker, sniffImage, MIME, STICKER_EXTS } from './stickers.js'
import { findMine } from './my-stickers.js'

export const AVATAR_STATES = ['idle', 'sleep', 'watching', 'thinking', 'talking', 'faint']

/** 有哪些状态头像（对话框据此决定换不换，免得一直请求不存在的图） */
export function avatarList(dir) {
  return AVATAR_STATES.filter((s) => STICKER_EXTS.some((e) => fs.existsSync(path.join(dir, `${s}.${e}`))))
}

/** 地址对应的文件；不认识 / 不存在 → null */
export function resolveStickerUrl(url, paths) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'sticker:') return null
  const key = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
  if (u.hostname === 'her' && /^[0-9a-f]{16}$/.test(key)) return getSticker(paths.stickers, key)?.path ?? null
  if (u.hostname === 'mine' || u.hostname === 'received') return findMine({ box: u.hostname, id: key }, paths)?.file ?? null
  if (u.hostname === 'avatar' && AVATAR_STATES.includes(key)) {
    for (const e of STICKER_EXTS) { const f = path.join(paths.avatars, `${key}.${e}`); if (fs.existsSync(f)) return f }
  }
  return null
}

/** 读出来交给 protocol.handle；再看一次文件头，不是图片就不给 */
export function stickerResponse(url, paths) {
  const file = resolveStickerUrl(url, paths)
  if (!file) return { status: 404 }
  let buf
  try { buf = fs.readFileSync(file) } catch { return { status: 404 } }
  const ext = sniffImage(buf)
  if (!ext) return { status: 404 }
  return { status: 200, body: buf, type: MIME[ext] }
}
