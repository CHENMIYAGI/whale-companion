#!/usr/bin/env bash
# 把 anim/sleep.webm（原地小憩沉眠，24fps、241 帧）切成三段，让她能一直睡着：
#   sleep-in    0–4.50s（第 0–107 帧）     入睡，播一次
#   sleep-loop  4.50–6.71s（第 108–160 帧） 熟睡，循环；接缝做 7 帧（约 0.3s）交叉淡化
#   sleep-out   6.71s–结尾（第 161–240 帧） 醒来，播一次
#
# 用法（Git Bash，在 app/ 目录下）：bash scripts/split-sleep.sh
# 需要 ffmpeg。透明通道：VP9 的透明是另外存的，解码必须用 libvpx-vp9（ffmpeg 自带的 vp9 解码器会丢掉它），
# 编码用 libvpx-vp9 + yuva420p。
set -euo pipefail
cd "$(dirname "$0")/../src/renderer/anim"

IN_END=108      # 4.50s × 24
OUT_START=161   # 6.71s × 24（6.71×24=161.04，取整）
FADE=7          # 交叉淡化帧数，7/24 ≈ 0.29s
ENC=(-c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 -row-mt 1 -auto-alt-ref 0 -an -metadata:s:v:0 alpha_mode=1)
DEC=(-c:v libvpx-vp9 -i sleep.webm)

LOOP_LEN=$((OUT_START - IN_END))
B_LEN=$((LOOP_LEN - FADE))
DUR=$(awk "BEGIN { printf \"%.6f\", $FADE / 24 }")
at() { awk "BEGIN { printf \"%.6f\", $1 / 24 }"; }   # 帧数 → 秒

# 循环段的头 7 帧（第 108–114 帧）被拿去做接缝，所以循环段实际从第 115 帧开始、结尾看起来像第 114 帧。
# 入睡和醒来两段也各做 7 帧交叉淡化去接它，长度不变，三段之间都不跳：
#   sleep-in  最后 7 帧淡入成第 108–114 帧 → 结尾是第 114 帧，接循环段开头的第 115 帧
#   sleep-out 头 7 帧从第 115–121 帧淡入成第 161 帧起 → 开头是第 115 帧，接循环段结尾的"第 114 帧"
ffmpeg -v error -y "${DEC[@]}" -filter_complex "\
[0:v]format=yuva420p,split[s1][s2];\
[s1]trim=end_frame=$IN_END,setpts=PTS-STARTPTS[p];\
[s2]trim=start_frame=$IN_END:end_frame=$((IN_END + FADE)),setpts=PTS-STARTPTS[q];\
[p][q]xfade=transition=fade:duration=$DUR:offset=$(at $((IN_END - FADE))),format=yuva420p[v]" -map "[v]" "${ENC[@]}" sleep-in.webm

ffmpeg -v error -y "${DEC[@]}" -filter_complex "\
[0:v]format=yuva420p,split[s1][s2];\
[s1]trim=start_frame=$((IN_END + FADE)):end_frame=$((IN_END + 2 * FADE)),setpts=PTS-STARTPTS[r];\
[s2]trim=start_frame=$OUT_START,setpts=PTS-STARTPTS[t];\
[r][t]xfade=transition=fade:duration=$DUR:offset=0,format=yuva420p[v]" -map "[v]" "${ENC[@]}" sleep-out.webm

# 循环段 L（53 帧）：A = L 的头 7 帧，B = L 剩下的 46 帧。
# 让 B 的最后 7 帧淡入成 A —— 输出的最后一帧就是 L 的第 7 帧前一刻，下一圈从 B 的开头（L 的第 7 帧）接上，没有跳变。
OFFSET=$(at $((B_LEN - FADE)))
ffmpeg -v error -y "${DEC[@]}" -filter_complex "\
[0:v]trim=start_frame=$IN_END:end_frame=$OUT_START,setpts=PTS-STARTPTS,format=yuva420p,split[l1][l2];\
[l1]trim=end_frame=$FADE,setpts=PTS-STARTPTS[a];\
[l2]trim=start_frame=$FADE,setpts=PTS-STARTPTS[b];\
[b][a]xfade=transition=fade:duration=$DUR:offset=$OFFSET,format=yuva420p[v]" -map "[v]" "${ENC[@]}" sleep-loop.webm

for f in sleep-in sleep-loop sleep-out; do
  n=$(ffmpeg -v error -c:v libvpx-vp9 -i $f.webm -f null - -stats 2>&1 | grep -o 'frame= *[0-9]*' | tail -1 | tr -dc 0-9)
  echo "$f.webm  $n 帧  $(du -k $f.webm | cut -f1)KB"
done
