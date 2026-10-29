# 她的表情包库

图片**不入库**（素材禁止商用，和动画一样），放在 `~/.whale-companion/stickers/`，旁边的 `index.json` 记每张的
文件名、配字、画面描述、情绪标签。这个文件夹里只放「描述文件」（seed），导入时按文件名对上。

## 导入 dsh-pet 的表情包

先把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) clone 下来，然后：

```sh
cd app
npm run stickers -- <dsh-pet 路径>/dsh-pet/assets/memes --seed stickers/dsh-pet.json
```

`dsh-pet.json` 的 `skip` 里那四张不导。导两次不会重复。

## 导入她自己的表情（主人照她的形象画的）

```sh
npm run stickers -- %USERPROFILE%/whale-companion-art --seed stickers/self.json --clean-alpha
```

- `self.json` 里每张都写了「什么场合用」（`when`），她挑表情包时看这个；`三视图` 是形象参考，在 `skip` 里。
- `source: self`：提示词里单独一组排在前面；挑表情包时对得上的话**优先用她自己的**（同样合适时加 0.5 分）。
- `--clean-alpha`：AI 抠图在边上留了一圈几乎透明（alpha < 16）的淡蓝灰色雾，白底上像一圈脏边，导入时变全透明；原图不动。
- 改了说明想更新：改 `self.json` 再跑一遍同样的命令（同一张图不会重复，说明会更新上去）。

## 导入别的图

```sh
npm run stickers -- <文件夹> --source 名字
```

没有 seed 的图：文件名当配字，描述和情绪标签先空着，桌宠开着、看图模型能用时她会自己看一遍补上。

## 状态头像（对话框标题栏）

```sh
npm run stickers -- --avatars <文件夹>
```

按文件名里的词认状态：待机 / 睡 / 看视频（刷）/ 思考（想）/ 说话（聊）/ 没精神（累、叹气），
复制成 `~/.whale-companion/avatars/<idle|sleep|watching|thinking|talking|faint>.png`。
缺哪个状态就用待机的，待机的也没有就用默认头像。

## 规矩

- 只认 png / jpg / gif / webp（看文件头，不看扩展名），5MB 以内。
- 情绪标签只能从 `src/main/core/stickers.js` 的 `EMOTIONS` 里挑（她选表情包时按这个对）。
