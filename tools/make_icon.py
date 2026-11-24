# -*- coding: utf-8 -*-
"""生成手环笔记应用图标 192x192: 黑色圆角底 + 橙色便签纸"""
from PIL import Image, ImageDraw

S = 192
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角黑色背景
d.rounded_rectangle([4, 4, S - 5, S - 5], radius=44, fill=(18, 18, 18, 255))

# 橙色便签纸(带折角)
note = [(44, 40), (148, 40), (148, 128), (124, 152), (44, 152)]
d.polygon(note, fill=(255, 105, 0, 255))
# 折角三角
d.polygon([(124, 152), (148, 128), (124, 128)], fill=(200, 70, 0, 255))

# 白色文字线条
for y in (62, 84, 106):
    d.line([(60, y), (132, y)], fill=(255, 255, 255, 255), width=8)
d.line([(60, 128), (108, 128)], fill=(255, 255, 255, 255), width=8)

img.save(r"D:\project\MI Band Pro\src\Common\logo.png")
print("icon saved")
