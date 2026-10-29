// 桌宠（whale-companion）通道 —— 她在 DSH 会话里用这个跟桌宠说话
//
// 用法:
//   node bili.mjs companion say "想对主人说的话" [--kind wake-done|reply|skip|share] [--bv BV...]
//       → 追加到 $DSH_HOME/companion/outbox.jsonl，桌宠冒气泡（桌宠没开也不丢，下次打开补发）
//   node bili.mjs companion chat-today [--max 60]
//       → 打印今天主人在桌宠里跟你聊了什么（醒来时读，写进日记用）
//   node bili.mjs companion chat-recent [--n 30]
//       → 最近 N 条桌宠聊天（不分哪天；换到新会话时读）
//   node bili.mjs companion status
//       → 桌宠目录在不在、outbox 里有几条
//
// 约定：这是**私下跟主人说话**的通道，不是对外发言 —— 不经过分享闸门，也不占额度。
//       但它也不能代替 B站 上的 @：分享仍然走 comment --share / dm --share。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dshPath } from '../lib/paths.mjs'

const DIR = dshPath('companion')
const OUTBOX = path.join(DIR, 'outbox.jsonl')
const CHAT = path.join(DIR, 'chat-log.jsonl')
const KINDS = new Set(['wake-done', 'reply', 'skip', 'share', 'note'])
const BV_RE = /^BV[0-9A-Za-z]{10}$/

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
const pos = []
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
  else pos.push(argv[i])
}

if (cmd === 'say') {
  const text = String(pos.join(' ') || opt.text || '').trim()
  if (!text) { console.error('用法: companion say "想说的话" [--kind wake-done|reply|skip|share] [--bv BV]'); process.exit(2) }
  if (!fs.existsSync(DIR)) {
    console.log('（没装桌宠：$DSH_HOME/companion 不存在 —— 这句不发；该 notify 的照常 notify）')
    process.exit(0)
  }
  const kind = KINDS.has(String(opt.kind)) ? String(opt.kind) : 'note'
  const bv = typeof opt.bv === 'string' && BV_RE.test(opt.bv) ? opt.bv : null
  if (opt.bv && !bv) console.error(`⚠️ --bv 格式不对（${opt.bv}），已忽略`)
  const rec = { id: crypto.randomUUID(), at: new Date().toISOString(), kind, text: text.slice(0, 1000), bv }
  fs.appendFileSync(OUTBOX, JSON.stringify(rec) + '\n')
  console.log(`✓ 已放进桌宠（${kind}${bv ? ' · ' + bv : ''}）：${rec.text.slice(0, 60)}${rec.text.length > 60 ? '…' : ''}`)
  process.exit(0)
}

// 聊天记录里主人和她说的话（工具调用之类的记录不要）
function chatRows() {
  try {
    return fs.readFileSync(CHAT, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((r) => r && r.at && (r.role === 'user' || r.role === 'assistant'))
  } catch { return [] /* 没有聊天记录 */ }
}
function printRows(rows, withDate) {
  const p2 = (n) => String(n).padStart(2, '0')
  for (const r of rows) {
    const t = new Date(r.at)
    const when = `${withDate ? `${p2(t.getMonth() + 1)}-${p2(t.getDate())} ` : ''}${p2(t.getHours())}:${p2(t.getMinutes())}`
    const who = r.role === 'user' ? '主人' : (r.source === 'dsh' ? '你（从 DSH 发的）' : '你')
    const text = String(r.text ?? '').replace(/\s+/g, ' ').slice(0, 300)
    console.log(`${when} ${who}：${text}`)
  }
}

if (cmd === 'chat-today') {
  const max = Math.min(200, Math.max(1, Number(opt.max ?? 60) || 60))
  const today = new Date().toLocaleDateString('sv-SE')
  const rows = chatRows().filter((r) => new Date(r.at).toLocaleDateString('sv-SE') === today)
  if (!rows.length) { console.log('（今天主人还没在桌宠里跟你说话）'); process.exit(0) }
  const shown = rows.slice(-max)
  if (rows.length > shown.length) console.log(`（今天一共 ${rows.length} 句，只显示最近 ${shown.length} 句）`)
  printRows(shown, false)
  process.exit(0)
}

// 2026-10-27：换到新会话时用 —— 不管哪天的，最近 N 条（默认 30）
if (cmd === 'chat-recent') {
  const n = Math.min(200, Math.max(1, Number(opt.n ?? 30) || 30))
  const rows = chatRows().slice(-n)
  if (!rows.length) { console.log('（桌宠里还没有聊天记录）'); process.exit(0) }
  console.log(`（桌宠里最近 ${rows.length} 句）`)
  printRows(rows, true)
  process.exit(0)
}

if (cmd === 'status') {
  const n = (() => { try { return fs.readFileSync(OUTBOX, 'utf8').split(/\r?\n/).filter(Boolean).length } catch { return 0 } })()
  console.log(fs.existsSync(DIR) ? `桌宠目录：${DIR}\noutbox：${n} 条` : '没装桌宠（$DSH_HOME/companion 不存在）')
  process.exit(0)
}

console.error('用法: companion say "…" [--kind …] [--bv …] | chat-today [--max N] | chat-recent [--n 30] | status')
process.exit(2)
