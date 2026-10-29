# 插件开发指南

桌宠的功能几乎都是插件：人设、日记、和 DSH 的连接、表情包、做梦……都在 `app/src/main/plugins/` 里，用的就是下面这套 API。
你自己的插件放在 `%USERPROFILE%\.whale-companion\plugins\<名字>\index.mjs`（Mac / Linux：`~/.whale-companion/plugins/<名字>/index.mjs`），
重启桌宠就会加载。设置面板最下面「插件」里能看到加载成功没有。

> ⚠️ 插件和桌宠跑在同一个进程里，能读写你电脑上的文件。**只装你看得懂、信得过的插件。**

## 最小的插件

```js
// ~/.whale-companion/plugins/weekend/index.mjs
export default {
  id: 'weekend',             // 唯一，小写字母 / 数字 / 横杠
  name: '周末提醒',
  setup(api) {
    api.registerContext({
      id: 'weekend', order: 1000,
      build: ({ now }) => (now.getDay() % 6 === 0 ? '［今天］今天是周末，主人可能比较有空。' : ''),
    })
  },
}
```

## API（`setup(api)` 里能用的）

| 方法 | 做什么 |
|---|---|
| `api.registerContext({ id, order, build })` | 往聊天的系统提示里加一段。`build({ now, userText })` 返回文字（空字符串 = 这次不加）。`order` 小的在前；**不常变的内容用小 order**，能多命中 DeepSeek 的上下文缓存、更省钱 |
| `api.registerTool({ name, label, description, parameters, confirm, silent, run })` | 给聊天模型一个能力。`parameters` 是 JSON Schema；`run(args, ctx)` 返回一个对象给模型看（建议 `{ ok, ... }` / `{ ok: false, error }`）。`confirm`：需要主人点头的，返回 `{ title, text, okLabel, cancelLabel }` 就会弹确认卡片。`silent: true` 不显示「…✓」小提示 |
| `api.registerMenu({ id, label, order, enabled, icon, hint, toggle, onClick })` | 右键菜单加一项。`label / enabled / icon / hint / toggle` 都可以是函数（每次弹菜单时算）；灰掉时用 `hint` 写原因 |
| `api.on(事件, fn)` | 订阅事件：`chat:user`（主人说了一句）、`chat:assistant`（她说了一句）、`chat:busy`、`chat:incoming`（她从 DSH 发回来的话）、`video:open`、`pet:base`（她的状态变了）…… |
| `api.say(text)` | 桌宠冒一个气泡 |
| `api.every(ms, fn)` | 定时任务（卸载时自动清掉） |
| `api.store.get(key, 默认值)` / `api.store.set(key, 值)` | 插件自己的小状态，存在 `state.json`，重启还在 |
| `api.settings.get()` / `api.settings.set(patch)` | 插件自己的设置（`config.json` 的 `plugins.settings[id]`） |
| `api.services` | 一些现成的东西：`paths`（各个文件在哪）、`chatLog`、`bridge`（连 DSH）、`openPath`、`openExternal`（只放行 B 站视频页和 DeepSeek）…… |
| `api.log(...)` | 写进 `companion.log`，前面带插件 id |

完整说明在 [`app/src/main/core/plugin-host.js`](../app/src/main/core/plugin-host.js) 的开头。

## 设计插件时想清楚这五件事

1. **她什么时候需要知道它？** 每次都要知道的放进上下文（`registerContext`）；偶尔要查的做成工具（`registerTool`），让她自己决定什么时候用。
2. **工具的说明写给谁看？** `description` 是写给模型看的：写清楚什么时候该用、什么时候**不该**用、参数怎么填。
3. **参数不可信。** 模型给的参数可能缺、可能乱：在 `run` 里检查（范围、长度、类型），不对就返回 `{ ok: false, error: '…' }`，她会看到原因再改。
4. **要不要主人点头？** 会改东西、花钱、对外说话的，加 `confirm` 弹卡片。**桌宠不能直接发 B 站评论 / 私信**，要发只能排任务让 DSH 里的她按原流程做。
5. **出错了会怎样？** 一个插件出错不会拖垮别的（setup、上下文、工具、菜单里抛错都会被接住、记日志）；但你的插件那部分功能会没了，看 `companion.log`。

## 例子

- [`examples/plugins/weekend`](../examples/plugins/weekend/index.mjs)：最简单的上下文
- [`examples/plugins/dice`](../examples/plugins/dice/index.mjs)：最简单的工具（检查参数）
- [`examples/plugins/memory`](../examples/plugins/memory/index.mjs)：小本本 —— 上下文 + 增删改工具 + `store` + 右键菜单 + 写给 DSH 里的她看的文件
- 内置插件 `app/src/main/plugins/*`：更复杂的写法（连 DSH、定时、读写共享文件）

## 不开桌宠试跑

不花钱、不碰你真的桌宠数据：真实的插件系统 + 假的模型，按你给的参数调用工具。

```sh
cd app
node test/try-plugin.mjs ../examples/plugins/memory/index.mjs remember '{"source":"owner","text":"不吃香菜"}'
```

会打印每次工具调用返回给模型的结果、插件加进系统提示的内容、右键菜单项。

## 规矩

- 显示外来的文字（模型、网络、DSH 发来的）只用 `textContent`，不要拼 HTML。
- 插件 API（`registerContext / registerTool / registerMenu / on / every / say / store / settings / services`）会保持稳定；新能力只会加新方法。
