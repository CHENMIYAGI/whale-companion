// 她自己开口说的话（主人没回时接着说、主动开口……）怎么送到主人面前
//
//   · 一条一条来：每条先「正在输入」一会儿（按字数 0.8～3 秒），再出来；对话框里一条一个气泡，
//     对话框没在看时桌宠上也冒气泡；每条都写进聊天记录（她的消息，kind 写是哪种开口）
//   · 主人「忙」（手动「我在忙」或前台全屏）：先存起来，等他空了（flush）再一起给
//   · 送到一半主人发消息了：后面的不送了（cancel）
import crypto from 'node:crypto'
import { typingPause } from './multi-message.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param o.chatLog      聊天记录
 * @param o.bus          事件总线（发 chat:assistant、pet:say）
 * @param o.chat         { start(id), delta(id, text), end(id, rec) } 对话框（main.js 的 sendChat）
 * @param o.chatVisible  () => 主人正看着对话框吗（看着就不用在桌宠上再冒气泡）
 * @param o.holding      () => 主人在忙（手动 / 全屏），先存着
 */
export function createHerSay({ chatLog, bus, chat, chatVisible = () => false, holding = () => false, wait = sleep, log = () => {} }) {
  let pending = []      // 忙的时候存着的：{ parts, kind }
  let generation = 0    // 主人一发消息就 +1：正在送的那批看到号码变了就停
  let sending = Promise.resolve()

  // my：这一批开始时的号码（中途主人发消息，号码就对不上了）
  async function present(parts, kind, my = generation) {
    for (const text of parts) {
      if (my !== generation) { log('[开口] 主人说话了，剩下的不说了'); return 'cancelled' }
      const id = crypto.randomUUID()
      chat.start(id)   // 空气泡 = 「正在输入」
      await wait(typingPause(text))
      if (my !== generation) { chat.end(id, null); log('[开口] 主人说话了，剩下的不说了'); return 'cancelled' }
      const rec = chatLog.append({ role: 'assistant', text, kind })
      chat.delta(id, text)
      chat.end(id, rec)
      bus.emit('chat:assistant', rec)
      if (!chatVisible()) bus.emit('pet:say', { text, kind, unread: 1 })
    }
    return 'shown'
  }

  return {
    /** 送几条话：主人忙就存着（返回 'held'），否则一条条显示（'shown' / 'cancelled'） */
    deliver(parts, kind) {
      if (!parts?.length) return Promise.resolve('empty')
      if (holding()) {
        pending.push({ parts, kind })
        log(`[开口] 主人在忙，先存着 ${parts.length} 条（${kind}）`)
        return Promise.resolve('held')
      }
      // 排队：上一批还没送完，这一批等它
      const run = sending.then(() => present(parts, kind))
      sending = run.catch(() => {})
      return run
    },
    /** 主人空了：存着的一起给 */
    flush() {
      if (!pending.length || holding()) return Promise.resolve('empty')
      const all = pending.flatMap((p) => p.parts.map((text) => ({ text, kind: p.kind })))
      pending = []
      log(`[开口] 主人空了，把存着的 ${all.length} 条给他`)
      const my = generation
      const run = sending.then(async () => {
        let r = 'shown'
        for (const it of all) { r = await present([it.text], it.kind, my); if (r === 'cancelled') break }
        return r
      })
      sending = run.catch(() => {})
      return run
    },
    /** 主人发消息了：正在送的停下（存着的不丢，等他空了还是会给） */
    cancel() { generation++ },
    pending: () => pending.reduce((n, p) => n + p.parts.length, 0),
  }
}
