# 出处与许可

## 形象

桌宠的形象是社区二创的 DeepSeek「大肥鱼」（鲸鱼娘），**不是 DeepSeek 官方形象**。

- 原型「溟月」：B 站 [@上善无形](https://space.bilibili.com/4456176)
- DeepSeek 版（女仆鲸鱼娘）设计：B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)
- 授权：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名 · 非商业 · 相同方式共享），
  [声明原文](https://www.bilibili.com/opus/1247156596114456581)

## 动画素材

来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（作者 PC2005-cloud）。代码 MIT；素材（动画/提示词/源视频）允许开源使用，**禁止商用**；
基于它的二创在公开渠道发布时须附上原作者仓库地址：<https://github.com/PC2005-cloud/dsh-pet>

入库的、从这些动画里截出来的图：`app/src/renderer/avatar.png`（「待机呼吸休闲」第 0 帧裁的头像）、
`app/build/icon.*`（用这个头像做的图标）、`docs/ui-mock.html` 里内嵌的几张图、`docs/screenshots/`（README 的截图，
里面的桌宠动画帧和一张 dsh-pet 表情包「Ciallo」）。许可同上。

动画和表情包文件本身**不入库**：自己从 dsh-pet 复制（见 `app/src/renderer/anim/README.md`、`app/stickers/README.md`）。

## 表情包

- `app/stickers/dsh-pet.json` 描述的那些表情包：来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的 `dsh-pet/assets/memes/`（作者 PC2005-cloud），
  许可同上面的动画素材：允许开源使用，**禁止商用**，二创公开发布须附原仓库地址。图片本身不入库，导入到 `~/.whale-companion/stickers/`。
- 「她自己的表情」（`app/stickers/self.json` 描述的 16 张，`~/.whale-companion/stickers/` 里 `source: self` 的）和状态头像（`~/.whale-companion/avatars/`）：
  这些图是 AI 根据上面的「大肥鱼」形象生成的，同样遵守 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名 · 非商业 · 相同方式共享）。
  导入时去掉了抠图留下的淡边（`--clean-alpha`），别的没改；图片不入库。

## 代码

- `dsh-bili-whale/`：基于 [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（MIT，Copyright (c) 2026 ALTERSSSS），
  我们的改动见 git 记录与 `dsh-companion.patch`。第三方说明见 `dsh-bili-whale/NOTICE.md`。
- `app/`：本项目代码。

## 所以

- 自己用：没问题。
- 公开发布：写明以上出处；不能卖、不能用来赚钱；基于该形象做的新图/新动画用 CC BY-NC-SA 4.0 分享。
