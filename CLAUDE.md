# whale-companion：给 dsh-bili-whale 配一个桌宠

> 给 Claude Code 看的项目说明（人也可以读）。和具体某个人的协作习惯放在 `CLAUDE.local.md`（不入库）。

## 一句话

DSH（DeepSeek Harness）里有一条会自己刷 B 站、写日记的鱼（`dsh-bili-whale` 插件）。这个项目给她做一个**桌宠**：
住在桌面上，点她会弹出对话框聊天（DeepSeek API），能叫她去刷 B 站 / 看指定视频，她刷完回来在桌宠上冒气泡。
形象是社区二创角色「大肥鱼」（女仆鲸鱼娘），动画和一部分表情包借用 dsh-pet 项目的素材（许可见 `CREDITS.md`，素材不入库）。

## 目录

```
dsh-bili-whale/            原插件 + 我们的改动（装进 DSH）。上游：github.com/Alterssss/dsh-bili-whale 0.4.6 @3e11454
  lib/companion.js           桌宠任务队列、给她的提示词、沉默天数（纯逻辑）
  lib/companion-bridge.js    本机接口：127.0.0.1 随机端口 + 令牌，写进 $DSH_HOME/whale-bridge.json
  tools/commands/companion.mjs   她用的命令：companion say / chat-today / status
  （另在 lib/scheduler.js、lib/index.js、tools/bili.mjs 等处有少量挂钩）
dsh-companion.patch        上面这些改动相对上游的补丁（上游更新后可重新打）
app/                       桌宠（Electron 38）
  src/main/main.js           主进程：窗口（桌宠 / 对话框 / 右键菜单）、托盘、IPC、插件装配、各种定时检查
  src/main/core/             配置、聊天记录、DeepSeek 流式调用、插件系统、聊天引擎（分条、接着说、主动开口）、
                             忙碌感知、表情包、看图、做梦、连 DSH 的客户端……（都是纯逻辑，能单独测）
  src/main/plugins/          内置插件：persona / self / owner-view / diary / bili-whale / video-notes / taste /
                             stickers / dreams / feedback
  src/preload/preload.cjs    窗口和主进程之间的白名单（window.pet / window.chat / window.menu）
  src/renderer/              桌宠（pet.*）、对话框（chat.*）、右键菜单（menu.*）；anim/ 放动画（不入库）
  stickers/                  表情包的描述文件（图不入库）；persona.example.md 人设模板
  scripts/                   启动、桌面快捷方式、导入表情包、切动画、做图标
  test/*.test.mjs            node --test 的单元测试；test/*-window.mjs 用 Electron 开窗口测界面并截图
docs/PLUGINS.md            插件开发指南
examples/plugins/          插件例子：memory（小本本）、dice、weekend
```

## 运行时共享文件（两边靠它们通信；都不在仓库里）

| 文件 | 谁写 | 谁读 |
|---|---|---|
| `$DSH_HOME/whale-bridge.json` | DSH 插件 | 桌宠（端口+令牌） |
| `$DSH_HOME/companion/chat-log.jsonl` | 桌宠 | 两边（她醒来用 `companion chat-today` 读） |
| `$DSH_HOME/companion/outbox.jsonl` | 她（`companion say`） | 桌宠（冒气泡） |
| `$DSH_HOME/whale-diary*.md` | 她 | 两边（醒来只读最近 7 天：`bili.mjs memories recall`） |
| `$DSH_HOME/whale-memories.md` | 她（「回忆」：一周前的日记提炼出来的） | DSH（醒来读） |
| `$DSH_HOME/whale-diary-archive/` | `bili.mjs memories archive`（整理完的原文按月搬进来，不删） | `feed`（看过的 BV 防重看） |
| `$DSH_HOME/whale-letters/<日期>-<旧会话>.md` | 她（换会话前，旧会话里写「给下一个自己的信」） | DSH（新会话第一次先读） |
| `$DSH_HOME/whale-videos/<BV>/` | `debrief`（素材自动存）+ 她（`bili.mjs video note/progress`）；90 天没再看就清，收藏的留 | 两边（桌宠的 `recall_video` 只读） |
| `$DSH_HOME/companion/notebook.md` | 桌宠的小本本插件（写给她看的格式） | DSH（醒来时放进人设段落，「她眼中的主人」后面；只读不改） |
| `$DSH_HOME/whale-dreams.md` | 桌宠（她在桌宠上睡着时，每晚最多一个梦；和日记分开） | 桌宠（第二天第一次聊天带一次「昨晚的梦（这是梦，不是真的发生过）」；右键「她的梦」）。**梦不进**小本本、回忆、我的成长、她眼中的主人；DSH 不读 |
| `$DSH_HOME/whale-pause.json` | 出门开关（`POST /v1/pause`） | DSH（生物钟、任务投递）|
| `~/.bili-ai/persona.md` | 用户（出生设定，她改不了；模板见 `app/persona.example.md`） | 两边 |
| `~/.bili-ai/self.md` | 她（「我的成长」：桌宠的 grow/ungrow、DSH 的 `bili.mjs self`，原子写） | 两边 |
| `~/.bili-ai/owner-view.md` | 她（「我眼中的主人」：`bili.mjs owner-view write`，旧版按日期进 `owner-view-archive/`） | 两边（桌宠只读，右键「她眼中的我」） |
| `~/.bili-ai/taste.json` | 两边：DSH 管分类表、「留着以后」的加入和预习（`video tag --later`、`video preview`）；桌宠记主人的反应、邀请的回答、一起看到第几 P | DSH（`feed` 加权、醒来时预习下一 P）；桌宠右键「她的分类」「一起看的清单」。两边读写都要原样保留不认识的字段（`later`） |
| `~/.whale-companion/stickers/` + `index.json` | 导入脚本（`npm run stickers`）、她要来的图 | 桌宠（`send_sticker`） |
| `~/.whale-companion/avatars/<状态>.png` | 导入脚本（`--avatars`） | 桌宠对话框标题栏 |
| `~/.whale-companion/my-stickers/` | 用户（直接丢图，或对话框里「☆ 收藏」） | 桌宠表情面板 |
| `~/.whale-companion/received/` | 桌宠（粘贴/拖进来的图先复制到这里） | 桌宠 |
| `~/.whale-companion/vision-cache.json` | 桌宠（看过的图：hash → 配字/描述/标签） | 桌宠 |
| `~/.whale-companion/config.json` | 桌宠 | 桌宠（API key 用 safeStorage 加密） |
| `~/.whale-companion/plugins/<名字>/index.mjs` | 用户 | 桌宠（用户插件） |

`$DSH_HOME/companion/` 由桌宠首次启动时创建；DSH 那边看到它存在才会在提示词里加桌宠相关步骤，没装桌宠时原项目行为不变。

## 规则

- **安全**：渲染进程全部 `contextIsolation + sandbox`，只通过 preload 白名单通信；主进程 IPC 都检查发送方（`ours(e)`）并校验参数；
  显示外来文字只用 `textContent`（禁止 `innerHTML`）；外部链接只放行 bilibili 视频页和 DeepSeek 官网；本机接口只绑 127.0.0.1 且要令牌；
  图片只认本地 png/jpg/gif/webp（看文件头、5MB 以内），复制进桌宠自己的文件夹再通过 `sticker://` 显示。
- **对外发言只走原项目的闸门**：桌宠和聊天模型不能直接发 B 站评论/私信，只能排任务让 DSH 里的她按原流程做。
- **插件 API 保持稳定**（`registerContext/registerTool/registerMenu/on/every/say/store/settings/services`）；要加能力就加新方法，别改旧的。
- 改 `dsh-bili-whale/` 时尽量小，改完跑 `npm test` 并重新生成 `dsh-companion.patch`；没装桌宠时原行为必须不变。
- **隐私**：仓库里不放任何运行时数据（人设、日记、聊天记录、梦、cookie、key、截图、日志）和个人路径；文档里路径写 `~` 或 `%USERPROFILE%`。
- 代码注释用中文，写"为什么"。
- 动画素材与形象：非商用、署名、相同方式共享（见 `CREDITS.md`）；dsh-pet 的动画和表情包不入库。

## 还没做的

- Windows 上和真实 DSH 的完整联调；看图模型、主动开口、接着说、做梦只用本机假接口测过。
- DeepSeek 思考模式（reasoning）模型在工具调用多轮里要求回传 `reasoning_content`，我们默认关掉思考模式（`llm.thinking: false`）。

## 常用命令

```sh
cd dsh-bili-whale && npm test                       # 原插件 + 桌宠接口的测试
cd app && npm install && npm start                  # 启动桌宠（Windows 上会临时把终端换成 UTF-8，中文日志不乱码）
cd app && npm test                                  # 桌宠的单元测试
cd app && npm run shortcut                          # 桌面建快捷方式（名字是她的名字；不弹终端；开着时双击 = 打开对话框）
cd app && npm run stickers -- <文件夹> --seed stickers/dsh-pet.json   # 导入表情包（见 app/stickers/README.md）
cd app && bash scripts/make-icon.sh                 # 用头像重做 build/icon.ico（要 ffmpeg）
cd app && bash scripts/make-idle.sh                 # 从 idle-full.webm 切出只站着呼吸的待机循环 idle.webm（要 ffmpeg）
cd app && bash scripts/split-sleep.sh               # 把 sleep.webm 切成 入睡/熟睡/醒来 三段（要 ffmpeg）
cd app && node test/try-plugin.mjs ../examples/plugins/memory/index.mjs remember '{"source":"owner","text":"不吃香菜"}'
cd app && npx electron test/chat-window.mjs         # 对话框测试 + 截图（假主进程）
cd app && npx electron test/menu-window.mjs         # 右键菜单测试 + 截图
cd app && npx electron test/pet-window.mjs          # 桌宠窗口测试 + 截图（Linux 无屏幕：xvfb-run -a npx electron --no-sandbox ...）
```

日志：`~/.whale-companion/companion.log`（"点了没反应"先看这里）。
