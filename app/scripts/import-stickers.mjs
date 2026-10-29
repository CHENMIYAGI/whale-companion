// 把一个文件夹里的图导入她的表情包库（~/.whale-companion/stickers/）
//
//   node scripts/import-stickers.mjs <文件夹> [--seed stickers/dsh-pet.json] [--source 名字]
//     · 只导 png / jpg / gif / webp、5MB 以内的（看文件头，不看扩展名）
//     · --seed：写好的描述和情绪标签（按文件名对）；seed 里 skip 的不导
//     · 没有 seed 的图：文件名当配字，描述留空 —— 桌宠开着、看图模型能用时会自己补上
//     · 同一张图导两次不会重复；再导一次时 seed 里的说明会更新上去（改了「什么场合用」重导就行）
//     · --clean-alpha：AI 抠图常在边上留一圈几乎透明（不到 6%）的淡色雾，白底上看着脏。
//       把这种像素变成全透明（真正的抗锯齿边缘留着）。只改导进库里的那份，原图不动；要 ffmpeg
//
//   node scripts/import-stickers.mjs --avatars <文件夹>
//     · 状态头像（对话框标题栏用），按文件名里的词对应状态，复制成 ~/.whale-companion/avatars/<状态>.<扩展名>
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { paths } from '../src/main/core/paths.js'
import { readImageFile, addToLibrary, readLibrary, updateSticker, stickerId } from '../src/main/core/stickers.js'

const args = process.argv.slice(2)
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null }

// 文件名里出现这些词 → 这个状态（前面的优先）
const AVATAR_WORDS = [
  ['sleep', ['sleep', '睡']],
  ['watching', ['watching', '看视频', '刷', '看']],
  ['thinking', ['thinking', '思考', '想']],
  ['talking', ['talking', '说话', '聊', '说']],
  ['faint', ['faint', '没精神', '累', '叹气']],
  ['idle', ['idle', '待机', '平常', '默认']],
]

// 淡边：alpha 小于这个数（0–255）的像素当成抠图残留，变全透明
const FAINT_ALPHA = 16

/** 去掉 png 边上的淡雾：ffmpeg 解成 RGBA 原始像素 → 改 alpha → 再编回 png。失败就原样返回 */
function cleanAlpha(file, buffer) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  const [w, h, fmt] = String(probe.stdout ?? '').trim().split(',')
  if (probe.status !== 0 || !/a/.test(fmt ?? '')) return { buffer, changed: 0 }   // 没有透明通道（或没装 ffmpeg）：不动
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 }).stdout
  if (!raw?.length) return { buffer, changed: 0 }
  let changed = 0
  for (let i = 3; i < raw.length; i += 4) {
    if (raw[i] > 0 && raw[i] < FAINT_ALPHA) { raw[i] = raw[i - 1] = raw[i - 2] = raw[i - 3] = 0; changed++ }
  }
  const out = spawnSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', '-compression_level', '9', '-f', 'image2pipe', '-vcodec', 'png', '-'], { input: raw, maxBuffer: 1 << 28 })
  return out.status === 0 && out.stdout?.length ? { buffer: out.stdout, changed } : { buffer, changed: 0 }
}

function imagesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.(png|jpe?g|gif|webp)$/i.test(d.name)).map((d) => d.name).sort()
}

if (args[0] === '--avatars') {
  const dir = args[1]
  if (!dir) { console.log('用法：node scripts/import-stickers.mjs --avatars <文件夹>'); process.exit(1) }
  fs.mkdirSync(paths.avatars, { recursive: true })
  for (const f of imagesIn(dir)) {
    const base = path.parse(f).name.toLowerCase()
    const state = AVATAR_WORDS.find(([, words]) => words.some((w) => base.includes(w)))?.[0]
    if (!state) { console.log(`  ? ${f}：认不出是哪个状态，跳过（文件名里写上 待机/睡/看视频/思考/说话/没精神）`); continue }
    const img = readImageFile(path.join(dir, f))
    if (!img.ok) { console.log(`  ✗ ${f}：${img.error}`); continue }
    for (const ext of ['png', 'jpg', 'gif', 'webp']) fs.rmSync(path.join(paths.avatars, `${state}.${ext}`), { force: true })
    fs.writeFileSync(path.join(paths.avatars, `${state}.${img.ext}`), img.buffer)
    console.log(`  ✓ ${f} → ${state}`)
  }
  console.log('放在：' + paths.avatars)
  process.exit(0)
}

const clean = args.includes('--clean-alpha')
if (clean) args.splice(args.indexOf('--clean-alpha'), 1)
const seedFile = opt('--seed')
const seed = seedFile ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : { stickers: {}, skip: [] }
const source = opt('--source') ?? seed.source ?? 'import'
const dir = args[0]
if (!dir) { console.log('用法：node scripts/import-stickers.mjs <文件夹> [--seed 描述文件.json] [--source 名字]'); process.exit(1) }

let added = 0, dup = 0, skipped = 0
for (const f of imagesIn(dir)) {
  const name = path.parse(f).name
  if (seed.skip?.includes(name)) { console.log(`  - ${name}：不要这张，跳过`); skipped++; continue }
  const img = readImageFile(path.join(dir, f))
  if (!img.ok) { console.log(`  ✗ ${f}：${img.error}`); skipped++; continue }
  let buffer = img.buffer
  if (clean && img.ext === 'png') {
    const c = cleanAlpha(path.join(dir, f), buffer)
    buffer = c.buffer
    if (c.changed) console.log(`    ${name}：去掉 ${c.changed} 个淡边像素`)
  }
  const meta = seed.stickers?.[name] ?? { caption: name, desc: '', tags: [] }
  const r = addToLibrary(paths.stickers, buffer, { name, source, ...meta })
  if (!r.ok) { console.log(`  ✗ ${f}：${r.error}`); skipped++; continue }
  if (r.duplicate) {
    if (seed.stickers?.[name]) updateSticker(paths.stickers, stickerId(r.sticker), { ...meta, source })
    dup++
    continue
  }
  added++
  console.log(`  ✓ ${name}${r.sticker.tags.length ? '（' + r.sticker.tags.join('、') + '）' : '（还没描述，等她看图补）'}`)
}
console.log(`新加 ${added} 张，已经有的 ${dup} 张，跳过 ${skipped} 张。库里一共 ${readLibrary(paths.stickers).stickers.length} 张：${paths.stickers}`)
