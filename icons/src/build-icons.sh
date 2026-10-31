#!/bin/bash
# 由 SVG 生成 PNG 图标（需要 rsvg-convert：apt-get install librsvg2-bin）
set -e
cd "$(dirname "$0")/.."
rsvg-convert -w 180 -h 180 src/icon.svg -o apple-touch-icon.png
rsvg-convert -w 192 -h 192 src/icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 src/icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 src/icon-maskable.svg -o icon-maskable-512.png
rsvg-convert -w 72 -h 72 src/badge.svg -o badge-72.png
ls -la *.png
