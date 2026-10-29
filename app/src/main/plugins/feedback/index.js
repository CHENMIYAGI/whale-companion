// 聊天就是反馈：主人在桌宠里说话 → 记一次 quota react（原项目的沉默衰减就不会误以为他不理她）
// 节流：30 分钟最多记一次（一直聊天不会把 feedback.json 刷爆）；DSH 没开时先攒着，开了再补记。
const GAP_MS = 30 * 60 * 1000

export default {
  id: 'feedback',
  name: '聊天算反馈',
  setup(api) {
    const { bridge } = api.services
    async function record(note) {
      const r = await bridge.feedback(note)
      if (r.ok || r.status === 429) { api.store.set('lastAt', Date.now()); api.store.set('pending', null); return true }
      if (r.offline) api.store.set('pending', { note, at: Date.now() })
      return false
    }
    api.on('chat:user', async (msg) => {
      if (Date.now() - api.store.get('lastAt', 0) < GAP_MS) return
      await record(String(msg.text).replace(/\s+/g, ' ').slice(0, 40))
    })
    // DSH 之前没开 → 每分钟试一次补记（只补最近 3 天内的）
    api.every(60_000, async () => {
      const p = api.store.get('pending', null)
      if (!p) return
      if (Date.now() - p.at > 3 * 86400_000) { api.store.set('pending', null); return }
      await record(p.note)
    })
  },
}
