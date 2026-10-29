// 路径约定（和 dsh-bili-whale 保持一致：USERPROFILE 优先，DSH_HOME 可覆盖）
import os from 'node:os'
import path from 'node:path'

export const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir() || '.'
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')

/** 和她共用的目录：聊天记录、她的来信（outbox）都在这里。插件看到它存在才会加桌宠相关的提示。 */
export const SHARED_DIR = path.join(DSH_HOME, 'companion')

/** 桌宠自己的目录：配置（含 API key）、你写的插件、读到哪了之类的小状态。 */
export const APP_DIR = process.env.WHALE_COMPANION_HOME || path.join(HOME, '.whale-companion')

export const paths = {
  home: HOME,
  dshHome: DSH_HOME,
  shared: SHARED_DIR,
  app: APP_DIR,
  config: path.join(APP_DIR, 'config.json'),
  appState: path.join(APP_DIR, 'state.json'),
  userPlugins: path.join(APP_DIR, 'plugins'),
  stickers: path.join(APP_DIR, 'stickers'),        // 她的表情包库（index.json 记描述和情绪标签）
  myStickers: path.join(APP_DIR, 'my-stickers'),   // 主人自己的收藏（表情面板里显示）
  received: path.join(APP_DIR, 'received'),        // 主人粘贴 / 拖进来的图（复制一份再显示）
  avatars: path.join(APP_DIR, 'avatars'),          // 对话框标题栏的状态头像：<状态>.png
  visionCache: path.join(APP_DIR, 'vision-cache.json'),   // 看过的图：hash → 描述（每张只看一次）
  chatLog: path.join(SHARED_DIR, 'chat-log.jsonl'),
  outbox: path.join(SHARED_DIR, 'outbox.jsonl'),
  bridge: path.join(DSH_HOME, 'whale-bridge.json'),
  whaleConfig: process.env.BILI_WHALE_CONFIG || path.join(DSH_HOME, 'bili-whale.config.json'),
  whaleNight: path.join(DSH_HOME, 'whale-night.json'),
  diary: path.join(DSH_HOME, 'whale-diary.md'),
  diaryPrivate: path.join(DSH_HOME, 'whale-diary-private.md'),
  persona: path.join(HOME, '.bili-ai', 'persona.md'),
  self: path.join(HOME, '.bili-ai', 'self.md'),   // 她自己写的「我的成长」（和 DSH 里的她共用）
  ownerView: path.join(HOME, '.bili-ai', 'owner-view.md'),   // 她眼中的主人（她在 DSH 里写，桌宠只读）
  videos: path.join(DSH_HOME, 'whale-videos'),   // 她的视频笔记（DSH 那边 debrief 存的，桌宠只读）
  taste: path.join(HOME, '.bili-ai', 'taste.json'),   // 主人的口味：桌宠记反应，DSH 管分类、选题时参考
  dreams: path.join(DSH_HOME, 'whale-dreams.md'),     // 她在桌宠上睡着时做的梦（和日记分开；梦不是真的发生过）
}

/** 给测试用：把所有路径指到一个临时目录 */
export function pathsFor(root) {
  const dsh = path.join(root, '.dsh')
  const app = path.join(root, '.whale-companion')
  const shared = path.join(dsh, 'companion')
  return {
    home: root, dshHome: dsh, shared, app,
    config: path.join(app, 'config.json'), appState: path.join(app, 'state.json'), userPlugins: path.join(app, 'plugins'),
    stickers: path.join(app, 'stickers'), myStickers: path.join(app, 'my-stickers'), received: path.join(app, 'received'), avatars: path.join(app, 'avatars'), visionCache: path.join(app, 'vision-cache.json'),
    chatLog: path.join(shared, 'chat-log.jsonl'), outbox: path.join(shared, 'outbox.jsonl'),
    bridge: path.join(dsh, 'whale-bridge.json'), whaleConfig: path.join(dsh, 'bili-whale.config.json'),
    whaleNight: path.join(dsh, 'whale-night.json'), diary: path.join(dsh, 'whale-diary.md'),
    diaryPrivate: path.join(dsh, 'whale-diary-private.md'), persona: path.join(root, '.bili-ai', 'persona.md'), self: path.join(root, '.bili-ai', 'self.md'), ownerView: path.join(root, '.bili-ai', 'owner-view.md'), videos: path.join(dsh, 'whale-videos'), taste: path.join(root, '.bili-ai', 'taste.json'), dreams: path.join(dsh, 'whale-dreams.md'),
  }
}
