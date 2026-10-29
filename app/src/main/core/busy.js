// 忙碌感知（2026-10-28 主人要的）：主人忙的时候她不打扰，忙完一起说
//
// 三种"忙"：
//   manual      主人在右键 / 托盘里点了「我在忙」：30 分钟 / 1 小时 / 直到我说（设置里能关掉这个功能）
//   fullscreen  前台程序全屏（看视频、玩游戏、演示）（设置里能关掉）
//   away        系统空闲超过 10 分钟：人不在电脑前
// 忙的时候：气泡先攒着不冒、待机小动作暂停、桌宠变淡一点。
// 不忙了：攒着的话合成一个气泡（"忙完啦？刚才……"），全部都在对话框里。
//
// 这里只有逻辑：时间、空闲秒数、全屏状态、设置都从外面传进来，方便测试。
export const IDLE_AWAY_SEC = 10 * 60
export const MANUAL = { '30m': 30 * 60_000, '1h': 60 * 60_000, until: Infinity }

const p2 = (n) => String(n).padStart(2, '0')
const hhmm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}` }
const REASON_TEXT = { manual: '主人说他在忙', fullscreen: '主人在全屏用别的程序', away: '主人不在电脑前' }

/**
 * @param o.now          () => 毫秒
 * @param o.idleSec      () => 系统空闲秒数（Electron 的 powerMonitor.getSystemIdleTime）
 * @param o.fullscreen   () => 前台是不是全屏（拿不到就 false）
 * @param o.settings     () => { manual: bool, fullscreen: bool }（设置里的开关）
 * @param o.manual       一开始的手动状态 { until: 毫秒 | null（直到我说）} 或 null（重启后接着算）
 */
export function createBusy({ now = Date.now, idleSec = () => 0, fullscreen = () => false, settings = () => ({ manual: true, fullscreen: true }), manual = null } = {}) {
  let manualUntil = manual ? (manual.until ?? Infinity) : 0
  let state = { busy: false, reasons: [], since: null }
  let held = []          // 忙的时候攒下的话 { text, at }
  let lastEpisode = null // 上一段「忙」：{ reasons, from, to, held } —— 聊天上下文用

  function evaluate() {
    const t = now(), s = settings()
    const reasons = []
    if (s.manual !== false && manualUntil > t) reasons.push('manual')
    if (s.fullscreen !== false && fullscreen()) reasons.push('fullscreen')
    if (idleSec() >= IDLE_AWAY_SEC) reasons.push('away')
    const busy = reasons.length > 0
    let released = null
    if (busy && !state.busy) state = { busy, reasons, since: t }
    else if (busy) state = { ...state, reasons }
    else if (!busy && state.busy) {
      lastEpisode = { reasons: state.reasons, from: state.since, to: t, held: held.map((h) => h.text) }
      released = { reasons: state.reasons, held }
      held = []
      state = { busy: false, reasons: [], since: null }
    }
    return { ...state, released }
  }

  return {
    evaluate,
    state: () => ({ ...state }),
    /** 手动「我在忙」：'30m' / '1h' / 'until'；'off' = 不忙了。返回存进配置用的 { until } 或 null */
    setManual(mode) {
      if (mode === 'off') { manualUntil = 0; return null }
      const ms = MANUAL[mode]
      if (!ms) throw new Error('不认识的忙碌时长：' + mode)
      manualUntil = ms === Infinity ? Infinity : now() + ms
      return { until: manualUntil === Infinity ? null : manualUntil }
    },
    manual: () => (manualUntil > now() ? { until: manualUntil === Infinity ? null : manualUntil } : null),
    /** 忙的时候来了一句话：攒着，返回 true；不忙返回 false（照常冒气泡） */
    hold(text) {
      if (!state.busy) return false
      held.push({ text: String(text), at: now() })
      return true
    },
    held: () => held.map((h) => h.text),
    /** 给聊天上下文：现在在忙 / 刚才忙过（30 分钟内） */
    contextLine() {
      const t = now()
      if (state.busy) return `［主人现在在忙］${state.reasons.map((r) => REASON_TEXT[r]).join('、')}（从 ${hhmm(state.since)} 起）。他要是来找你，回得简短些。`
      if (lastEpisode && t - lastEpisode.to < 30 * 60_000) {
        const why = lastEpisode.reasons.map((r) => REASON_TEXT[r]).join('、')
        const said = lastEpisode.held.length ? `那会儿你攒着没说的话（已经合成一个气泡给他了）：${lastEpisode.held.map((x) => `「${x.slice(0, 60)}」`).join('、')}` : '那会儿你没什么要说的。'
        return `［刚才］${hhmm(lastEpisode.from)}–${hhmm(lastEpisode.to)} ${why}，所以你没出声。${said}`
      }
      return ''
    },
  }
}

/** 攒着的话合成一个气泡（120 字以内）。away 用"回来啦"，别的用"忙完啦" */
export function releaseBubble({ reasons, held }) {
  if (!held.length) return null
  const hi = reasons.length === 1 && reasons[0] === 'away' ? '回来啦？' : '忙完啦？'
  if (held.length === 1) return (hi + '刚才' + held[0].text).slice(0, 120)
  const first = held[0].text.length > 40 ? held[0].text.slice(0, 40) + '…' : held[0].text
  return `${hi}刚才攒了 ${held.length} 句想说：${first}（点我看全部）`.slice(0, 120)
}
