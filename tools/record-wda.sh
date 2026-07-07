#!/usr/bin/env bash
# Record an iOS device session by polling WDA /screenshot into frames, then encode to mp4.
# Usage: record-wda.sh <out.mp4> <duration_seconds> [fps]
set -euo pipefail
OUT="${1:?out.mp4 required}"
DUR="${2:-10}"
FPS="${3:-4}"
WDA="${WDA_URL:-http://localhost:8100}"

FRAMES="$(mktemp -d)"
trap 'rm -rf "$FRAMES"' EXIT

interval=$(python3 -c "print(1.0/$FPS)")
total=$(python3 -c "print(int($DUR*$FPS))")
echo "capturing $total frames @ ${FPS}fps from $WDA ..."

i=0
start=$(python3 -c "import time;print(time.time())")
while [ "$i" -lt "$total" ]; do
  n=$(printf "%05d" "$i")
  curl -s --max-time 5 "$WDA/screenshot" \
    | python3 -c "import sys,json,base64;open('$FRAMES/f_$n.png','wb').write(base64.b64decode(json.load(sys.stdin)['value']))" \
    || echo "frame $n dropped"
  i=$((i+1))
  # pace to target fps
  python3 -c "import time;t=$start+$i*$interval;d=t-time.time();_=time.sleep(d) if d>0 else None"
done

echo "encoding -> $OUT"
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$FRAMES/f_%05d.png" \
  -vf "scale=trunc(iw/3)*2:trunc(ih/3)*2" -c:v libx264 -pix_fmt yuv420p "$OUT"
echo "done: $OUT ($(ls -la "$OUT" | awk '{print $5}') bytes)"
