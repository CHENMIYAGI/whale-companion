#!/usr/bin/env bash
# 用她的头像（src/renderer/avatar.png）做桌面快捷方式的图标：圆形 + 白边，边缘抗锯齿。
#   build/icon.png  256×256（窗口图标用）
#   build/icon.ico  16/24/32/48/64/128/256 七个尺寸（Windows 按显示的地方挑大小）
# 用法（Git Bash，在 app/ 目录下）：bash scripts/make-icon.sh    需要 ffmpeg
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 头像缩到 236 → 裁成圆 → 贴在 256 的白底中间（白边 10px）→ 整体再裁成圆。clip(半径-距离,0,1) 让边缘有 1px 过渡，不起锯齿
ffmpeg -v error -y -i src/renderer/avatar.png -filter_complex "\
color=white:s=256x256,format=rgba[bg];\
[0]scale=236:236,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(118-hypot(X-117.5,Y-117.5),0,1)'[face];\
[bg][face]overlay=10:10,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(128-hypot(X-127.5,Y-127.5),0,1)'" \
  -frames:v 1 build/icon.png

inputs=(); maps=(); i=0
for s in 256 128 64 48 32 24 16; do
  ffmpeg -v error -y -i build/icon.png -vf "scale=$s:$s:flags=lanczos" "$tmp/$s.png"
  inputs+=(-i "$tmp/$s.png"); maps+=(-map "$i:v"); i=$((i + 1))
done
ffmpeg -v error -y "${inputs[@]}" "${maps[@]}" -c:v png build/icon.ico
echo "build/icon.png、build/icon.ico 做好了"
