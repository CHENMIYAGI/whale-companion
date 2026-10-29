// 连发几条：她的回复里用 SEP 隔开，就拆成几条消息（像真人发消息那样一条一条发）
//
//   · 模型只调一次：拆是在我们这边做的，不多花钱
//   · SEP 不会出现在正常文字里，也绝不显示给主人（拆的时候去掉；没用完的半截在流结束时也会清掉）
//   · 最多 MAX_PARTS 条，再多的分隔符当成换行
//   · 第一条边生成边显示；后面的每条先显示「正在输入」，按字数停一会儿（0.8～3 秒）再整条出来
export const SEP = '[[下一条]]'
export const SILENT = '[[不说]]'   // 「要不要再说点什么」时，她不想说就只回这个
export const MAX_PARTS = 5

/** 这条话「打字」要多久：0.8 秒起，每个字 0.07 秒，最多 3 秒 */
export function typingPause(text) {
  return Math.round(Math.min(3000, Math.max(800, 800 + [...String(text)].length * 70)))
}

/**
 * 流式拆分：一段段文字 push 进来，碰到 SEP 就换下一条。
 * SEP 可能被拆在两段里（比如 "[[下" + "一条]]"），所以末尾像是 SEP 开头的那几个字先扣着不发，等下一段来了再判断。
 * onText(第几条, 新文字)、onBreak(新的第几条)
 */
export function createSplitter({ onText, onBreak }) {
  let index = 0
  let held = ''
  const emit = (s) => { if (s) onText(index, s) }
  // s 的末尾有没有 SEP 的开头（返回扣着的长度）
  const tailOverlap = (s) => {
    for (let n = Math.min(SEP.length - 1, s.length); n > 0; n--) if (SEP.startsWith(s.slice(-n))) return n
    return 0
  }
  return {
    push(delta) {
      let s = held + String(delta ?? '')
      held = ''
      let i
      while ((i = s.indexOf(SEP)) >= 0) {
        emit(s.slice(0, i))
        s = s.slice(i + SEP.length)
        if (index < MAX_PARTS - 1) { index++; onBreak(index) }
        else emit('\n')   // 已经 5 条了：后面的都并进最后一条
      }
      const keep = tailOverlap(s)
      emit(s.slice(0, s.length - keep))
      held = s.slice(s.length - keep)
    },
    /** 流结束：扣着的那点不是 SEP，照常发出去 */
    end() { emit(held); held = '' },
    get index() { return index },
  }
}

/** 整段文字一次拆好（不是流式的时候用）：去掉空的，最多 MAX_PARTS 条 */
export function splitParts(text) {
  const parts = []
  const sp = createSplitter({ onText: (i, s) => { parts[i] = (parts[i] ?? '') + s }, onBreak: (i) => { parts[i] = parts[i] ?? '' } })
  sp.push(text)
  sp.end()
  return parts.map((p) => (p ?? '').trim()).filter(Boolean)
}
