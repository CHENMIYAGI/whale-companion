// 示例插件：小本本（她记着关于主人的事：上下文 + 增删改工具 + store + 右键菜单）
// 装法：复制到 ~/.whale-companion/plugins/memory/index.mjs
import fs from 'node:fs'
import path from 'node:path'

export default {
  id: 'memories',
  name: 'jishiben',

  setup(api) {
    api.registerContext({
      id: 'memory',
      order: 20,
      build: () => {
        const items = api.store.get('items', [])
        if (items.length === 0) return ''

        const lines = items.map(
          (m) =>
            `- #${m.id} ${m.text}（${m.day}，${m.source === 'owner' ? '主人让你记的' : '你自己记下的'}）`
        )

        return '［你的小本本］自然地用上就好，不用每次都提起，更不要念清单。\n' +
          lines.join('\n')
      },
    })

    // 新增记忆
    api.registerTool({
      name: 'remember',
      label: '记入小本本',
      description:
        '把主人明确要求记住的重要信息，或你判断值得长期保留的信息记进小本本。只记录有长期价值的事实、偏好和约定。不要记录普通闲聊、一次性的小事或临时信息。本工具只负责新增记录；修改和删除请使用专门的工具。',

      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['owner', 'self'],
            description:
              '主人明确要求记录时填 owner；你自己判断值得长期保留时填 self。',
          },
          text: {
            type: 'string',
            description:
              '要记下的事实或信息，简短、准确地写清楚。例如：不吃香菜。',
          },
        },
        required: ['source', 'text'],
      },

      run: (args) => {
        const text = String(args.text ?? '').trim()
        const items = api.store.get('items', [])
        const id = api.store.get('nextId', 1)
        const day = new Date().toLocaleDateString('sv-SE')

        const source = args.source === 'owner' ? 'owner' : 'self'

        if (text.length === 0 || text.length > 100) {
          return {
            ok: false,
            error: '内容不能为空，也不能超过 100 字',
          }
        }

        if (items.length >= 50) {
          return {
            ok: false,
            error: '小本本记满了，先划掉几条',
          }
        }

        items.push({
          id: id,
          text: text,
          source: source,
          day: day,
        })

        api.store.set('nextId', id + 1)
        api.store.set('items', items)

        return {
          ok: true,
          id: id,
          text: text,
          note: '告诉主人你记在小本本上了',
        }
      },
    })

    // 删除记忆
    api.registerTool({
      name: 'forget',
      label: '从小本本上划掉',
      description:
        '当主人说“忘了吧”“划掉”时，或某条记录已经不再正确时，使用此工具删除对应记录。主人要求修改某条记录时，先删除旧记录，再使用 remember 记入修改后的内容。必须使用小本本上已有的编号。',

      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: '小本本上的编号，只填数字。',
          },
        },
        required: ['id'],
      },

      run: (args) => {
        const items = api.store.get('items', [])
        const id = Number(args.id)

        if (!Number.isInteger(id) || id <= 0) {
          return {
            ok: false,
            error: '编号必须是正整数哦',
          }
        }

        const item = items.find((m) => m.id === id)

        if (!item) {
          return {
            ok: false,
            error: '小本本上找不到哦',
          }
        }

        const rest = items.filter((m) => m.id !== id)

        api.store.set('items', rest)

        return {
          ok: true,
          id: id,
          text: item.text,
          note: '已经从小本本上划去了哦',
        }
      },
    })

    // 查看小本本
    api.registerMenu({
      id: 'view',
      label: '看看她的小本本',
      icon: '📒',
      group: 'look',

      // 小本本为空时，菜单项变灰，不能点击
      enabled: () => api.store.get('items', []).length > 0,

      onClick: () => {
        // 1. 取出记事列表
        const items = api.store.get('items', [])

        // 2. 把每条记事变成一行文字
        const lines = items.map(
          (m) =>
            `#${m.id} ${m.text}（${m.day}，${m.source === 'owner' ? '你让她记的' : '她自己记下的'}）`
        )

        // 3. 添加标题
        const content =
          `她的小本本（共 ${items.length} 条）\n\n` +
          lines.join('\n')

        // 4. 拼接文件路径
        const file = path.join(
          api.services.paths.app,
          '小本本.txt'
        )

        // 5. 写入文件并打开
        fs.writeFileSync(file, content, 'utf8')
        api.services.openPath(file)
      },
    })
  },
}
