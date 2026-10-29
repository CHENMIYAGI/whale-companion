#!/usr/bin/env bash
# 做平时待机的循环动画 anim/idle.webm：只要「待机呼吸休闲」开头那段站着呼吸的部分。
#
# 为什么（2026-10-29 主人报的 bug「她一直在左顾右盼」）：原来的「待机呼吸休闲」一段 10 秒，
# 从第 3 秒起会把头转向左边、再转向右边。它是循环播放的，所以看起来就像一直在左顾右盼。
# 现在：
#   idle-full.webm  原版「待机呼吸休闲」（从 dsh-pet 复制过来时用这个名字）
#   idle.webm       第 0–68 帧（0–2.8 秒：正面站着、呼吸、眨一次眼），循环；接缝做 7 帧（约 0.3 秒）交叉淡化
# 左顾右盼只在「东张西望」（idle-look.webm）里，作为偶尔的待机小动作播一次。
#
# 用法（Git Bash，在 app/ 目录下）：bash scripts/make-idle.sh
# 需要 ffmpeg。透明通道：解码必须用 libvpx-vp9（ffmpeg 自带的 vp9 解码器会丢掉它），编码用 libvpx-vp9 + yuva420p。
set -euo pipefail
cd "$(dirname "$0")/../src/renderer/anim"

# 以前的 idle.webm 就是原版：第一次跑时改名成 idle-full.webm
if [ ! -f idle-full.webm ]; then
  [ -f idle.webm ] || { echo "找不到 idle-full.webm（「待机呼吸休闲」），先从 dsh-pet 复制过来"; exit 1; }
  mv idle.webm idle-full.webm
fi

END=69    # 第 0–68 帧；第 71 帧左右开始转头
FADE=7    # 交叉淡化帧数，7/24 ≈ 0.29s
ENC=(-c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 -row-mt 1 -auto-alt-ref 0 -an -metadata:s:v:0 alpha_mode=1)
at() { awk "BEGIN { printf \"%.6f\", $1 / 24 }"; }   # 帧数 → 秒

# 循环段 L（69 帧）：A = L 的头 7 帧，B = L 剩下的 62 帧。
# 让 B 的最后 7 帧淡入成 A —— 输出的最后一帧就是 L 的第 7 帧前一刻，下一圈从 B 的开头（L 的第 7 帧）接上，没有跳变。
ffmpeg -v error -y -c:v libvpx-vp9 -i idle-full.webm -filter_complex "\
[0:v]trim=end_frame=$END,setpts=PTS-STARTPTS,format=yuva420p,split[l1][l2];\
[l1]trim=end_frame=$FADE,setpts=PTS-STARTPTS[a];\
[l2]trim=start_frame=$FADE,setpts=PTS-STARTPTS[b];\
[b][a]xfade=transition=fade:duration=$(at $FADE):offset=$(at $((END - 2 * FADE))),format=yuva420p[v]" -map "[v]" "${ENC[@]}" idle.webm

n=$(ffmpeg -v error -c:v libvpx-vp9 -i idle.webm -f null - -stats 2>&1 | grep -o 'frame= *[0-9]*' | tail -1 | tr -dc 0-9)
echo "idle.webm  $n 帧  $(du -k idle.webm | cut -f1)KB（原版留在 idle-full.webm）"
