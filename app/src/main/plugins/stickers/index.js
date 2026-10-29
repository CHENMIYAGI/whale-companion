// 表情包：她的库在 ~/.whale-companion/stickers/（导入见 app/stickers/README.md）
//   · 系统提示里放一段：有哪些表情包、什么时候用（偶尔用，不要每句都发）
//   · 工具 send_sticker：按情绪 / 关键词挑一张，附在这次回复里
//   · 冷却：发过一张之后，主人至少再说 3 句才能发下一张（光靠提示词管不住，程序里再卡一道）
//   · 偷图：主人发了一张她库里没有的表情包，她可以用 keep_sticker 问「这个能给我吗」（确认卡片），同意了就进她的库
//   · 导入时没写描述的图（比如主人自己画的，只有文件名）：看图模型能用时在后台看一遍，补上配字、描述、情绪标签
import fs from 'node:fs'
import path from 'node:path'
import { readLibrary, pickSticker, updateSticker, addToLibrary, sniffImage, stickerId, EMOTIONS, SELF } from '../../core/stickers.js'
import { findMine } from '../../core/my-stickers.js'

export const COOLDOWN_TURNS = 3

/** 库里还没描述的图，看一遍补上（一次最多 limit 张；看不了的跳过，下次再试） */
export async function describeMissing({ dir, vision, limit = 5, log = () => {} }) {
  let done = 0
  for (const s of readLibrary(dir).stickers.filter((x) => !x.desc).slice(0, limit)) {
    let buffer
    try { buffer = fs.readFileSync(path.join(dir, path.basename(s.file))) } catch { continue }
    const ext = sniffImage(buffer)
    if (!ext) continue
    const r = await vision.look({ hash: s.hash, buffer, ext })
    if (!r) continue
    updateSticker(dir, stickerId(s), { caption: r.caption || s.caption, desc: r.desc, tags: r.tags?.length ? r.tags : s.tags })
    log(`补了描述：${s.name} → ${r.desc}`)
    done++
  }
  return done
}

export default {
  id: 'stickers',
  name: '表情包',
  setup(api) {
    const dir = api.services.paths.stickers

    // 没描述的图：开机 1 分钟后看一轮，之后每 30 分钟一轮（看图模型不可用时什么都不做）
    const vision = api.services.vision
    if (vision) {
      const fill = () => describeMissing({ dir, vision, log: api.log })
      const t = setTimeout(() => fill().catch(() => {}), 60_000)
      api.onDispose(() => clearTimeout(t))
      api.every(30 * 60_000, fill)
    }

    // ── 偷图 ──
    // 主人最近发的、她库里没有的那张（只记最新一张；5 轮内有效；每张图只问一次，主人说不给也不再问）
    let offer = null   // { box, id, name, hash, desc, turn }
    let pending = null // 这次卡片问的是哪张：run 只认它（主人点了「给你」才会走到 run）
    const asked = new Set(api.store.get('asked', []))
    const inLibrary = (hash) => readLibrary(dir).stickers.some((s) => s.hash === hash)
    const currentOffer = () => (offer && api.store.get('turn', 0) - offer.turn < 5 && !asked.has(offer.hash) && !inLibrary(offer.hash) ? offer : null)
    api.on('chat:user', (rec) => {
      const st = rec?.kind === 'sticker' ? rec.meta?.sticker : null
      if (st?.hash && !inLibrary(st.hash) && !asked.has(st.hash)) offer = { ...st, turn: api.store.get('turn', 0) }
    })
    api.registerContext({
      id: 'offer', order: 940,   // 每轮都可能变，放后面（前面的提示能命中缓存）
      build: () => {
        const o = currentOffer()
        return o ? `［主人刚发的表情包］「${o.name}」你的库里没有。真的很喜欢的话，可以用 keep_sticker 问主人要（"这个能给我吗"）；一般般就别问。` : ''
      },
    })
    api.registerTool({
      name: 'keep_sticker',
      label: '把这张表情包收进她的库',
      description: '问主人要他刚发的那张表情包（你库里没有的）。界面会弹卡片问主人给不给；给了就进你的库，以后你也能发。一张图只问一次。',
      parameters: { type: 'object', properties: {} },
      confirm: () => {
        pending = null
        const o = currentOffer()
        if (!o) return null   // 没有可要的：不弹卡片，run 里说明
        asked.add(o.hash)
        api.store.set('asked', [...asked].slice(-200))
        pending = o
        return { title: '这个能给我吗？', text: `她想要「${o.name}」这张表情包，给了以后她也会发。`, okLabel: '给你', cancelLabel: '不给', image: { box: o.box, id: o.id, name: o.name } }
      },
      run: () => {
        // 只认刚才卡片问的那张：不能看 offer —— 主人说「不给」之后她再要，卡片不弹（问过了），run 却会把图收进库
        const o = pending
        pending = null
        if (!o) return { ok: false, error: '主人最近没发你库里没有的表情包（或者已经问过了），别再要了' }
        offer = null
        const src = findMine({ box: o.box, id: o.id }, api.services.paths)
        if (!src) return { ok: false, error: '那张图找不到了' }
        const seen = api.services.vision?.cached(o.hash)
        const r = addToLibrary(dir, fs.readFileSync(src.file), { name: o.name, caption: seen?.caption ?? '', desc: seen?.desc ?? '', tags: seen?.tags ?? [], source: 'owner' })
        if (!r.ok) return r
        api.log('主人给了一张表情包：' + o.name)
        return { ok: true, name: r.sticker.name, note: '收下了！可以开心一下，以后合适的时候也能发它' }
      },
    })

    // 主人每发一次消息，轮数 +1（存在 state.json：重启了冷却也还在）。
    // 听 chat:busy 而不是 chat:user：主人一次发「一句话 + 一张图」会有两条 chat:user，但只算一轮
    api.on('chat:busy', (busy) => { if (busy) api.store.set('turn', api.store.get('turn', 0) + 1) })

    api.registerContext({
      id: 'stickers', order: 6,
      build: () => {
        const list = readLibrary(dir).stickers
        if (!list.length) return ''
        // 她自己的放前面、单独一组，写上什么场合用；别人画的（dsh-pet、找主人要的）放后面
        const line = (s) => `- ${s.name}${s.tags?.length ? '（' + s.tags.join('、') + '）' : ''}${s.when ? '：' + s.when : ''}`
        const own = list.filter((s) => s.source === SELF).slice(0, 40).map(line)
        const others = list.filter((s) => s.source !== SELF).slice(0, 40).map(line)
        const groups = [
          own.length && `你自己的表情（主人照你的样子画的，有合适的就优先用这些）：\n${own.join('\n')}`,
          others.length && `别人画的表情：\n${others.join('\n')}`,
        ].filter(Boolean)
        return `［表情包］你有一些表情包，可以用 send_sticker 发给主人。
- 偶尔用，不要每句都发：真的有情绪、发一张比说一句更好玩的时候才发。主人在说正事、难过、认真问问题时别发。
- 程序会卡：发过一张之后要隔几句才能再发，被拒了就用文字说。
- 不要自己在文字里写「[表情：…]」，那样主人只看到一行字。
${groups.join('\n\n')}`
      },
    })

    api.registerTool({
      name: 'send_sticker',
      label: '发表情包',
      silent: true,   // 图本身就看得见，不用再显示「发表情包 ✓」
      description:
        '发一张表情包。按情绪（emotion）挑，或者用名字 / 配字 / 场合里的词（query）指定某一张；两个都填更准。有合适的会优先挑你自己的表情。' +
        '偶尔用，不要每句都发。发完不用再描述这张图。',
      parameters: {
        type: 'object',
        properties: {
          emotion: { type: 'string', enum: EMOTIONS, description: '想表达的情绪' },
          query: { type: 'string', description: '表情包名字或配字里的词，比如「吃白饭」' },
        },
      },
      run: (args, ctx) => {
        const turn = api.store.get('turn', 0)
        const last = api.store.get('lastTurn', null)
        if (last !== null && turn - last < COOLDOWN_TURNS) {
          return { ok: false, error: `刚发过表情包，再聊 ${COOLDOWN_TURNS - (turn - last)} 句才能发下一张。这次用文字说就好，不用提这件事。` }
        }
        const emotion = EMOTIONS.includes(args.emotion) ? args.emotion : undefined
        const recent = api.store.get('recent', [])
        const s = pickSticker(readLibrary(dir), { emotion, query: args.query, exclude: recent })
        if (!s) return { ok: false, error: '没有对得上的表情包，用文字说就好' }
        if (!ctx?.attach?.({ kind: 'sticker', box: 'her', id: s.id, name: s.name, desc: [s.caption && `配字：${s.caption}`, s.desc].filter(Boolean).join('；') })) {
          return { ok: false, error: '这次回复已经发过一张了' }
        }
        api.store.set('lastTurn', turn)
        api.store.set('recent', [s.id, ...recent.filter((x) => x !== s.id)].slice(0, 5))
        return { ok: true, sent: s.name, note: '已经发出去了，主人看得到图，不用再描述' }
      },
    })
  },
}
