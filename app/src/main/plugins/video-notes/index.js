// 视频笔记：她在 DSH 里看过的视频（~/.dsh/whale-videos/<BV>/）—— 桌宠这边只读
//   · 工具 recall_video：主人聊起某个视频时，按 BV 或关键词（标题、她的笔记、日期）找回来，返回相关的片段
import fs from 'node:fs'
import path from 'node:path'
import { recallVideos, listVideos, notesReport } from '../../core/video-notes.js'

export default {
  id: 'video-notes',
  name: '视频笔记',
  setup(api) {
    const root = api.services.paths.videos

    api.registerTool({
      name: 'recall_video',
      label: '翻翻视频笔记',
      description:
        '翻你自己看过的视频的笔记（只读）。主人聊起你看过的某个视频、问"那个视频里…""你那天看的…"时用：' +
        'query 填 BV 号，或关键词（标题里的词、你笔记里的词、日期如 2026-10-28 或 10-28）；问到某个时间点时再填 at（如 03:20），会给那附近的字幕和笔记。' +
        '找不到就直说不记得了，不要编。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'BV 号或关键词' },
          at: { type: 'string', description: '可选：时间点，如 03:20（配合 BV 号用）' },
        },
        required: ['query'],
      },
      run: (args) => {
        const r = recallVideos(root, { query: args.query, at: args.at })
        // 主人聊起这个视频她才去翻 → 算「聊到了」（口味插件记一笔）；对得上好几个就不算
        if (r.ok && r.videos?.length === 1) api.emit('video:recalled', r.videos[0].bv)
        return r
      },
    })

    // 右键「👀 看看…」→「看看视频笔记」：写一份能读的摘要再打开（和「看看她的分类」一样）
    api.registerMenu({
      id: 'view', order: 42, icon: '🎞️', group: 'look',
      label: '看看视频笔记',
      enabled: () => listVideos(root).length > 0,
      hint: () => (listVideos(root).length ? '' : '她还没有视频笔记'),
      onClick: () => {
        const { paths } = api.services
        const out = path.join(paths.app, '视频笔记.txt')
        fs.mkdirSync(paths.app, { recursive: true })
        fs.writeFileSync(out, notesReport(root), 'utf8')
        api.services.openPath(out)
      },
    })
  },
}
