// 主人的口味：记主人对她分享的视频有什么反应（~/.bili-ai/taste.json，DSH 那边选题时会参考）
//   · 她从 DSH 发回来、带 BV 的话 → 分享了（shown）
//   · 点了「打开视频」 → open；聊天里提到那个 BV、或她翻笔记找到了那个视频 → talk
//   · 工具 rate_video：主人明确说喜欢 / 不喜欢某个视频时记一下
//   · 右键「她的分类」：每个分类的统计
import fs from 'node:fs'
import path from 'node:path'
import { recordEvent, tasteStats, reportText, readTaste } from '../../core/taste.js'
import { recallVideos } from '../../core/video-notes.js'

const BV_IN = /BV[0-9A-Za-z]{10}/g

export default {
  id: 'taste',
  name: '主人的口味',
  setup(api) {
    const { paths } = api.services
    const file = paths.taste
    const videosRoot = paths.videos
    const record = (bv, kind) => {
      const r = recordEvent({ file, videosRoot, bv, kind })
      if (r.ok && !r.duplicate) api.log(`记一笔：${bv} ${kind}${r.category ? '（' + r.category + '）' : ''}`)
      return r
    }

    api.on('chat:incoming', (msg) => { if (msg?.bv) record(msg.bv, 'shown') })
    api.on('video:open', (bv) => record(bv, 'open'))
    api.on('chat:user', (rec) => { for (const m of String(rec?.text ?? '').matchAll(BV_IN)) record(m[0], 'talk') })
    api.on('video:recalled', (bv) => record(bv, 'talk'))

    api.registerTool({
      name: 'rate_video',
      label: '记下主人喜不喜欢',
      description:
        '主人明确说他喜欢 / 不喜欢你给他看的某个视频时调用（"这个好看""这类别再给我看了"），记下来，以后你挑视频会参考。' +
        '只在他自己说出来时用，不要从语气里猜。video 填 BV 号，或能认出那个视频的关键词（标题里的词）。',
      parameters: {
        type: 'object',
        properties: {
          video: { type: 'string', description: 'BV 号或关键词' },
          feeling: { type: 'string', enum: ['like', 'dislike'], description: 'like = 喜欢；dislike = 不喜欢' },
        },
        required: ['video', 'feeling'],
      },
      run: (args) => {
        if (args.feeling !== 'like' && args.feeling !== 'dislike') return { ok: false, error: 'feeling 只能是 like 或 dislike' }
        const found = recallVideos(videosRoot, { query: args.video })
        const v = found.ok ? found.videos?.[0] : null
        if (!v) return { ok: false, error: found.error ?? `视频笔记里找不到「${args.video}」，问问他是哪个视频` }
        if (found.videos.length > 1 && !/BV[0-9A-Za-z]{10}/.test(String(args.video))) {
          return { ok: false, error: `对得上的不止一个：${found.videos.map((x) => `${x.title}（${x.bv}）`).join('、')}，问清楚是哪个` }
        }
        const r = record(v.bv, args.feeling)
        return r.ok ? { ok: true, bv: v.bv, title: v.title, category: r.category, note: '记下了，顺着聊就好，不用特意说"已记录"' } : r
      },
    })

    api.registerMenu({
      id: 'view', order: 47, icon: '🏷️',
      label: '她的分类',
      enabled: () => readTaste(file).categories.length > 0,
      hint: () => (readTaste(file).categories.length ? '' : '她还没分过类'),
      onClick: () => {
        const out = path.join(paths.app, '她的分类.txt')
        fs.mkdirSync(paths.app, { recursive: true })
        fs.writeFileSync(out, reportText(tasteStats({ file, videosRoot })), 'utf8')
        api.services.openPath(out)
      },
    })
  },
}
