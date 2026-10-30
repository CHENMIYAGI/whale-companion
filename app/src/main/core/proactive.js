// 主动开口：隔一段时间看一次，下面都满足才问她「要不要找主人说句话」
//
//   · 主人在电脑前：最近 5 分钟内碰过键盘鼠标
//   · 不忙：没开「我在忙」、前台没全屏
//   · 离上次聊天、离上次主动开口（问过她就算，不管她说没说）都超过最短间隔（默认 60 分钟）
//   · 今天主动开口（真的说了的）不到每日上限（默认 4 次）
//   · 不在深夜（默认 23 点到早上 8 点）
// 问她时给的：系统提示里本来就有的人设、我的成长、她眼中的主人、日记末尾、小本本、现在时间，
// 加上最近的聊天，再加上「上次主动开口后主人有没有回」。说不说、说什么由她自己决定。
//
// 这里只有判断和提示词；时间、空闲秒数、忙不忙、记录从外面传进来，方便测试。
import { SEP, SILENT } from './multi-message.js'

export const PROACTIVE_DEFAULTS = { enabled: true, minGapMinutes: 60, dailyMax: 4, quietStart: 23, quietEnd: 8 }
export const PRESENT_SEC = 5 * 60   // 最近这么多秒内有输入 = 主人在电脑前

/** 几点算深夜：start > end 是跨午夜（23→8）；一样就是没有深夜 */
export function inQuietHours(hour, start, end) {
  if (start === end) return false
  return start > end ? hour >= start || hour < end : hour >= start && hour < end
}

const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }

/**
 * 现在能不能开口。返回 { ok, why }（why 是不能的原因，写日志用）
 * state：{ lastTriedAt, day, count }（存在 state.json 里）
 */
export function canSpeak({ now, settings, idleSec, holding, chatting, lastChatAt, state }) {
  const s = { ...PROACTIVE_DEFAULTS, ...(settings ?? {}) }
  const gap = Number(s.minGapMinutes) * 60_000
  if (!s.enabled) return { ok: false, why: '设置里关了' }
  if (inQuietHours(new Date(now).getHours(), Number(s.quietStart), Number(s.quietEnd))) return { ok: false, why: '深夜' }
  if (idleSec >= PRESENT_SEC) return { ok: false, why: '主人不在电脑前' }
  if (holding) return { ok: false, why: '主人在忙' }
  if (chatting) return { ok: false, why: '正在聊' }
  if (now - (lastChatAt ?? 0) < gap) return { ok: false, why: '刚聊过' }
  if (now - (state?.lastTriedAt ?? 0) < gap) return { ok: false, why: '刚问过她' }
  const count = state?.day === dayOf(now) ? state.count ?? 0 : 0
  if (count >= Number(s.dailyMax)) return { ok: false, why: '今天说够了' }
  return { ok: true }
}

/** 记一笔：问过她了（spoke = 她真的说了，算进今天的次数） */
export function recordTry(state, now, spoke) {
  const today = dayOf(now)
  const count = (state?.day === today ? state.count ?? 0 : 0) + (spoke ? 1 : 0)
  return { lastTriedAt: now, day: today, count, lastSpokeAt: spoke ? now : state?.lastSpokeAt ?? null }
}

const ago = (ms) => (ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} 分钟` : ms < 48 * 3600_000 ? `${Math.round(ms / 3600_000)} 小时` : `${Math.round(ms / 86400_000)} 天`)

/**
 * 问她的话。只交代事实和怎么回，不规定她的心情和反应
 * @param last  上次主动开口：{ at, replied }，没有就 null
 */
export function proactiveNote({ now, lastChatAt, last, notebook = '', invite = null }) {
  const since = lastChatAt ? `你们上次说话是 ${ago(now - lastChatAt)}前。` : '你们还没在桌宠里聊过天。'
  const prev = last ? `上次你主动找他是 ${ago(now - last.at)}前，那之后他${last.replied ? '回过你' : '没回你'}。` : '这是你第一次主动找他。'
  // 一起看（2026-10-30）：「留着以后」里有预习好的，告诉她可以邀请（邀不邀请由她）
  const together = invite
    ? `\n\n［留着以后］你预习好了「${invite.title}」${invite.parts > 1 ? `第 ${invite.nextPart} P` : ''}，一直想陪他一起看。` +
      `想的话可以邀请他现在一起看：在你要说的话最后单独一行写 ${INVITE}（他会看到「现在看 / 晚点再说 / 不想看」三个按钮，你不用再问一遍）。不想邀请就不写。`
    : ''
  return `［系统提示，不是主人说的］主人现在在电脑前，没在忙。${since}${prev}
你可以主动跟他说点什么，也可以不说。
想说就直接写你要发的话（可以分几条，两条之间单独一行写 ${SEP}）；不想说就只回 ${SILENT}。` + together + (notebook ? `\n\n［你的小本本］\n${notebook}` : '')
}

/** 她在主动开口的话里写了这个 = 想邀请主人一起看（界面上变成三个按钮，这个记号本身不显示） */
export const INVITE = '[[邀请一起看]]'

/** 把邀请记号从她的几句话里拿掉：{ parts, invited } */
export function takeInvite(parts) {
  let invited = false
  const out = []
  for (const p of parts ?? []) {
    if (p.includes(INVITE)) invited = true
    const t = p.split(INVITE).join('').trim()
    if (t) out.push(t)
  }
  return { parts: out, invited }
}
