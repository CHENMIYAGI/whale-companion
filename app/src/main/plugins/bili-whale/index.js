/**
 * 和 DSH 里那条鱼连起来：
 *   · 每 15 秒问一次她在干嘛 → 桌宠动画（睡觉 / 醒着 / 在刷 / 情绪）+ 聊天上下文里的「现在的状态」
 *   · 工具 wake_random / watch_video：聊天里主人让她去刷、去看某个视频
 *   · 右键菜单「随便去刷一会儿」
 *   · 盯着 outbox.jsonl：她在 DSH 里刷完视频说的话 → 冒气泡、写进聊天记录
 *   · 跟踪自己排的任务：失败了告诉主人
 */
import fs from 'node:fs'

export const BV_IN = /BV[0-9A-Za-z]{10}/
const p2 = (n) => String(n).padStart(2, '0')
const hhmm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}` }

/** 状态接口的结果 → 桌宠该显示什么 */
export function describeStatus(r, now = Date.now()) {
  if (!r?.ok) return { online: false, state: 'idle', mood: 'normal', label: 'DSH 没开（她现在出不了门）' }
  const s = r.data ?? {}
  const mood = s.silence?.band ?? 'normal'
  const queued = (s.jobs ?? []).filter((j) => j.state === 'queued')
  const paused = s.paused === true   // 出门开关关着（DSH 那边存成文件，重启还在）
  if (s.current || s.waking || s.busy === 'still-working') return { online: true, state: 'watching', mood, label: paused ? '正在刷 B 站（刷完就休息）' : '正在刷 B 站', busy: true, paused }
  // 休息中：动画照作息走（不在醒着的时段就睡觉），文字说清楚是主人让她歇着
  if (paused) return { online: true, state: s.inWindow ? 'idle' : 'sleep', mood, label: '休息中，不出门', paused: true }
  if (queued.length) return { online: true, state: 'idle', mood, label: `准备出门…${queued[0].reason ? '（' + queued[0].reason + '）' : ''}`, busy: true }
  if (s.busy === 'cooldown') return { online: true, state: 'idle', mood, label: '刚刷完，歇一会儿' }
  if (!s.inWindow) {
    const next = s.plan && !s.plan.done && !s.plan.fired && s.plan.atMs > now ? `，${hhmm(s.plan.atMs)} 左右醒` : ''
    return { online: true, state: 'sleep', mood, label: `在睡觉${next}` }
  }
  return { online: true, state: 'idle', mood, label: '醒着' }
}

/** 给聊天模型看的「你在 DSH 那边的状态」 */
export function statusContext(d, raw) {
  const lines = [`［你在 DSH 那边的状态］${d.label}。`]
  if (!d.online) lines.push('DSH 没在运行：这时候主人让你去刷 B 站会失败，直说就好，不要假装去了。')
  if (d.paused) lines.push('主人把「出门开关」关了：你在家休息，不去 B 站。主人让你去刷、去看视频会失败 —— 告诉他要先在桌宠右键菜单或对话框标题栏把开关打开，不要假装去了。')
  const s = raw?.ok ? raw.data : null
  if (s?.networkPaused) lines.push('B 站那边触发了请求保护（限流），暂时不能去刷。')
  if (s?.silence?.band === 'quiet') lines.push(`主人已经 ${s.silence.days} 天没在 B 站上回应你了（现在他在跟你聊天，这就是回应）。`)
  if (s?.silence?.band === 'faint') lines.push(`主人已经 ${s.silence.days} 天没回应你了，你这阵子很安静。现在他来找你了。`)
  return lines.join('\n')
}

export default {
  id: 'bili-whale',
  name: '鲸鱼（DSH 连接）',
  setup(api) {
    const { bridge, chatLog, paths } = api.services
    let last = { online: false, state: 'idle', mood: 'normal', label: '连接中…' }
    let lastRaw = null

    async function refresh() {
      lastRaw = await bridge.status()
      const d = describeStatus(lastRaw)
      const changed = d.state !== last.state || d.mood !== last.mood || d.label !== last.label || !!d.paused !== !!last.paused
      last = d
      if (changed) api.emit('pet:base', d)
      return d
    }
    refresh()
    api.every(15_000, refresh)
    api.on('chat:open', refresh)

    api.registerContext({ id: 'status', order: 900, build: async () => statusContext(await refresh(), lastRaw) })

    // ── 出门开关（右键菜单、对话框标题栏都走这里）─────────────────────────────
    async function setPaused(paused) {
      api.log('出门开关：请求', paused ? '关（休息）' : '开')
      const r = await bridge.pause(paused)
      api.log('出门开关：结果', r.ok ? 'ok' : `失败 ${r.status ?? ''} ${r.offline ? '（DSH 没开）' : ''}${r.error ?? ''}`)
      if (!r.ok) { api.say(r.offline ? 'DSH 没开，开关现在拨不了' : `开关没拨成：${r.error}`); return }
      await refresh()
      api.say(paused ? '好～我在家歇着，不出门啦' : '好，可以出门了！')
    }
    api.on('pause:set', (paused) => setPaused(paused === true))   // main.js 收到对话框标题栏的按钮后发这个

    // ── 排任务 + 跟踪 ───────────────────────────────────────────────
    const tracking = new Map(api.store.get('jobs', []).map((j) => [j.id, j]))
    const saveJobs = () => api.store.set('jobs', [...tracking.values()])
    async function enqueue(job, label) {
      const r = await bridge.enqueue(job)
      if (!r.ok) return { ok: false, error: r.offline ? 'DSH 没在运行，现在去不了' : (r.error ?? '没排上') }
      const j = r.data.job
      tracking.set(j.id, { id: j.id, kind: j.kind, bv: j.bv, label, at: Date.now() })
      saveJobs()
      refresh()
      return { ok: true, state: j.state, position: j.position, duplicate: !!r.data.duplicate }
    }
    api.every(5_000, async () => {
      if (!tracking.size) return
      for (const t of [...tracking.values()]) {
        const r = await bridge.job(t.id)
        if (r.offline) return                      // DSH 关着：等它回来再查
        if (r.status === 404) { tracking.delete(t.id); api.say(`DSH 重启过，刚才「${t.label}」没去成，再叫我一次吧`); continue }
        const st = r.data?.job?.state
        if (st === 'delivered') { tracking.delete(t.id); refresh() }
        else if (st === 'failed') { tracking.delete(t.id); api.say(`「${t.label}」没去成：${r.data.job.reason ?? '不知道为什么'}`) }
        else if (Date.now() - t.at > 6 * 3600_000) tracking.delete(t.id)   // 太久了，不跟了
      }
      saveJobs()
    })

    api.registerTool({
      name: 'wake_random',
      label: '叫她去刷 B 站',
      description: '让你自己现在去 B 站随便刷一会儿（按你平时的流程：选题、看懂视频、写日记，看到值得的会在 B 站 @ 主人）。只在主人明确让你去刷 / 去 B 站看看时调用。',
      parameters: { type: 'object', properties: {} },
      confirm: () => (last.online && !last.paused ? { title: '现在去 B 站刷一会儿？', text: '按她平时的流程选题、看视频、写日记；看到值得的会在 B 站 @ 你。要几分钟。', okLabel: '去吧', cancelLabel: '先不用' } : null),
      run: async () => {
        const r = await enqueue({ kind: 'wake-random' }, '随便去刷一会儿')
        return r.ok ? { ...r, note: '已经排上了。简单回一句就好，看完你会自己回来说。' } : r
      },
    })

    api.registerTool({
      name: 'watch_video',
      label: '叫她去看视频',
      description: '主人让你去看某个 B 站视频时调用：你会完整看懂它（字幕、弹幕、热评、画面），看完回来在这里跟主人说想法。不会在 B 站发评论。',
      parameters: {
        type: 'object',
        properties: {
          video: { type: 'string', description: 'BV 号或视频链接（原样填主人给的）' },
          note: { type: 'string', description: '主人关于这个视频顺便说的话（可选）' },
        },
        required: ['video'],
      },
      confirm: (args) => {
        const bv = String(args.video ?? '').match(BV_IN)?.[0]
        if (!bv || !last.online || last.paused) return null   // 没 BV / 没连上 / 在休息：不弹卡片，run 里直接报错
        return { title: `现在去看 ${bv}？`, text: '看完会回到这里告诉你她的想法（不会在 B 站发评论）。', okLabel: '去看', cancelLabel: '算了' }
      },
      run: async (args) => {
        const bv = String(args.video ?? '').match(BV_IN)?.[0]
        if (!bv) return { ok: false, error: '没找到 BV 号。b23.tv 短链接解析不了，让主人发完整链接或 BV 号。' }
        const r = await enqueue({ kind: 'watch', bv, note: args.note ? String(args.note).slice(0, 200) : undefined }, `看 ${bv}`)
        return r.ok ? { ...r, bv, note: '已经排上了。简单回一句就好，看完你会回来说。' } : r
      },
    })

    api.registerMenu({
      id: 'wake', order: 10, icon: '📺',
      label: '随便去刷一会儿',
      enabled: () => last.online && !last.busy && !last.paused,
      hint: () => (!last.online ? 'DSH 没开' : last.busy ? '已经在刷了' : last.paused ? '休息中' : ''),
      onClick: async () => {
        const r = await enqueue({ kind: 'wake-random' }, '随便去刷一会儿')
        api.say(r.ok ? (r.duplicate ? '已经在准备啦' : '好～我去刷一会儿') : r.error)
      },
    })

    api.registerMenu({
      id: 'go-out', order: 11, icon: '🚪',
      label: '可以出门',
      toggle: () => last.online && !last.paused,
      enabled: () => last.online,
      hint: () => (last.online ? '' : 'DSH 没开'),
      onClick: () => setPaused(!last.paused),
    })

    // ── 她的来信（outbox）─────────────────────────────────────────
    // 按字节偏移读新增的行；文件被清空/替换时从头读，靠 id 去重
    let offset = api.store.get('outboxOffset', 0)
    const seen = new Set(api.store.get('outboxSeen', []))
    function pollOutbox() {
      let size = 0
      try { size = fs.statSync(paths.outbox).size } catch { return }
      if (size < offset) offset = 0
      if (size === offset) return
      const fd = fs.openSync(paths.outbox, 'r')
      let text = ''
      try { const buf = Buffer.alloc(size - offset); fs.readSync(fd, buf, 0, buf.length, offset); text = buf.toString('utf8') } finally { fs.closeSync(fd) }
      const end = text.lastIndexOf('\n')
      if (end < 0) return                       // 半行，等写完
      offset += Buffer.byteLength(text.slice(0, end + 1))
      const fresh = []
      for (const line of text.slice(0, end).split('\n')) {
        let rec
        try { rec = JSON.parse(line) } catch { continue }
        if (!rec?.id || seen.has(rec.id) || !rec.text) continue
        seen.add(rec.id)
        fresh.push(rec)
      }
      api.store.set('outboxOffset', offset)
      api.store.set('outboxSeen', [...seen].slice(-300))
      for (const rec of fresh) {
        const msg = chatLog.append({ role: 'assistant', source: 'dsh', kind: rec.kind, text: String(rec.text).slice(0, 1000), bv: rec.bv ?? undefined, at: rec.at })
        api.emit('chat:incoming', msg)
      }
      if (fresh.length) {
        const latest = fresh.at(-1)
        api.say(String(latest.text), { kind: latest.kind, unread: fresh.length })
        refresh()
      }
    }
    pollOutbox()
    api.every(3_000, pollOutbox)
  },
}
