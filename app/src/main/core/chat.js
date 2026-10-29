/**
 * 聊天引擎：一句话进来 → 组上下文 → 流式调用模型 → （需要时）调用插件工具 → 一句话出去
 *
 * 她的回复可以分成几条（最多 5 条，见 multi-message.js）：每条一个 id、一个气泡、聊天记录里一条。
 *
 * 和界面之间只通过 ui 接口说话（main.js 把它接到聊天窗口）：
 *   ui.start(id) / ui.delta(id, text) / ui.end(id, rec) / ui.error(id, message)
 *   ui.tool(id, { name, state: 'running'|'done'|'cancelled'|'error', label })
 *   ui.confirm({ id, title, text, okLabel, cancelLabel, image? }) → Promise<boolean>
 *   ui.attach(id, item)   工具往这次回复里附了东西（目前只有表情包：{ kind: 'sticker', box, id, name }）
 *
 * 工具的 run(args, ctx)：ctx.turnId；ctx.attach(item) 往回复里附一张表情包（她说完话后记进聊天记录，
 * 记成「[表情：名字]」，DSH 那边读记录也看得懂）。工具写了 silent: true 就不显示「…✓」小提示。
 *
 * 事件（插件可以订阅）：
 *   chat:user       主人说了一句（已写入聊天记录）
 *   chat:assistant  她回了一句（已写入聊天记录）
 *   chat:busy       true/false，正在想
 */
import crypto from 'node:crypto'
import { streamChat, explainError } from './llm.js'
import { stickerText } from './stickers.js'
import { createSplitter, splitParts, typingPause, SEP, SILENT } from './multi-message.js'

// 等一会儿；主人点了「停止」就马上不等了
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('已停止'), { name: 'AbortError' })) }, { once: true })
})

const MAX_USER_CHARS = 4000

export function createChat({ host, chatLog, bus, ui, getConfig, getApiKey, describeSticker = null, llm = { streamChat }, log = console.log, now = () => new Date(), wait = sleep }) {
  let active = null   // { id, controller }

  function historyMessages(limit) {
    const rows = chatLog.recent(limit)
    const out = []
    for (const r of rows) {
      const m = { role: r.role === 'user' ? 'user' : 'assistant', content: contentOf(r) }
      if (!m.content.trim()) continue
      // 表情包、连发的几条都是单独的记录：和前一条同一个人说的就并成一条（有的接口不认连着两条 assistant）。
      // 她连发的文字用分隔符接起来：让她看到自己以前就是这么分条发的
      const last = out[out.length - 1]
      const sticker = r.kind === 'sticker'
      if (last?.role === m.role) {
        last.content += (m.role === 'assistant' && !sticker && !last.endsSticker ? `\n${SEP}\n` : '\n') + m.content
        last.endsSticker = sticker
      } else out.push({ ...m, endsSticker: sticker })
    }
    return out.map(({ role, content }) => ({ role, content }))
  }

  // 给模型看的文字：表情包有描述就带上描述（聊天记录里只记了「[表情：名字]」）
  function contentOf(r) {
    const st = r.kind === 'sticker' ? r.meta?.sticker : null
    if (st?.desc) return `${stickerText(st.name)}（${String(st.desc).slice(0, 200)}）`
    if (st && r.role === 'user') return `${stickerText(st.name)}（主人发了一张图，你看不到画面，只知道它叫「${st.name}」）`
    return String(r.text ?? '')
  }

  // 主人发的图：先看一眼（有缓存就不再看），再记成一条聊天记录
  async function userStickerRec(s) {
    let seen = null
    try { seen = await describeSticker?.(s) } catch {}
    // 粘贴的图没有名字（叫「图片」）：看出配字的话用配字当名字
    const name = (s.name === '图片' && seen?.caption ? seen.caption : String(s.name ?? '图片')).slice(0, 20)
    const desc = seen ? [seen.caption && `配字：${seen.caption}`, seen.desc && `画面：${seen.desc}`].filter(Boolean).join('；') : undefined
    return { role: 'user', text: stickerText(name), kind: 'sticker', meta: { sticker: { box: s.box, id: s.id, name, hash: s.hash, desc } } }
  }

  async function runTool(call, turnId, attach) {
    const tool = host.getTool(call.name)
    if (!tool) return { ok: false, error: `没有这个工具：${call.name}` }
    let args = {}
    try { args = call.arguments ? JSON.parse(call.arguments) : {} } catch { return { ok: false, error: '参数不是合法 JSON' } }
    const label = tool.label ?? tool.name
    // 需要主人点头的工具：先弹确认卡片
    if (tool.confirm) {
      let card
      try { card = typeof tool.confirm === 'function' ? await tool.confirm(args) : tool.confirm } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
      if (card) {
        const ok = await ui.confirm({ id: crypto.randomUUID(), title: card.title ?? `要执行「${label}」吗？`, text: card.text ?? '', okLabel: card.okLabel ?? '好', cancelLabel: card.cancelLabel ?? '算了', image: card.image })
        if (!ok) {
          ui.tool(turnId, { name: tool.name, state: 'cancelled', label })
          chatLog.append({ role: 'event', text: `取消：${tool.name}`, kind: 'tool', meta: { name: tool.name, args, ok: false, cancelled: true } })
          return { ok: false, cancelled: true, note: '主人点了「算了」，没有执行。不要再追问，顺着聊就好。' }
        }
      }
    }
    const mark = (state) => { if (!tool.silent) ui.tool(turnId, { name: tool.name, state, label }) }
    mark('running')
    try {
      const result = await tool.run(args, { turnId, attach })
      mark('done')
      chatLog.append({ role: 'event', text: `工具：${tool.name}`, kind: 'tool', meta: { name: tool.name, args, ok: true } })
      return result ?? { ok: true }
    } catch (e) {
      mark('error')
      chatLog.append({ role: 'event', text: `工具出错：${tool.name}`, kind: 'tool', meta: { name: tool.name, args, ok: false, error: String(e?.message ?? e) } })
      return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
    }
  }

  // sticker：主人这句附的图 { box, id, name, hash }（main.js 已经检查过、复制进桌宠自己的文件夹了）
  async function send(text, { sticker = null } = {}) {
    const clean = String(text ?? '').trim().slice(0, MAX_USER_CHARS)
    if (!clean && !sticker) return { ok: false, error: '空消息' }
    if (active) return { ok: false, error: '她还在说上一句' }
    asking?.abort()   // 她正在想要不要自己开口：主人说话了，那个作废
    const cfg = getConfig()
    const id = crypto.randomUUID()
    const controller = new AbortController()
    active = { id, controller }
    bus.emit('chat:busy', true)

    const historyLimit = Math.max(4, Number(cfg.chat?.historyMessages ?? 40))
    const history = historyMessages(historyLimit)   // 先取历史，再记这一句（不重复）
    const userRecs = []
    if (clean) userRecs.push(chatLog.append({ role: 'user', text: clean }))
    if (sticker) userRecs.push(chatLog.append(await userStickerRec(sticker)))
    for (const r of userRecs) bus.emit('chat:user', r)
    const userContent = userRecs.map(contentOf).join('\n')

    // 她的回复可能分成几条（见 multi-message.js）：parts[i] 是第 i 条的文字，ids[i] 是它在界面上的气泡。
    // 第一条边生成边显示；碰到分隔符，第一条就说完了（马上记下），第二条先亮「正在输入」
    const parts = ['']
    const ids = [id]
    const done = new Set()     // 已经收尾（显示完 / 去掉了）的条
    const shown = []           // 显示出来、记进聊天记录的
    let typingSince = 0        // 现在这条「正在输入」从什么时候开始的
    const finishPart = (i) => {
      done.add(i)
      const text = parts[i].trim()
      if (!text) { ui.end(ids[i], null); return }   // 空的一条（比如一开头就是分隔符）：气泡拿掉
      const rec = chatLog.append({ role: 'assistant', text })
      ui.end(ids[i], rec)
      shown.push(rec)
      bus.emit('chat:assistant', rec)
    }
    const splitter = createSplitter({
      onText: (i, s) => { parts[i] += s; if (i === 0) ui.delta(id, s) },
      onBreak: (i) => {
        parts[i] = ''
        ids[i] = crypto.randomUUID()
        if (i === 1) { finishPart(0); ui.start(ids[1]); typingSince = Date.now() }
      },
    })
    // 这次回复里附的表情包：当场显示，等她说完话再记进聊天记录（顺序和界面上一样：先文字后图）
    const attached = []
    const attach = (item) => {
      if (item?.kind !== 'sticker' || !item.id || attached.length >= 1) return false   // 一次回复最多一张
      const it = { kind: 'sticker', box: String(item.box ?? 'her'), id: String(item.id), name: String(item.name ?? '').slice(0, 40), desc: item.desc ? String(item.desc).slice(0, 200) : undefined }
      attached.push(it)
      ui.attach?.(id, it)
      return true
    }
    const saveAttached = () => attached.map((it) => chatLog.append({ role: 'assistant', text: stickerText(it.name), kind: 'sticker', meta: { sticker: it } }))
    try {
      const system = await host.buildSystemPrompt({ now: now(), userText: userContent })
      const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: userContent }]
      const tools = host.toolSpecs()
      const maxRounds = Math.max(1, Number(cfg.chat?.maxToolRounds ?? 4))
      ui.start(id)
      for (let round = 0; round < maxRounds; round++) {
        let roundText = ''
        let calls = null
        for await (const ev of llm.streamChat({
          baseUrl: cfg.llm.baseUrl, apiKey: getApiKey(), model: cfg.llm.model, maxTokens: cfg.llm.maxTokens, thinking: cfg.llm.thinking,
          messages, tools: round < maxRounds - 1 ? tools : undefined,   // 最后一轮不给工具，逼她把话说完
          signal: controller.signal,
        })) {
          if (ev.type === 'text') { roundText += ev.delta; splitter.push(ev.delta) }
          else if (ev.type === 'tool_calls') calls = ev.calls
        }
        if (!calls?.length) break
        messages.push({ role: 'assistant', content: roundText, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) })
        for (const c of calls) {
          const result = await runTool(c, id, attach)
          messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 4000) })
        }
        const cur = parts[splitter.index]
        if (cur && !cur.endsWith('\n')) splitter.push('\n')
      }
      splitter.end()
      if (splitter.index === 0) {
        // 只有一条（最常见）：和以前一样
        if (!parts[0].trim() && attached.length) ui.end(id, null)   // 只发了表情包没说话：不硬塞一句「……」
        else { if (!parts[0].trim()) parts[0] = '……'; finishPart(0) }
      } else {
        // 后面几条：一条一条来，每条先「正在输入」一会儿（字越多越久），再整条出来
        for (let i = 1; i < parts.length; i++) {
          if (i > 1) { ui.start(ids[i]); typingSince = Date.now() }
          const text = parts[i].trim()
          if (text) await wait(Math.max(0, typingPause(text) - (Date.now() - typingSince)), controller.signal)
          if (text) ui.delta(ids[i], text)
          finishPart(i)
        }
      }
      for (const r of saveAttached()) bus.emit('chat:assistant', r)
      return { ok: true, id }
    } catch (e) {
      const msg = explainError(e)
      // 说了一半被打断：第一条已经说出口的那部分照样记下来；还没轮到的那几条就不发了（气泡拿掉）
      for (let i = 0; i < ids.length; i++) {
        if (done.has(i)) continue
        if (i === 0 && parts[0].trim()) finishPart(0)
        else { done.add(i); ui.end(ids[i], null) }
      }
      saveAttached()   // 已经显示出来的表情包也记下
      ui.error(id, msg)
      if (e?.name !== 'AbortError') log('[chat] 出错：', e?.message ?? e)
      return { ok: false, error: msg }
    } finally {
      active = null
      bus.emit('chat:busy', false)
    }
  }

  // 不是主人发起的一轮（他没回时接着说、主动开口……）：把 note 放在最后问她一次。
  // 不给工具、不写聊天记录、不碰界面，只返回她想说的几条（不想说 → []，没问成 → null）。
  // 主人一发消息就作废（send 一开头会把它停掉）
  let asking = null
  async function ask({ note, context = {}, maxTokens = 500 }) {
    if (active || asking) return null
    const cfg = getConfig()
    const controller = new AbortController()
    asking = controller
    try {
      const system = await host.buildSystemPrompt({ now: now(), ...context })
      const history = historyMessages(Math.max(4, Number(cfg.chat?.historyMessages ?? 40)))
      const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: note }]
      let text = ''
      for await (const ev of llm.streamChat({
        baseUrl: cfg.llm.baseUrl, apiKey: getApiKey(), model: cfg.llm.model, maxTokens, thinking: cfg.llm.thinking,
        messages, signal: controller.signal,
      })) if (ev.type === 'text') text += ev.delta
      return splitParts(text.split(SILENT).join(''))   // 回了「不说」（或什么都没写）→ []
    } catch (e) {
      if (e?.name !== 'AbortError') log('[chat] 问她要不要说话，没问成：', e?.message ?? e)
      return null
    } finally {
      asking = null
    }
  }

  // 只调一次模型写一段东西（做梦用）：自己给系统提示，不带聊天记录、不给工具、不写记录。出错返回 null
  async function generate({ system, prompt, maxTokens = 600 }) {
    const cfg = getConfig()
    let text = ''
    try {
      for await (const ev of llm.streamChat({
        baseUrl: cfg.llm.baseUrl, apiKey: getApiKey(), model: cfg.llm.model, maxTokens, thinking: cfg.llm.thinking,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      })) if (ev.type === 'text') text += ev.delta
      return text.trim()
    } catch (e) {
      log('[chat] 写东西没写成：', e?.message ?? e)
      return null
    }
  }

  return {
    send,
    ask,
    generate,
    abort() { active?.controller.abort() },
    busy: () => !!active,
  }
}
