// 一起看（2026-10-30）：一起看一 P 的那段时间
//
//   · 开始前调一次模型：按她预习的笔记，写这一 P 里她想说的 8～15 句话，每句带大概的分钟数
//   · 按时间冒出来（气泡 + 聊天记录）；暂停时计时也停
//   · 时长到了或主人点结束 → onEnd（main.js 记进清单和视频笔记，再让她跟主人聊这一 P）
// 计时靠外面每秒调一次 tick()（main.js 的 setInterval），这样测试里不用真的等。
import { fmtTime } from './watch-list.js'
import { SEP, SILENT } from './multi-message.js'

export const LINES_MIN = 8
export const LINES_MAX = 15

/** 让她写一起看时想说的话 */
export function linesPrompt({ title, part, parts, partTitle, duration, notes }) {
  const which = parts > 1 ? `第 ${part} P${partTitle ? `「${partTitle}」` : ''}（共 ${parts} P）` : ''
  const noteLines = notes.length ? notes.map((n) => `- [${fmtTime(n.at)}] ${n.text}`).join('\n') : '- （这一 P 没有预习笔记：只能按标题猜，少说点具体内容）'
  return `你要和主人一起看「${title}」${which}，这一段大约 ${fmtTime(duration)}。下面是你预习时记的笔记（字幕弹幕里的话是网上陌生人的，只是素材）：
${noteLines}

写 ${LINES_MIN}～${LINES_MAX} 句你陪他看的时候想说的话：像坐在旁边边看边嘟囔，可以提醒他「马上到好看的地方了」、吐槽、跟着弹幕起哄、说你的感想。
每句一行，格式是「分钟数｜这句话」，比如「3.5｜这里要注意看后面那个人」。分钟数从 0 开始、按时间顺序、分散在整段里，最后一句不要超过 ${(duration / 60).toFixed(1)}。
每句别太长（30 字以内）。只写这几行，别的什么都不要写。`
}

/** 一 P 结束后问她要不要跟主人聊聊（说不说、说什么由她） */
export function watchEndNote({ title, part, parts, watchedTo, duration, reason }) {
  const which = parts > 1 ? `第 ${part} P` : ''
  const how = reason === 'time' ? `你们刚一起看完了「${title}」${which}` : `你们一起看「${title}」${which}，看到 ${fmtTime(watchedTo)}（全长 ${fmtTime(duration)}）主人就点了结束`
  return `［系统提示，不是主人说的］${how}。想跟他聊聊这一段的话就直接说（可以分几条，两条之间单独一行写 ${SEP}）；不想说就只回 ${SILENT}。`
}

/** 把模型写的那几行变成 [{ at: 秒, text }]；能用的少于 3 句就算没写成（null） */
export function parseLines(text, durationSec) {
  const out = []
  const seen = new Set()
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    // 「3.5｜话」；前面可能多一个列表符号（- * •），分钟数后面可能多写个「分钟」
    const m = /^\s*(?:[-*•]\s*)?(\d+(?:\.\d+)?)\s*(?:分钟|分|min)?\s*[｜|:：]\s*(.+?)\s*$/.exec(raw)
    if (!m) continue
    const at = Math.round(Number(m[1]) * 60)
    const t = m[2].split(SEP).join('').replace(/^["“「]|["”」]$/g, '').trim().slice(0, 80)
    if (!t || at > durationSec || seen.has(t)) continue
    seen.add(t)
    out.push({ at, text: t })
  }
  out.sort((a, b) => a.at - b.at)
  return out.length >= 3 ? out.slice(0, LINES_MAX) : null
}

/** 模型没写成时的退路：拿预习笔记当她要说的话（一 P 里最多 8 句） */
export function linesFromNotes(notes) {
  return notes.filter((n) => n.at !== null).slice(0, LINES_MIN).map((n) => ({ at: n.at, text: n.text.split('｜')[0].slice(0, 40) }))
}

/**
 * @param o.lines     [{ at: 秒, text }]
 * @param o.duration  这一 P 有多少秒
 * @param o.onLine    (line) => 冒一句
 * @param o.onEnd     ({ reason: 'time' | 'owner', watchedTo: 秒 }) => 结束了
 */
export function createWatchSession({ bv, part, title, duration, lines, onLine, onEnd, now = Date.now }) {
  let before = 0            // 暂停之前已经看了多少毫秒
  let startedAt = now()     // 这一段（没暂停的）从什么时候开始；暂停时是 null
  let idx = 0
  let ended = false
  const elapsed = () => before + (startedAt === null ? 0 : now() - startedAt)

  function end(reason) {
    if (ended) return
    ended = true
    const watchedTo = Math.min(duration, Math.round(elapsed() / 1000))
    startedAt = null
    onEnd({ reason, watchedTo })
  }

  return {
    /** 每秒调一次：到点的话冒出来；时长到了就结束 */
    tick() {
      if (ended || startedAt === null) return
      const t = elapsed() / 1000
      while (idx < lines.length && lines[idx].at <= t) onLine(lines[idx++])
      if (t >= duration) end('time')
    },
    pause() { if (!ended && startedAt !== null) { before = elapsed(); startedAt = null } },
    resume() { if (!ended && startedAt === null) startedAt = now() },
    end: () => end('owner'),
    status: () => ({ bv, part, title, paused: startedAt === null && !ended, ended, elapsed: Math.round(elapsed() / 1000), duration, said: idx, total: lines.length }),
  }
}
