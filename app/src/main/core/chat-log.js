// 聊天记录：$DSH_HOME/companion/chat-log.jsonl（和她共用 —— 她醒来时用 `companion chat-today` 读）
// 每行一条：{ id, at, role: 'user'|'assistant'|'event', text, source?, kind?, bv?, meta? }
//   source='dsh'  她在 DSH 里刷完视频后发回来的话（outbox）
//   role='event'  工具调用之类的记录，不进模型上下文，只留痕
//   kind='followup'  主人没回时她接着说的；kind='proactive' 她主动开口说的；kind='together' 一起看时说的；kind='sticker' 表情包（meta.sticker）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readTail } from './files.js'

export function createChatLog({ file, now = () => new Date() }) {
  return {
    file,
    append(entry) {
      const rec = { id: entry.id ?? crypto.randomUUID(), at: (entry.at ?? now().toISOString()), role: entry.role, text: String(entry.text ?? '') }
      for (const k of ['source', 'kind', 'bv', 'meta']) if (entry[k] !== undefined && entry[k] !== null) rec[k] = entry[k]
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, JSON.stringify(rec) + '\n')
      return rec
    },
    /** 最近 n 条（默认只要对话；includeEvents 时连工具记录一起） */
    recent(n = 40, { includeEvents = false, maxBytes = 512 * 1024 } = {}) {
      const { text } = readTail(file, maxBytes)
      const rows = []
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue
        try {
          const r = JSON.parse(line)
          if (r.role === 'user' || r.role === 'assistant' || (includeEvents && r.role === 'event')) rows.push(r)
        } catch { /* 坏行跳过 */ }
      }
      return rows.slice(-n)
    },
  }
}
