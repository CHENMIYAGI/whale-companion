// 主人没回的时候，她自己接着说
//
//   她回完话 → 等 2～5 分钟（随机，设置里能改）→ 主人还没发消息，就问她一次「主人还没回，想再说点什么吗」
//   → 她说了就送出去，然后再等下一轮；她不想说就到此为止。
//   主人没回的情况下最多连着补 maxRounds 轮（默认 2）。主人一发消息：计时停下、正在问的作废、轮数清零。
//   话送不出去（主人在忙，先存着了）也不再往下补：他忙着呢，不用一直说。
//
// 这里只管什么时候问、问几轮；怎么问（ask）、怎么送（deliver）从外面传进来，方便测试。
import { SEP, SILENT } from './multi-message.js'

export const FOLLOW_UP_DEFAULTS = { enabled: true, maxRounds: 2, minMinutes: 2, maxMinutes: 5 }

/** 问她的那句话。只说事实和怎么回，不规定她该是什么心情 */
export function followUpNote({ minutes, round }) {
  const again = round > 1 ? `（这已经是你第 ${round} 次接着说了）` : ''
  return `［系统提示，不是主人说的］你上一条发出去大约 ${minutes} 分钟了，主人还没回${again}。你想再说点什么吗？
想说就直接写你要发的话（可以分几条，两条之间单独一行写 ${SEP}）；不想说就只回 ${SILENT}。`
}

/**
 * @param o.settings  () => { enabled, maxRounds, minMinutes, maxMinutes }
 * @param o.ask       async ({ minutes, round }) => 她想说的几条（[] = 不想说，null = 没问成）
 * @param o.deliver   async (parts) => 'shown' | 'held' | 'cancelled'
 */
export function createFollowUp({ settings, ask, deliver, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, log = () => {} }) {
  let timer = null
  let round = 0
  let lastSaidAt = 0   // 她最后一次说话的时间（算「多少分钟没回」）
  let turn = 0         // 主人每发一次消息 +1：问到一半主人说话了，结果作废

  const conf = () => ({ ...FOLLOW_UP_DEFAULTS, ...(settings() ?? {}) })
  const stop = () => { if (timer) clearTimer(timer); timer = null }

  function schedule() {
    stop()
    const c = conf()
    if (!c.enabled || round >= c.maxRounds) return
    const min = Math.max(0.5, Number(c.minMinutes)), max = Math.max(min, Number(c.maxMinutes))
    const ms = (min + random() * (max - min)) * 60_000
    timer = setTimer(fire, ms)
    log(`[接着说] ${Math.round(ms / 1000)} 秒后看主人回没回（第 ${round + 1} 轮）`)
  }

  async function fire() {
    timer = null
    const my = turn
    round++
    const minutes = Math.max(1, Math.round((now() - lastSaidAt) / 60_000))
    const parts = await ask({ minutes, round })
    if (my !== turn) return   // 问的时候主人说话了
    if (!parts?.length) { log(parts ? '[接着说] 她不想说' : '[接着说] 没问成'); return }
    const r = await deliver(parts)
    if (my !== turn || r !== 'shown') return
    lastSaidAt = now()
    schedule()
  }

  return {
    /** 主人发起的一轮，她回完了：从头计时 */
    herReplied() { turn++; round = 0; lastSaidAt = now(); schedule() },
    /** 主人发消息了：停 */
    ownerSpoke() { turn++; round = 0; stop() },
    stop,
    rounds: () => round,
    waiting: () => timer !== null,
  }
}
