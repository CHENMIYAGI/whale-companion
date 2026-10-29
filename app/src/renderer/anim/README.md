# 桌宠动画

`*.webm` 不入库（体积大、素材禁止商用），自己从 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的
`dsh-pet/assets/webm/` 复制过来并改名。出处与许可见仓库根目录的 `CREDITS.md`。

规格：VP9 带透明通道，640×360，24fps，大多 10 秒；每段首尾都是正面站姿。

| 文件 | 原文件名 | 用在哪 |
|---|---|---|
| idle-full.webm | 待机呼吸休闲 | 不直接用（10 秒里会左右转头，循环起来像一直在左顾右盼） |
| idle.webm | ↑ 第 0–68 帧 | 待机（循环）：只站着呼吸、眨一次眼，接缝做了淡化（scripts/make-idle.sh） |
| idle-look.webm | 东张西望 | 待机时随机插播 |
| idle-hum.webm | 悠闲哼歌 | 待机时随机插播 |
| idle-bubbles.webm | 鲸鱼吐泡泡特效 | 待机时随机插播 |
| idle-stretch.webm | 超大伸懒腰 | 待机时随机插播 |
| sleep.webm | 原地小憩沉眠 | 不直接用，切成下面三段 |
| sleep-in.webm | ↑ 0–4.50s | 入睡（播一次） |
| sleep-loop.webm | ↑ 4.50–6.71s | 熟睡（循环，接缝做了淡化） |
| sleep-out.webm | ↑ 6.71s–结尾 | 醒来（播一次） |
| watching.webm | 碎碎念-对屏碎碎念 | 刷 B 站（循环） |
| thinking.webm | 工作状态-思考冒泡 | 想回复（循环） |
| talking.webm | 点击回应-元气挥手 | 开始说话时播一次；入场、退出时从第 2 秒（抬手）开始播 |
| faint.webm | 工作状态-垂头叹气冒汗 | 心情 faint 时代替待机 |
| click-happy.webm | 点击回应-开心跃动 | 点她（随机一个） |
| click-shy.webm | 点击回应-害羞惊讶 | 点她 |
| click-pout.webm | 点击回应-傲娇生气 | 点她 |
| click-giggle.webm | 点击回应-挠痒咯咯笑 | 点她 |
| drag.webm | 被鼠标拖拽悬空反馈 | 拖动中（循环） |

一次复制好（Git Bash，`SRC` 换成你 clone 下来的 dsh-pet 路径）：

```sh
SRC=~/dsh-pet/dsh-pet/assets/webm
cd app/src/renderer/anim
while read src dst; do cp "$SRC/$src.webm" "$dst.webm"; done <<'EOF'
待机呼吸休闲 idle-full
东张西望 idle-look
悠闲哼歌 idle-hum
鲸鱼吐泡泡特效 idle-bubbles
超大伸懒腰 idle-stretch
原地小憩沉眠 sleep
碎碎念-对屏碎碎念 watching
工作状态-思考冒泡 thinking
点击回应-元气挥手 talking
工作状态-垂头叹气冒汗 faint
点击回应-开心跃动 click-happy
点击回应-害羞惊讶 click-shy
点击回应-傲娇生气 click-pout
点击回应-挠痒咯咯笑 click-giggle
被鼠标拖拽悬空反馈 drag
EOF
```

复制完再切出待机的循环段和睡觉的三段（需要 ffmpeg；在 `app/` 目录下）：

```sh
bash scripts/make-idle.sh
bash scripts/split-sleep.sh
```

文件缺了也能跑：桌宠会退回 emoji。
