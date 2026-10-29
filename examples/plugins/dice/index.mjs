// 示例插件：掷骰子（最简单的工具：模型带参数调用，插件检查参数、返回结果）
export default {
  id: 'dice',
  name: '掷骰子',
  setup(api) {
    api.registerTool({
      name: 'roll_dice',
      label: '掷骰子',
      description: '主人让你掷骰子时调用。会返回掷出的点数，你再告诉主人。',
      parameters: {
        type: 'object',
        properties: {
          sides: { type: 'number', description: '骰子有几面，只允许 2 到 100；主人没说几面就用 6' },
        },
        required: ['sides'],
      },
      run: (args) => {
        const sides = Number(args.sides)
        if (!(sides >= 2 && sides <= 100)) return { ok: false, error: '只能掷 2 到 100 面的骰子' }
        const result = Math.floor(Math.random() * sides) + 1
        return { ok: true, sides: sides, result: result }
      },
    })
  },
}
